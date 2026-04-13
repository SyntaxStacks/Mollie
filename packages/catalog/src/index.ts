import { db, type Prisma } from "@reselleros/db";
import type {
  CatalogCacheStatus,
  CatalogImportSource,
  CatalogIdentifierType,
  CatalogLookupRecord,
  CatalogLookupResult,
  CatalogLookupMode,
  CatalogTrustStatus,
  OperatorHint
} from "@reselleros/types";

type LookupInput = {
  workspaceId: string;
  identifier: string;
  identifierType?: CatalogIdentifierType | null;
};

type ObservationInput = {
  market: CatalogImportSource | string;
  label: string;
  price?: number | null;
  sourceUrl?: string | null;
  note?: string | null;
  observedAt?: Date | string | null;
};

type OperatorResearchInput = {
  workspaceId: string;
  identifier: string;
  identifierType?: CatalogIdentifierType | null;
  title: string;
  brand?: string | null;
  category: string;
  imageUrls: string[];
  sourceReferences: Array<{ market: CatalogImportSource; label: string; url: string }>;
  observations: ObservationInput[];
};

type SeedRecordInput = {
  identifier: string;
  identifierType?: CatalogIdentifierType | null;
  title: string;
};

type CrawlerHarvestInput = {
  identifier: string;
  identifierType?: CatalogIdentifierType | null;
  title?: string | null;
  brand?: string | null;
  category?: string | null;
  imageUrls?: string[];
  sourceReferences?: Array<{ market: CatalogImportSource; label: string; url: string }>;
  observations?: ObservationInput[];
  confidenceScore: number;
};

type CatalogRecordWithRelations = Awaited<ReturnType<typeof fetchCatalogRecord>>;

const STALE_LOOKUP_DAYS = 30;
const CRAWLER_CANONICAL_THRESHOLD = 0.7;
const LOOKUP_DISCOVERED_CONFIDENCE = 0.05;
const SEED_CONFIDENCE = 0.25;
const OPERATOR_CONFIDENCE = 1;

function createHint(input: {
  title: string;
  explanation: string;
  severity: OperatorHint["severity"];
  nextActions: string[];
  canContinue?: boolean;
  helpText?: string | null;
}) {
  return {
    title: input.title,
    explanation: input.explanation,
    severity: input.severity,
    nextActions: input.nextActions,
    canContinue: input.canContinue,
    helpText: input.helpText ?? null
  } satisfies OperatorHint;
}

function identifierTypeLabel(identifierType: CatalogIdentifierType) {
  return identifierType === "CODE128" ? "Code 128" : identifierType;
}

function getLookupMode(): CatalogLookupMode {
  return process.env.CATALOG_LOOKUP_MODE?.trim().toLowerCase() === "fixture" ? "FIXTURE" : "INTERNAL";
}

export function normalizeIdentifier(identifier: string) {
  const trimmed = identifier.trim().toUpperCase();

  if (/^https?:\/\//i.test(trimmed) || trimmed.includes("WWW.")) {
    return trimmed;
  }

  if (/^[0-9X\s-]+$/.test(trimmed)) {
    return trimmed.replace(/[^0-9X]/g, "");
  }

  return trimmed
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9\-_.+/]/g, "");
}

function isValidIsbn10(value: string) {
  if (!/^\d{9}[\dX]$/.test(value)) {
    return false;
  }

  const checksum = value.split("").reduce((sum, character, index) => {
    const digit = character === "X" ? 10 : Number(character);
    return sum + digit * (10 - index);
  }, 0);

  return checksum % 11 === 0;
}

export function classifyIdentifier(identifier: string): CatalogIdentifierType {
  const normalized = normalizeIdentifier(identifier);

  if (/^\d{12}$/.test(normalized)) {
    return "UPC";
  }

  if (/^(97[89])\d{10}$/.test(normalized)) {
    return "ISBN";
  }

  if (/^\d{13}$/.test(normalized)) {
    return "EAN";
  }

  if (isValidIsbn10(normalized)) {
    return "ISBN";
  }

  if (/^[A-Z0-9][A-Z0-9\-_.+/]{3,95}$/.test(normalized)) {
    return "CODE128";
  }

  return "UNKNOWN";
}

function resolveIdentifierType(identifier: string, preferred?: CatalogIdentifierType | null) {
  if (preferred && preferred !== "UNKNOWN") {
    return preferred;
  }

  return classifyIdentifier(identifier);
}

