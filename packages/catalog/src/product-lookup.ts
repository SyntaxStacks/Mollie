import type {
  CatalogIdentifierType,
  OperatorHint,
  ProductLookupCandidate,
  ProductLookupConfidenceState,
  ProductLookupResult,
  ProductLookupSource
} from "@reselleros/types";

import { classifyIdentifier, lookupCatalogIdentifier, normalizeIdentifier } from "./index.js";

export type BarcodeLookupProvider = {
  id: string;
  simulated: boolean;
  lookupBarcode(input: { workspaceId: string; barcode: string; identifierType: CatalogIdentifierType }): Promise<ProductLookupCandidate[]>;
};

export type ProductEnrichmentProvider = {
  id: string;
  simulated: boolean;
  enrichCandidates(input: {
    workspaceId: string;
    barcode: string;
    identifierType: CatalogIdentifierType;
    candidates: ProductLookupCandidate[];
  }): Promise<ProductLookupCandidate[]>;
};

export type ProductLookupService = {
  lookupBarcode(input: { workspaceId: string; barcode: string }): Promise<ProductLookupResult>;
};

const knownSimulatedMatches: Record<
  string,
  {
    title: string;
    brand: string;
    category: string;
    model?: string;
    color?: string;
    asin: string;
    primaryImageUrl: string;
    productUrl: string;
    confidenceScore: number;
    matchRationale: string[];
  }
> = {
  "012345678905": {
    title: "Nintendo Wii Remote Controller",
    brand: "Nintendo",
    category: "Video Games",
    model: "RVL-003",
    color: "White",
    asin: "B000IMWK2G",
    primaryImageUrl: "https://m.media-amazon.com/images/I/example-wii-remote.jpg",
    productUrl: "https://www.amazon.com/dp/B000IMWK2G",
    confidenceScore: 0.84,
    matchRationale: [
      "The barcode matches a known simulated Amazon product seed.",
      "The product family aligns with common resale inventory for this code."
    ]
  },
  "9780316769488": {
    title: "The Catcher in the Rye",
    brand: "Little, Brown and Company",
    category: "Books",
    asin: "0316769487",
    primaryImageUrl: "https://m.media-amazon.com/images/I/example-catcher-in-the-rye.jpg",
    productUrl: "https://www.amazon.com/dp/0316769487",
    confidenceScore: 0.86,
    matchRationale: [
      "The ISBN maps to a stable book catalog record.",
      "Amazon-oriented enrichment is available for this title in simulated mode."
    ]
  }
};

function buildOperatorHint(input: {
  title: string;
  explanation: string;
  severity: OperatorHint["severity"];
  nextActions: string[];
  canContinue?: boolean;
  helpText?: string | null;
}): OperatorHint {
  return {
    title: input.title,
    explanation: input.explanation,
    severity: input.severity,
    nextActions: input.nextActions,
    canContinue: input.canContinue,
    helpText: input.helpText ?? null
  };
}

function inferAsinFromUrl(url: string | null | undefined) {
  if (!url) {
    return null;
  }

  const directMatch = url.match(/\/dp\/([A-Z0-9]{10})/i);
  if (directMatch?.[1]) {
    return directMatch[1].toUpperCase();
  }

  return null;
}

function confidenceStateFromScore(score: number): ProductLookupConfidenceState {
  if (score >= 0.8) {
    return "HIGH";
  }

  if (score >= 0.55) {
    return "MEDIUM";
  }

  return "LOW";
}

function defaultHintForConfidence(source: ProductLookupSource, score: number): OperatorHint {
  const confidenceState = confidenceStateFromScore(score);

  if (confidenceState === "HIGH") {
    return buildOperatorHint({
      title: "Likely match found",
      explanation:
        source === "AMAZON_ENRICHMENT"
          ? "We found a likely Amazon-backed match. Double-check the photo and brand before applying it to inventory."
          : "We found a likely product match. Double-check the title and photo before applying it to inventory.",
      severity: "SUCCESS",
      nextActions: [
        "Compare the candidate photo to the item in your hand.",
        "Confirm the brand and model before applying the match."
      ],
      canContinue: true
    });
  }

  if (confidenceState === "MEDIUM") {
    return buildOperatorHint({
      title: "Possible match found",
      explanation: "This looks promising, but it still needs an operator review before Mollie should rely on it.",
      severity: "WARNING",
      nextActions: [
        "Review the title and brand carefully.",
        "Open the product URL and compare packaging or model details.",
        "Edit the inventory fields if only part of the candidate is correct."
      ],
      canContinue: true
    });
  }

  return buildOperatorHint({
    title: "Low-confidence match",
    explanation: "This candidate is only a loose match. Use it as a starting point only if the item in hand clearly lines up.",
    severity: "WARNING",
    nextActions: [
      "Compare the image and title carefully before accepting it.",
      "Use manual entry if the candidate does not clearly match the item."
    ],
    canContinue: true
  });
}

