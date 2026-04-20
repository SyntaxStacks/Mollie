import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { z } from "zod";

import { extractRankedProductImageUrlsFromHtml, inferAsinFromUrl, rankProductImageUrls } from "@reselleros/catalog";
import {
  addInventoryImage,
  createInventoryImportItemForRun,
  createInventoryImportRunForWorkspace,
  createInventoryItem,
  findInventoryImportRunForWorkspace,
  listInventoryImportRunsForWorkspace,
  recordAuditLog,
  updateInventoryImportRun
} from "@reselleros/db";
import { buildIdempotencyKey, enqueueJob } from "@reselleros/queue";
import {
  inventoryImportAccountStartSchema,
  inventoryImportUrlApplySchema,
  inventoryImportUrlPreviewSchema,
  type InventoryImportCandidate
} from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

const maxPreviewResponseBytes = 512 * 1024;
const maxPreviewRedirects = 3;

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const first = parts[0] ?? 0;
  const second = parts[1] ?? 0;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6(address: string) {
  const normalized = address.toLowerCase();

  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

function isPrivateAddress(address: string) {
  const family = isIP(address);

  if (family === 4) {
    return isPrivateIpv4(address);
  }

  if (family === 6) {
    return isPrivateIpv6(address);
  }

  return true;
}

async function assertPublicPreviewUrl(rawUrl: string) {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Preview URL is invalid.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Preview URL must use http or https.");
  }

  const hostname = parsed.hostname.trim().toLowerCase();

  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Preview URL must point to a public host.");
  }

  if (isIP(hostname) && isPrivateAddress(hostname)) {
    throw new Error("Preview URL must point to a public host.");
  }

  const resolved = await lookup(hostname, { all: true, verbatim: true });

  if (resolved.length === 0 || resolved.some((entry) => !entry.address || isPrivateAddress(entry.address))) {
    throw new Error("Preview URL must point to a public host.");
  }

  return parsed;
}

async function readPreviewResponseText(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");

  if (Number.isFinite(declaredLength) && declaredLength > maxPreviewResponseBytes) {
    const canceled = response.body?.cancel();
    if (canceled) {
      await canceled.catch(() => undefined);
    }
    throw new Error("Preview page is too large to import.");
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    received += value.byteLength;
    if (received > maxPreviewResponseBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Preview page is too large to import.");
    }

    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

async function fetchPreviewHtml(rawUrl: string) {
  let currentUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= maxPreviewRedirects; redirectCount += 1) {
    const parsedUrl = await assertPublicPreviewUrl(currentUrl);
    const response = await fetch(parsedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MollieImportBot/1.0; +https://mollie.biz/contact)"
      },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000)
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");

      if (!location) {
        throw new Error("Preview URL redirected without a destination.");
      }

      currentUrl = new URL(location, parsedUrl).toString();
      continue;
    }

    if (!response.ok) {
      throw new Error("Preview fetch failed.");
    }

    return {
      html: await readPreviewResponseText(response),
      finalUrl: parsedUrl.toString()
    };
  }

  throw new Error("Preview URL redirected too many times.");
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractMetaContent(html: string, property: string) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtml(match[1]);
    }
  }

  return null;
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtml(stripHtml(match[1])) : null;
}

function isAmazonHost(rawUrl: string) {
  try {
    return new URL(rawUrl).hostname.toLowerCase().includes("amazon.");
  } catch {
    return false;
  }
}

async function fetchAmazonSearchPreviewImageUrls(rawUrl: string) {
  const asin = inferAsinFromUrl(rawUrl);

  if (!asin) {
    return [];
  }

  try {
    const preview = await fetchPreviewHtml(`https://www.amazon.com/s?k=${encodeURIComponent(asin)}`);
    return extractRankedProductImageUrlsFromHtml(preview.html, {
      pageUrl: preview.finalUrl
    });
  } catch {
    return [];
  }
}

function inferSourceKind(sourcePlatform: string) {
  return sourcePlatform === "NIFTY" || sourcePlatform === "CROSSLIST" ? "CSV_EXPORT" : "LINKED_ACCOUNT";
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values.map((value) => value.replace(/^"(.*)"$/, "$1").trim());
}

function parseCsvText(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const firstLine = lines[0];

  if (!firstLine) {
    return [];
  }

  const header = parseCsvLine(firstLine).map((value) => value.toLowerCase());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return header.reduce<Record<string, string>>((record, key, index) => {
      record[key] = values[index] ?? "";
      return record;
    }, {});
  });
}

