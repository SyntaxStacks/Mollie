import type {
  AutomationOperationalState,
  ConnectorCapability,
  ConnectorExecutionMode,
  ConnectorFailureCode,
  ConnectorFallbackMode,
  ConnectorFeatureFamily,
  OperatorHint,
  ConnectorRateLimitStrategy,
  ConnectorRiskLevel,
  ConnectorSupportLevel,
  MarketplaceAccountStatus,
  CredentialValidationStatus,
  MarketplaceCredentialType,
  Platform,
  PublishResult
} from "@reselleros/types";

export type MarketplaceAccountContext = {
  id: string;
  platform: Platform;
  displayName: string;
  secretRef: string;
  status?: MarketplaceAccountStatus;
  credentialType: MarketplaceCredentialType;
  validationStatus: CredentialValidationStatus;
  externalAccountId?: string | null;
  credentialMetadata?: Record<string, unknown> | null;
  credentialPayload?: Record<string, unknown> | null;
};

export type PublishListingInput = {
  inventoryItemId: string;
  sku: string;
  quantity: number;
  title: string;
  description: string;
  price: number;
  images: string[];
  category: string;
  condition: string;
  brand?: string | null;
  attributes: Record<string, unknown>;
  marketplaceAccount: MarketplaceAccountContext;
};

export type ConnectorCapabilitySupport = {
  capability: ConnectorCapability;
  support: ConnectorSupportLevel;
  detail: string;
};

export type ConnectorFeatureFamilySupport = {
  family: ConnectorFeatureFamily;
  support: ConnectorSupportLevel;
  detail: string;
};

export type ConnectorDescriptor = {
  platform: Platform;
  displayName: string;
  executionMode: ConnectorExecutionMode;
  riskLevel: ConnectorRiskLevel;
  fallbackMode: ConnectorFallbackMode;
  rateLimitStrategy: ConnectorRateLimitStrategy;
  supportedCapabilities: ConnectorCapabilitySupport[];
  supportedFeatureFamilies: ConnectorFeatureFamilySupport[];
};

export type MarketplaceAdapter = {
  platform: Platform;
  descriptor: ConnectorDescriptor;
  connect?(input: { marketplaceAccount: MarketplaceAccountContext }): Promise<{ ok: boolean; detail: string }>;
  validateAuth?(input: { marketplaceAccount: MarketplaceAccountContext }): Promise<{ ok: boolean; detail: string }>;
  refreshAuth?(input: { marketplaceAccount: MarketplaceAccountContext }): Promise<Record<string, unknown> | null>;
  syncAccountState?(input: { marketplaceAccount: MarketplaceAccountContext }): Promise<Record<string, unknown> | null>;
  publishListing(input: PublishListingInput): Promise<PublishResult>;
  reviseListing?(input: PublishListingInput & { externalListingId: string }): Promise<PublishResult>;
  delistListing?(input: { externalListingId: string; marketplaceAccount: MarketplaceAccountContext }): Promise<{ ok: boolean }>;
  relistListing?(input: { externalListingId: string; marketplaceAccount: MarketplaceAccountContext }): Promise<PublishResult>;
  sendOffer?(input: { externalListingId: string; marketplaceAccount: MarketplaceAccountContext; amount: number }): Promise<{ ok: boolean }>;
  runFeatureAction?(
    input: {
      family: ConnectorFeatureFamily;
      action: string;
      marketplaceAccount: MarketplaceAccountContext;
      payload?: Record<string, unknown>;
    }
  ): Promise<Record<string, unknown> | null>;
  reportHealth?(input: { marketplaceAccount: MarketplaceAccountContext }): Promise<{ state: string; detail: string }>;
  emitArtifacts?(input: { marketplaceAccount: MarketplaceAccountContext; context: string }): Promise<string[]>;
  syncListing(input: { externalListingId: string; currentStatus: string }): Promise<{ status: string }>;
  testConnection(input: { marketplaceAccount: MarketplaceAccountContext }): Promise<{ ok: boolean; detail: string }>;
};

export type AutomationMarketplaceReadiness = {
  state: AutomationOperationalState;
  status: "READY" | "BLOCKED";
  publishMode: "automation";
  summary: string;
  detail: string;
  hint: OperatorHint;
};

function getAutomationFeatureFamily(platform: Platform): ConnectorFeatureFamily {
  if (platform === "DEPOP") {
    return "DEPOP_PROMOTION";
  }

  if (platform === "POSHMARK") {
    return "POSHMARK_SOCIAL";
  }

  return "WHATNOT_LIVE_SELLING";
}

function buildAutomationHint(input: {
  platformLabel: string;
  platform: Platform;
  title: string;
  explanation: string;
  severity: OperatorHint["severity"];
  nextActions: string[];
  canContinue: boolean;
  helpText?: string;
}) {
  return {
    title: input.title,
    explanation: input.explanation,
    severity: input.severity,
    nextActions: input.nextActions,
    routeTarget: "/marketplaces",
    featureFamily: getAutomationFeatureFamily(input.platform),
    canContinue: input.canContinue,
    helpText: input.helpText ?? `${input.platformLabel} is currently handled as an automation-class connector.`
  } satisfies OperatorHint;
}

export class ConnectorError extends Error {
  code: ConnectorFailureCode;
  retryable: boolean;
  metadata?: Record<string, unknown>;

