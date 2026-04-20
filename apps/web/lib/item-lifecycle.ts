import type { MarketplaceCapabilitySummary, OperatorHint } from "@reselleros/types";

export type ItemLifecycleState =
  | "scanned"
  | "review"
  | "inventory"
  | "ready_to_list"
  | "listing_in_progress"
  | "listed"
  | "sold"
  | "archived"
  | "error";

export type ListingReadinessFlag =
  | "missing_title"
  | "missing_photos"
  | "missing_condition"
  | "missing_category"
  | "missing_price"
  | "missing_shipping"
  | "duplicate_candidate";

export type MarketplaceListingState =
  | "not_started"
  | "draft"
  | "queued"
  | "publishing"
  | "published"
  | "failed"
  | "ended"
  | "sold";

export type MarketplaceActionKind =
  | "publish_api"
  | "publish_extension"
  | "generate_draft"
  | "open_extension"
  | "open_listing"
  | "review_sale"
  | "connect_account"
  | "check_again"
  | "check_extension"
  | "fix_details"
  | "retry"
  | "watch"
  | "unavailable";

export type InventoryListLikeItem = {
  id: string;
  title: string;
  brand?: string | null;
  category: string;
  condition: string;
  size?: string | null;
  status?: string | null;
  costBasis?: number | null;
  priceRecommendation?: number | null;
  estimatedResaleMin?: number | null;
  estimatedResaleMax?: number | null;
  attributesJson?: Record<string, unknown> | null;
  images?: Array<{ id: string; url: string; position?: number | null }>;
  listingDrafts?: Array<{
    id: string;
    platform: string;
    reviewStatus?: string | null;
    generatedPrice?: number | null;
    generatedTitle?: string | null;
    attributesJson?: Record<string, unknown> | null;
  }>;
  platformListings?: Array<{
    id: string;
    platform: string;
    status?: string | null;
    externalUrl?: string | null;
  }>;
  extensionTasks?: Array<{
    id: string;
    platform: string;
    action: string;
    state: string;
    attemptCount?: number | null;
    resultJson?: Record<string, unknown> | null;
    needsInputReason?: string | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
  }>;
  sales?: Array<{ id: string; soldPrice: number; soldAt?: string | Date | null }>;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export type MarketplaceAccountLike = {
  id: string;
  platform: string;
  displayName: string;
  status: string;
  validationStatus?: string | null;
  readiness?: {
    state: string;
    status: string;
    summary: string;
    detail: string;
    hint?: OperatorHint | null;
  } | null;
};

export type MarketplaceStatusSummary = {
  platform: string;
  state: MarketplaceListingState;
  missingRequirements: string[];
  recommendedRequirements: string[];
  actionLabel: string;
  actionKind: MarketplaceActionKind;
  secondaryActionLabel?: string | null;
  secondaryActionKind?: MarketplaceActionKind | null;
  summary: string;
  executionMode: string;
  capabilitySummary: string;
  extensionRequired: boolean;
  extensionSummary: string;
  connectionSummary: string;
  connectionTone: "success" | "warning" | "neutral" | "danger";
  blocker: string | null;
  listingUrl?: string | null;
};

export type MarketplaceStatusOptions = {
  marketplaceAccounts?: MarketplaceAccountLike[];
  capabilitySummary?: MarketplaceCapabilitySummary[];
  extensionInstalled?: boolean;
  extensionConnected?: boolean;
};

type ListingDraftLike = NonNullable<InventoryListLikeItem["listingDrafts"]>[number];
type ExtensionTaskLike = NonNullable<InventoryListLikeItem["extensionTasks"]>[number];
type PlatformRequirements = {
  required: string[];
  recommended: string[];
};

type ExtensionTaskResultLike = {
  missingFields?: unknown;
};

export function getItemPrimaryImage(item: InventoryListLikeItem) {
  return item.images?.[0]?.url ?? null;
}

export function getListingReadinessFlags(item: InventoryListLikeItem): ListingReadinessFlag[] {
  const flags: ListingReadinessFlag[] = [];

  if (!item.title.trim()) {
    flags.push("missing_title");
  }

  if (!item.images?.length) {
    flags.push("missing_photos");
  }

  if (!item.condition.trim()) {
    flags.push("missing_condition");
  }

  if (!item.category.trim()) {
    flags.push("missing_category");
  }

  if ((item.priceRecommendation ?? 0) <= 0) {
    flags.push("missing_price");
  }

  const attributes = item.attributesJson ?? {};
  if (attributes && typeof attributes.duplicateCandidate === "boolean" && attributes.duplicateCandidate) {
    flags.push("duplicate_candidate");
  }

  return flags;
}

export function getMarketplaceListingState(status: string | null | undefined): MarketplaceListingState {
  const normalized = (status ?? "").toUpperCase();

  if (!normalized) {
    return "not_started";
  }

  if (normalized.includes("SOLD")) {
    return "sold";
  }

  if (normalized.includes("END")) {
    return "ended";
  }

  if (normalized.includes("FAIL") || normalized.includes("ERROR")) {
    return "failed";
  }

  if (normalized.includes("QUEUE")) {
    return "queued";
  }

  if (normalized.includes("RUN") || normalized.includes("PUBLISHING")) {
    return "publishing";
  }

  if (normalized.includes("PUBLISH") || normalized.includes("LISTED") || normalized.includes("SYNC")) {
    return "published";
  }

  if (normalized.includes("DRAFT") || normalized.includes("APPROV")) {
    return "draft";
  }

  return "not_started";
}

function getItemAttributes(item: InventoryListLikeItem) {
  return (item.attributesJson ?? {}) as Record<string, unknown>;
}

function getMarketplaceOverride(item: InventoryListLikeItem, platform: string) {
  const attributes = getItemAttributes(item);
  const marketplaceOverrides =
    attributes.marketplaceOverrides && typeof attributes.marketplaceOverrides === "object"
      ? (attributes.marketplaceOverrides as Record<string, unknown>)
      : null;
  const override = marketplaceOverrides?.[platform];

  return override && typeof override === "object" ? (override as Record<string, unknown>) : null;
}

function getMarketplaceOverrideAttributes(item: InventoryListLikeItem, platform: string) {
  const override = getMarketplaceOverride(item, platform);
  const attributes = override?.attributes;

  return attributes && typeof attributes === "object" ? (attributes as Record<string, unknown>) : null;
}

function getStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function hasValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return false;
}