function csvRowToCandidate(row: Record<string, string>, fallbackSourcePlatform: string): InventoryImportCandidate {
  const title = row.title || row.name || row.product_name || row.listing_title || row.item || "Imported item";
  const brand = row.brand || row.manufacturer || null;
  const category = row.category || row.department || "General Merchandise";
  const condition = row.condition || "Good used condition";
  const size = row.size || null;
  const color = row.color || null;
  const sourceUrl = row.url || row.source_url || row.link || null;
  const externalItemId = row.external_id || row.listing_id || row.id || null;
  const imageUrls = [row.image_url, row.image, row.primary_image]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(/[|,\s]+/))
    .map((value) => value.trim())
    .filter((value) => /^https?:\/\//i.test(value));
  const parsedPrice = Number(row.price || row.list_price || row.asking_price || "");

  return {
    title,
    brand,
    category,
    condition,
    size,
    color,
    quantity: 1,
    costBasis: 0,
    estimatedResaleMin: Number.isFinite(parsedPrice) ? parsedPrice : null,
    estimatedResaleMax: Number.isFinite(parsedPrice) ? parsedPrice : null,
    priceRecommendation: Number.isFinite(parsedPrice) ? parsedPrice : null,
    sourceUrl,
    externalItemId,
    imageUrls,
    attributes: {
      importSourcePlatform: fallbackSourcePlatform
    }
  };
}

async function createInventoryFromCandidate(input: {
  workspaceId: string;
  candidate: InventoryImportCandidate;
  sourcePlatform: string;
  sourceUrl?: string | null;
  importRunId: string;
}) {
  const item = await createInventoryItem(input.workspaceId, {
    title: input.candidate.title,
    brand: input.candidate.brand ?? null,
    category: input.candidate.category,
    condition: input.candidate.condition,
    size: input.candidate.size ?? null,
    color: input.candidate.color ?? null,
    quantity: input.candidate.quantity,
    costBasis: input.candidate.costBasis,
    estimatedResaleMin: input.candidate.estimatedResaleMin ?? null,
    estimatedResaleMax: input.candidate.estimatedResaleMax ?? null,
    priceRecommendation: input.candidate.priceRecommendation ?? null,
    attributes: {
      ...(input.candidate.attributes ?? {}),
      importSource: "INVENTORY_IMPORT",
      importSourcePlatform: input.sourcePlatform,
      importRunId: input.importRunId,
      sourceUrl: input.sourceUrl ?? input.candidate.sourceUrl ?? null,
      externalItemId: input.candidate.externalItemId ?? null
    }
  });

  await Promise.all(
    input.candidate.imageUrls.map((url, position) =>
      addInventoryImage(item.id, {
        url,
        kind: "ORIGINAL",
        position
      })
    )
  );

  return item;
}

function serializeImportRun(run: Awaited<ReturnType<typeof findInventoryImportRunForWorkspace>>) {
  if (!run) {
    return null;
  }

  return {
    id: run.id,
    workspaceId: run.workspaceId,
    sourceKind: run.sourceKind,
    sourcePlatform: run.sourcePlatform,
    marketplaceAccountId: run.marketplaceAccountId ?? null,
    sourceUrl: run.sourceUrl ?? null,
    uploadFilename: run.uploadFilename ?? null,
    status: run.status,
    progressCount: run.progressCount,
    appliedCount: run.appliedCount,
    failedCount: run.failedCount,
    skippedCount: run.skippedCount,
    cursor: (run.cursorJson ?? null) as Record<string, unknown> | null,
    stats: (run.statsJson ?? null) as Record<string, unknown> | null,
    artifactUrls: ((run.artifactUrlsJson ?? []) as string[]) ?? [],
    lastErrorCode: run.lastErrorCode ?? null,
    lastErrorMessage: run.lastErrorMessage ?? null,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    marketplaceAccount: run.marketplaceAccount
      ? {
          id: run.marketplaceAccount.id,
          platform: run.marketplaceAccount.platform,
          displayName: run.marketplaceAccount.displayName
        }
      : null,
    items: run.items.map((item) => ({
      id: item.id,
      runId: item.runId,
      externalItemId: item.externalItemId ?? null,
      sourceUrl: item.sourceUrl ?? null,
      dedupeKey: item.dedupeKey,
      status: item.status,
      matchedInventoryItemId: item.matchedInventoryItemId ?? null,
      normalizedCandidate: (item.normalizedCandidateJson ?? null) as InventoryImportCandidate | null,
      lastErrorMessage: item.lastErrorMessage ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    }))
  };
}