function noMatchHint(barcode: string, identifierType: CatalogIdentifierType): OperatorHint {
  return buildOperatorHint({
    title: "No reliable product match yet",
    explanation: `We could not find a reliable ${identifierType} match for ${barcode}. You can still continue with manual entry and save the item yourself.`,
    severity: "INFO",
    nextActions: [
      "Compare the code to the label and try scanning again if needed.",
      "Use manual entry if no candidate clearly matches the item in hand."
    ],
    canContinue: true
  });
}

function rankCandidates(candidates: ProductLookupCandidate[]) {
  return [...candidates].sort((left, right) => right.confidenceScore - left.confidenceScore);
}

function dedupeCandidates(candidates: ProductLookupCandidate[]) {
  const byKey = new Map<string, ProductLookupCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.title}:${candidate.provider}:${candidate.productUrl ?? candidate.barcode}`;
    const existing = byKey.get(key);

    if (!existing || existing.confidenceScore < candidate.confidenceScore) {
      byKey.set(key, candidate);
    }
  }

  return [...byKey.values()];
}

const internalCatalogLookupProvider: BarcodeLookupProvider = {
  id: "internal-catalog",
  simulated: false,
  async lookupBarcode(input) {
    const lookup = await lookupCatalogIdentifier({
      workspaceId: input.workspaceId,
      identifier: input.barcode,
      identifierType: input.identifierType
    });

    if (!lookup.record) {
      return [];
    }

    const amazonReference = lookup.record.sourceReferences.find((reference) => reference.market === "AMAZON");
    const confidenceScore =
      lookup.record.trustStatus === "OPERATOR_CONFIRMED"
        ? 0.94
        : lookup.record.trustStatus === "CRAWLER_DERIVED"
          ? Math.max(lookup.record.confidenceScore, 0.74)
          : lookup.record.trustStatus === "SEED_TENTATIVE"
            ? 0.58
            : Math.max(lookup.record.confidenceScore, 0.42);

    return [
      {
        id: `catalog:${lookup.record.id}`,
        barcode: lookup.normalizedIdentifier,
        identifierType: lookup.identifierType,
        title: lookup.record.canonicalTitle ?? `Saved ${lookup.identifierType} record`,
        brand: lookup.record.brand ?? null,
        category: lookup.record.category ?? null,
        model: null,
        size: null,
        color: null,
        primaryImageUrl: lookup.record.imageUrls[0] ?? null,
        imageUrls: lookup.record.imageUrls,
        asin: inferAsinFromUrl(amazonReference?.url),
        productUrl: amazonReference?.url ?? null,
        provider: "INTERNAL_CATALOG",
        confidenceScore,
        confidenceState: confidenceStateFromScore(confidenceScore),
        matchRationale: [
          `Mollie already has a ${lookup.record.trustStatus.toLowerCase().replace(/_/g, " ")} record for this code.`,
          ...(lookup.record.brand ? [`Saved brand: ${lookup.record.brand}.`] : [])
        ],
        hint:
          lookup.hint ??
          defaultHintForConfidence("INTERNAL_CATALOG", confidenceScore),
        safeToPrefill: confidenceScore >= 0.55,
        simulated: false
      }
    ];
  }
};

const simulatedBarcodeLookupProvider: BarcodeLookupProvider = {
  id: "simulated-barcode",
  simulated: true,
  async lookupBarcode(input) {
    const known = knownSimulatedMatches[input.barcode];
    const confidenceScore = known?.confidenceScore ?? 0.36;

    return [
      {
        id: `simulated:${input.barcode}`,
        barcode: input.barcode,
        identifierType: input.identifierType,
        title: known?.title ?? `Possible product match for ${input.barcode}`,
        brand: known?.brand ?? null,
        category: known?.category ?? "General Merchandise",
        model: known?.model ?? null,
        size: null,
        color: known?.color ?? null,
        primaryImageUrl: known?.primaryImageUrl ?? null,
        imageUrls: known?.primaryImageUrl ? [known.primaryImageUrl] : [],
        asin: known?.asin ?? null,
        productUrl: known?.productUrl ?? `https://www.amazon.com/s?k=${encodeURIComponent(input.barcode)}`,
        provider: "SIMULATED",
        confidenceScore,
        confidenceState: confidenceStateFromScore(confidenceScore),
        matchRationale:
          known?.matchRationale ?? [
            "This is a deterministic fallback candidate because no live barcode provider is configured.",
            "Treat it as a starting point, not a guaranteed match."
          ],
        hint: defaultHintForConfidence("SIMULATED", confidenceScore),
        safeToPrefill: Boolean(known && confidenceScore >= 0.8),
        simulated: true
      }
    ];
  }
};