function dedupeUrls(urls: Array<string | null | undefined>) {
  return [...new Set(urls.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function mapTrustStatus(input: unknown): CatalogTrustStatus {
  if (
    input === "LOOKUP_DISCOVERED" ||
    input === "SEED_TENTATIVE" ||
    input === "CRAWLER_DERIVED" ||
    input === "OPERATOR_CONFIRMED"
  ) {
    return input;
  }

  return "LOOKUP_DISCOVERED";
}

function mapIdentifierType(input: unknown): CatalogIdentifierType {
  if (input === "UPC" || input === "EAN" || input === "ISBN" || input === "CODE128" || input === "UNKNOWN") {
    return input;
  }

  return "UNKNOWN";
}

function mapJsonStringArray(input: unknown) {
  return Array.isArray(input)
    ? input.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)
    : [];
}

function mapImportSource(input: unknown): CatalogImportSource {
  return input === "GOOGLE" || input === "AMAZON" || input === "EBAY" || input === "OTHER" ? input : "OTHER";
}

function mapSourceReferences(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as Array<{ market: CatalogImportSource; label: string; url: string }>;
  }

  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Record<string, unknown>;
      return typeof candidate.url === "string" && typeof candidate.label === "string"
        ? {
            market: mapImportSource(candidate.market),
            label: candidate.label,
            url: candidate.url
          }
        : null;
    })
    .filter((entry): entry is { market: CatalogImportSource; label: string; url: string } => Boolean(entry));
}

function observationTimestamp(input: Date | string | null | undefined) {
  if (input instanceof Date) {
    return input;
  }

  if (typeof input === "string" && Date.parse(input) > 0) {
    return new Date(input);
  }

  return new Date();
}

function isStale(date: Date | null | undefined) {
  if (!date) {
    return false;
  }

  return Date.now() - date.getTime() > STALE_LOOKUP_DAYS * 24 * 60 * 60 * 1000;
}

function hasMeaningfulRecord(record: {
  canonicalTitle: string | null;
  brand: string | null;
  category: string | null;
  canonicalImageUrlsJson: unknown;
}) {
  return Boolean(
    record.canonicalTitle?.trim() ||
      record.brand?.trim() ||
      record.category?.trim() ||
      mapJsonStringArray(record.canonicalImageUrlsJson).length
  );
}

function buildResearchLinks(normalizedIdentifier: string, identifierType: CatalogIdentifierType) {
  const queryPrefix =
    identifierType === "UNKNOWN"
      ? "product"
      : identifierType === "CODE128"
        ? "product code"
        : identifierType;
  const googleQuery = encodeURIComponent(`${queryPrefix} ${normalizedIdentifier}`);
  const encodedIdentifier = encodeURIComponent(normalizedIdentifier);

  return [
    {
      market: "GOOGLE" as const,
      label: `Search Google Shopping for ${queryPrefix} ${normalizedIdentifier}`,
      url: `https://www.google.com/search?tbm=shop&q=${googleQuery}`
    },
    {
      market: "AMAZON" as const,
      label: `Search Amazon for ${normalizedIdentifier}`,
      url: `https://www.amazon.com/s?k=${encodedIdentifier}`
    },
    {
      market: "EBAY" as const,
      label: `Search eBay for ${normalizedIdentifier}`,
      url: `https://www.ebay.com/sch/i.html?_nkw=${encodedIdentifier}`
    }
  ];
}

function serializeRecord(record: NonNullable<CatalogRecordWithRelations>): CatalogLookupRecord {
  const override = record.workspaceOverrides[0] ?? null;
  const imageUrls = override
    ? mapJsonStringArray(override.imageUrlsJson).length > 0
      ? mapJsonStringArray(override.imageUrlsJson)
      : mapJsonStringArray(record.canonicalImageUrlsJson)
    : mapJsonStringArray(record.canonicalImageUrlsJson);

  return {
    id: record.id,
    normalizedIdentifier: record.normalizedIdentifier,
    identifierType: mapIdentifierType(record.identifierType),
    canonicalTitle: override?.title?.trim() || record.canonicalTitle,
    brand: override?.brand?.trim() || record.brand,
    category: override?.category?.trim() || record.category,
    imageUrls,
    sourceReferences: mapSourceReferences(record.sourceReferencesJson),
    trustStatus: mapTrustStatus(record.trustStatus),
    confidenceScore: record.confidenceScore,
    lastConfirmedAt: record.lastConfirmedAt?.toISOString() ?? null,
    lastRefreshedAt: record.lastRefreshedAt?.toISOString() ?? null,
    observations: record.observations.map((observation) => ({
      market: observation.market,
      label: observation.label,
      price: observation.price ?? null,
      sourceUrl: observation.sourceUrl,
      note: observation.note,
      observedAt: observation.observedAt.toISOString(),
      provenance: mapTrustStatus(observation.provenance),
      confidenceScore: observation.confidenceScore ?? null
    }))
  };
}

