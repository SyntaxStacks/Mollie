import { z } from "zod";

const macBidUrlSchema = z.string().url().refine((value) => value.includes("mac.bid"), {
  message: "URL must be a Mac.bid lot URL"
});

type ParsedLotUrl = {
  externalId: string;
  titleSlug: string;
};

const categoryHints: Array<{ keyword: string; category: string; brand?: string }> = [
  { keyword: "shoe", category: "Footwear", brand: "Nike" },
  { keyword: "sneaker", category: "Footwear", brand: "Nike" },
  { keyword: "vacuum", category: "Home", brand: "Dyson" },
  { keyword: "controller", category: "Gaming", brand: "Sony" },
  { keyword: "camera", category: "Electronics", brand: "Canon" },
  { keyword: "hoodie", category: "Apparel", brand: "Nike" },
  { keyword: "jacket", category: "Apparel" }
];

export function parseMacBidUrl(url: string): ParsedLotUrl {
  const parsedUrl = new URL(macBidUrlSchema.parse(url));
  const segments = parsedUrl.pathname.split("/").filter(Boolean);
  const finalSegment = segments.at(-1) ?? parsedUrl.hostname;
  const externalId =
    parsedUrl.searchParams.get("lot") ??
    parsedUrl.searchParams.get("id") ??
    finalSegment.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase();
  const titleSlug = finalSegment.replace(/[-_]+/g, " ").trim();

  return {
    externalId: externalId || crypto.randomUUID(),
    titleSlug
  };
}

export type FetchedLot = {
  externalId: string;
  title: string;
  sourceUrl: string;
  categoryHint: string;
  brandHint?: string;
  quantity: number;
  rawMetadata: Record<string, unknown>;
  images: string[];
};

export function fetchMockLot(url: string, titleHint?: string): FetchedLot {
  const parsed = parseMacBidUrl(url);
  const title = titleHint ?? parsed.titleSlug.replace(/\b\w/g, (value) => value.toUpperCase());
  const matched:
    | {
        category: string;
        brand?: string;
      }
    | undefined = categoryHints.find((hint) => title.toLowerCase().includes(hint.keyword));
  const quantity = title.toLowerCase().includes("lot") ? 3 : 1;

  return {
    externalId: parsed.externalId,
    title: title || "Mac.bid liquidation lot",
    sourceUrl: url,
    categoryHint: matched?.category ?? "General Merchandise",
    brandHint: matched?.brand,
    quantity,
    rawMetadata: {
      source: "mac.bid",
      parsedTitle: title,
      categoryHint: matched?.category ?? "General Merchandise",
      brandHint: matched?.brand ?? null,
      quantity,
      quality: title.toLowerCase().includes("sealed") ? "new" : "mixed",
      notes: "Fetched via MVP heuristic parser"
    },
    images: [
      `https://images.unsplash.com/photo-1512436991641-6745cdb1723f?lot=${parsed.externalId}`,
      `https://images.unsplash.com/photo-1542291026-7eec264c27ff?lot=${parsed.externalId}`
    ]
  };
}

export type InventoryCandidate = {
  title: string;
  brand?: string;
  category: string;
  condition: string;
  quantity: number;
  estimatedResaleMin: number;
  estimatedResaleMax: number;
  priceRecommendation: number;
  attributes: Record<string, string>;
};

export function lotToInventoryCandidates(lot: FetchedLot & { estimatedResaleMin?: number; estimatedResaleMax?: number }) {
  const low = lot.estimatedResaleMin ?? 30;
  const high = lot.estimatedResaleMax ?? 55;

  return [
    {
      title: lot.title,
      brand: lot.brandHint,
      category: lot.categoryHint,
      condition: lot.rawMetadata.quality === "new" ? "New with tags" : "Good used condition",
      quantity: lot.quantity,
      estimatedResaleMin: low,
      estimatedResaleMax: high,
      priceRecommendation: Math.round((low + high) / 2),
      attributes: {
        source: "mac.bid",
        lotExternalId: lot.externalId
      }
    }
  ];
}
