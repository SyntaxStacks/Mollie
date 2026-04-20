import {
  ConnectorError,
  createAutomationVendorConnectAdapter,
  type AutomationVendorConnectAdapter,
  type MarketplaceAdapter,
  type PublishListingInput
} from "@reselleros/marketplaces";

function simulatePoshmarkPublish(input: PublishListingInput) {
  if (!input.images.length) {
    throw new ConnectorError({
      code: "PREREQUISITE_MISSING",
      message: "Poshmark publish requires at least one image",
      retryable: false,
      metadata: {
        inventoryItemId: input.inventoryItemId
      }
    });
  }

  const externalListingId = `poshmark_${crypto.randomUUID().slice(0, 12)}`;

  return {
    externalListingId,
    externalUrl: `https://poshmark.com/listing/${externalListingId}`,
    title: input.title,
    price: input.price,
    rawResponse: {
      mode: "simulated",
      platform: "POSHMARK",
      account: input.marketplaceAccount.displayName
    }
  };
}

export const poshmarkConnectAdapter: AutomationVendorConnectAdapter = createAutomationVendorConnectAdapter({
  platform: "POSHMARK",
  platformLabel: "Poshmark",
  loginUrl: "https://poshmark.com/login",
  challengeLabel: "Poshmark security code",
  challengeDetail: "Enter the 6-digit code Poshmark requested to finish secure sign-in.",
  summaryLabel: "Poshmark closet"
});

export const poshmarkAdapter: MarketplaceAdapter = {
  platform: "POSHMARK",
  descriptor: {
    platform: "POSHMARK",
    displayName: "Poshmark",
    executionMode: "SIMULATED",
    riskLevel: "HIGH",
    fallbackMode: "MANUAL",
    rateLimitStrategy: "SESSION_PACED",
    supportedCapabilities: [
      {
        capability: "CONNECT_ACCOUNT",
        support: "SUPPORTED",
        detail: "Operators connect Poshmark through Mollie's hosted remote sign-in session so the remote automation runtime can capture and validate the seller session."
      },
      {
        capability: "VALIDATE_AUTH",
        support: "SUPPORTED",
        detail: "Poshmark sessions are validated from the hosted session artifact Mollie stores for remote automation."
      },
      {
        capability: "REFRESH_AUTH",
        support: "UNSUPPORTED",
        detail: "No OAuth token refresh path exists for Poshmark."
      },
      {
        capability: "SYNC_ACCOUNT_STATE",
        support: "PLANNED",
        detail: "Future automation hardening may add richer account/session checks."
      },
      {
        capability: "SYNC_LISTINGS",
        support: "SUPPORTED",
        detail: "Listing status sync uses the shared sync path."
      },
      {
        capability: "SYNC_ORDERS",
        support: "PLANNED",
        detail: "Order sync is planned."
      },
      {
        capability: "CREATE_LISTING",
        support: "SIMULATED",
        detail: "Publish currently runs as a pilot-safe simulated automation adapter through connector-runner."
      },
      {
        capability: "UPDATE_LISTING",
        support: "PLANNED",
        detail: "Revise listing flows are planned."
      },
      {
        capability: "DELIST_LISTING",
        support: "PLANNED",
        detail: "Delist flows are planned."
      },
      {
        capability: "RELIST_LISTING",
        support: "PLANNED",
        detail: "Relist workflows are planned."
      },
      {
        capability: "SEND_OFFER",
        support: "UNSUPPORTED",
        detail: "Generic offer support is not part of the current Poshmark connector."
      },
      {
        capability: "FETCH_MESSAGES",
        support: "PLANNED",
        detail: "Comments and bundle communication belong to the Poshmark-native social family."
      },
      {
        capability: "RECORD_HEALTH",
        support: "SUPPORTED",
        detail: "Automation readiness, failure artifacts, and connector degradation are already tracked."
      },
      {
        capability: "FETCH_ANALYTICS",
        support: "UNSUPPORTED",
        detail: "Analytics retrieval is not in scope today."
      }
    ],
    supportedFeatureFamilies: [
      {
        family: "POSHMARK_SOCIAL",
        support: "PLANNED",
        detail: "Closet sharing, social actions, and bundle/comment workflows should remain a marketplace-native Poshmark family."
      }
    ]
  },
  async publishListing(input) {
    return simulatePoshmarkPublish(input);
  },
  async syncListing({ currentStatus }) {
    return { status: currentStatus === "PUBLISHED" ? "SYNCED" : currentStatus };
  },
  async testConnection({ marketplaceAccount }) {
    return {
      ok: true,
      detail: `Simulated Poshmark cross-listing is ready for ${marketplaceAccount.displayName}`
    };
  }
};
