import { ConnectorError, type MarketplaceAdapter, type PublishListingInput } from "@reselleros/marketplaces";

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

export const whatnotAdapter: MarketplaceAdapter = {
  platform: "WHATNOT",
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