async function fetchCatalogRecord(workspaceId: string, normalizedIdentifier: string) {
  return db.catalogIdentifier.findUnique({
    where: { normalizedIdentifier },
    include: {
      observations: {
        orderBy: { observedAt: "desc" },
        take: 12
      },
      workspaceObservations: {
        where: { workspaceId },
        orderBy: { observedAt: "desc" },
        take: 12
      },
      workspaceOverrides: {
        where: { workspaceId },
        take: 1
      }
    }
  });
}

function buildLookupHint(input: {
  cacheStatus: CatalogCacheStatus;
  normalizedIdentifier: string;
  identifierType: CatalogIdentifierType;
  record: CatalogRecordWithRelations | null;
}) {
  if (input.cacheStatus === "MISS") {
    return createHint({
      title: "No saved catalog match yet",
      explanation: `Mollie has not built a reusable ${identifierTypeLabel(input.identifierType)} record for ${input.normalizedIdentifier} yet. Use the research links to gather a title, price, and images, then save the item to strengthen the catalog.`,
      severity: "INFO",
      nextActions: [
        "Open Google, Amazon, or eBay from the research links.",
        "Paste the best title, price observations, and image URLs you find.",
        "Create the item to save this identifier into Mollie's catalog."
      ],
      canContinue: true
    });
  }

  if (input.cacheStatus === "STALE") {
    return createHint({
      title: "Saved identifier data may be stale",
      explanation: "Mollie found a prior catalog record, but it has not been refreshed recently. Recheck the current market prices before you create or publish from this item.",
      severity: "WARNING",
      nextActions: [
        "Use the research links to confirm today's pricing.",
        "Update the title, price, or images if they no longer match."
      ],
      canContinue: true
    });
  }

  return createHint({
    title: "Saved catalog match found",
    explanation: "Mollie already knows this identifier and can prefill the research form with saved product data and prior observations.",
    severity: "SUCCESS",
    nextActions: [
      "Review the cached title, prices, and images.",
      "Adjust anything that no longer matches the item in front of you."
    ],
    canContinue: true
  });
}

function fixtureLookup(input: LookupInput): CatalogLookupResult {
  const normalizedIdentifier = normalizeIdentifier(input.identifier);
  const identifierType = resolveIdentifierType(normalizedIdentifier, input.identifierType);

  return {
    mode: "FIXTURE",
    normalizedIdentifier,
    identifierType,
    cacheStatus: "HIT",
    record: {
      id: `fixture-${normalizedIdentifier}`,
      normalizedIdentifier,
      identifierType,
      canonicalTitle: `Fixture Catalog Item ${normalizedIdentifier}`,
      brand: "Fixture Brand",
      category: "Media",
      imageUrls: [
        "https://example.test/images/fixture-1.jpg",
        "https://example.test/images/fixture-2.jpg"
      ],
      sourceReferences: buildResearchLinks(normalizedIdentifier, identifierType),
      trustStatus: "CRAWLER_DERIVED",
      confidenceScore: 0.82,
      lastConfirmedAt: null,
      lastRefreshedAt: new Date().toISOString(),
      observations: [
        {
          market: "AMAZON",
          label: "Amazon",
          price: 39.99,
          sourceUrl: `https://www.amazon.com/s?k=${encodeURIComponent(normalizedIdentifier)}`,
          note: "Fixture observation for automated tests.",
          observedAt: new Date().toISOString(),
          provenance: "CRAWLER_DERIVED",
          confidenceScore: 0.82
        }
      ]
    },
    workspaceObservations: [],
    researchLinks: buildResearchLinks(normalizedIdentifier, identifierType),
    hint: createHint({
      title: "Fixture catalog match loaded",
      explanation: "The identifier lookup is running in fixture mode, so Mollie returned a deterministic catalog match for this test environment.",
      severity: "INFO",
      nextActions: ["Review the fixture data before creating the item."],
      canContinue: true
    })
  };
}