function humanizeGenericRequirement(flag: ListingReadinessFlag) {
  switch (flag) {
    case "missing_title":
      return "title";
    case "missing_photos":
      return "photos";
    case "missing_condition":
      return "condition";
    case "missing_category":
      return "category";
    case "missing_price":
      return "base price";
    case "missing_shipping":
      return "shipping";
    case "duplicate_candidate":
      return "duplicate review";
    default:
      return String(flag).replace(/_/g, " ");
  }
}

function humanizeExtensionField(field: string) {
  switch (field.trim().toLowerCase()) {
    case "title":
      return "title";
    case "description":
      return "description";
    case "price":
      return "price";
    case "brand":
      return "brand";
    case "category":
      return "category";
    case "department":
    case "depop department":
      return "Depop department";
    case "product type":
    case "product_type":
    case "depop product type":
      return "Depop product type";
    case "shipping":
    case "shipping mode":
    case "shipping_mode":
    case "depop shipping":
      return "Depop shipping";
    case "condition":
      return "condition";
    case "size":
      return "size";
    case "photos":
      return "photos";
    default:
      return field.replace(/_/g, " ").trim().toLowerCase();
  }
}

function isGenericMissingFieldMessage(message: string | null | undefined) {
  if (!message) {
    return false;
  }

  const normalized = message.trim().toLowerCase();
  return normalized.includes("needs a few required fields") || normalized.includes("still needs required item fields");
}

function getExtensionTaskMissingFields(extensionTask?: ExtensionTaskLike | null) {
  if (!extensionTask?.resultJson || typeof extensionTask.resultJson !== "object") {
    return [];
  }

  const result = extensionTask.resultJson as ExtensionTaskResultLike;
  return uniqueStrings(getStringArray(result.missingFields).map(humanizeExtensionField));
}

