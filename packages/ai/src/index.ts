import type {
  AiAssistOperation,
  AiProviderName,
  AiStatusResponse,
  ListingDraftOutput,
  LotAnalysis,
  OperatorHint,
  Platform,
  UniversalListing,
  VisualProductLookupResult
} from "@reselleros/types";
import { z } from "zod";

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

export type ListingAssistContext = {
  operation: AiAssistOperation;
  platform?: Platform | null;
  item: UniversalListing;
};

export type VisualIdentifyContext = {
  imageBase64: string;
  mediaType: string;
  notes?: string | null;
};

export type AiProvider = {
  name: AiProviderName;
  interactiveEnabled: boolean;
  generateListingAssist(input: ListingAssistContext): Promise<string | number | null>;
  generateListingDraft?(input: InventoryContext, platform: Platform): Promise<ListingDraftOutput>;
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

  return Object.entries(valueMap).reduce((total, [keyword, boost]) => total + (lowerTitle.includes(keyword) ? boost : 0), 35);
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
      "Targeted a buy ceiling near 42% of the low-end resale estimate to protect margin after fees."
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
  const platformSuffix =
    platform === "DEPOP"
      ? " Y2K reseller pick"
      : platform === "POSHMARK"
        ? " closet refresh"
        : platform === "WHATNOT"
          ? " live sale ready"
          : " fast ship";
  const title = `${adjective} ${brandPrefix}${input.title}${sizeSuffix}${colorSuffix}${platformSuffix}`.slice(0, 78).trim();
  const description = [
    `${brandPrefix}${input.title} in ${input.condition.toLowerCase()} condition.`,
    input.size ? `Size: ${input.size}.` : null,
    input.color ? `Color: ${input.color}.` : null,
    `Category: ${input.category}.`,
    platform === "EBAY"
      ? "Packed for search clarity and quick handling with room for item specifics."
      : platform === "DEPOP"
        ? "Written for a style-forward Depop audience while keeping sizing and condition explicit."
        : platform === "POSHMARK"
          ? "Written for Poshmark cross-listing with brand, condition, and closet-style clarity."
          : "Written for Whatnot cross-listing with concise callouts and live-sale friendly details."
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
      platform === "DEPOP"
        ? "depopfinds"
        : platform === "POSHMARK"
          ? "poshmarkfinds"
          : platform === "WHATNOT"
            ? "whatnotseller"
            : "ebayseller"
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

function heuristicAssist(input: ListingAssistContext): string | number | null {
  const draft = fallbackListingDraft(
    {
      title: input.item.title,
      brand: input.item.brand ?? null,
      category: input.item.category,
      condition: input.item.condition,
      size: input.item.size ?? null,
      color: input.item.color ?? null,
      estimatedResaleMin: null,
      estimatedResaleMax: null,
      priceRecommendation: typeof input.item.price === "number" ? input.item.price : null,
      attributes: (input.item.metadata ?? {}) as Record<string, unknown>
    },
    input.platform ?? "EBAY"
  );

  if (input.operation === "title") {
    return draft.title;
  }

  if (input.operation === "description") {
    return draft.description;
  }

  return draft.price;
}

function getAiConfig() {
  return {
    enabled: process.env.AI_ENABLED === "true",
    provider: (process.env.AI_PROVIDER ?? "null") as AiProviderName,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    ollamaModel: process.env.OLLAMA_MODEL ?? "llama3.1:8b",
    dailyQuota: Number(process.env.AI_DAILY_LIMIT_PER_WORKSPACE ?? 50)
  };
}

const visualIdentificationSchema = z.object({
  title: z.string().trim().min(1).max(180),
  brand: z.string().trim().max(120).nullable().optional(),
  category: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  size: z.string().trim().max(80).nullable().optional(),
  color: z.string().trim().max(80).nullable().optional(),
  condition: z.string().trim().max(120).nullable().optional(),
  priceSuggestion: z.number().nonnegative().nullable().optional(),
  confidenceScore: z.number().min(0).max(1).default(0.42),
  matchRationale: z.array(z.string().trim().min(1).max(240)).max(5).default([]),
  researchQueries: z.array(z.string().trim().min(1).max(120)).max(5).default([])
});

function extractJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return text.slice(start, end + 1);
}

function confidenceStateFromScore(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 0.82) {
    return "HIGH";
  }

  if (score >= 0.58) {
    return "MEDIUM";
  }

  return "LOW";
}

