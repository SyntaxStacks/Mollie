import { ConnectorError, type MarketplaceAdapter, type PublishListingInput } from "@reselleros/marketplaces";

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

export const depopAdapter: MarketplaceAdapter = {
  platform: "DEPOP",
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
