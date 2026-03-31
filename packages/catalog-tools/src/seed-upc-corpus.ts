import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import { classifyIdentifier, normalizeIdentifier } from "@reselleros/catalog";
import { db } from "@reselleros/db";

const BATCH_SIZE = 2000;

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

type PendingSeedRecord = {
  normalizedIdentifier: string;
  identifierType: "UPC" | "EAN" | "ISBN" | "UNKNOWN";
  title: string;
};

async function flushBatch(records: PendingSeedRecord[]) {
  if (records.length === 0) {
    return {
      created: 0,
      updated: 0,
      skipped: 0
    };
  }

  const deduped = [...new Map(records.map((record) => [record.normalizedIdentifier, record])).values()];
  const existing = await db.catalogIdentifier.findMany({
    where: {
      normalizedIdentifier: {
        in: deduped.map((record) => record.normalizedIdentifier)
      }
    },
    select: {
      id: true,
      normalizedIdentifier: true,
      trustStatus: true,
      canonicalTitle: true,
      identifierType: true
    }
  });
  const existingByIdentifier = new Map(existing.map((record) => [record.normalizedIdentifier, record]));
  const now = new Date();

  const createRows = deduped
    .filter((record) => !existingByIdentifier.has(record.normalizedIdentifier))
    .map((record) => ({
      normalizedIdentifier: record.normalizedIdentifier,
      identifierType: record.identifierType,
      canonicalTitle: record.title,
      trustStatus: "SEED_TENTATIVE" as const,
      confidenceScore: 0.25,
      lastRefreshedAt: now
    }));

  if (createRows.length > 0) {
    await db.catalogIdentifier.createMany({
      data: createRows,
      skipDuplicates: true
    });
  }

  const updates = deduped
    .map((record) => {
      const current = existingByIdentifier.get(record.normalizedIdentifier);

      if (!current) {
        return null;
      }

      if (current.trustStatus === "OPERATOR_CONFIRMED") {
        return null;
      }

      const needsTitle = !current.canonicalTitle?.trim();
      const needsIdentifierType = current.identifierType === "UNKNOWN" && record.identifierType !== "UNKNOWN";

      if (!needsTitle && !needsIdentifierType) {
        return null;
      }

      return db.catalogIdentifier.update({
        where: { id: current.id },
        data: {
          canonicalTitle: needsTitle ? record.title : current.canonicalTitle,
          identifierType: needsIdentifierType ? record.identifierType : undefined,
          lastRefreshedAt: now
        }
      });
    })
    .filter((operation): operation is ReturnType<typeof db.catalogIdentifier.update> => Boolean(operation));

  if (updates.length > 0) {
    await db.$transaction(updates);
  }

  return {
    created: createRows.length,
    updated: updates.length,
    skipped: deduped.length - createRows.length - updates.length
  };
}

async function main() {
  const inputPath = process.argv[2] || path.join(os.homedir(), "Downloads", "upc_corpus.csv");
  const artifactDir = path.join(process.cwd(), "tmp", "catalog-seed");
  await mkdir(artifactDir, {
    recursive: true
  });

  const stream = createReadStream(inputPath, {
    encoding: "utf8"
  });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  let lineNumber = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const failures: string[] = [];
  let batch: PendingSeedRecord[] = [];

  await db.$connect();

  try {
    for await (const line of reader) {
      lineNumber += 1;

      if (lineNumber === 1) {
        continue;
      }

      const [ean, name] = parseCsvLine(line);

      if (!ean || !name) {
        skipped += 1;
        continue;
      }

      const normalizedIdentifier = normalizeIdentifier(ean);

      if (!normalizedIdentifier) {
        skipped += 1;
        continue;
      }

      batch.push({
        normalizedIdentifier,
        identifierType: classifyIdentifier(normalizedIdentifier),
        title: name
      });

      if (batch.length >= BATCH_SIZE) {
        try {
          const result = await flushBatch(batch);
          created += result.created;
          updated += result.updated;
          skipped += result.skipped;
        } catch (error) {
          failures.push(`line ${lineNumber}: ${error instanceof Error ? error.message : "unknown failure"}`);
        } finally {
          batch = [];
        }
      }
    }

    if (batch.length > 0) {
      const result = await flushBatch(batch);
      created += result.created;
      updated += result.updated;
      skipped += result.skipped;
    }
  } finally {
    await db.$disconnect();
  }

  const summary = {
    inputPath,
    created,
    updated,
    skipped,
    failureCount: failures.length,
    failures: failures.slice(0, 100)
  };

  await writeFile(path.join(artifactDir, "upc-corpus-summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

void main();
