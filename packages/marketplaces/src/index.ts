import type { ConnectorFailureCode, Platform, PublishResult } from "@reselleros/types";

export type PublishListingInput = {
  inventoryItemId: string;
  title: string;
  description: string;
  price: number;
  images: string[];
  attributes: Record<string, unknown>;
  marketplaceAccountId: string;
  marketplaceAccountDisplayName: string;
};

export type MarketplaceAdapter = {
  platform: Platform;
  publishListing(input: PublishListingInput): Promise<PublishResult>;
  syncListing(input: { externalListingId: string; currentStatus: string }): Promise<{ status: string }>;
  testConnection(input: { displayName: string }): Promise<{ ok: boolean; detail: string }>;
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