function buildSourceReferences(
  primary: { market: CatalogImportSource; label: string; url: string },
  extraUrls: string[]
) {
  const unique = new Map<string, { market: CatalogImportSource; label: string; url: string }>();
  unique.set(primary.url, primary);

  for (const url of extraUrls) {
    if (!unique.has(url)) {
      unique.set(url, {
        market: "OTHER",
        label: "Reference",
        url
      });
    }
  }

  return [...unique.values()];
}

function selectCanonicalUpdate(record: {
  trustStatus: CatalogTrustStatus;
  canonicalTitle: string | null;
  brand: string | null;
  category: string | null;
  canonicalImageUrlsJson: unknown;
}, incoming: {
  title?: string | null;
  brand?: string | null;
  category?: string | null;
  imageUrls?: string[];
  trustStatus: CatalogTrustStatus;
  confidenceScore: number;
}) {
  if (record.trustStatus === "OPERATOR_CONFIRMED" && incoming.trustStatus !== "OPERATOR_CONFIRMED") {
    return null;
  }

  const existingStrength =
    (record.canonicalTitle ? 1 : 0) +
    (record.brand ? 1 : 0) +
    (record.category ? 1 : 0) +
    (mapJsonStringArray(record.canonicalImageUrlsJson).length > 0 ? 1 : 0);
  const incomingStrength =
    (incoming.title ? 1 : 0) +
    (incoming.brand ? 1 : 0) +
    (incoming.category ? 1 : 0) +
    ((incoming.imageUrls?.length ?? 0) > 0 ? 1 : 0);

  if (incoming.trustStatus !== "OPERATOR_CONFIRMED" && incomingStrength < existingStrength) {
    return null;
  }

  return {
    canonicalTitle: incoming.title ?? record.canonicalTitle,
    brand: incoming.brand ?? record.brand,
    category: incoming.category ?? record.category,
    canonicalImageUrlsJson: (incoming.imageUrls?.length ? incoming.imageUrls : mapJsonStringArray(record.canonicalImageUrlsJson)) as Prisma.InputJsonValue,
    trustStatus: incoming.trustStatus,
    confidenceScore: incoming.confidenceScore,
    lastRefreshedAt: new Date(),
    ...(incoming.trustStatus === "OPERATOR_CONFIRMED" ? { lastConfirmedAt: new Date() } : {})
  } satisfies Prisma.CatalogIdentifierUpdateInput;
}

export async function lookupCatalogIdentifier(input: LookupInput): Promise<CatalogLookupResult> {
  const normalizedIdentifier = normalizeIdentifier(input.identifier);
  const identifierType = resolveIdentifierType(normalizedIdentifier, input.identifierType);

  if (getLookupMode() === "FIXTURE") {
    return fixtureLookup(input);
  }

  await db.catalogIdentifier.upsert({
    where: { normalizedIdentifier },
    update: {
      identifierType,
      lastLookupAt: new Date()
    },
    create: {
      normalizedIdentifier,
      identifierType,
      trustStatus: "LOOKUP_DISCOVERED",
      confidenceScore: LOOKUP_DISCOVERED_CONFIDENCE,
      lastLookupAt: new Date()
    }
  });

  const record = await fetchCatalogRecord(input.workspaceId, normalizedIdentifier);
  const cacheStatus: CatalogCacheStatus = !record || !hasMeaningfulRecord(record) ? "MISS" : isStale(record.lastRefreshedAt ?? record.updatedAt) ? "STALE" : "HIT";

  return {
    mode: "INTERNAL",
    normalizedIdentifier,
    identifierType,
    cacheStatus,
    record: record && hasMeaningfulRecord(record) ? serializeRecord(record) : null,
    workspaceObservations:
      record?.workspaceObservations.map((observation) => ({
        market: observation.market,
        label: observation.label,
        price: observation.price ?? null,
        sourceUrl: observation.sourceUrl,
        note: observation.note,
        observedAt: observation.observedAt.toISOString()
      })) ?? [],
    researchLinks: buildResearchLinks(normalizedIdentifier, identifierType),
    hint: buildLookupHint({
      cacheStatus,
      normalizedIdentifier,
      identifierType,
      record
    })
  };
}

