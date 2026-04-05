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
      executionMode: "API publish + browser import",
      capabilitySummary: "Publish via Mollie API, import through the browser extension",
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
      executionMode: "Browser extension",
      capabilitySummary: "Marketplace work runs in your browser extension",
      extensionRequired: true
    };
  }

  if (capability.importMode === "EXTENSION") {
    return {
      executionMode: "Browser assist",
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

function describeConnection(account?: MarketplaceAccountLike | null) {
  if (!account) {
    return {
      connectionSummary: "No connected marketplace account",
      connectionTone: "warning" as const,
      blocker: "Connect a marketplace account first."
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
}) {
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

  if (input.blocker) {
    if (!input.account) {
      return {
        actionLabel: "Connect account",
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
      actionLabel: "Open in extension",
      actionKind: "open_extension" as const
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
    const listingState = listing ? getMarketplaceListingState(listing.status) : draft ? "draft" : "not_started";
    const missingRequirements = [...flags];
    const capability = options.capabilitySummary?.find((entry) => entry.platform === platform) ?? null;
    const account =
      options.marketplaceAccounts?.find((candidate) => candidate.platform === platform && candidate.status === "CONNECTED") ??
      options.marketplaceAccounts?.find((candidate) => candidate.platform === platform) ??
      null;
    const capabilityDetail = describeCapabilities(platform, capability);
    const connectionDetail = describeConnection(account);
    const extensionDetail = describeExtensionState(options, capabilityDetail.extensionRequired);

    let summary = "Needs more item setup";
    let blocker =
      missingRequirements.length > 0
        ? `Missing ${missingRequirements.map((value) => value.replace(/_/g, " ")).join(", ")}.`
        : null;

    if (listingState === "published" || listingState === "sold") {
      summary = listingState === "sold" ? "Sold on marketplace" : "Published and live";
      blocker = null;
    } else if (listingState === "queued" || listingState === "publishing") {
      summary =
        extensionTask?.state === "QUEUED"
          ? "Queued in the browser extension"
          : extensionTask?.state === "RUNNING"
            ? "Browser extension execution is active"
            : "Marketplace work is in flight";
      blocker = null;
    } else if (listingState === "failed") {
      summary = extensionTask?.lastErrorMessage ?? "Marketplace work failed and needs attention";
      blocker = extensionTask?.needsInputReason ?? extensionTask?.lastErrorMessage ?? connectionDetail.blocker ?? blocker;
    } else if (draft) {
      summary = draft.reviewStatus === "APPROVED" ? "Draft approved and waiting" : "Draft exists and needs review";
      blocker = missingRequirements.length > 0 ? blocker : connectionDetail.blocker ?? extensionDetail.extensionBlocker;
    } else if (capability?.publishMode !== "NONE" && missingRequirements.length === 0) {
      summary = "Draft not created yet";
      blocker = "Generate a marketplace draft before publishing.";
    } else if (extensionTask?.state === "NEEDS_INPUT") {
      summary = extensionTask.lastErrorMessage ?? "Browser extension needs help to continue";
      blocker = extensionTask.needsInputReason ?? extensionTask.lastErrorMessage ?? "Finish the browser-side marketplace step.";
    } else if (extensionTask?.state === "QUEUED") {
      summary = "Queued in the browser extension";
      blocker = null;
    } else if (extensionTask?.state === "RUNNING") {
      summary = "Browser extension execution is active";
      blocker = null;
    } else if (missingRequirements.length === 0) {
      summary = capability?.publishMode === "NONE" ? "Marketplace publish is not live yet" : "Ready for marketplace work";
      blocker = connectionDetail.blocker ?? extensionDetail.extensionBlocker;
    } else {
      blocker = blocker ?? connectionDetail.blocker ?? extensionDetail.extensionBlocker;
    }

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
      blocker
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
        extensionTask?.state === "NEEDS_INPUT"
          ? "failed"
          : listingState,
      missingRequirements,
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