  constructor(input: {
    code: ConnectorFailureCode;
    message: string;
    retryable?: boolean;
    metadata?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "ConnectorError";
    this.code = input.code;
    this.retryable = input.retryable ?? true;
    this.metadata = input.metadata;
  }
}

export function classifyConnectorError(error: unknown) {
  if (error instanceof ConnectorError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "Unknown connector error";
  const lower = message.toLowerCase();

  if (lower.includes("prerequisite") || lower.includes("missing")) {
    return new ConnectorError({
      code: "PREREQUISITE_MISSING",
      message,
      retryable: false
    });
  }

  if (lower.includes("disabled") || lower.includes("unavailable")) {
    return new ConnectorError({
      code: "ACCOUNT_UNAVAILABLE",
      message,
      retryable: false
    });
  }

  if (lower.includes("rate")) {
    return new ConnectorError({
      code: "RATE_LIMITED",
      message,
      retryable: true
    });
  }

  return new ConnectorError({
    code: "AUTOMATION_FAILED",
    message,
    retryable: true
  });
}

export function getAutomationAccountReadiness(input: {
  account: MarketplaceAccountContext;
  workspaceAutomationEnabled?: boolean;
  accountStatus?: MarketplaceAccountStatus;
  lastErrorMessage?: string | null;
}) {
  const accountStatus = input.accountStatus ?? input.account.status ?? "CONNECTED";
  const platformLabel =
    input.account.platform === "DEPOP"
      ? "Depop"
      : input.account.platform === "POSHMARK"
        ? "Poshmark"
        : input.account.platform === "WHATNOT"
          ? "Whatnot"
          : input.account.platform;

  if (input.workspaceAutomationEnabled === false) {
    return {
      state: "AUTOMATION_BLOCKED",
      status: "BLOCKED",
      publishMode: "automation" as const,
      summary: `${platformLabel} automation is disabled for this workspace.`,
      detail: "Re-enable workspace connector automation before publishing.",
      hint: buildAutomationHint({
        platform: input.account.platform,
        platformLabel,
        title: `${platformLabel} needs workspace automation turned back on.`,
        explanation: "This account cannot publish until connector automation is re-enabled for the workspace.",
        severity: "ERROR",
        nextActions: ["Re-enable connector automation in Workspace settings.", "Retry publish after automation is enabled."],
        canContinue: false
      })
    };
  }

  if (accountStatus === "ERROR") {
    return {
      state: "AUTOMATION_ERROR",
      status: "BLOCKED",
      publishMode: "automation" as const,
      summary: input.lastErrorMessage?.trim() || `${platformLabel} automation is in an error state.`,
      detail: "Reconnect or repair the automation session before publishing again.",
      hint: buildAutomationHint({
        platform: input.account.platform,
        platformLabel,
        title: `${platformLabel} needs attention before it can publish again.`,
        explanation: input.lastErrorMessage?.trim() || "The last automation run failed and the connector is currently blocked.",
        severity: "ERROR",
        nextActions: [
          `Reconnect the ${platformLabel} session or secret reference.`,
          "Open Executions to inspect the last failure details and artifacts.",
          "Use manual handling if this publish cannot wait."
        ],
        canContinue: false
      })
    };
  }

  if (accountStatus === "DISABLED") {
    return {
      state: "AUTOMATION_BLOCKED",
      status: "BLOCKED",
      publishMode: "automation" as const,
      summary: `${platformLabel} automation is disabled for this account.`,
      detail: "Reconnect or re-enable the account before publishing.",
      hint: buildAutomationHint({
        platform: input.account.platform,
        platformLabel,
        title: `${platformLabel} is disabled for this account.`,
        explanation: "Mollie will not send automation jobs to this account until it is re-enabled or reconnected.",
        severity: "ERROR",
        nextActions: [`Reconnect the ${platformLabel} account.`, "Return here to confirm the account is ready before publishing."],
        canContinue: false
      })
    };
  }

  if (input.account.validationStatus !== "VALID") {
    return {
      state: "AUTOMATION_BLOCKED",
      status: "BLOCKED",
      publishMode: "automation" as const,
      summary: `${platformLabel} session needs attention before automation can run.`,
      detail:
        input.account.validationStatus === "NEEDS_REFRESH"
          ? "Refresh the stored session secret before publishing."
          : "Reconnect the automation session before publishing.",
      hint: buildAutomationHint({
        platform: input.account.platform,
        platformLabel,
        title: `${platformLabel} session needs to be refreshed before it can publish.`,
        explanation:
          input.account.validationStatus === "NEEDS_REFRESH"
            ? "The saved automation session is stale and needs a fresh secret or session reference."
            : "The saved automation session is not valid enough to run publish jobs.",
        severity: "WARNING",
        nextActions: [
          `Refresh or replace the saved ${platformLabel} session reference.`,
          "Retry the publish after the account shows ready again."
        ],
        canContinue: false
      })
    };
  }

  return {
    state: "AUTOMATION_READY",
    status: "READY",
    publishMode: "automation" as const,
    summary: `${platformLabel} automation is ready for publish jobs.`,
    detail: "This account will publish through the isolated connector-runner.",
    hint: buildAutomationHint({
      platform: input.account.platform,
      platformLabel,
      title: `${platformLabel} is ready for automation publish jobs.`,
      explanation: "Mollie can queue publish work for this account through the isolated automation runner.",
      severity: "SUCCESS",
      nextActions: ["Continue from inventory detail to publish an item.", "Check Executions if a publish later needs support review."],
      canContinue: true
    })
  };
}
