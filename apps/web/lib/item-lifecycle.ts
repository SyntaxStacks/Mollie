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
  | "generate_draft"
  | "open_listing"
  | "review_sale"
  | "connect_account"
  | "check_again"
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
  automationTasks?: Array<{
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
  connectionSummary: string;
  connectionTone: "success" | "warning" | "neutral" | "danger";
  blocker: string | null;
  listingUrl?: string | null;
};

export type MarketplaceStatusOptions = {
  marketplaceAccounts?: MarketplaceAccountLike[];
  capabilitySummary?: MarketplaceCapabilitySummary[];
  pendingConnectAttempts?: Partial<Record<string, { attemptId: string; helperNonce: string }>>;
};

type ListingDraftLike = NonNullable<InventoryListLikeItem["listingDrafts"]>[number];
type AutomationTaskLike = NonNullable<InventoryListLikeItem["automationTasks"]>[number];
type PlatformRequirements = {
  required: string[];
  recommended: string[];
};

type AutomationTaskResultLike = {
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

function humanizeAutomationField(field: string, platform?: string | null) {
  const isDepop = platform === "DEPOP";

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
      return isDepop ? "Depop package size" : "shipping";
    case "package size":
    case "package_size":
    case "depop package size":
      return isDepop ? "Depop package size" : "package size";
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

function isLegacyBrowserTransportMessage(message: string | null | undefined) {
  if (!message) {
    return false;
  }

  const normalized = message.trim().toLowerCase();

  return (
    normalized.includes("receiving end does not exist") ||
    normalized.includes("could not establish connection") ||
    normalized.includes("message port closed")
  );
}

function isRemoteGridPublishPlatform(platform: string, capability?: MarketplaceCapabilitySummary | null) {
  return (platform === "DEPOP" || platform === "POSHMARK") && capability?.publishMode === "API";
}

function getPlatformLabel(platform: string) {
  switch (platform) {
    case "DEPOP":
      return "Depop";
    case "POSHMARK":
      return "Poshmark";
    case "WHATNOT":
      return "Whatnot";
    case "EBAY":
      return "eBay";
    default:
      return platform;
  }
}

function getAutomationTaskMissingFields(automationTask?: AutomationTaskLike | null) {
  if (!automationTask?.resultJson || typeof automationTask.resultJson !== "object") {
    return [];
  }

  const result = automationTask.resultJson as AutomationTaskResultLike;
  return uniqueStrings(getStringArray(result.missingFields).map((field) => humanizeAutomationField(field, automationTask.platform)));
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
    case "Depop package size":
      return hasValue(overrideAttributes?.packageSize);
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

    if (!hasValue(depopAttributes?.packageSize)) {
      required.push("Depop package size");
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
      automationRequired: false
    };
  }

  if (capability.publishMode === "API") {
    return {
      executionMode: "API",
      capabilitySummary: "Publish through Mollie",
      automationRequired: false
    };
  }

  return {
    executionMode: "Unavailable",
    capabilitySummary: "No live marketplace workflow",
    automationRequired: false
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

function summarizeMarketplaceReadiness(input: {
  platform: string;
  listingState: MarketplaceListingState;
  draft?: ListingDraftLike | null;
  requiredRequirements: string[];
  recommendedRequirements: string[];
  capability?: MarketplaceCapabilitySummary | null;
  account?: MarketplaceAccountLike | null;
  connectionBlocker: string | null;
  automationTask?: AutomationTaskLike | null;
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
        input.automationTask?.state === "QUEUED"
          ? "Queued for posting"
          : input.automationTask?.state === "RUNNING"
            ? "Posting is in progress"
            : "Marketplace work is in progress",
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
      input.platform === "DEPOP" ? "Depop publish needs another pass." : "The marketplace flow needs another pass.";
    const legacyTransportFailure =
      isLegacyBrowserTransportMessage(input.automationTask?.lastErrorMessage) ||
      isLegacyBrowserTransportMessage(input.automationTask?.needsInputReason);

    if (legacyTransportFailure && isRemoteGridPublishPlatform(input.platform, input.capability)) {
      const platformLabel = getPlatformLabel(input.platform);

      return {
        summary: `${platformLabel} publish is ready to retry on the remote grid.`,
        blocker: "The last automation attempt could not reach a worker. Retry publish to queue it on Mollie's remote browser grid."
      };
    }

    return {
      summary:
        isGenericMissingFieldMessage(input.automationTask?.lastErrorMessage)
          ? browserRetrySummary
          : input.automationTask?.lastErrorMessage ?? browserRetrySummary,
      blocker:
        isGenericMissingFieldMessage(input.automationTask?.needsInputReason)
          ? "Mollie has the required fields. Retry the publish so Mollie can map them onto this Depop page."
          : input.automationTask?.needsInputReason ??
        "Mollie needs another pass to finish the marketplace flow."
    };
  }

  if (input.listingState === "failed") {
    const legacyTransportFailure =
      isLegacyBrowserTransportMessage(input.automationTask?.lastErrorMessage) ||
      isLegacyBrowserTransportMessage(input.automationTask?.needsInputReason);

    if (legacyTransportFailure && isRemoteGridPublishPlatform(input.platform, input.capability)) {
      const platformLabel = getPlatformLabel(input.platform);

      return {
        summary: `${platformLabel} publish is ready to retry on the remote grid.`,
        blocker: "The last automation attempt could not reach a worker. Retry publish to queue it on Mollie's remote browser grid."
      };
    }

    return {
      summary: input.automationTask?.lastErrorMessage ?? "Marketplace work failed and needs attention",
      blocker: input.automationTask?.needsInputReason ?? input.automationTask?.lastErrorMessage ?? input.connectionBlocker ?? fallbackBlocker
    };
  }

  switch (input.platform) {
    case "EBAY": {
      if (input.draft) {
        return {
          summary: input.draft.reviewStatus === "APPROVED" ? "Ready for eBay API publish" : "eBay draft needs review",
          blocker: input.requiredRequirements.length > 0 ? fallbackBlocker : input.connectionBlocker
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
        blocker: fallbackBlocker ?? input.connectionBlocker
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
          summary: input.draft.reviewStatus === "APPROVED" ? "Ready for Depop publish" : "Depop draft needs review",
          blocker: input.requiredRequirements.length > 0 ? fallbackBlocker : input.connectionBlocker
        };
      }

      return {
        summary: primaryMissing ? `Finish ${primaryMissing} before Depop draft prep` : "Depop needs a little more listing detail",
        blocker: fallbackBlocker ?? input.connectionBlocker
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
        blocker: input.connectionBlocker
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
          input.capability?.publishMode === "API"
            ? "Ready for Whatnot remote publish"
            : "Whatnot is connected, but listing prep is not live yet",
        blocker: input.connectionBlocker
      };
    }

    default:
      return {
        summary: primaryMissing ? `Finish ${primaryMissing}` : "Needs more item setup",
        blocker: fallbackBlocker ?? input.connectionBlocker
      };
  }
}

function actionForState(input: {
  platform: string;
  listingState: MarketplaceListingState;
  hasDraft: boolean;
  hasBlockingFields: boolean;
  capability?: MarketplaceCapabilitySummary | null;
  account?: MarketplaceAccountLike | null;
  blocker: string | null;
  needsBrowserInput: boolean;
  automationTaskAction?: string | null;
  pendingConnectAttempt?: boolean;
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
          ? input.automationTaskAction === "PUBLISH_LISTING"
            ? "Retry publish"
            : "Retry draft prep"
          : "Retry",
      actionKind: "retry" as const
    };
  }

  if (input.blocker) {
    if (!input.account) {
      return {
        actionLabel:
          input.platform === "POSHMARK" || input.platform === "DEPOP" || input.platform === "WHATNOT"
            ? input.pendingConnectAttempt
              ? "Recheck login"
              : "Open login"
            : "Recheck login",
        actionKind: input.pendingConnectAttempt ? ("check_again" as const) : ("connect_account" as const)
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
        actionLabel:
          input.platform === "DEPOP" || input.platform === "POSHMARK" || input.platform === "WHATNOT"
            ? "Publish now"
            : "Publish via API",
        actionKind: "publish_api" as const
      };
    }

    return {
      actionLabel: "Unavailable",
      actionKind: "unavailable" as const
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
    const automationTask =
      item.automationTasks?.find((candidate) => candidate.platform === platform) ?? null;
    const baseListingState = listing ? getMarketplaceListingState(listing.status) : draft ? "draft" : "not_started";
    const listingState =
      automationTask?.state === "QUEUED"
        ? "queued"
        : automationTask?.state === "RUNNING"
          ? "publishing"
          : automationTask?.state === "FAILED"
            ? "failed"
            : baseListingState;
    const requirements = getPlatformRequirements({
      item,
      platform,
      genericFlags: flags,
      draft
    });
    const automationTaskMissingFields = getAutomationTaskMissingFields(automationTask).filter(
      (field) => !marketplaceFieldHasValue(item, platform, field, draft)
    );
    const missingRequirements = uniqueStrings([...requirements.required, ...automationTaskMissingFields]);
    const capability = options.capabilitySummary?.find((entry) => entry.platform === platform) ?? null;
    const pendingConnectAttempt = options.pendingConnectAttempts?.[platform] ?? null;
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
    const needsBrowserInput = automationTask?.state === "NEEDS_INPUT";
    const readinessCopy = summarizeMarketplaceReadiness({
      platform,
      listingState,
      draft,
      requiredRequirements: missingRequirements,
      recommendedRequirements: requirements.recommended,
      capability,
      account,
      connectionBlocker: connectionDetail.blocker,
      automationTask,
      needsBrowserInput
    });
    let summary = readinessCopy.summary;
    let blocker = readinessCopy.blocker;

    if (pendingConnectAttempt && !account) {
      summary = `Login started for ${platform}. Recheck from Mollie once sign-in is complete.`;
      blocker = connectionDetail.blocker;
    }

    if (!blocker && connectionDetail.blocker && listingState !== "published" && listingState !== "sold") {
      blocker = connectionDetail.blocker;
    }

    const action = actionForState({
      platform,
      listingState,
      hasDraft: Boolean(draft),
      hasBlockingFields: missingRequirements.length > 0,
      capability,
      account,
      blocker,
      needsBrowserInput,
      automationTaskAction: automationTask?.action ?? null,
      pendingConnectAttempt: Boolean(pendingConnectAttempt)
    });
    const legacyRemoteRetry =
      listingState === "failed" &&
      isRemoteGridPublishPlatform(platform, capability) &&
      (isLegacyBrowserTransportMessage(automationTask?.lastErrorMessage) ||
        isLegacyBrowserTransportMessage(automationTask?.needsInputReason));

    let secondaryActionLabel: string | null = null;
    let secondaryActionKind: MarketplaceActionKind | null = null;

    if (legacyRemoteRetry) {
      secondaryActionLabel = null;
      secondaryActionKind = null;
    } else if (!account) {
      secondaryActionLabel =
        platform === "DEPOP" || platform === "POSHMARK" || platform === "WHATNOT"
          ? pendingConnectAttempt
            ? "Open login"
            : "Check again"
          : "Check again";
      secondaryActionKind =
        platform === "DEPOP" || platform === "POSHMARK" || platform === "WHATNOT"
          ? pendingConnectAttempt
            ? "connect_account"
            : "connect_account"
          : "connect_account";
    } else if (account) {
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