export async function upsertSeedCatalogRecord(input: SeedRecordInput) {
  const normalizedIdentifier = normalizeIdentifier(input.identifier);
  const identifierType = resolveIdentifierType(normalizedIdentifier, input.identifierType);
  const existing = await db.catalogIdentifier.findUnique({
    where: { normalizedIdentifier }
  });

  if (!existing) {
    return db.catalogIdentifier.create({
      data: {
        normalizedIdentifier,
        identifierType,
        canonicalTitle: input.title,
        trustStatus: "SEED_TENTATIVE",
        confidenceScore: SEED_CONFIDENCE,
        lastRefreshedAt: new Date()
      }
    });
  }

  const nextData = selectCanonicalUpdate(
    {
      trustStatus: mapTrustStatus(existing.trustStatus),
      canonicalTitle: existing.canonicalTitle,
      brand: existing.brand,
      category: existing.category,
      canonicalImageUrlsJson: existing.canonicalImageUrlsJson
    },
    {
      title: input.title,
      trustStatus: "SEED_TENTATIVE",
      confidenceScore: SEED_CONFIDENCE
    }
  );

  if (!nextData) {
    return existing;
  }

  return db.catalogIdentifier.update({
    where: { id: existing.id },
    data: nextData
      ? {
          ...nextData,
          identifierType: existing.identifierType === "UNKNOWN" ? identifierType : undefined
        }
      : nextData
  });
}

export async function applyOperatorResearch(input: OperatorResearchInput) {
  const normalizedIdentifier = normalizeIdentifier(input.identifier);
  const identifierType = resolveIdentifierType(normalizedIdentifier, input.identifierType);
  const sourceReferences = input.sourceReferences;
  const catalogIdentifier = await db.catalogIdentifier.upsert({
    where: { normalizedIdentifier },
    update: {
      identifierType,
      canonicalTitle: input.title,
      brand: input.brand ?? null,
      category: input.category,
      canonicalImageUrlsJson: dedupeUrls(input.imageUrls) as Prisma.InputJsonValue,
      sourceReferencesJson: sourceReferences as Prisma.InputJsonValue,
      trustStatus: "OPERATOR_CONFIRMED",
      confidenceScore: OPERATOR_CONFIDENCE,
      lastConfirmedAt: new Date(),
      lastRefreshedAt: new Date(),
      lastLookupAt: new Date()
    },
    create: {
      normalizedIdentifier,
      identifierType,
      canonicalTitle: input.title,
      brand: input.brand ?? null,
      category: input.category,
      canonicalImageUrlsJson: dedupeUrls(input.imageUrls) as Prisma.InputJsonValue,
      sourceReferencesJson: sourceReferences as Prisma.InputJsonValue,
      trustStatus: "OPERATOR_CONFIRMED",
      confidenceScore: OPERATOR_CONFIDENCE,
      lastConfirmedAt: new Date(),
      lastRefreshedAt: new Date(),
      lastLookupAt: new Date()
    }
  });

  await db.workspaceCatalogOverride.upsert({
    where: {
      workspaceId_catalogIdentifierId: {
        workspaceId: input.workspaceId,
        catalogIdentifierId: catalogIdentifier.id
      }
    },
    update: {
      title: input.title,
      brand: input.brand ?? null,
      category: input.category,
      imageUrlsJson: dedupeUrls(input.imageUrls),
      lastConfirmedAt: new Date()
    },
    create: {
      workspaceId: input.workspaceId,
      catalogIdentifierId: catalogIdentifier.id,
      title: input.title,
      brand: input.brand ?? null,
      category: input.category,
      imageUrlsJson: dedupeUrls(input.imageUrls),
      lastConfirmedAt: new Date()
    }
  });

  if (input.observations.length > 0) {
    await db.catalogObservation.createMany({
      data: input.observations.map((observation) => ({
        catalogIdentifierId: catalogIdentifier.id,
        market: observation.market,
        label: observation.label,
        price: observation.price ?? null,
        sourceUrl: observation.sourceUrl ?? null,
        note: observation.note ?? null,
        observedAt: observationTimestamp(observation.observedAt),
        provenance: "OPERATOR_CONFIRMED",
        confidenceScore: OPERATOR_CONFIDENCE
      }))
    });

    await db.workspaceCatalogObservation.createMany({
      data: input.observations.map((observation) => ({
        workspaceId: input.workspaceId,
        catalogIdentifierId: catalogIdentifier.id,
        market: observation.market,
        label: observation.label,
        price: observation.price ?? null,
        sourceUrl: observation.sourceUrl ?? null,
        note: observation.note ?? null,
        observedAt: observationTimestamp(observation.observedAt)
      }))
    });
  }

  return catalogIdentifier;
}