function buildVisionHint(input: {
  title?: string | null;
  confidenceScore: number;
  explanation: string;
  severity?: OperatorHint["severity"];
  nextActions: string[];
}) {
  const title = input.title?.trim() || "Photo identification";

  return {
    title: `${title} needs operator review`,
    explanation: input.explanation,
    severity:
      input.severity ??
      (input.confidenceScore >= 0.82 ? "SUCCESS" : input.confidenceScore >= 0.58 ? "WARNING" : "WARNING"),
    nextActions: input.nextActions,
    canContinue: true
  } satisfies OperatorHint;
}

function buildUnavailableVisionResult(message: string, enabled: boolean, provider: string): VisualProductLookupResult {
  return {
    candidate: null,
    hint: buildVisionHint({
      confidenceScore: 0,
      explanation: message,
      severity: "WARNING",
      nextActions: [
        "Continue with manual or source lookup.",
        "Upload the photo to the item after save so you can keep editing from the listing workspace."
      ]
    }),
    recommendedNextAction: "Continue with manual/source lookup and treat photo identification as unavailable for this item.",
    providerSummary: {
      visionProvider: provider,
      simulated: true,
      enabled
    }
  };
}

function buildVisualPrompt(notes?: string | null) {
  return [
    "You identify secondhand resale inventory from a product photo.",
    "Inspect the main item in the image and return only JSON.",
    "Use visible evidence only. Do not invent barcodes, model numbers, accessories, or exact brands when they are not visible.",
    "Prefer practical resale categories like Apparel, Shoes, Beauty & Personal Care, Home, Electronics, Video Games, Books, Toys, Collectibles, or General Merchandise.",
    "Use null for fields you cannot support from the image.",
    'Return JSON with keys: title, brand, category, model, size, color, condition, priceSuggestion, confidenceScore, matchRationale, researchQueries.',
    "confidenceScore must be a number between 0 and 1.",
    "matchRationale must be an array of short evidence-based strings.",
    "researchQueries must be an array of short search phrases a reseller could use to verify the item.",
    notes?.trim() ? `Operator notes: ${notes.trim()}` : null
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function callOpenAiVision(input: VisualIdentifyContext) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";

  if (!apiKey) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildVisualPrompt(input.notes)
            },
            {
              type: "input_image",
              image_url: `data:${input.mediaType};base64,${input.imageBase64}`
            }
          ]
        }
      ],
      max_output_tokens: 700
    })
  });

  const payload = (await response.json().catch(() => ({}))) as {
    output_text?: string;
    error?: {
      message?: string;
    };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `OpenAI vision request failed with ${response.status}`);
  }

  return payload.output_text?.trim() ?? null;
}

function parseVisualIdentification(text: string) {
  const json = extractJsonObject(text);

  if (!json) {
    return null;
  }

  const parsed = JSON.parse(json) as unknown;
  return visualIdentificationSchema.parse(parsed);
}

