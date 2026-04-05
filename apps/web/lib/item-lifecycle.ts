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
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
  }>;
  sales?: Array<{ id: string; soldPrice: number; soldAt?: string | Date | null }>;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export type MarketplaceStatusSummary = {
  platform: string;
  state: MarketplaceListingState;
  missingRequirements: string[];
  actionLabel: string;
  summary: string;
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

export function getMarketplaceStatusSummaries(item: InventoryListLikeItem): MarketplaceStatusSummary[] {
  const flags = getListingReadinessFlags(item);
  const platforms = ["EBAY", "DEPOP", "POSHMARK", "WHATNOT"] as const;

  return platforms.map((platform) => {
    const listing = item.platformListings?.find((candidate) => candidate.platform === platform) ?? null;
    const draft = item.listingDrafts?.find((candidate) => candidate.platform === platform) ?? null;
    const extensionTask =
      item.extensionTasks?.find((candidate) => candidate.platform === platform) ?? null;
    const listingState = listing ? getMarketplaceListingState(listing.status) : draft ? "draft" : "not_started";
    const missingRequirements = [...flags];

    if (listingState === "published" || listingState === "sold") {
      return {
        platform,
        state: listingState,
        missingRequirements: [],
        actionLabel: listingState === "sold" ? "Review sale" : "Open listing",
        summary: listingState === "sold" ? "Sold on marketplace" : "Published and live"
      };
    }

    if (listingState === "failed") {
      return {
        platform,
        state: listingState,
        missingRequirements,
        actionLabel: "Retry",
        summary: "Publish failed and needs attention"
      };
    }

    if (listingState === "queued" || listingState === "publishing") {
      return {
        platform,
        state: listingState,
        missingRequirements: [],
        actionLabel: "Watch",
        summary: "Publish work is in flight"
      };
    }

    if (draft) {
      return {
        platform,
        state: "draft",
        missingRequirements,
        actionLabel: flags.length === 0 ? "Publish" : "Edit",
        summary: draft.reviewStatus === "APPROVED" ? "Draft approved and waiting" : "Draft exists and needs review"
      };
    }

    if (extensionTask?.state === "FAILED" || extensionTask?.state === "NEEDS_INPUT") {
      return {
        platform,
        state: "failed",
        missingRequirements,
        actionLabel: "Retry in extension",
        summary: extensionTask.lastErrorMessage ?? "Browser extension work needs attention"
      };
    }

    if (extensionTask?.state === "RUNNING") {
      return {
        platform,
        state: "publishing",
        missingRequirements: [],
        actionLabel: "Watch extension",
        summary: "Browser extension is working this listing"
      };
    }

    if (extensionTask?.state === "QUEUED") {
      return {
        platform,
        state: "queued",
        missingRequirements: [],
        actionLabel: "Open extension",
        summary: "Queued for browser extension work"
      };
    }

    return {
      platform,
      state: "not_started",
      missingRequirements,
      actionLabel: flags.length === 0 ? "Queue" : "Fix",
      summary: flags.length === 0 ? "Ready to start listing" : "Needs more item setup"
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