function marketplaceFieldHasValue(item: InventoryListLikeItem, platform: string, field: string, draft?: ListingDraftLike | null) {
  const attributes = getItemAttributes(item);
  const override = getMarketplaceOverride(item, platform);
  const overrideAttributes = getMarketplaceOverrideAttributes(item, platform);

  switch (field) {
    case "title":
      return hasValue(override?.title) || hasValue(item.title);
    case "description":
    case "show notes":
      return hasValue(getTextAttribute(attributes, "description")) || hasValue(override?.description);
    case "price":
      return hasValue(override?.price) || hasValue(item.priceRecommendation);
    case "brand":
      return hasValue(override?.brand) || hasValue(item.brand);
    case "category":
      return hasValue(override?.category) || hasValue(item.category);
    case "Depop department":
      return hasValue(overrideAttributes?.department);
    case "Depop product type":
      return hasValue(overrideAttributes?.productType);
    case "Depop shipping":
      return hasValue(overrideAttributes?.shippingMode);
    case "condition":
      return hasValue(override?.condition) || hasValue(item.condition);
    case "size":
      return hasValue(override?.size) || hasValue(overrideAttributes?.size) || hasValue(item.size);
    case "photos":
      return (item.images?.length ?? 0) > 0;
    case "eBay category mapping":
      return hasValue(draft?.attributesJson && typeof draft.attributesJson === "object" ? (draft.attributesJson as Record<string, unknown>).ebayCategoryId : null);
    default:
      return false;
  }
}

function getTextAttribute(attributes: Record<string, unknown>, key: string) {
  return typeof attributes[key] === "string" ? attributes[key].trim() : "";
}

function itemNeedsSizing(item: InventoryListLikeItem) {
  const haystack = `${item.category} ${item.title}`.toLowerCase();
  return [
    "apparel",
    "clothing",
    "dress",
    "shirt",
    "jacket",
    "coat",
    "hoodie",
    "pants",
    "jeans",
    "shorts",
    "skirt",
    "top",
    "sweater",
    "outerwear",
    "sneaker",
    "shoe",
    "boot",
    "heel",
    "sandals"
  ].some((token) => haystack.includes(token));
}

function getPlatformRequirements(input: {
  item: InventoryListLikeItem;
  platform: string;
  genericFlags: ListingReadinessFlag[];
  draft?: ListingDraftLike | null;
}): PlatformRequirements {
  const genericRequired = input.genericFlags
    .filter((flag) => flag !== "duplicate_candidate")
    .map(humanizeGenericRequirement);
  const required =
    input.platform === "DEPOP"
      ? genericRequired.filter((requirement) => requirement !== "title" && requirement !== "category")
      : [...genericRequired];
  const recommended: string[] = [];
  const attributes = getItemAttributes(input.item);
  const draftAttributes =
    input.draft?.attributesJson && typeof input.draft.attributesJson === "object"
      ? (input.draft.attributesJson as Record<string, unknown>)
      : {};
  const description = getTextAttribute(attributes, "description");

  if (input.platform === "EBAY") {
    if (!hasValue(attributes.shippingWeightValue)) {
      required.push("shipping weight");
    }

    const hasDimensions = hasValue(attributes.shippingLength) && hasValue(attributes.shippingWidth) && hasValue(attributes.shippingHeight);
    if (!hasDimensions) {
      required.push("package size");
    }

    if (!description) {
      required.push("description");
    }

    if (!hasValue(draftAttributes.ebayCategoryId) && !required.includes("category")) {
      required.push("eBay category mapping");
    }
  }

  if (input.platform === "DEPOP") {
    const depopAttributes = getMarketplaceOverrideAttributes(input.item, "DEPOP");

    if (!description) {
      required.push("description");
    }

    if (!hasValue(depopAttributes?.department)) {
      required.push("Depop department");
    }

    if (!hasValue(depopAttributes?.productType)) {
      required.push("Depop product type");
    }

    if (!hasValue(depopAttributes?.shippingMode)) {
      required.push("Depop shipping");
    }

    const sharedTags = getStringArray(attributes.tags);
    const depopTags = getStringArray(depopAttributes?.tags);

    if (sharedTags.length === 0 && depopTags.length === 0) {
      recommended.push("Depop discovery tags");
    }

    if (itemNeedsSizing(input.item) && !hasValue(input.item.size)) {
      required.push("size");
    }
  }

  if (input.platform === "POSHMARK") {
    if (!description) {
      required.push("description");
    }

    if (itemNeedsSizing(input.item) && !hasValue(input.item.size)) {
      required.push("size");
    }

    if (!hasValue(input.item.brand)) {
      recommended.push("brand");
    }
  }

  if (input.platform === "WHATNOT") {
    if (!description) {
      required.push("show notes");
    }

    if (!hasValue(input.item.brand)) {
      recommended.push("brand");
    }
  }

  return {
    required: uniqueStrings(required),
    recommended: uniqueStrings(recommended).filter((value) => !required.includes(value))
  };
}