export async function identifyProductFromImage(input: VisualIdentifyContext): Promise<VisualProductLookupResult> {
  const providerConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());

  if (!providerConfigured) {
    return buildUnavailableVisionResult(
      "Photo identification is not configured for this environment yet. Add OPENAI_API_KEY to enable AI-based product recognition from images.",
      false,
      "UNAVAILABLE"
    );
  }

  try {
    const output = await callOpenAiVision(input);

    if (!output) {
      return buildUnavailableVisionResult(
        "The vision provider did not return a usable identification result for this image.",
        true,
        "OPENAI_VISION"
      );
    }

    const parsed = parseVisualIdentification(output);

    if (!parsed) {
      return buildUnavailableVisionResult(
        "The image analysis response could not be converted into a trustworthy product suggestion.",
        true,
        "OPENAI_VISION"
      );
    }

    const confidenceScore = Math.max(0, Math.min(1, parsed.confidenceScore ?? 0.42));
    const confidenceState = confidenceStateFromScore(confidenceScore);

    return {
      candidate: {
        title: parsed.title,
        brand: parsed.brand ?? null,
        category: parsed.category ?? null,
        model: parsed.model ?? null,
        size: parsed.size ?? null,
        color: parsed.color ?? null,
        condition: parsed.condition ?? null,
        priceSuggestion: parsed.priceSuggestion ?? null,
        researchQueries: parsed.researchQueries,
        matchRationale: parsed.matchRationale,
        confidenceScore,
        confidenceState,
        hint: buildVisionHint({
          title: parsed.title,
          confidenceScore,
          explanation:
            confidenceState === "HIGH"
              ? "AI image analysis produced a strong first-pass identification. Review the fields, then save the item with the operator photo."
              : confidenceState === "MEDIUM"
                ? "AI image analysis produced a useful working guess. Review the title, category, and brand before saving."
                : "AI image analysis found only a weak match. Use it as a starting point and verify the item manually before saving.",
          nextActions: [
            "Review the suggested fields before saving the item.",
            "Use the suggested research queries if you need to verify brand, model, or market price."
          ]
        }),
        provider: "OPENAI_VISION",
        simulated: false
      },
      hint: buildVisionHint({
        title: parsed.title,
        confidenceScore,
        explanation:
          confidenceState === "HIGH"
            ? "Photo identification is strong enough to prefill the item, but the operator should still confirm the visible details."
            : "Photo identification is a starting point. Treat it as source material rather than final truth.",
        nextActions: [
          "Review the suggested fields.",
          "Save the item and continue refining it from the listing workspace."
        ]
      }),
      recommendedNextAction:
        confidenceState === "HIGH"
          ? "Review the prefilled fields and save the item with the uploaded photo."
          : "Use the photo suggestion as a prefill, then verify the details before saving.",
      providerSummary: {
        visionProvider: "OPENAI_VISION",
        simulated: false,
        enabled: true
      }
    };
  } catch {
    return buildUnavailableVisionResult(
      "Photo identification is temporarily unavailable. Continue with manual/source lookup for this item.",
      true,
      "OPENAI_VISION"
    );
  }
}

function buildOllamaPrompt(input: ListingAssistContext) {
  const operationInstruction =
    input.operation === "title"
      ? "Return JSON with a single string field named suggestion containing a concise resale listing title under 80 characters."
      : input.operation === "description"
        ? "Return JSON with a single string field named suggestion containing a concise but sellable marketplace description under 900 characters."
        : "Return JSON with a single numeric field named suggestion containing a resale listing price recommendation in USD.";

  return [
    "You are assisting a reseller creating a marketplace listing.",
    operationInstruction,
    "Use the item data provided. Do not invent condition upgrades or accessories that are not present.",
    `Platform: ${input.platform ?? "GENERAL"}`,
    `Item JSON: ${JSON.stringify(input.item)}`
  ].join("\n\n");
}

