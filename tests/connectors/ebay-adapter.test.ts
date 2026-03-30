import assert from "node:assert/strict";
import { after, before, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.EBAY_CLIENT_ID ??= "pilot-ebay-client-id";
process.env.EBAY_CLIENT_SECRET ??= "pilot-ebay-client-secret";
process.env.EBAY_REDIRECT_URI ??= "http://localhost:4000/api/marketplace-accounts/ebay/oauth/callback";
delete process.env.EBAY_RU_NAME;
process.env.EBAY_ENVIRONMENT ??= "sandbox";
process.env.EBAY_LIVE_PUBLISH_ENABLED = "true";
process.env.EBAY_MARKETPLACE_ID = "EBAY_US";
process.env.EBAY_CURRENCY = "USD";
process.env.EBAY_MERCHANT_LOCATION_KEY = "pilot-warehouse";
process.env.EBAY_PAYMENT_POLICY_ID = "payment-policy";
process.env.EBAY_RETURN_POLICY_ID = "return-policy";
process.env.EBAY_FULFILLMENT_POLICY_ID = "fulfillment-policy";
process.env.EBAY_SCOPES =
  "https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/commerce.identity.readonly";

type EbayModule = typeof import("../../packages/marketplaces-ebay/src/index.js");

let ebayAdapter: EbayModule["ebayAdapter"];
let encryptEbayCredentialPayload: EbayModule["encryptEbayCredentialPayload"];
const originalFetch = global.fetch;

before(async () => {
  const ebayModule = await import("../../packages/marketplaces-ebay/src/index.js");
  ebayAdapter = ebayModule.ebayAdapter;
  encryptEbayCredentialPayload = ebayModule.encryptEbayCredentialPayload;
});

after(() => {
  global.fetch = originalFetch;
});

test("ebay live publish refreshes tokens and publishes a real offer flow when enabled", async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ?? null;
    requests.push({ url, method, body });

    if (url.includes("/identity/v1/oauth2/token")) {
      return new Response(
        JSON.stringify({
          access_token: "fresh-access-token",
          token_type: "User Access Token",
          expires_in: 7200,
          refresh_token: "fresh-refresh-token",
          refresh_token_expires_in: 47304000,
          scope: process.env.EBAY_SCOPES
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url.includes("/sell/inventory/v1/inventory_item/")) {
      return new Response(null, { status: 204 });
    }

    if (url.endsWith("/sell/inventory/v1/offer")) {
      return new Response(JSON.stringify({ offerId: "offer-123" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (url.endsWith("/sell/inventory/v1/offer/offer-123/publish")) {
      return new Response(JSON.stringify({ listingId: "1100000001" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    throw new Error(`Unexpected fetch request: ${method} ${url}`);
  }) as typeof fetch;

  const result = await ebayAdapter.publishListing({
    inventoryItemId: "inv-1",
    sku: "SKU-EBAY-1",
    quantity: 1,
    title: "Vintage Denim Jacket",
    description: "Pilot listing for a real eBay offer flow.",
    price: 48,
    images: ["https://cdn.example.com/jacket-1.jpg"],
    category: "Outerwear",
    condition: "Good used condition",
    brand: "Levi's",
    attributes: {
      ebayCategoryId: "57988",
      size: "M"
    },
    marketplaceAccount: {
      id: "acct-1",
      platform: "EBAY",
      displayName: "Pilot Seller",
      secretRef: "db-encrypted://marketplace-account/oauth",
      credentialType: "OAUTH_TOKEN_SET",
      validationStatus: "VALID",
      externalAccountId: "ebay-user-123",
      credentialMetadata: {
        username: "pilot-seller",
        accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString()
      },
      credentialPayload: encryptEbayCredentialPayload({
        accessToken: "expired-access-token",
        refreshToken: "refresh-token",
        tokenType: "User Access Token",
        scopes: process.env.EBAY_SCOPES?.split(" ") ?? [],
        issuedAt: new Date(Date.now() - 60_000).toISOString(),
        accessTokenExpiresAt: new Date(Date.now() - 30_000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString()
      })
    }
  });

  assert.equal(result.externalListingId, "1100000001");
  assert.equal(result.externalUrl, "https://www.sandbox.ebay.com/itm/1100000001");
  assert.equal(result.rawResponse.mode, "live");
  assert.equal(requests.length, 4);
  assert.match(requests[0]?.url ?? "", /identity\/v1\/oauth2\/token/i);
  assert.match(requests[1]?.url ?? "", /sell\/inventory\/v1\/inventory_item/i);
  assert.equal((requests[2]?.body as { categoryId?: string })?.categoryId, "57988");
  assert.equal((requests[2]?.body as { listingPolicies?: { fulfillmentPolicyId?: string } })?.listingPolicies?.fulfillmentPolicyId, "fulfillment-policy");
  assert.ok(result.marketplaceAccountUpdate);
  assert.equal(result.marketplaceAccountUpdate?.validationStatus, "VALID");
  assert.equal(JSON.stringify(result.marketplaceAccountUpdate?.credentialPayload).includes("fresh-access-token"), false);
});
