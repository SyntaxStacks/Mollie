import type {
  AutomationOperationalState,
  ConnectorFailureCode,
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

export type MarketplaceAdapter = {
  platform: Platform;
  publishListing(input: PublishListingInput): Promise<PublishResult>;
  syncListing(input: { externalListingId: string; currentStatus: string }): Promise<{ status: string }>;
  testConnection(input: { marketplaceAccount: MarketplaceAccountContext }): Promise<{ ok: boolean; detail: string }>;
};

export type AutomationMarketplaceReadiness = {
  state: AutomationOperationalState;
  status: "READY" | "BLOCKED";
  publishMode: "automation";
  summary: string;
  detail: string;
};

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
      detail: "Re-enable workspace connector automation before publishing."
    };
  }

  if (accountStatus === "ERROR") {
    return {
      state: "AUTOMATION_ERROR",
      status: "BLOCKED",
      publishMode: "automation" as const,
      summary: input.lastErrorMessage?.trim() || `${platformLabel} automation is in an error state.`,
      detail: "Reconnect or repair the automation session before publishing again."
    };
  }

  if (accountStatus === "DISABLED") {
    return {
      state: "AUTOMATION_BLOCKED",
      status: "BLOCKED",
      publishMode: "automation" as const,
      summary: `${platformLabel} automation is disabled for this account.`,
      detail: "Reconnect or re-enable the account before publishing."
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
          : "Reconnect the automation session before publishing."
    };
  }

  return {
    state: "AUTOMATION_READY",
    status: "READY",
    publishMode: "automation" as const,
    summary: `${platformLabel} automation is ready for publish jobs.`,
    detail: "This account will publish through the isolated connector-runner."
  };
}
