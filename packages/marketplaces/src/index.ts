import type {
  ConnectorFailureCode,
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
