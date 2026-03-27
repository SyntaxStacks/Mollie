import { ConnectorError, type MarketplaceAdapter, type PublishListingInput } from "@reselleros/marketplaces";

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

export const poshmarkAdapter: MarketplaceAdapter = {
  platform: "POSHMARK",
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
