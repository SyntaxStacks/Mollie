import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { db } from "@reselleros/db";

import { crawlIdentifier } from "./crawler.js";

function collectIdentifiers(argv: string[]) {
  const identifiers: string[] = [];
  let filePath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--identifier" && argv[index + 1]) {
      identifiers.push(argv[index + 1] ?? "");
      index += 1;
      continue;
    }

    if (token === "--file" && argv[index + 1]) {
      filePath = argv[index + 1] ?? null;
      index += 1;
    }
  }

  return {
    identifiers,
    filePath
  };
}

async function main() {
  const { identifiers, filePath } = collectIdentifiers(process.argv.slice(2));
  const fileIdentifiers = filePath
    ? (await readFile(filePath, "utf8"))
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  const finalIdentifiers = [...new Set([...identifiers, ...fileIdentifiers])];

  if (finalIdentifiers.length === 0) {
    throw new Error("Provide identifiers with --identifier or --file");
  }

  const runDir = path.join(process.cwd(), "tmp", "catalog-crawler", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(runDir, {
    recursive: true
  });

  await db.$connect();
  const results = [];

  try {
    for (const identifier of finalIdentifiers) {
      const result = await crawlIdentifier({
        identifier,
        artifactDir: runDir
      });
      results.push(result);
    }
  } finally {
    await db.$disconnect();
  }
  await writeFile(path.join(runDir, "run-summary.json"), JSON.stringify(results, null, 2), "utf8");
  console.log(JSON.stringify({ runDir, count: results.length }, null, 2));
}

void main();
