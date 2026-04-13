import { z } from "zod";

export const platforms = ["EBAY", "DEPOP", "POSHMARK", "WHATNOT"] as const;
export type Platform = (typeof platforms)[number];
export const automationVendors = ["DEPOP", "POSHMARK", "WHATNOT"] as const;
export type AutomationVendor = (typeof automationVendors)[number];
export const importSourceKinds = ["LINKED_ACCOUNT", "CSV_EXPORT", "PUBLIC_URL"] as const;
export type ImportSourceKind = (typeof importSourceKinds)[number];
export const importSourcePlatforms = ["EBAY", "DEPOP", "POSHMARK", "WHATNOT", "NIFTY", "CROSSLIST"] as const;
export type ImportSourcePlatform = (typeof importSourcePlatforms)[number];

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

export const vendorConnectStates = [
  "PENDING",
  "AWAITING_LOGIN",
  "AWAITING_2FA",
  "CAPTURING_SESSION",
  "VALIDATING",
  "CONNECTED",
  "FAILED",
  "EXPIRED"
] as const;
export type VendorConnectState = (typeof vendorConnectStates)[number];

export const vendorConnectPromptKinds = ["INFO", "LOGIN", "CODE", "APPROVAL"] as const;
export type VendorConnectPromptKind = (typeof vendorConnectPromptKinds)[number];

export const vendorConnectCaptureModes = ["WEB_POPUP_HELPER", "LOCAL_BRIDGE", "EXTENSION_BROWSER"] as const;
export type VendorConnectCaptureMode = (typeof vendorConnectCaptureModes)[number];
export const inventoryImportRunStatuses = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"] as const;
export type InventoryImportRunStatus = (typeof inventoryImportRunStatuses)[number];
export const inventoryImportItemStatuses = ["PENDING", "PREVIEWED", "APPLIED", "SKIPPED", "FAILED"] as const;
export type InventoryImportItemStatus = (typeof inventoryImportItemStatuses)[number];

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

export type VendorConnectPrompt = {
  kind: VendorConnectPromptKind;
  label: string;
  detail: string;
  required: boolean;
  codeLength?: number | null;
};

export type VendorSessionArtifactMetadata = {
  captureMode: VendorConnectCaptureMode;
  capturedAt: string;
  validatedAt?: string | null;
  accountHandle: string;
  externalAccountId?: string | null;
  sessionLabel?: string | null;
  connectAttemptId: string;
  cookieCount?: number | null;
  origin?: string | null;
  storageStateJson?: Record<string, unknown> | null;
};

export type MarketplaceSessionArtifact = VendorSessionArtifactMetadata & {
  platform: AutomationVendor;
  storageStateRef?: string | null;
  cookieCount?: number | null;
  origin?: string | null;
};

export type VendorValidationResult = {
  validationStatus: CredentialValidationStatus;
  accountHandle: string;
  externalAccountId?: string | null;
  summary: string;
  detail: string;
  operatorHint: OperatorHint;
};

export type VendorConnectAttempt = {
  id: string;
  workspaceId: string;
  vendor: AutomationVendor;
  displayName: string;
  state: VendorConnectState;
  helperNonce: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  helperLaunchUrl?: string | null;
  prompts: VendorConnectPrompt[];
  hint: OperatorHint;
  externalAccountId?: string | null;
  marketplaceAccountId?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
};

export type LinkedPublishPlatformResult = {
  platform: Platform;
  marketplaceAccountId?: string | null;
  displayName?: string | null;
  state: "QUEUED" | "BLOCKED" | "FAILED_TO_QUEUE";
  summary: string;
  hint?: OperatorHint | null;
  executionLogId?: string | null;
};

export type LinkedPublishSummary = {
  inventoryItemId: string;
  results: LinkedPublishPlatformResult[];
};

export const marketplaceAdapterCapabilities = [
  "API_IMPORT",
  "EXTENSION_IMPORT",
  "API_PUBLISH",
  "EXTENSION_PUBLISH",
  "BULK_IMPORT",
  "BULK_PUBLISH",
  "RELIST",
  "DELIST",
  "UPDATE",
  "SOLD_SYNC"
] as const;
export type MarketplaceAdapterCapability = (typeof marketplaceAdapterCapabilities)[number];

export const extensionTaskActions = [
  "IMPORT_LISTING",
  "PREPARE_DRAFT",
  "PUBLISH_LISTING",
  "UPDATE_LISTING",
  "DELIST_LISTING",
  "RELIST_LISTING"
] as const;
export type ExtensionTaskAction = (typeof extensionTaskActions)[number];

