import OpenAI from "openai";

import type { ListingDraftOutput, LotAnalysis, Platform } from "@reselleros/types";

type LotContext = {
  title: string;
  normalizedTitle?: string | null;
  categoryHint?: string | null;
  quantity?: number | null;
};

type InventoryContext = {
  title: string;
  brand?: string | null;
  category: string;
  condition: string;
  size?: string | null;
  color?: string | null;
  attributes?: Record<string, unknown> | null;
  estimatedResaleMin?: number | null;
  estimatedResaleMax?: number | null;
  priceRecommendation?: number | null;
};

function scoreKeywords(title: string) {
  const valueMap: Record<string, number> = {
    nike: 40,
    apple: 90,
    vintage: 35,
    leather: 30,
    dyson: 80,
    nintendo: 70,
    sony: 60,
    designer: 50,
    lot: 15,
    sealed: 25,
    new: 20
  };

  const lowerTitle = title.toLowerCase();

  return Object.entries(valueMap).reduce((total, [keyword, boost]) => {
    return total + (lowerTitle.includes(keyword) ? boost : 0);
  }, 35);
}

function fallbackLotAnalysis(input: LotContext): LotAnalysis {
  const baseScore = scoreKeywords(input.title);
  const quantityFactor = Math.max(input.quantity ?? 1, 1);
  const min = Math.round((baseScore + quantityFactor * 8) * 1.15);
  const max = Math.round(min * 1.65);
  const riskScore = Math.min(88, Math.max(22, 70 - Math.round(baseScore / 2)));
  const confidenceScore = Math.min(92, Math.max(48, 50 + Math.round(baseScore / 5)));
  const recommendedMaxBid = Math.max(12, Math.round(min * 0.42));

  return {
    resaleRange: { min, max },
    confidenceScore,
    riskScore,
    recommendedMaxBid,
    summary: `Estimated resale value is strongest for ${input.categoryHint ?? "general merchandise"} buyers if the lot condition matches the listing photos.`,
    rationale: [
      "Used keyword heuristics from the lot title to estimate resale interest.",
      `Applied a quantity multiplier of ${quantityFactor} to avoid underpricing multi-item lots.`,
      `Targeted a buy ceiling near 42% of the low-end resale estimate to protect margin after fees.`
    ]
  };
}

function fallbackListingDraft(input: InventoryContext, platform: Platform): ListingDraftOutput {
  const basePrice =
    input.priceRecommendation ??
    input.estimatedResaleMin ??
    Math.max(18, Math.round(((input.estimatedResaleMax ?? 40) + (input.estimatedResaleMin ?? 24)) / 2));

  const adjective = input.condition.toLowerCase().includes("new") ? "New" : "Pre-Owned";
  const brandPrefix = input.brand ? `${input.brand} ` : "";
  const sizeSuffix = input.size ? ` Size ${input.size}` : "";
  const colorSuffix = input.color ? ` ${input.color}` : "";
  const platformSuffix = platform === "DEPOP" ? " Y2K reseller pick" : " fast ship";
  const title = `${adjective} ${brandPrefix}${input.title}${sizeSuffix}${colorSuffix}${platformSuffix}`.slice(0, 78).trim();
  const description = [
    `${brandPrefix}${input.title} in ${input.condition.toLowerCase()} condition.`,
    input.size ? `Size: ${input.size}.` : null,
    input.color ? `Color: ${input.color}.` : null,
    `Category: ${input.category}.`,
    platform === "EBAY"
      ? "Packed for search clarity and quick handling with room for item specifics."
      : "Written for a style-forward Depop audience while keeping sizing and condition explicit."
  ]
    .filter(Boolean)
    .join(" ");

  return {
    title,
    description,
    price: Math.round(basePrice * (platform === "DEPOP" ? 1.08 : 1)),
    tags: [
      input.category,
      input.brand ?? "reseller-finds",
      input.color ?? "neutral",
      platform === "DEPOP" ? "depopfinds" : "ebayseller"
    ]
      .map((tag) => tag.toLowerCase().replace(/\s+/g, "-"))
      .slice(0, 8),
    attributes: {
      condition: input.condition,
      category: input.category,
      ...(input.brand ? { brand: input.brand } : {}),
      ...(input.size ? { size: input.size } : {}),
      ...(input.color ? { color: input.color } : {})
    }
  };
}

async function tryOpenAiJson(prompt: string) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      input: prompt
    });

    return response.output_text;
  } catch {
    return null;
  }
}

export async function generateLotAnalysis(input: LotContext): Promise<LotAnalysis> {
  const fallback = fallbackLotAnalysis(input);
  const prompt = `Return JSON with keys resaleRange {min,max}, confidenceScore, riskScore, recommendedMaxBid, summary, rationale for this Mac.bid lot: ${JSON.stringify(
    input
  )}`;
  const output = await tryOpenAiJson(prompt);

  if (!output) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(output) as LotAnalysis;
    if (
      typeof parsed?.resaleRange?.min === "number" &&
      typeof parsed?.resaleRange?.max === "number" &&
      typeof parsed?.recommendedMaxBid === "number"
    ) {
      return parsed;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export async function generateListingDraft(
  input: InventoryContext,
  platform: Platform
): Promise<ListingDraftOutput> {
  const fallback = fallbackListingDraft(input, platform);
  const prompt = `Return JSON with keys title, description, price, tags, attributes for a ${platform} listing draft using this inventory item: ${JSON.stringify(
    input
  )}`;
  const output = await tryOpenAiJson(prompt);

  if (!output) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(output) as ListingDraftOutput;
    if (parsed.title && parsed.description && typeof parsed.price === "number") {
      return parsed;
    }
  } catch {
    return fallback;
  }

  return fallback;
}
