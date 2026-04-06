import {
  ConnectorError,
  createAutomationVendorConnectAdapter,
  type AutomationVendorConnectAdapter,
  type MarketplaceAdapter,
  type PublishListingInput
} from "@reselleros/marketplaces";

function simulateDepopPublish(input: PublishListingInput) {
  if (!input.images.length) {
    throw new ConnectorError({
      code: "PREREQUISITE_MISSING",
      message: "Depop publish requires at least one image",
      retryable: false,
      metadata: {
        inventoryItemId: input.inventoryItemId
      }
    });
  }

  const externalListingId = `depop_${crypto.randomUUID().slice(0, 12)}`;

  return {
    externalListingId,
    externalUrl: `https://www.depop.com/products/${externalListingId}`,
    title: input.title,
    price: input.price,
    rawResponse: {
      mode: "simulated",
      platform: "DEPOP",
      account: input.marketplaceAccount.displayName
    },
    artifactUrls: [
      `${process.env.GCS_BUCKET_ARTIFACTS ?? "local-artifacts"}/screenshots/${externalListingId}-step-1.png`
    ]
  };
}

export const depopConnectAdapter: AutomationVendorConnectAdapter = createAutomationVendorConnectAdapter({
  platform: "DEPOP",
  platformLabel: "Depop",
  loginUrl: "https://www.depop.com/login/",
  challengeLabel: "Depop verification code",
  challengeDetail: "Enter the 6-digit code Depop sent to finish secure sign-in.",
  summaryLabel: "Depop shop"
});

export const depopAdapter: MarketplaceAdapter = {
  platform: "DEPOP",
  descriptor: {
    platform: "DEPOP",
    displayName: "Depop",
    executionMode: "SIMULATED",
    riskLevel: "HIGH",
    fallbackMode: "MANUAL",
    rateLimitStrategy: "SESSION_PACED",
    supportedCapabilities: [
      {
        capability: "CONNECT_ACCOUNT",
        support: "SUPPORTED",
        detail: "Operators connect Depop by signing in on another tab and rechecking that browser session through the Mollie extension."
      },
      {
        capability: "VALIDATE_AUTH",
        support: "SUPPORTED",
        detail: "Depop sessions are validated after the browser extension rechecks the signed-in tab."
      },
      {
        capability: "REFRESH_AUTH",
        support: "UNSUPPORTED",
        detail: "There is no OAuth refresh path for the current Depop connector."
      },
      {
        capability: "SYNC_ACCOUNT_STATE",
        support: "PLANNED",
        detail: "Richer account state sync is planned once automation runtime hardening progresses."
      },
      {
        capability: "SYNC_LISTINGS",
        support: "SUPPORTED",
        detail: "Listing status sync uses the shared sync path."
      },
      {
        capability: "SYNC_ORDERS",
        support: "PLANNED",
        detail: "Order sync is planned, not implemented."
      },
      {
        capability: "CREATE_LISTING",
        support: "SIMULATED",
        detail: "Publish currently runs as a pilot-safe simulated automation adapter through connector-runner."
      },
      {
        capability: "UPDATE_LISTING",
        support: "PLANNED",
        detail: "Revise flows are planned."
      },
      {
        capability: "DELIST_LISTING",
        support: "PLANNED",
        detail: "Delist flows are planned."
      },
      {
        capability: "RELIST_LISTING",
        support: "PLANNED",
        detail: "Relist and bump-style flows are planned."
      },
      {
        capability: "SEND_OFFER",
        support: "UNSUPPORTED",
        detail: "Generic offer workflows are not part of the current Depop integration."
      },
      {
        capability: "FETCH_MESSAGES",
        support: "PLANNED",
        detail: "Buyer messaging support belongs to a Depop-native feature family."
      },
      {
        capability: "RECORD_HEALTH",
        support: "SUPPORTED",
        detail: "Automation readiness, failure artifacts, and degraded account state already exist."
      },
      {
        capability: "FETCH_ANALYTICS",
        support: "UNSUPPORTED",
        detail: "Analytics retrieval is not part of the current integration."
      }
    ],
    supportedFeatureFamilies: [
      {
        family: "DEPOP_PROMOTION",
        support: "PLANNED",
        detail: "Bump, relist, and shop-promotion workflows are intentionally modeled as a Depop-native family."
      }
    ]
  },
  async publishListing(input) {
    return simulateDepopPublish(input);
  },
  async syncListing({ currentStatus }) {
    return { status: currentStatus === "PUBLISHED" ? "SYNCED" : currentStatus };
  },
  async testConnection({ marketplaceAccount }) {
    return {
      ok: true,
      detail: `Simulated Depop automation session ready for ${marketplaceAccount.displayName}`
    };
  }
};