export const extensionTaskStates = ["QUEUED", "RUNNING", "NEEDS_INPUT", "FAILED", "SUCCEEDED", "CANCELED"] as const;
export type ExtensionTaskState = (typeof extensionTaskStates)[number];

export const extensionTaskFailureCodes = [
  "AUTH_REQUIRED",
  "EXTENSION_MISSING",
  "MISSING_REQUIRED_FIELD",
  "UNSUPPORTED_FLOW",
  "SELECTOR_FAILED",
  "UPLOAD_FAILED",
  "PUBLISH_FAILED",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "UNKNOWN"
] as const;
export type ExtensionTaskFailureCode = (typeof extensionTaskFailureCodes)[number];

export const extensionConnectionStates = ["INSTALLED", "NOT_INSTALLED", "DISCONNECTED"] as const;
export type ExtensionConnectionState = (typeof extensionConnectionStates)[number];

export const extensionBridgeTargets = ["MOLLIE_APP", "MOLLIE_EXTENSION"] as const;
export type ExtensionBridgeTarget = (typeof extensionBridgeTargets)[number];
export const aiProviders = ["null", "ollama"] as const;
export type AiProviderName = (typeof aiProviders)[number];
export const aiAssistOperations = ["title", "description", "price"] as const;
export type AiAssistOperation = (typeof aiAssistOperations)[number];

export const universalListingPhotoSchema = z.object({
  url: z.string().url(),
  kind: z.enum(["PRIMARY", "GALLERY"]).default("GALLERY"),
  alt: z.string().trim().max(180).optional().nullable(),
  width: z.number().int().positive().optional().nullable(),
  height: z.number().int().positive().optional().nullable()
});

export const universalListingMarketplaceOverrideSchema = z.object({
  title: z.string().trim().min(2).max(180).optional(),
  description: z.string().trim().min(2).max(5000).optional(),
  category: z.string().trim().min(2).max(160).optional(),
  price: z.number().nonnegative().optional(),
  attributes: z.record(z.string(), z.any()).default({})
});

export const universalListingSchema = z.object({
  inventoryItemId: z.string().min(1),
  sku: z.string().trim().min(1).max(120),
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(5000).default(""),
  category: z.string().trim().min(2).max(160),
  brand: z.string().trim().max(120).optional().nullable(),
  condition: z.string().trim().min(2).max(120),
  price: z.number().nonnegative().nullable(),
  quantity: z.number().int().positive().default(1),
  size: z.string().trim().max(80).optional().nullable(),
  color: z.string().trim().max(80).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(24).default([]),
  labels: z.array(z.string().trim().min(1).max(40)).max(24).default([]),
  freeShipping: z.boolean().default(false),
  dimensions: z
    .object({
      length: z.number().positive().optional().nullable(),
      width: z.number().positive().optional().nullable(),
      height: z.number().positive().optional().nullable(),
      unit: z.enum(["in", "cm"]).default("in")
    })
    .optional()
    .nullable(),
  weight: z
    .object({
      value: z.number().positive(),
      unit: z.enum(["oz", "lb", "g", "kg"]).default("oz")
    })
    .optional()
    .nullable(),
  photos: z.array(universalListingPhotoSchema).max(24).default([]),
  marketplaceOverrides: z.record(z.enum(platforms), universalListingMarketplaceOverrideSchema).default({}),
  metadata: z.record(z.string(), z.any()).default({})
});

export type UniversalListingPhoto = z.infer<typeof universalListingPhotoSchema>;
export type UniversalListing = z.infer<typeof universalListingSchema>;

export type MarketplaceCapabilitySummary = {
  platform: Platform;
  capabilities: MarketplaceAdapterCapability[];
  importMode: "API" | "EXTENSION" | "NONE";
  publishMode: "API" | "EXTENSION" | "NONE";
  bulkImport: boolean;
  bulkPublish: boolean;
};

export const extensionTaskCreateSchema = z.object({
  inventoryItemId: z.string().min(1),
  platform: z.enum(platforms),
  action: z.enum(extensionTaskActions)
});

export const extensionTaskClaimSchema = z.object({
  runnerInstanceId: z.string().trim().min(8).max(120),
  browserName: z.string().trim().max(80).optional().nullable()
});

export const extensionTaskHeartbeatSchema = z.object({
  runnerInstanceId: z.string().trim().min(8).max(120),
  message: z.string().trim().max(240).optional().nullable(),
  result: z.record(z.string(), z.any()).optional().nullable()
});