function describeCapabilities(platform: string, capability?: MarketplaceCapabilitySummary | null) {
  if (!capability) {
    return {
      executionMode: "Unavailable",
      capabilitySummary: "No live marketplace workflow",
      extensionRequired: false
    };
  }

  if (capability.publishMode === "API" && capability.importMode === "EXTENSION") {
    return {
      executionMode: "API",
      capabilitySummary: "API publish with optional browser import",
      extensionRequired: false
    };
  }

  if (capability.publishMode === "API") {
    return {
      executionMode: "API",
      capabilitySummary: "Publish through Mollie",
      extensionRequired: false
    };
  }

  if (capability.publishMode === "EXTENSION") {
    return {
      executionMode: "Browser",
      capabilitySummary: "Marketplace work runs in your browser extension",
      extensionRequired: true
    };
  }

  if (capability.importMode === "EXTENSION") {
    return {
      executionMode: "Browser",
      capabilitySummary: "Import or draft prep is available in the browser extension",
      extensionRequired: false
    };
  }

  return {
    executionMode: "Unavailable",
    capabilitySummary: "No live marketplace workflow",
    extensionRequired: false
  };
}

function describeConnection(input: {
  platform: string;
  capability?: MarketplaceCapabilitySummary | null;
  account?: MarketplaceAccountLike | null;
}) {
  const account = input.account;

  if (!account) {
    const blocker =
      input.platform === "POSHMARK"
        ? "Open Poshmark in another tab, finish login there, then recheck it from Mollie."
        : input.platform === "DEPOP"
          ? "Open the marketplace in another tab, finish login there, then recheck it from Mollie."
          : input.platform === "WHATNOT"
            ? "Open Whatnot in another tab, finish login there, then recheck it from Mollie."
            : "Open the marketplace in another tab, finish login there, then recheck it from Mollie.";

    return {
      connectionSummary: "No connected marketplace account",
      connectionTone: "warning" as const,
      blocker
    };
  }

  if (
    input.capability?.publishMode === "EXTENSION" &&
    account.status === "CONNECTED" &&
    account.validationStatus === "VALID"
  ) {
    return {
      connectionSummary: `Browser session ready${account.displayName ? ` - ${account.displayName}` : ""}`,
      connectionTone: "success" as const,
      blocker: null
    };
  }

  if (account.readiness?.status === "READY") {
    return {
      connectionSummary: account.readiness.summary,
      connectionTone: "success" as const,
      blocker: null
    };
  }

  if (account.readiness) {
    return {
      connectionSummary: account.readiness.summary,
      connectionTone: account.readiness.status === "BLOCKED" ? ("danger" as const) : ("warning" as const),
      blocker: account.readiness.detail
    };
  }

  if (account.status === "CONNECTED") {
    return {
      connectionSummary: "Connected account",
      connectionTone: "success" as const,
      blocker: null
    };
  }

  return {
    connectionSummary: account.status.replace(/_/g, " "),
    connectionTone: "warning" as const,
    blocker: "Reconnect this marketplace account before listing."
  };
}

function describeExtensionState(options: MarketplaceStatusOptions, extensionRequired: boolean) {
  if (!extensionRequired) {
    return {
      extensionSummary: options.extensionConnected
        ? "Browser extension is connected for optional browser-side work"
        : options.extensionInstalled
          ? "Browser extension is installed but not connected to Mollie"
          : "Browser extension is optional for this marketplace",
      extensionBlocker: null
    };
  }

  if (options.extensionConnected) {
    return {
      extensionSummary: "Browser extension connected and ready",
      extensionBlocker: null
    };
  }

  if (options.extensionInstalled) {
    return {
      extensionSummary: "Browser extension installed but not connected",
      extensionBlocker: "Refresh the browser extension connection."
    };
  }

  return {
    extensionSummary: "Browser extension not installed in this browser",
    extensionBlocker: "Install the Mollie browser extension."
  };
}