async function callOllama(input: ListingAssistContext, baseUrl: string, model: string) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      prompt: buildOllamaPrompt(input),
      stream: false,
      format: "json"
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed with ${response.status}`);
  }

  const payload = (await response.json()) as { response?: string };
  const text = payload.response?.trim();

  if (!text) {
    return null;
  }

  const parsed = JSON.parse(text) as { suggestion?: string | number | null };
  return parsed.suggestion ?? null;
}

class NullProvider implements AiProvider {
  name: AiProviderName = "null";
  interactiveEnabled = false;

  async generateListingAssist(input: ListingAssistContext) {
    return heuristicAssist(input);
  }

  async generateListingDraft(input: InventoryContext, platform: Platform) {
    return fallbackListingDraft(input, platform);
  }
}

class OllamaProvider implements AiProvider {
  name: AiProviderName = "ollama";
  interactiveEnabled = true;

  constructor(private readonly baseUrl: string, private readonly model: string) {}

  async generateListingAssist(input: ListingAssistContext) {
    try {
      return await callOllama(input, this.baseUrl, this.model);
    } catch {
      return heuristicAssist(input);
    }
  }

  async generateListingDraft(input: InventoryContext, platform: Platform) {
    const title = await this.generateListingAssist({
      operation: "title",
      platform,
      item: {
        inventoryItemId: "draft",
        sku: "draft",
        title: input.title,
        description: "",
        category: input.category,
        brand: input.brand ?? null,
        condition: input.condition,
        price: input.priceRecommendation ?? input.estimatedResaleMin ?? null,
        quantity: 1,
        size: input.size ?? null,
        color: input.color ?? null,
        tags: [],
        labels: [],
        freeShipping: false,
        photos: [],
        marketplaceOverrides: {},
        metadata: {}
      }
    });
    const description = await this.generateListingAssist({
      operation: "description",
      platform,
      item: {
        inventoryItemId: "draft",
        sku: "draft",
        title: input.title,
        description: "",
        category: input.category,
        brand: input.brand ?? null,
        condition: input.condition,
        price: input.priceRecommendation ?? input.estimatedResaleMin ?? null,
        quantity: 1,
        size: input.size ?? null,
        color: input.color ?? null,
        tags: [],
        labels: [],
        freeShipping: false,
        photos: [],
        marketplaceOverrides: {},
        metadata: {}
      }
    });
    const price = await this.generateListingAssist({
      operation: "price",
      platform,
      item: {
        inventoryItemId: "draft",
        sku: "draft",
        title: input.title,
        description: "",
        category: input.category,
        brand: input.brand ?? null,
        condition: input.condition,
        price: input.priceRecommendation ?? input.estimatedResaleMin ?? null,
        quantity: 1,
        size: input.size ?? null,
        color: input.color ?? null,
        tags: [],
        labels: [],
        freeShipping: false,
        photos: [],
        marketplaceOverrides: {},
        metadata: {}
      }
    });
    const fallback = fallbackListingDraft(input, platform);

    return {
      ...fallback,
      title: typeof title === "string" && title.trim() ? title.trim() : fallback.title,
      description: typeof description === "string" && description.trim() ? description.trim() : fallback.description,
      price: typeof price === "number" && Number.isFinite(price) ? price : fallback.price
    };
  }
}

export function getAiProvider(): AiProvider {
  const config = getAiConfig();

  if (config.enabled && config.provider === "ollama") {
    return new OllamaProvider(config.ollamaBaseUrl, config.ollamaModel);
  }

  return new NullProvider();
}

export function getAiStatus(): AiStatusResponse {
  const config = getAiConfig();
  return {
    enabled: config.enabled && config.provider !== "null",
    provider: config.enabled ? config.provider : "null",
    remainingDailyQuota: config.dailyQuota,
    dailyQuota: config.dailyQuota,
    message: config.enabled ? null : "AI suggestions are disabled for this environment."
  };
}

export async function generateLotAnalysis(input: LotContext): Promise<LotAnalysis> {
  return fallbackLotAnalysis(input);
}

export async function generateListingDraft(input: InventoryContext, platform: Platform): Promise<ListingDraftOutput> {
  const provider = getAiProvider();

  if (provider.generateListingDraft) {
    return provider.generateListingDraft(input, platform);
  }

  return fallbackListingDraft(input, platform);
}

export async function assistListing(input: ListingAssistContext): Promise<string | number | null> {
  return getAiProvider().generateListingAssist(input);
}