export function registerImportRoutes(app: ApiApp, context: ApiRouteContext) {
  app.get("/api/imports", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const runs = await listInventoryImportRunsForWorkspace(workspace.id);

    return {
      runs: runs.map((run) => serializeImportRun(run)).filter(Boolean)
    };
  });

  app.get("/api/imports/:runId", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ runId: z.string().min(1) }).parse(request.params);
    const run = await findInventoryImportRunForWorkspace(workspace.id, params.runId);

    if (!run) {
      throw app.httpErrors.notFound("Import run not found");
    }

    return {
      run: serializeImportRun(run)
    };
  });

  app.post("/api/imports/account", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = inventoryImportAccountStartSchema.parse(request.body);
    const sourceKind = inferSourceKind(body.sourcePlatform);

    if ((body.sourcePlatform === "EBAY" || body.sourcePlatform === "DEPOP" || body.sourcePlatform === "POSHMARK" || body.sourcePlatform === "WHATNOT") && !body.marketplaceAccountId) {
      throw app.httpErrors.badRequest("Choose a linked marketplace account to import from.");
    }

    const run = await createInventoryImportRunForWorkspace(workspace.id, {
      sourceKind,
      sourcePlatform: body.sourcePlatform,
      marketplaceAccountId: body.marketplaceAccountId ?? null,
      status: "PENDING",
      stats: {
        requestedLimit: body.limit
      }
    });

    const correlationId = crypto.randomUUID();
    const jobName =
      body.sourcePlatform === "EBAY"
        ? "inventory.importAccountApi"
        : "inventory.importAccountBrowser";

    await enqueueJob(jobName, {
      importRunId: run.id,
      workspaceId: workspace.id,
      sourcePlatform: body.sourcePlatform,
      marketplaceAccountId: body.marketplaceAccountId ?? null,
      correlationId
    }, {
      jobId: buildIdempotencyKey(jobName, run.id)
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "inventory.import_account.started",
      targetType: "inventory_import_run",
      targetId: run.id,
      metadata: {
        sourceKind,
        sourcePlatform: body.sourcePlatform,
        marketplaceAccountId: body.marketplaceAccountId ?? null,
        limit: body.limit
      }
    });

    return {
      run: serializeImportRun(await findInventoryImportRunForWorkspace(workspace.id, run.id))
    };
  });

  app.post("/api/imports/url/preview", async (request) => {
    const auth = await context.requireAuth(request);
    await context.requireWorkspace(auth);
    const body = inventoryImportUrlPreviewSchema.parse(request.body);
    let preview: { html: string; finalUrl: string };

    try {
      preview = await fetchPreviewHtml(body.url);
    } catch (error) {
      throw app.httpErrors.badRequest(
        error instanceof Error && error.message
          ? error.message
          : `Could not fetch ${body.sourcePlatform} page for preview.`
      );
    }

    const html = preview.html;
    const title = extractMetaContent(html, "og:title") ?? extractTitle(html) ?? `${body.sourcePlatform} listing`;
    const description = extractMetaContent(html, "og:description");
    let imageUrls = extractRankedProductImageUrlsFromHtml(html, {
      pageUrl: preview.finalUrl
    });

    if (isAmazonHost(preview.finalUrl)) {
      imageUrls = rankProductImageUrls(
        [
          ...imageUrls,
          ...(await fetchAmazonSearchPreviewImageUrls(preview.finalUrl))
        ],
        { pageUrl: preview.finalUrl }
      );
    }

    const candidate: InventoryImportCandidate = {
      title,
      brand: null,
      category: "General Merchandise",
      condition: "Good used condition",
      size: null,
      color: null,
      quantity: 1,
      costBasis: 0,
      estimatedResaleMin: null,
      estimatedResaleMax: null,
      priceRecommendation: null,
      sourceUrl: preview.finalUrl,
      externalItemId: null,
      imageUrls: imageUrls.slice(0, 12),
      attributes: {
        description: description ?? "",
        previewOnly: true
      }
    };

    return {
      candidate
    };
  });

  app.post("/api/imports/url/apply", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = inventoryImportUrlApplySchema.parse(request.body);
    const run = await createInventoryImportRunForWorkspace(workspace.id, {
      sourceKind: "PUBLIC_URL",
      sourcePlatform: body.sourcePlatform,
      sourceUrl: body.url,
      status: "RUNNING",
      startedAt: new Date()
    });

    const item = await createInventoryFromCandidate({
      workspaceId: workspace.id,
      candidate: body.candidate,
      sourcePlatform: body.sourcePlatform,
      sourceUrl: body.url,
      importRunId: run.id
    });

    await createInventoryImportItemForRun(run.id, {
      matchedInventoryItemId: item.id,
      externalItemId: body.candidate.externalItemId ?? null,
      sourceUrl: body.url,
      dedupeKey: `${body.sourcePlatform}:${body.url}`,
      status: "APPLIED",
      normalizedCandidate: body.candidate,
      rawSourcePayload: {
        sourceUrl: body.url
      }
    });

    if (body.generateDrafts && body.draftPlatforms.length > 0) {
      await enqueueJob(
        "inventory.generateListingDraft",
        {
          inventoryItemId: item.id,
          workspaceId: workspace.id,
          platforms: body.draftPlatforms,
          correlationId: crypto.randomUUID()
        },
        {
          jobId: buildIdempotencyKey("inventory.generateListingDraft", `${item.id}:${body.draftPlatforms.join(",")}`)
        }
      );
    }

    await updateInventoryImportRun(run.id, {
      status: "SUCCEEDED",
      appliedCount: 1,
      progressCount: 1,
      finishedAt: new Date(),
      statsJson: {
        generatedDrafts: body.generateDrafts,
        draftPlatforms: body.generateDrafts ? body.draftPlatforms : []
      }
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "inventory.import_url.applied",
      targetType: "inventory_import_run",
      targetId: run.id,
      metadata: {
        sourcePlatform: body.sourcePlatform,
        sourceUrl: body.url,
        inventoryItemId: item.id
      }
    });

    return {
      item,
      run: serializeImportRun(await findInventoryImportRunForWorkspace(workspace.id, run.id))
    };
  });

  app.post("/api/imports/csv", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const file = await request.file({
      limits: {
        files: 1,
        fileSize: 10 * 1024 * 1024
      }
    });

    if (!file) {
      throw app.httpErrors.badRequest("Choose a CSV file to import.");
    }

    const sourcePlatformValue = file.fields.sourcePlatform;
    const sourcePlatform =
      sourcePlatformValue && "value" in sourcePlatformValue && typeof sourcePlatformValue.value === "string"
        ? sourcePlatformValue.value
        : null;

    if (!sourcePlatform || !["EBAY", "DEPOP", "POSHMARK", "WHATNOT", "NIFTY", "CROSSLIST"].includes(sourcePlatform)) {
      throw app.httpErrors.badRequest("Choose a supported source platform for this CSV import.");
    }

    const csvText = (await file.toBuffer()).toString("utf8");
    const rows = parseCsvText(csvText);
    const run = await createInventoryImportRunForWorkspace(workspace.id, {
      sourceKind: "CSV_EXPORT",
      sourcePlatform: sourcePlatform as "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT" | "NIFTY" | "CROSSLIST",
      uploadFilename: file.filename,
      status: "RUNNING",
      startedAt: new Date()
    });

    let appliedCount = 0;
    let failedCount = 0;

    for (const row of rows) {
      const candidate = csvRowToCandidate(row, sourcePlatform);
      const dedupeKey = `${sourcePlatform}:${candidate.externalItemId ?? candidate.sourceUrl ?? candidate.title}`;

      try {
        const item = await createInventoryFromCandidate({
          workspaceId: workspace.id,
          candidate,
          sourcePlatform,
          sourceUrl: candidate.sourceUrl ?? null,
          importRunId: run.id
        });

        await createInventoryImportItemForRun(run.id, {
          matchedInventoryItemId: item.id,
          externalItemId: candidate.externalItemId ?? null,
          sourceUrl: candidate.sourceUrl ?? null,
          dedupeKey,
          status: "APPLIED",
          normalizedCandidate: candidate,
          rawSourcePayload: row
        });

        appliedCount += 1;
      } catch (error) {
        failedCount += 1;
        await createInventoryImportItemForRun(run.id, {
          externalItemId: candidate.externalItemId ?? null,
          sourceUrl: candidate.sourceUrl ?? null,
          dedupeKey,
          status: "FAILED",
          normalizedCandidate: candidate,
          rawSourcePayload: row,
          lastErrorMessage: error instanceof Error ? error.message : "Could not import CSV row."
        });
      }
    }

    await updateInventoryImportRun(run.id, {
      status: failedCount > 0 && appliedCount === 0 ? "FAILED" : "SUCCEEDED",
      progressCount: rows.length,
      appliedCount,
      failedCount,
      finishedAt: new Date(),
      statsJson: {
        rowCount: rows.length
      },
      lastErrorCode: failedCount > 0 ? "CSV_IMPORT_PARTIAL_FAILURE" : null,
      lastErrorMessage: failedCount > 0 ? `${failedCount} row(s) could not be imported.` : null
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "inventory.import_csv.completed",
      targetType: "inventory_import_run",
      targetId: run.id,
      metadata: {
        sourcePlatform,
        rowCount: rows.length,
        appliedCount,
        failedCount
      }
    });

    return {
      run: serializeImportRun(await findInventoryImportRunForWorkspace(workspace.id, run.id))
    };
  });
}