const simulatedAmazonEnrichmentProvider: ProductEnrichmentProvider = {
  id: "amazon-enrichment-simulated",
  simulated: true,
  async enrichCandidates(input) {
    return input.candidates.map((candidate) => {
      if (candidate.provider === "AMAZON_ENRICHMENT") {
        return candidate;
      }

      const known = knownSimulatedMatches[input.barcode];
      const confidenceScore = candidate.provider === "INTERNAL_CATALOG"
        ? Math.min(0.95, candidate.confidenceScore + 0.03)
        : known
          ? Math.max(candidate.confidenceScore, known.confidenceScore)
          : candidate.confidenceScore;
      const productUrl =
        candidate.productUrl ??
        known?.productUrl ??
        `https://www.amazon.com/s?k=${encodeURIComponent(input.barcode)}`;

      return {
        ...candidate,
        provider: "AMAZON_ENRICHMENT",
        primaryImageUrl: candidate.primaryImageUrl ?? known?.primaryImageUrl ?? null,
        imageUrls:
          candidate.imageUrls.length > 0
            ? candidate.imageUrls
            : known?.primaryImageUrl
              ? [known.primaryImageUrl]
              : [],
        asin: candidate.asin ?? known?.asin ?? inferAsinFromUrl(productUrl),
        productUrl,
        confidenceScore,
        confidenceState: confidenceStateFromScore(confidenceScore),
        matchRationale: [
          ...candidate.matchRationale,
          "Amazon-oriented enrichment added a product URL and enriched image context."
        ],
        hint: defaultHintForConfidence("AMAZON_ENRICHMENT", confidenceScore),
        safeToPrefill: confidenceScore >= 0.55,
        simulated: true
      } satisfies ProductLookupCandidate;
    });
  }
};

export function createProductLookupService(): ProductLookupService {
  const barcodeProviders: BarcodeLookupProvider[] = [internalCatalogLookupProvider, simulatedBarcodeLookupProvider];
  const enrichmentProviders: ProductEnrichmentProvider[] = [simulatedAmazonEnrichmentProvider];

  return {
    async lookupBarcode(input) {
      const barcode = normalizeIdentifier(input.barcode);
      const identifierType = classifyIdentifier(barcode);

      let candidates: ProductLookupCandidate[] = [];
      const providerSummary = {
        barcodeLookupProvider: barcodeProviders[0]?.id ?? "none",
        enrichmentProvider: enrichmentProviders[0]?.id ?? "none",
        simulated: false
      };

      for (const provider of barcodeProviders) {
        const providerCandidates = await provider.lookupBarcode({
          workspaceId: input.workspaceId,
          barcode,
          identifierType
        });

        if (providerCandidates.length > 0) {
          providerSummary.barcodeLookupProvider = provider.id;
          providerSummary.simulated = provider.simulated;
          candidates = providerCandidates;
          break;
        }
      }

      if (candidates.length > 0) {
        for (const enrichmentProvider of enrichmentProviders) {
          const highestCandidate = rankCandidates(candidates)[0];
          if (!highestCandidate || highestCandidate.confidenceScore < 0.55) {
            break;
          }

          candidates = await enrichmentProvider.enrichCandidates({
            workspaceId: input.workspaceId,
            barcode,
            identifierType,
            candidates
          });
          providerSummary.enrichmentProvider = enrichmentProvider.id;
          providerSummary.simulated = providerSummary.simulated || enrichmentProvider.simulated;
        }
      }

      const rankedCandidates = rankCandidates(dedupeCandidates(candidates));

      if (rankedCandidates.length === 0) {
        return {
          barcode,
          identifierType,
          candidates: [],
          hint: noMatchHint(barcode, identifierType),
          recommendedNextAction: "Continue with manual entry if the barcode does not produce a trustworthy match.",
          providerSummary
        };
      }

      const topCandidate = rankedCandidates[0];

      if (!topCandidate) {
        return {
          barcode,
          identifierType,
          candidates: [],
          hint: noMatchHint(barcode, identifierType),
          recommendedNextAction: "Continue with manual entry if the barcode does not produce a trustworthy match.",
          providerSummary
        };
      }

      return {
        barcode,
        identifierType,
        candidates: rankedCandidates,
        hint:
          topCandidate?.hint ??
          defaultHintForConfidence(topCandidate?.provider ?? "SIMULATED", topCandidate?.confidenceScore ?? 0.3),
        recommendedNextAction:
          topCandidate.confidenceState === "HIGH"
            ? "Review the top match, confirm it matches the item in hand, then apply it to inventory."
            : "Review the candidates carefully and use manual entry if none clearly match the item in hand.",
        providerSummary
      };
    }
  };
}