function summarizeMarketplaceReadiness(input: {
  platform: string;
  listingState: MarketplaceListingState;
  draft?: ListingDraftLike | null;
  requiredRequirements: string[];
  recommendedRequirements: string[];
  capability?: MarketplaceCapabilitySummary | null;
  account?: MarketplaceAccountLike | null;
  connectionBlocker: string | null;
  extensionBlocker: string | null;
  extensionTask?: ExtensionTaskLike | null;
  needsBrowserInput: boolean;
}) {
  const primaryMissing = input.requiredRequirements[0] ?? null;
  const fallbackBlocker =
    input.requiredRequirements.length > 0 ? `Missing ${input.requiredRequirements.join(", ")}.` : null;

  if (input.listingState === "published" || input.listingState === "sold") {
    return {
      summary: input.listingState === "sold" ? "Sold on marketplace" : "Published and live",
      blocker: null
    };
  }

  if (input.listingState === "queued" || input.listingState === "publishing") {
    return {
      summary:
        input.extensionTask?.state === "QUEUED"
          ? "Queued in the browser extension"
          : input.extensionTask?.state === "RUNNING"
            ? "Browser extension execution is active"
            : "Marketplace work is in flight",
      blocker: null
    };
  }

  if (input.needsBrowserInput) {
    if (input.requiredRequirements.length > 0) {
      return {
        summary:
          input.platform === "DEPOP"
            ? "Depop still needs required item fields before publish."
            : "This marketplace still needs required item fields.",
        blocker: fallbackBlocker
      };
    }

    const browserRetrySummary =
      input.platform === "DEPOP" ? "Depop publish needs another browser pass." : "The marketplace flow needs another browser pass.";

    return {
      summary:
        isGenericMissingFieldMessage(input.extensionTask?.lastErrorMessage)
          ? browserRetrySummary
          : input.extensionTask?.lastErrorMessage ?? browserRetrySummary,
      blocker:
        isGenericMissingFieldMessage(input.extensionTask?.needsInputReason)
          ? "Mollie has the required fields. Retry the browser publish so the extension can map them onto this Depop page."
          : input.extensionTask?.needsInputReason ??
        "The browser extension needs another pass to finish the marketplace flow."
    };
  }

  if (input.listingState === "failed") {
    return {
      summary: input.extensionTask?.lastErrorMessage ?? "Marketplace work failed and needs attention",
      blocker: input.extensionTask?.needsInputReason ?? input.extensionTask?.lastErrorMessage ?? input.connectionBlocker ?? fallbackBlocker
    };
  }

  switch (input.platform) {
    case "EBAY": {
      if (input.draft) {
        return {
          summary: input.draft.reviewStatus === "APPROVED" ? "Ready for eBay API publish" : "eBay draft needs review",
          blocker: input.requiredRequirements.length > 0 ? fallbackBlocker : input.connectionBlocker ?? input.extensionBlocker
        };
      }

      if (input.requiredRequirements.some((value) => value === "shipping weight" || value === "package size")) {
        return {
          summary: "Finish eBay shipping details",
          blocker: fallbackBlocker
        };
      }

      if (input.requiredRequirements.some((value) => value === "eBay category mapping" || value === "category")) {
        return {
          summary: "Finish eBay category mapping",
          blocker: fallbackBlocker
        };
      }

      if (input.capability?.publishMode !== "NONE" && input.requiredRequirements.length === 0) {
        return {
          summary: "eBay is ready for draft generation",
          blocker: "Generate a marketplace draft before publishing."
        };
      }

      return {
        summary: primaryMissing ? `Finish ${primaryMissing} for eBay` : "eBay needs more listing detail",
        blocker: fallbackBlocker ?? input.connectionBlocker ?? input.extensionBlocker
      };
    }

    case "DEPOP": {
      if (!input.account) {
        return {
          summary: "Open Depop login, then recheck from Mollie",
          blocker: input.connectionBlocker
        };
      }

      if (input.draft) {
        return {
          summary: input.draft.reviewStatus === "APPROVED" ? "Ready for Depop browser posting" : "Depop draft needs review",
          blocker: input.requiredRequirements.length > 0 ? fallbackBlocker : input.connectionBlocker ?? input.extensionBlocker
        };
      }

      if (input.capability?.publishMode === "EXTENSION" && input.requiredRequirements.length === 0) {
        return {
          summary: "Ready for Depop browser draft prep",
          blocker: input.connectionBlocker ?? input.extensionBlocker
        };
      }

      return {
        summary: primaryMissing ? `Finish ${primaryMissing} before Depop draft prep` : "Depop needs a little more listing detail",
        blocker: fallbackBlocker ?? input.connectionBlocker ?? input.extensionBlocker
      };
    }

    case "POSHMARK": {
      if (!input.account) {
        return {
          summary: "Open Poshmark login, then recheck from Mollie",
          blocker: input.connectionBlocker
        };
      }

      if (input.requiredRequirements.length > 0) {
        return {
          summary: primaryMissing ? `Finish ${primaryMissing} before Poshmark prep` : "Finish the core listing details for Poshmark",
          blocker: fallbackBlocker
        };
      }

      if (!input.draft && input.capability?.publishMode !== "NONE") {
        return {
          summary: "Ready for Poshmark draft generation",
          blocker: "Generate and approve a Poshmark draft before publishing."
        };
      }

      return {
        summary:
          input.capability?.publishMode === "API"
            ? "Ready for Poshmark remote publish"
            : "Poshmark account is connected, but remote publish is not live yet",
        blocker: input.capability?.publishMode === "API" ? input.connectionBlocker : input.connectionBlocker ?? input.extensionBlocker
      };
    }

    case "WHATNOT": {
      if (!input.account) {
        return {
          summary: "Open Whatnot login, then recheck from Mollie",
          blocker: input.connectionBlocker
        };
      }

      if (input.requiredRequirements.length > 0) {
        return {
          summary: primaryMissing ? `Finish ${primaryMissing} before Whatnot prep` : "Finish the core listing details for Whatnot",
          blocker: fallbackBlocker
        };
      }

      return {
        summary:
          input.capability?.publishMode === "EXTENSION"
            ? "Ready for Whatnot browser prep"
            : "Whatnot browser session is connected, but listing prep is not live yet",
        blocker: input.capability?.publishMode === "EXTENSION" ? input.connectionBlocker ?? input.extensionBlocker : input.connectionBlocker
      };
    }

    default:
      return {
        summary: primaryMissing ? `Finish ${primaryMissing}` : "Needs more item setup",
        blocker: fallbackBlocker ?? input.connectionBlocker ?? input.extensionBlocker
      };
  }
}

