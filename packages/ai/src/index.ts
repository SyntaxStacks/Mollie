import type {
  AiAssistOperation,
  AiProviderName,
  AiStatusResponse,
  ListingDraftOutput,
  LotAnalysis,
  Platform,
  UniversalListing
} from "@reselleros/types";

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