export const extensionTaskResultUpdateSchema = z.object({
  state: z.enum(extensionTaskStates),
  runnerInstanceId: z.string().trim().min(8).max(120).optional().nullable(),
  lastErrorCode: z.enum(extensionTaskFailureCodes).optional().nullable(),
  lastErrorMessage: z.string().trim().max(500).optional().nullable(),
  needsInputReason: z.string().trim().max(240).optional().nullable(),
  retryAfterSeconds: z.number().int().positive().max(86_400).optional().nullable(),
  result: z.record(z.string(), z.any()).optional().nullable()
});

export const extensionEbayImportSchema = z.object({
  externalListingId: z.string().trim().min(1).max(160),
  externalUrl: z.string().url(),
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(5000).optional().nullable(),
  price: z.number().nonnegative().optional().nullable(),
  category: z.string().trim().max(160).optional().nullable(),
  condition: z.string().trim().max(120).optional().nullable(),
  brand: z.string().trim().max(120).optional().nullable(),
  quantity: z.number().int().positive().default(1),
  photos: z.array(universalListingPhotoSchema).max(24).default([]),
  sourceUrl: z.string().url().optional().nullable(),
  sourceListingState: z.enum(["DRAFT", "PUBLISHED", "SOLD", "ENDED"]).default("PUBLISHED"),
  attributes: z.record(z.string(), z.any()).default({})
});

export type ExtensionEbayImportPayload = z.infer<typeof extensionEbayImportSchema>;

export type ExtensionTaskView = {
  id: string;
  workspaceId: string;
  inventoryItemId?: string | null;
  inventoryImportRunId?: string | null;
  marketplaceAccountId?: string | null;
  platform: Platform;
  action: ExtensionTaskAction;
  state: ExtensionTaskState;
  queuedAt: string;
  attemptCount: number;
  runnerInstanceId?: string | null;
  claimedAt?: string | null;
  lastHeartbeatAt?: string | null;
  retryAfter?: string | null;
  needsInputReason?: string | null;
  lastErrorCode?: ExtensionTaskFailureCode | null;
  lastErrorMessage?: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExtensionStatusView = {
  connectionState: ExtensionConnectionState;
  browserName: string;
  latestTask?: ExtensionTaskView | null;
  capabilitySummary: MarketplaceCapabilitySummary[];
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

export const automationVendorParamsSchema = z.object({
  vendor: z.enum(automationVendors),
  attemptId: z.string().min(1).optional()
});

export const automationVendorConnectStartSchema = z.object({
  displayName: z.string().trim().min(2).max(120)
});

export const automationVendorConnectChallengeSchema = z.object({
  code: z.string().trim().min(4).max(12),
  method: z.enum(["SMS", "EMAIL", "APPROVAL"]).default("SMS")
});

export const automationVendorConnectSessionSchema = z.object({
  helperNonce: z.string().trim().min(16).max(160),
  accountHandle: z.string().trim().max(160).optional().nullable(),
  externalAccountId: z.string().trim().min(2).max(160).optional().nullable(),
  sessionLabel: z.string().trim().min(2).max(160).optional().nullable(),
  captureMode: z.enum(vendorConnectCaptureModes).default("WEB_POPUP_HELPER"),
  challengeRequired: z.boolean().default(false),
  cookieCount: z.number().int().nonnegative().optional().nullable(),
  origin: z.string().trim().max(240).optional().nullable(),
  storageStateJson: z.record(z.string(), z.any()).optional().nullable()
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
  attributes: z.record(z.string(), z.any()).default({})
});

export const aiStatusResponseSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(aiProviders),
  remainingDailyQuota: z.number().int().nonnegative(),
  dailyQuota: z.number().int().nonnegative(),
  message: z.string().trim().max(240).optional().nullable()
});

export const aiListingAssistRequestSchema = z.object({
  operation: z.enum(aiAssistOperations),
  platform: z.enum(platforms).optional().nullable(),
  item: universalListingSchema
});

export const aiListingAssistResponseSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(aiProviders),
  operation: z.enum(aiAssistOperations),
  suggestion: z.union([z.string(), z.number(), z.null()]),
  remainingDailyQuota: z.number().int().nonnegative(),
  dailyQuota: z.number().int().nonnegative(),
  message: z.string().trim().max(240).optional().nullable()
});