function actionForState(input: {
  platform: string;
  listingState: MarketplaceListingState;
  hasDraft: boolean;
  hasBlockingFields: boolean;
  capability?: MarketplaceCapabilitySummary | null;
  extensionRequired: boolean;
  extensionConnected?: boolean;
  account?: MarketplaceAccountLike | null;
  blocker: string | null;
  needsBrowserInput: boolean;
  extensionTaskAction?: string | null;
}): {
  actionLabel: string;
  actionKind: MarketplaceActionKind;
} {
  if (input.listingState === "published") {
    return {
      actionLabel: "Open listing",
      actionKind: "open_listing" as const
    };
  }

  if (input.listingState === "sold") {
    return {
      actionLabel: "Review sale",
      actionKind: "review_sale" as const
    };
  }

  if (input.listingState === "queued" || input.listingState === "publishing") {
    return {
      actionLabel: "Watch progress",
      actionKind: "watch" as const
    };
  }

  if (input.needsBrowserInput) {
    if (input.hasBlockingFields) {
      return {
        actionLabel: "Fix details",
        actionKind: "fix_details" as const
      };
    }

    return {
      actionLabel:
        input.platform === "DEPOP"
          ? input.extensionTaskAction === "PUBLISH_LISTING"
            ? "Retry publish"
            : "Retry draft prep"
          : "Retry in browser",
      actionKind: "retry" as const
    };
  }

  if (input.listingState === "failed" && input.capability?.publishMode === "EXTENSION") {
    const actionKind: MarketplaceActionKind =
      input.extensionTaskAction === "PUBLISH_LISTING" ? "publish_extension" : "open_extension";

    return {
      actionLabel: input.extensionTaskAction === "PUBLISH_LISTING" ? "Retry publish" : "Retry draft prep",
      actionKind
    };
  }

  if (input.blocker) {
    if (!input.account) {
      return {
        actionLabel:
          input.platform === "POSHMARK" || input.platform === "DEPOP" || input.platform === "WHATNOT"
            ? "Open login"
            : "Recheck login",
        actionKind: "connect_account" as const
      };
    }

    if (input.extensionRequired && !input.extensionConnected) {
      return {
        actionLabel: "Check extension",
        actionKind: "check_extension" as const
      };
    }

    if (input.hasBlockingFields) {
      return {
        actionLabel: "Fix details",
        actionKind: "fix_details" as const
      };
    }

    return {
      actionLabel: "Retry",
      actionKind: "retry" as const
    };
  }

  if (input.hasDraft || input.listingState === "draft") {
    if (input.capability?.publishMode === "API") {
      return {
        actionLabel: "Publish via API",
        actionKind: "publish_api" as const
      };
    }

    return {
      actionLabel: input.platform === "DEPOP" ? "Post in browser" : "Open in extension",
      actionKind: "publish_extension" as const
    };
  }

  if (!input.hasDraft && input.capability?.publishMode !== "NONE" && !input.hasBlockingFields) {
    return {
      actionLabel: "Generate draft",
      actionKind: "generate_draft" as const
    };
  }

  if (input.capability?.publishMode === "API") {
    return {
      actionLabel: "Publish via API",
      actionKind: "publish_api" as const
    };
  }

  if (input.capability?.importMode === "EXTENSION" || input.capability?.publishMode === "EXTENSION") {
    return {
      actionLabel: "Open in extension",
      actionKind: "open_extension" as const
    };
  }

  if (input.hasBlockingFields) {
    return {
      actionLabel: "Fix details",
      actionKind: "fix_details" as const
    };
  }

  return {
    actionLabel: "Unavailable",
    actionKind: "unavailable" as const
  };
}

