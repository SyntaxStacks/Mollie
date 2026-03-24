import type { MarketplaceAdapter, PublishListingInput } from "@reselleros/marketplaces";

function simulatePublish(input: PublishListingInput) {
  const externalListingId = `ebay_${crypto.randomUUID().slice(0, 12)}`;
  return {
    externalListingId,
    externalUrl: `https://www.ebay.com/itm/${externalListingId}`,
    title: input.title,
    price: input.price,
    rawResponse: {
      mode: "simulated",
      platform: "EBAY",
      account: input.marketplaceAccountDisplayName
    }
  };
}

export const ebayAdapter: MarketplaceAdapter = {
  platform: "EBAY",
  async publishListing(input) {
    return simulatePublish(input);
  },
  async syncListing({ currentStatus }) {
    return { status: currentStatus === "PUBLISHED" ? "SYNCED" : currentStatus };
  },
  async testConnection({ displayName }) {
    return {
      ok: true,
      detail: `Simulated eBay connection ready for ${displayName}`
    };
  }
};
