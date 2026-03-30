import { z } from "zod";

export const platforms = ["EBAY", "DEPOP", "POSHMARK", "WHATNOT"] as const;
export type Platform = (typeof platforms)[number];

export const marketplaceAccountStatuses = ["PENDING", "CONNECTED", "DISABLED", "ERROR"] as const;
export type MarketplaceAccountStatus = (typeof marketplaceAccountStatuses)[number];

export const marketplaceCredentialTypes = ["SECRET_REF", "OAUTH_TOKEN_SET"] as const;
export type MarketplaceCredentialType = (typeof marketplaceCredentialTypes)[number];

export const credentialValidationStatuses = ["UNVERIFIED", "VALID", "INVALID", "NEEDS_REFRESH"] as const;
export type CredentialValidationStatus = (typeof credentialValidationStatuses)[number];

export const ebayOperationalStates = [
  "SIMULATED",
  "OAUTH_CONNECTED",
  "LIVE_CONFIG_MISSING",
  "LIVE_READY",
  "LIVE_BLOCKED",
  "LIVE_ERROR"
] as const;
export type EbayOperationalState = (typeof ebayOperationalStates)[number];

export const automationOperationalStates = [
  "AUTOMATION_READY",
  "AUTOMATION_BLOCKED",
  "AUTOMATION_ERROR"
] as const;
export type AutomationOperationalState = (typeof automationOperationalStates)[number];

export const connectorCapabilities = [
  "CONNECT_ACCOUNT",
  "VALIDATE_AUTH",
  "REFRESH_AUTH",
  "SYNC_ACCOUNT_STATE",
  "SYNC_LISTINGS",
  "SYNC_ORDERS",
  "CREATE_LISTING",
  "UPDATE_LISTING",
  "DELIST_LISTING",
  "RELIST_LISTING",
  "SEND_OFFER",
  "FETCH_MESSAGES",
  "RECORD_HEALTH",
  "FETCH_ANALYTICS"
] as const;
export type ConnectorCapability = (typeof connectorCapabilities)[number];

export const connectorFeatureFamilies = [
  "EBAY_POLICY_CONFIGURATION",
  "DEPOP_PROMOTION",
  "POSHMARK_SOCIAL",
  "WHATNOT_LIVE_SELLING"
] as const;
export type ConnectorFeatureFamily = (typeof connectorFeatureFamilies)[number];

export const connectorExecutionModes = [
  "API",
  "OAUTH_API",
  "BROWSER_SESSION",
  "LOCAL_AGENT",
  "SIMULATED",
  "MANUAL"
] as const;
export type ConnectorExecutionMode = (typeof connectorExecutionModes)[number];

export const connectorSupportLevels = ["SUPPORTED", "MANUAL_ONLY", "SIMULATED", "PLANNED", "UNSUPPORTED"] as const;
export type ConnectorSupportLevel = (typeof connectorSupportLevels)[number];

export const connectorHealthStates = [
  "READY",
  "DEGRADED",
  "SESSION_EXPIRED",
  "AUTH_BLOCKED",
  "RATE_LIMITED",
  "SELECTOR_DRIFT",
  "MANUAL_ONLY",
  "ERROR"
] as const;
export type ConnectorHealthState = (typeof connectorHealthStates)[number];

export const connectorRiskLevels = ["LOW", "MEDIUM", "HIGH"] as const;
export type ConnectorRiskLevel = (typeof connectorRiskLevels)[number];

export const connectorFallbackModes = ["MANUAL", "SIMULATED", "NONE"] as const;
export type ConnectorFallbackMode = (typeof connectorFallbackModes)[number];

export const connectorRateLimitStrategies = ["PROVIDER", "SESSION_PACED", "MANUAL_ONLY"] as const;
export type ConnectorRateLimitStrategy = (typeof connectorRateLimitStrategies)[number];

export const operatorHintSeverities = ["INFO", "SUCCESS", "WARNING", "ERROR"] as const;
export type OperatorHintSeverity = (typeof operatorHintSeverities)[number];