export function getMarketplaceStatusSummaries(
  item: InventoryListLikeItem,
  options: MarketplaceStatusOptions = {}
): MarketplaceStatusSummary[] {
  const flags = getListingReadinessFlags(item);
  const platforms = ["EBAY", "DEPOP", "POSHMARK", "WHATNOT"] as const;

  return platforms.map((platform) => {
    const listing = item.platformListings?.find((candidate) => candidate.platform === platform) ?? null;
    const draft = item.listingDrafts?.find((candidate) => candidate.platform === platform) ?? null;
    const extensionTask =
      item.extensionTasks?.find((candidate) => candidate.platform === platform) ?? null;
    const baseListingState = listing ? getMarketplaceListingState(listing.status) : draft ? "draft" : "not_started";
    const listingState =
      extensionTask?.state === "QUEUED"
        ? "queued"
        : extensionTask?.state === "RUNNING"
          ? "publishing"
          : extensionTask?.state === "FAILED"
            ? "failed"
            : baseListingState;
    const requirements = getPlatformRequirements({
      item,
      platform,
      genericFlags: flags,
      draft
    });
    const extensionTaskMissingFields = getExtensionTaskMissingFields(extensionTask).filter(
      (field) => !marketplaceFieldHasValue(item, platform, field, draft)
    );
    const missingRequirements = uniqueStrings([...requirements.required, ...extensionTaskMissingFields]);
    const capability = options.capabilitySummary?.find((entry) => entry.platform === platform) ?? null;
    const account =
      options.marketplaceAccounts?.find((candidate) => candidate.platform === platform && candidate.status === "CONNECTED") ??
      options.marketplaceAccounts?.find((candidate) => candidate.platform === platform) ??
      null;
    const capabilityDetail = describeCapabilities(platform, capability);
    const connectionDetail = describeConnection({
      platform,
      capability,
      account
    });
    const extensionDetail = describeExtensionState(options, capabilityDetail.extensionRequired);
    const needsBrowserInput = extensionTask?.state === "NEEDS_INPUT";
    const readinessCopy = summarizeMarketplaceReadiness({
      platform,
      listingState,
      draft,
      requiredRequirements: missingRequirements,
      recommendedRequirements: requirements.recommended,
      capability,
      account,
      connectionBlocker: connectionDetail.blocker,
      extensionBlocker: extensionDetail.extensionBlocker,
      extensionTask,
      needsBrowserInput
    });
    let summary = readinessCopy.summary;
    let blocker = readinessCopy.blocker;

    if (!blocker && (connectionDetail.blocker || extensionDetail.extensionBlocker) && listingState !== "published" && listingState !== "sold") {
      blocker = connectionDetail.blocker ?? extensionDetail.extensionBlocker;
    }

    const action = actionForState({
      platform,
      listingState,
      hasDraft: Boolean(draft),
      hasBlockingFields: missingRequirements.length > 0,
      capability,
      extensionRequired: capabilityDetail.extensionRequired,
      extensionConnected: options.extensionConnected,
      account,
      blocker,
      needsBrowserInput,
      extensionTaskAction: extensionTask?.action ?? null
    });

    let secondaryActionLabel: string | null = null;
    let secondaryActionKind: MarketplaceActionKind | null = null;

    if (!account) {
      secondaryActionLabel = "Check again";
      secondaryActionKind = "connect_account";
    } else if (capabilityDetail.extensionRequired && !options.extensionConnected) {
      secondaryActionLabel = "Check again";
      secondaryActionKind = "check_extension";
    } else if (capability?.importMode === "EXTENSION" && platform === "EBAY" && action.actionKind !== "open_extension") {
      secondaryActionLabel = "Open in extension";
      secondaryActionKind = "open_extension";
    } else if (account || capabilityDetail.extensionRequired) {
      secondaryActionLabel = "Check again";
      secondaryActionKind = "check_again";
    }

    return {
      platform,
      state:
        needsBrowserInput ? baseListingState : listingState,
      missingRequirements,
      recommendedRequirements: requirements.recommended,
      actionLabel: action.actionLabel,
      actionKind: action.actionKind,
      secondaryActionLabel,
      secondaryActionKind,
      summary,
      executionMode: capabilityDetail.executionMode,
      capabilitySummary: capabilityDetail.capabilitySummary,
      extensionRequired: capabilityDetail.extensionRequired,
      extensionSummary: extensionDetail.extensionSummary,
      connectionSummary: connectionDetail.connectionSummary,
      connectionTone: connectionDetail.connectionTone,
      blocker,
      listingUrl: listing?.externalUrl ?? null
    };
  });
}