export async function applyCrawlerHarvest(input: CrawlerHarvestInput) {
  const normalizedIdentifier = normalizeIdentifier(input.identifier);
  const identifierType = resolveIdentifierType(normalizedIdentifier, input.identifierType);
  const existing = await db.catalogIdentifier.findUnique({
    where: { normalizedIdentifier }
  });
  const shouldPromoteCanonical = input.confidenceScore >= CRAWLER_CANONICAL_THRESHOLD;

  const catalogIdentifier = existing
    ? await db.catalogIdentifier.update({
        where: { id: existing.id },
        data: shouldPromoteCanonical
          ? ({
              ...(selectCanonicalUpdate(
              {
                trustStatus: mapTrustStatus(existing.trustStatus),
                canonicalTitle: existing.canonicalTitle,
                brand: existing.brand,
                category: existing.category,
                canonicalImageUrlsJson: existing.canonicalImageUrlsJson
              },
              {
                title: input.title ?? null,
                brand: input.brand ?? null,
                category: input.category ?? null,
                imageUrls: dedupeUrls(input.imageUrls ?? []),
                trustStatus: "CRAWLER_DERIVED",
                confidenceScore: input.confidenceScore
              }
              ) ?? {
                lastRefreshedAt: new Date(),
                lastLookupAt: new Date()
              }),
              sourceReferencesJson: (input.sourceReferences?.length
                ? input.sourceReferences
                : mapSourceReferences(existing.sourceReferencesJson)) as Prisma.InputJsonValue,
              identifierType: existing.identifierType === "UNKNOWN" ? identifierType : undefined
            })
          : {
              lastRefreshedAt: new Date(),
              lastLookupAt: new Date()
            }
      })
    : await db.catalogIdentifier.create({
        data: {
          normalizedIdentifier,
          identifierType,
          canonicalTitle: shouldPromoteCanonical ? input.title ?? null : null,
          brand: shouldPromoteCanonical ? input.brand ?? null : null,
          category: shouldPromoteCanonical ? input.category ?? null : null,
          canonicalImageUrlsJson: (shouldPromoteCanonical ? dedupeUrls(input.imageUrls ?? []) : []) as Prisma.InputJsonValue,
          sourceReferencesJson: (shouldPromoteCanonical ? input.sourceReferences ?? [] : []) as Prisma.InputJsonValue,
          trustStatus: shouldPromoteCanonical ? "CRAWLER_DERIVED" : "LOOKUP_DISCOVERED",
          confidenceScore: shouldPromoteCanonical ? input.confidenceScore : LOOKUP_DISCOVERED_CONFIDENCE,
          lastRefreshedAt: new Date(),
          lastLookupAt: new Date()
        }
      });

  if ((input.observations?.length ?? 0) > 0) {
    await db.catalogObservation.createMany({
      data: (input.observations ?? []).map((observation) => ({
        catalogIdentifierId: catalogIdentifier.id,
        market: observation.market,
        label: observation.label,
        price: observation.price ?? null,
        sourceUrl: observation.sourceUrl ?? null,
        note: observation.note ?? null,
        observedAt: observationTimestamp(observation.observedAt),
        provenance: "CRAWLER_DERIVED",
        confidenceScore: input.confidenceScore
      }))
    });
  }

  return catalogIdentifier;
}

export function buildCatalogSourceReferences(input: {
  primarySourceMarket: CatalogImportSource;
  primarySourceUrl?: string | null;
  referenceUrls?: string[];
}) {
  const fallbackUrls = dedupeUrls(input.referenceUrls ?? []);

  if (!input.primarySourceUrl?.trim()) {
    if (fallbackUrls.length === 0) {
      return [];
    }

    return buildSourceReferences(
      {
        market: "OTHER",
        label: "Reference",
        url: fallbackUrls[0] ?? ""
      },
      fallbackUrls.slice(1)
    );
  }

  return buildSourceReferences(
    {
      market: input.primarySourceMarket,
      label: `${input.primarySourceMarket} reference`,
      url: input.primarySourceUrl
    },
    fallbackUrls
  );
}

export * from "./product-lookup.js";