export type OperatorHint = {
  title: string;
  explanation: string;
  severity: OperatorHintSeverity;
  nextActions: string[];
  routeTarget?: string | null;
  featureFamily?: ConnectorFeatureFamily | null;
  canContinue?: boolean;
  helpText?: string | null;
};

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
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(120).optional()
});

export const authVerifySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().length(6).regex(/^\d+$/)
});

export const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(120)
});

export const workspaceMemberInviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  role: z.enum(workspaceRoles).default("MEMBER")
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

export const ebayMarketplaceAccountDeletionChallengeSchema = z.object({
  challenge_code: z.string().min(1)
});

export const ebayMarketplaceAccountDeletionNotificationSchema = z.object({
  metadata: z.object({
    topic: z.string(),
    schemaVersion: z.string(),
    deprecated: z.boolean().optional()
  }),
  notification: z.object({
    notificationId: z.string(),
    eventDate: z.string(),
    publishDate: z.string(),
    publishAttemptCount: z.number().int().nonnegative(),
    data: z.object({
      username: z.string().optional(),
      userId: z.string().optional(),
      eiasToken: z.string().optional()
    })
  })
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

export const catalogImportSources = ["AMAZON"] as const;
export type CatalogImportSource = (typeof catalogImportSources)[number];

export const catalogLookupModes = ["MANUAL", "FIXTURE", "AMAZON_PAAPI5"] as const;
export type CatalogLookupMode = (typeof catalogLookupModes)[number];

export const catalogLookupStatuses = ["READY", "NOT_CONFIGURED", "NOT_FOUND", "ERROR"] as const;
export type CatalogLookupStatus = (typeof catalogLookupStatuses)[number];

export const marketObservationSchema = z.object({
  market: z.string().trim().min(2).max(40),
  label: z.string().trim().min(2).max(80),
  price: z.number().nonnegative(),
  sourceUrl: z.string().url().optional().nullable(),
  note: z.string().trim().max(240).optional().nullable()
});

export const catalogLookupRequestSchema = z
  .object({
    provider: z.enum(catalogImportSources),
    barcode: z.string().trim().min(8).max(64).optional(),
    amazonAsin: z.string().trim().max(32).optional()
  })
  .refine((input) => Boolean(input.barcode?.trim() || input.amazonAsin?.trim()), {
    message: "Provide a barcode or Amazon ASIN"
  });

export const inventoryBarcodeImportSchema = z.object({
  barcode: z.string().trim().min(8).max(64),
  sourceMarket: z.enum(catalogImportSources),
  title: z.string().trim().min(2).max(180),
  brand: z.string().trim().max(120).optional().nullable(),
  category: z.string().trim().min(2).max(120),
  condition: z.string().trim().min(2).max(120),
  size: z.string().trim().max(40).optional().nullable(),
  color: z.string().trim().max(40).optional().nullable(),
  quantity: z.number().int().positive().default(1),
  costBasis: z.number().nonnegative().default(0),
  estimatedResaleMin: z.number().nonnegative().optional().nullable(),
  estimatedResaleMax: z.number().nonnegative().optional().nullable(),
  priceRecommendation: z.number().nonnegative().optional().nullable(),
  amazonUrl: z.string().url().optional().nullable(),
  amazonAsin: z.string().trim().max(32).optional().nullable(),
  imageUrls: z.array(z.string().url()).max(12).default([]),
  observations: z.array(marketObservationSchema).min(1).max(8)
});

export type CatalogLookupItem = {
  title: string;
  brand?: string | null;
  category?: string | null;
  amazonUrl?: string | null;
  amazonAsin?: string | null;
  imageUrls: string[];
  observations: Array<z.infer<typeof marketObservationSchema>>;
};

export type CatalogLookupResult = {
  provider: CatalogImportSource;
  mode: CatalogLookupMode;
  status: CatalogLookupStatus;
  query: {
    barcode?: string | null;
    amazonAsin?: string | null;
  };
  item: CatalogLookupItem | null;
  hint?: OperatorHint | null;
};

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
