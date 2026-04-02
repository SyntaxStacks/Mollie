import {
  ConnectorError,
  createAutomationVendorConnectAdapter,
  type AutomationVendorConnectAdapter,
  type MarketplaceAdapter,
  type PublishListingInput
} from "@reselleros/marketplaces";

function simulateWhatnotPublish(input: PublishListingInput) {
  if (!input.images.length) {
    throw new ConnectorError({
      code: "PREREQUISITE_MISSING",
      message: "Whatnot publish requires at least one image",
      retryable: false,
      metadata: {
        inventoryItemId: input.inventoryItemId
      }
    });
  }

  const externalListingId = `whatnot_${crypto.randomUUID().slice(0, 12)}`;

  return {
    externalListingId,
    externalUrl: `https://www.whatnot.com/listing/${externalListingId}`,
    title: input.title,
    price: input.price,
    rawResponse: {
      mode: "simulated",
      platform: "WHATNOT",
      account: input.marketplaceAccount.displayName
    }
  };
}

export const whatnotConnectAdapter: AutomationVendorConnectAdapter = createAutomationVendorConnectAdapter({
  platform: "WHATNOT",
  platformLabel: "Whatnot",
  loginUrl: "https://www.whatnot.com/login",
  challengeLabel: "Whatnot verification code",
  challengeDetail: "Enter the 6-digit code Whatnot requested to finish secure sign-in.",
  summaryLabel: "Whatnot seller account"
});

export const whatnotAdapter: MarketplaceAdapter = {
  platform: "WHATNOT",
  descriptor: {
    platform: "WHATNOT",
    displayName: "Whatnot",
    executionMode: "SIMULATED",
    riskLevel: "HIGH",
    fallbackMode: "MANUAL",
    rateLimitStrategy: "SESSION_PACED",
    supportedCapabilities: [
      {
        capability: "CONNECT_ACCOUNT",
        support: "SUPPORTED",
        detail: "Operators connect Whatnot through a helper-assisted secure sign-in flow."
      },
      {
        capability: "VALIDATE_AUTH",
        support: "SUPPORTED",
        detail: "Whatnot sessions are validated after helper-assisted sign-in before the account is marked ready."
      },
      {
        capability: "REFRESH_AUTH",
        support: "UNSUPPORTED",
        detail: "No OAuth refresh path exists for Whatnot."
      },
      {
        capability: "SYNC_ACCOUNT_STATE",
        support: "PLANNED",
        detail: "Future runtime hardening may add richer account sync checks."
      },
      {
        capability: "SYNC_LISTINGS",
        support: "SUPPORTED",
        detail: "Listing status sync uses the shared sync path."
      },
      {
        capability: "SYNC_ORDERS",
        support: "PLANNED",
        detail: "Order and sale reconciliation are planned."
      },
      {
        capability: "CREATE_LISTING",
        support: "SIMULATED",
        detail: "Publish currently runs as a pilot-safe simulated automation adapter through connector-runner."
      },
      {
        capability: "UPDATE_LISTING",
        support: "PLANNED",
        detail: "Revise listing workflows are planned."
      },
      {
        capability: "DELIST_LISTING",
        support: "PLANNED",
        detail: "Delist flows are planned."
      },
      {
        capability: "RELIST_LISTING",
        support: "PLANNED",
        detail: "Relist workflows are planned where Whatnot catalog behavior allows it."
      },
      {
        capability: "SEND_OFFER",
        support: "UNSUPPORTED",
        detail: "Generic offer support is not part of the current Whatnot connector."
      },
      {
        capability: "FETCH_MESSAGES",
        support: "UNSUPPORTED",
        detail: "Messaging is not modeled in the current Whatnot connector."
      },
      {
        capability: "RECORD_HEALTH",
        support: "SUPPORTED",
        detail: "Automation readiness, failure artifacts, and connector degradation are already tracked."
      },
      {
        capability: "FETCH_ANALYTICS",
        support: "UNSUPPORTED",
        detail: "Analytics retrieval is not part of the current integration."
      }
    ],
    supportedFeatureFamilies: [
      {
        family: "WHATNOT_LIVE_SELLING",
        support: "PLANNED",
        detail: "Live-show inventory assignment, auction controls, and stream reconciliation should remain Whatnot-native workflows."
      }
    ]
  },
  async publishListing(input) {
    return simulateWhatnotPublish(input);
  },
  async syncListing({ currentStatus }) {
    return { status: currentStatus === "PUBLISHED" ? "SYNCED" : currentStatus };
  },
  async testConnection({ marketplaceAccount }) {
    return {
      ok: true,
      detail: `Simulated Whatnot cross-listing is ready for ${marketplaceAccount.displayName}`
    };
  }
};