export const draftUpdateSchema = z.object({
  generatedTitle: z.string().min(2).max(180).optional(),
  generatedDescription: z.string().min(2).max(5000).optional(),
  generatedPrice: z.number().nonnegative().optional(),
  generatedTags: z.array(z.string().min(1).max(32)).max(12).optional(),
  attributes: z.record(z.string(), z.any()).optional(),
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

export const catalogImportSources = ["GOOGLE", "AMAZON", "EBAY", "OTHER"] as const;
export type CatalogImportSource = (typeof catalogImportSources)[number];

export const catalogIdentifierTypes = ["UPC", "EAN", "ISBN", "CODE128", "UNKNOWN"] as const;
export type CatalogIdentifierType = (typeof catalogIdentifierTypes)[number];

export const catalogLookupModes = ["INTERNAL", "FIXTURE"] as const;
export type CatalogLookupMode = (typeof catalogLookupModes)[number];

export const catalogCacheStatuses = ["HIT", "MISS", "STALE"] as const;
export type CatalogCacheStatus = (typeof catalogCacheStatuses)[number];

export const catalogTrustStatuses = [
  "LOOKUP_DISCOVERED",
  "SEED_TENTATIVE",
  "CRAWLER_DERIVED",
  "OPERATOR_CONFIRMED"
] as const;
export type CatalogTrustStatus = (typeof catalogTrustStatuses)[number];

export const productLookupSources = ["INTERNAL_CATALOG", "AMAZON_ENRICHMENT", "SOURCE_RESEARCH", "SIMULATED"] as const;
export type ProductLookupSource = (typeof productLookupSources)[number];

export const productLookupConfidenceStates = ["HIGH", "MEDIUM", "LOW"] as const;
export type ProductLookupConfidenceState = (typeof productLookupConfidenceStates)[number];

export const marketObservationSchema = z.object({
  market: z.string().trim().min(2).max(40),
  label: z.string().trim().min(2).max(80),
  price: z.number().nonnegative(),
  sourceUrl: z.string().url().optional().nullable(),
  note: z.string().trim().max(240).optional().nullable()
});

export const catalogResearchLinkSchema = z.object({
  market: z.enum(catalogImportSources),
  label: z.string().trim().min(2).max(80),
  url: z.string().url()
});

export const catalogLookupRequestSchema = z
  .object({
    identifier: z.string().trim().min(8).max(64).optional(),
    barcode: z.string().trim().min(8).max(64).optional(),
    identifierType: z.enum(catalogIdentifierTypes).optional().nullable()
  })
  .refine((input) => Boolean(input.identifier?.trim() || input.barcode?.trim()), {
    message: "Provide a supported barcode"
  });

export const productLookupBarcodeRequestSchema = z.object({
  barcode: z.string().trim().min(4).max(96),
  identifierType: z.enum(catalogIdentifierTypes).optional().nullable()
});

export const productLookupCandidateSchema = z.object({
  id: z.string().min(1),
  barcode: z.string().trim().min(8).max(64),
  identifierType: z.enum(catalogIdentifierTypes),
  title: z.string().trim().min(1),
  brand: z.string().trim().max(120).nullable().optional(),
  category: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  size: z.string().trim().max(80).nullable().optional(),
  color: z.string().trim().max(80).nullable().optional(),
  primaryImageUrl: z.string().url().nullable().optional(),
  imageUrls: z.array(z.string().url()).max(12).default([]),
  asin: z.string().trim().max(40).nullable().optional(),
  productUrl: z.string().url().nullable().optional(),
  provider: z.enum(productLookupSources),
  confidenceScore: z.number().min(0).max(1),
  confidenceState: z.enum(productLookupConfidenceStates),
  matchRationale: z.array(z.string().trim().min(1).max(240)).default([]),
  hint: z.custom<OperatorHint>(),
  safeToPrefill: z.boolean(),
  simulated: z.boolean().default(false)
});

export const inventoryBarcodeImportSchema = z.object({
  identifier: z.string().trim().min(8).max(64).optional(),
  barcode: z.string().trim().min(8).max(64).optional(),
  identifierType: z.enum(catalogIdentifierTypes).optional().nullable(),
  intakeDecision: z.enum(["ADD", "HOLD", "LIST_LATER", "POST_NOW"]).default("ADD"),
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
  primarySourceMarket: z.enum(catalogImportSources).default("AMAZON"),
  primarySourceUrl: z.string().url().optional().nullable(),
  referenceUrls: z.array(z.string().url()).max(8).default([]),
  imageUrls: z.array(z.string().url()).max(12).default([]),
  observations: z.array(marketObservationSchema).max(8).default([]),
  acceptedCandidate: productLookupCandidateSchema.optional().nullable(),
  generateDrafts: z.boolean().default(false),
  draftPlatforms: z.array(z.enum(platforms)).default([...platforms])
}).refine((input) => Boolean(input.identifier?.trim() || input.barcode?.trim()), {
  message: "Provide a supported barcode",
  path: ["identifier"]
});

export const inventoryImportCandidateSchema = z.object({
  title: z.string().trim().min(2).max(180),
  brand: z.string().trim().max(120).optional().nullable(),
  category: z.string().trim().min(2).max(120).default("General Merchandise"),
  condition: z.string().trim().min(2).max(120).default("Good used condition"),
  size: z.string().trim().max(40).optional().nullable(),
  color: z.string().trim().max(40).optional().nullable(),
  quantity: z.number().int().positive().default(1),
  costBasis: z.number().nonnegative().default(0),
  estimatedResaleMin: z.number().nonnegative().optional().nullable(),
  estimatedResaleMax: z.number().nonnegative().optional().nullable(),
  priceRecommendation: z.number().nonnegative().optional().nullable(),
  sourceUrl: z.string().url().optional().nullable(),
  externalItemId: z.string().trim().min(1).max(160).optional().nullable(),
  imageUrls: z.array(z.string().url()).max(12).default([]),
  attributes: z.record(z.string(), z.any()).default({})
});

export const inventoryImportAccountStartSchema = z.object({
  sourcePlatform: z.enum(importSourcePlatforms),
  marketplaceAccountId: z.string().min(1).optional().nullable(),
  limit: z.number().int().positive().max(250).default(25)
});

export const inventoryImportUrlPreviewSchema = z.object({
  sourcePlatform: z.enum(importSourcePlatforms),
  url: z.string().url()
});

export const inventoryImportUrlApplySchema = z.object({
  sourcePlatform: z.enum(importSourcePlatforms),
  url: z.string().url(),
  candidate: inventoryImportCandidateSchema,
  generateDrafts: z.boolean().default(false),
  draftPlatforms: z.array(z.enum(platforms)).default([...platforms])
});

export type InventoryImportCandidate = z.infer<typeof inventoryImportCandidateSchema>;

export type InventoryImportRunView = {
  id: string;
  workspaceId: string;
  sourceKind: ImportSourceKind;
  sourcePlatform: ImportSourcePlatform;
  marketplaceAccountId?: string | null;
  sourceUrl?: string | null;
  uploadFilename?: string | null;
  status: InventoryImportRunStatus;
  progressCount: number;
  appliedCount: number;
  failedCount: number;
  skippedCount: number;
  cursor?: Record<string, unknown> | null;
  stats?: Record<string, unknown> | null;
  artifactUrls: string[];
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InventoryImportItemView = {
  id: string;
  runId: string;
  externalItemId?: string | null;
  sourceUrl?: string | null;
  dedupeKey: string;
  status: InventoryImportItemStatus;
  matchedInventoryItemId?: string | null;
  normalizedCandidate?: InventoryImportCandidate | null;
  lastErrorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CatalogLookupRecord = {
  id: string;
  normalizedIdentifier: string;
  identifierType: CatalogIdentifierType;
  canonicalTitle: string | null;
  brand: string | null;
  category: string | null;
  imageUrls: string[];
  sourceReferences: Array<z.infer<typeof catalogResearchLinkSchema>>;
  trustStatus: CatalogTrustStatus;
  confidenceScore: number;
  lastConfirmedAt: string | null;
  lastRefreshedAt: string | null;
  observations: Array<{
    market: string;
    label: string;
    price: number | null;
    sourceUrl?: string | null;
    note?: string | null;
    observedAt: string | null;
    provenance: CatalogTrustStatus;
    confidenceScore: number | null;
  }>;
};

export type CatalogLookupResult = {
  mode: CatalogLookupMode;
  normalizedIdentifier: string;
  identifierType: CatalogIdentifierType;
  cacheStatus: CatalogCacheStatus;
  record: CatalogLookupRecord | null;
  workspaceObservations: Array<{
    market: string;
    label: string;
    price: number | null;
    sourceUrl?: string | null;
    note?: string | null;
    observedAt: string | null;
  }>;
  researchLinks: Array<z.infer<typeof catalogResearchLinkSchema>>;
  hint?: OperatorHint | null;
};

export type ProductLookupCandidate = z.infer<typeof productLookupCandidateSchema>;

export type ProductLookupResult = {
  barcode: string;
  identifierType: CatalogIdentifierType;
  candidates: ProductLookupCandidate[];
  hint: OperatorHint;
  recommendedNextAction: string;
  providerSummary: {
    barcodeLookupProvider: string;
    enrichmentProvider: string;
    simulated: boolean;
  };
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

export type AiStatusResponse = z.infer<typeof aiStatusResponseSchema>;
export type AiListingAssistRequest = z.infer<typeof aiListingAssistRequestSchema>;
export type AiListingAssistResponse = z.infer<typeof aiListingAssistResponseSchema>;

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
