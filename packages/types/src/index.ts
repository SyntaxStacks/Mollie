import { z } from "zod";

export const platforms = ["EBAY", "DEPOP"] as const;
export type Platform = (typeof platforms)[number];

export const marketplaceAccountStatuses = ["PENDING", "CONNECTED", "DISABLED", "ERROR"] as const;
export type MarketplaceAccountStatus = (typeof marketplaceAccountStatuses)[number];

export const marketplaceCredentialTypes = ["SECRET_REF", "OAUTH_TOKEN_SET"] as const;
export type MarketplaceCredentialType = (typeof marketplaceCredentialTypes)[number];

export const credentialValidationStatuses = ["UNVERIFIED", "VALID", "INVALID", "NEEDS_REFRESH"] as const;
export type CredentialValidationStatus = (typeof credentialValidationStatuses)[number];

export const sourceLotStatuses = ["PENDING", "FETCHED", "ANALYZED", "FAILED"] as const;
export type SourceLotStatus = (typeof sourceLotStatuses)[number];

export const inventoryStatuses = ["DRAFT", "READY", "LISTED", "SOLD", "ARCHIVED"] as const;
export type InventoryStatus = (typeof inventoryStatuses)[number];

export const draftReviewStatuses = ["DRAFT", "NEEDS_REVIEW", "APPROVED", "REJECTED"] as const;
export type DraftReviewStatus = (typeof draftReviewStatuses)[number];

export const platformListingStatuses = ["PENDING", "PUBLISHED", "SYNCED", "SOLD", "ENDED", "FAILED"] as const;
export type PlatformListingStatus = (typeof platformListingStatuses)[number];

export const executionStatuses = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type ExecutionStatus = (typeof executionStatuses)[number];

export const payoutStatuses = ["PENDING", "PAID", "DISPUTED"] as const;
export type PayoutStatus = (typeof payoutStatuses)[number];

export const workspaceRoles = ["OWNER", "MEMBER"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export const connectorFailureCodes = [
  "PREREQUISITE_MISSING",
  "ACCOUNT_UNAVAILABLE",
  "WORKSPACE_AUTOMATION_DISABLED",
  "RATE_LIMITED",
  "AUTOMATION_FAILED",
  "ARTIFACT_CAPTURE_FAILED",
  "UNKNOWN"
] as const;
export type ConnectorFailureCode = (typeof connectorFailureCodes)[number];

export const sourcePlatformSchema = z.literal("MAC_BID");

export const sessionSchema = z.object({
  token: z.string(),
  userId: z.string(),
  email: z.string().email(),
  workspaceId: z.string().nullable(),
  expiresAt: z.string()
});

export type Session = z.infer<typeof sessionSchema>;

export const authRequestSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional()
});

export const authVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6).regex(/^\d+$/)
});

export const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(120)
});

export const marketplaceAccountSchema = z.object({
  platform: z.enum(platforms),
  displayName: z.string().min(2).max(120),
  secretRef: z.string().min(4).max(255),
  credentialType: z.enum(marketplaceCredentialTypes).default("SECRET_REF")
});

export const ebayOAuthStartSchema = z.object({
  displayName: z.string().min(2).max(120)
});

export const ebayOAuthCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1),
  error: z.string().min(1).optional(),
  error_description: z.string().min(1).optional(),
  mode: z.enum(["json", "redirect"]).default("redirect")
});

export const ebayLiveDefaultsSchema = z.object({
  merchantLocationKey: z.string().min(1).max(120).optional().nullable(),
  paymentPolicyId: z.string().min(1).max(120).optional().nullable(),
  returnPolicyId: z.string().min(1).max(120).optional().nullable(),
  fulfillmentPolicyId: z.string().min(1).max(120).optional().nullable(),
  marketplaceId: z.string().min(1).max(40).optional().nullable(),
  currency: z.string().min(1).max(12).optional().nullable()
});

export const sourceLotInputSchema = z.object({
  url: z.string().url(),
  titleHint: z.string().min(2).max(180).optional()
});

export const inventoryInputSchema = z.object({
  title: z.string().min(2).max(180),
  brand: z.string().max(120).optional().nullable(),
  category: z.string().min(2).max(120),
  condition: z.string().min(2).max(120),
  size: z.string().max(40).optional().nullable(),
  color: z.string().max(40).optional().nullable(),
  quantity: z.number().int().positive().default(1),
  costBasis: z.number().nonnegative().default(0),
  estimatedResaleMin: z.number().nonnegative().optional().nullable(),
  estimatedResaleMax: z.number().nonnegative().optional().nullable(),
  priceRecommendation: z.number().nonnegative().optional().nullable(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({})
});

export const draftUpdateSchema = z.object({
  generatedTitle: z.string().min(2).max(180).optional(),
  generatedDescription: z.string().min(2).max(5000).optional(),
  generatedPrice: z.number().nonnegative().optional(),
  generatedTags: z.array(z.string().min(1).max(32)).max(12).optional(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  reviewStatus: z.enum(draftReviewStatuses).optional()
});

export const manualSaleSchema = z.object({
  inventoryItemId: z.string().min(1),
  soldPrice: z.number().nonnegative(),
  fees: z.number().nonnegative().default(0),
  shippingCost: z.number().nonnegative().default(0),
  soldAt: z.string().datetime().optional(),
  payoutStatus: z.enum(payoutStatuses).default("PENDING")
});

export const imageInputSchema = z.object({
  url: z.string().url(),
  kind: z.enum(["ORIGINAL", "DERIVED"]).default("ORIGINAL"),
  width: z.number().int().positive().optional().nullable(),
  height: z.number().int().positive().optional().nullable(),
  position: z.number().int().nonnegative().default(0)
});

export type DashboardMetric = {
  label: string;
  value: string;
  detail: string;
};

export type AnalyticsSummary = {
  inventoryCount: number;
  listedCount: number;
  soldCount: number;
  pendingDrafts: number;
  totalRevenue: number;
  totalFees: number;
  totalMargin: number;
};

export type PriceRange = {
  min: number;
  max: number;
};

export type LotAnalysis = {
  resaleRange: PriceRange;
  confidenceScore: number;
  riskScore: number;
  recommendedMaxBid: number;
  summary: string;
  rationale: string[];
};

export type ListingDraftOutput = {
  title: string;
  description: string;
  price: number;
  tags: string[];
  attributes: Record<string, string | number | boolean>;
};

export type PublishResult = {
  externalListingId: string;
  externalUrl: string;
  title: string;
  price: number;
  rawResponse: Record<string, unknown>;
  artifactUrls?: string[];
  marketplaceAccountUpdate?: {
    validationStatus?: CredentialValidationStatus;
    credentialPayload?: Record<string, unknown>;
    credentialMetadata?: Record<string, unknown>;
    lastValidatedAt?: string | null;
  };
};

export type PreflightCheckStatus = "READY" | "BLOCKED" | "WARNING";

export type ConnectorPreflightCheck = {
  key: string;
  label: string;
  status: PreflightCheckStatus;
  detail: string;
};
