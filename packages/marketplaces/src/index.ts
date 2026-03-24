import type { Platform, PublishResult } from "@reselleros/types";

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
