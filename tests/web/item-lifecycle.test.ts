import assert from "node:assert/strict";
import { test } from "node:test";

import { getMarketplaceStatusSummaries } from "../../apps/web/lib/item-lifecycle.js";

test("Depop rows treat browser-input work as draft prep instead of a hard failure", () => {
  const depop = getMarketplaceStatusSummaries(
    {
      id: "item-1",
      title: "Vintage denim jacket",
      category: "Jackets",
      condition: "Good used condition",
      priceRecommendation: 58,
      images: [{ id: "img-1", url: "https://images.example.com/jacket.jpg", position: 0 }],
      listingDrafts: [
        {
          id: "draft-1",
          platform: "DEPOP",
          reviewStatus: "APPROVED",
          generatedPrice: 58,
          generatedTitle: "Vintage denim jacket"
        }
      ],
      platformListings: [],
      extensionTasks: [
        {
          id: "task-1",
          platform: "DEPOP",
          action: "PREPARE_DRAFT",
          state: "NEEDS_INPUT",
          needsInputReason: "Finish the Depop draft in the current browser tab.",
          lastErrorMessage: "Depop needs a few more listing fields finished in the browser tab."
        }
      ]
    },
    {
      extensionInstalled: true,
      extensionConnected: true,
      capabilitySummary: [
        {
          platform: "DEPOP",
          capabilities: ["EXTENSION_PUBLISH"],
          importMode: "NONE",
          publishMode: "EXTENSION",
          bulkImport: false,
          bulkPublish: false
        }
      ],
      marketplaceAccounts: [
        {
          id: "acct-1",
          platform: "DEPOP",
          displayName: "main closet",
          status: "CONNECTED",
          validationStatus: "VALID",
          readiness: {
            state: "AUTOMATION_BLOCKED",
            status: "BLOCKED",
            summary: "Blocked by old automation runtime",
            detail: "Legacy runtime copy should not override browser-session readiness."
          }
        }
      ]
    }
  ).find((entry) => entry.platform === "DEPOP");

  assert.ok(depop);
  assert.equal(depop.platform, "DEPOP");
  assert.equal(depop.state, "draft");
  assert.equal(depop.actionLabel, "Finish draft in Depop tab");
  assert.equal(depop.actionKind, "open_extension");
  assert.equal(depop.connectionSummary, "Browser session ready - main closet");
  assert.equal(depop.summary, "Depop needs a few more listing fields finished in the browser tab.");
  assert.equal(depop.blocker, "Finish the Depop draft in the current browser tab.");
});

test("Depop rows offer browser publish when a ready draft exists", () => {
  const depop = getMarketplaceStatusSummaries(
    {
      id: "item-2",
      title: "Burberry wool coat",
      category: "Coats",
      condition: "Excellent used condition",
      priceRecommendation: 240,
      attributesJson: {
        marketplaceOverrides: {
          DEPOP: {
            attributes: {
              tags: ["burberry", "wool", "coat"]
            }
          }
        }
      },
      images: [{ id: "img-1", url: "https://images.example.com/coat.jpg", position: 0 }],
      listingDrafts: [
        {
          id: "draft-2",
          platform: "DEPOP",
          reviewStatus: "APPROVED",
          generatedPrice: 240,
          generatedTitle: "Burberry wool coat"
        }
      ],
      platformListings: [],
      extensionTasks: []
    },
    {
      extensionInstalled: true,
      extensionConnected: true,
      capabilitySummary: [
        {
          platform: "DEPOP",
          capabilities: ["EXTENSION_PUBLISH"],
          importMode: "NONE",
          publishMode: "EXTENSION",
          bulkImport: false,
          bulkPublish: false
        }
      ],
      marketplaceAccounts: [
        {
          id: "acct-2",
          platform: "DEPOP",
          displayName: "main closet",
          status: "CONNECTED",
          validationStatus: "VALID"
        }
      ]
    }
  ).find((entry) => entry.platform === "DEPOP");

  assert.ok(depop);
  assert.equal(depop.actionLabel, "Post in browser");
  assert.equal(depop.actionKind, "publish_extension");
  assert.equal(depop.summary, "Ready for Depop browser posting");
});

test("eBay rows prioritize shipping and category readiness", () => {
  const ebay = getMarketplaceStatusSummaries(
    {
      id: "item-3",
      title: "Patagonia fleece",
      category: "Outerwear",
      condition: "Good used condition",
      priceRecommendation: 78,
      images: [{ id: "img-1", url: "https://images.example.com/fleece.jpg", position: 0 }],
      listingDrafts: [],
      platformListings: [],
      extensionTasks: [],
      attributesJson: {}
    },
    {
      capabilitySummary: [
        {
          platform: "EBAY",
          capabilities: ["API_PUBLISH"],
          importMode: "EXTENSION",
          publishMode: "API",
          bulkImport: false,
          bulkPublish: false
        }
      ],
      marketplaceAccounts: [
        {
          id: "acct-3",
          platform: "EBAY",
          displayName: "main ebay",
          status: "CONNECTED",
          validationStatus: "VALID",
          readiness: {
            state: "READY",
            status: "READY",
            summary: "eBay account ready",
            detail: "Ready to publish."
          }
        }
      ]
    }
  ).find((entry) => entry.platform === "EBAY");

  assert.ok(ebay);
  assert.equal(ebay.summary, "Finish eBay shipping details");
  assert.match(ebay.blocker ?? "", /shipping weight/);
});

test("Poshmark rows stay honest when only browser session connectivity exists", () => {
  const poshmark = getMarketplaceStatusSummaries(
    {
      id: "item-4",
      title: "Coach shoulder bag",
      category: "Bags",
      condition: "Excellent used condition",
      priceRecommendation: 140,
      images: [{ id: "img-1", url: "https://images.example.com/bag.jpg", position: 0 }],
      listingDrafts: [],
      platformListings: [],
      extensionTasks: []
    },
    {
      extensionInstalled: true,
      extensionConnected: true,
      capabilitySummary: [
        {
          platform: "POSHMARK",
          capabilities: [],
          importMode: "NONE",
          publishMode: "NONE",
          bulkImport: false,
          bulkPublish: false
        }
      ],
      marketplaceAccounts: [
        {
          id: "acct-4",
          platform: "POSHMARK",
          displayName: "main closet",
          status: "CONNECTED",
          validationStatus: "VALID"
        }
      ]
    }
  ).find((entry) => entry.platform === "POSHMARK");

  assert.ok(poshmark);
  assert.equal(poshmark.summary, "Poshmark browser session is connected, but listing prep is not live yet");
  assert.equal(poshmark.actionLabel, "Unavailable");
});