export function getItemLifecycleState(item: InventoryListLikeItem): ItemLifecycleState {
  const readinessFlags = getListingReadinessFlags(item);
  const marketStates = getMarketplaceStatusSummaries(item);
  const hasFailedListing = marketStates.some((state) => state.state === "failed");
  const hasLiveListing = marketStates.some((state) => state.state === "published");
  const hasListingInProgress = marketStates.some((state) => state.state === "queued" || state.state === "publishing");
  const hasDraft = marketStates.some((state) => state.state === "draft");
  const hasSale = (item.sales?.length ?? 0) > 0 || marketStates.some((state) => state.state === "sold");

  if (hasSale) {
    return "sold";
  }

  if (hasFailedListing) {
    return "error";
  }

  if (hasLiveListing) {
    return "listed";
  }

  if (hasListingInProgress) {
    return "listing_in_progress";
  }

  if (hasDraft && readinessFlags.length === 0) {
    return "ready_to_list";
  }

  const hasCoreInventoryFields = Boolean(item.title.trim() && item.category.trim() && item.condition.trim());

  if (!hasCoreInventoryFields) {
    return "review";
  }

  if (readinessFlags.length > 0) {
    return "inventory";
  }

  if (item.attributesJson?.importSource === "IDENTIFIER_RESEARCH") {
    return "inventory";
  }

  return "ready_to_list";
}

export function getProfitEstimate(item: InventoryListLikeItem) {
  if ((item.priceRecommendation ?? 0) <= 0) {
    return null;
  }

  return (item.priceRecommendation ?? 0) - (item.costBasis ?? 0);
}

export function getNextActionLabel(item: InventoryListLikeItem) {
  const lifecycle = getItemLifecycleState(item);
  const flags = getListingReadinessFlags(item);

  if (lifecycle === "sold") {
    return "Review sale";
  }

  if (lifecycle === "listed") {
    return "Monitor listing";
  }

  if (lifecycle === "listing_in_progress") {
    return "Watch publish";
  }

  if (lifecycle === "ready_to_list") {
    return "Publish now";
  }

  if (lifecycle === "error") {
    return "Fix blockers";
  }

  if (flags.includes("missing_photos")) {
    return "Add photos";
  }

  if (flags.length > 0) {
    return "Add details";
  }

  return "Review item";
}

export function getLifecycleBucket(item: InventoryListLikeItem) {
  const lifecycle = getItemLifecycleState(item);

  switch (lifecycle) {
    case "sold":
      return "Sold";
    case "listed":
    case "listing_in_progress":
      return "Listed";
    case "ready_to_list":
      return "Ready to List";
    case "error":
      return "Needs Fix";
    default:
      return "Unlisted";
  }
}

export function getSellQueue(item: InventoryListLikeItem) {
  const lifecycle = getItemLifecycleState(item);
  const flags = getListingReadinessFlags(item);
  const marketStates = getMarketplaceStatusSummaries(item);

  if (lifecycle === "error") {
    return "Failed";
  }

  if (lifecycle === "sold") {
    return "Listed";
  }

  if (marketStates.some((state) => state.state === "publishing" || state.state === "queued")) {
    return "Publishing";
  }

  if (marketStates.some((state) => state.state === "published")) {
    return "Listed";
  }

  if (marketStates.some((state) => state.state === "draft")) {
    return "Drafts";
  }

  if (flags.length > 0) {
    return "Needs Details";
  }

  return "Ready to List";
}

export function humanizeReadinessFlag(flag: ListingReadinessFlag) {
  return flag.replace(/_/g, " ");
}
