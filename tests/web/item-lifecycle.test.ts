import assert from "node:assert/strict";
import { test } from "node:test";

import { getMarketplaceStatusSummaries } from "../../apps/web/lib/item-lifecycle.js";

test("Depop rows surface exact missing fields in Mollie instead of sending the operator back to the Depop tab", () => {
  const depop = getMarketplaceStatusSummaries(
    {
      id: "item-1",
      title: "Vintage denim jacket",
      category: "Jackets",
      condition: "Good used condition",
      size: "L",
      priceRecommendation: 58,
      attributesJson: {
        description: "",
        marketplaceOverrides: {
          DEPOP: {
            attributes: {
              department: "Men",
              productType: "Jackets",
              packageSize: "Small"
            }
          }
        }
      },
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
      automationTasks: [
        {
          id: "task-1",
          platform: "DEPOP",
          action: "PREPARE_DRAFT",
          state: "NEEDS_INPUT",
          needsInputReason: "Depop still needs a few required fields before publish.",
          lastErrorMessage: "Depop still needs a few required fields before publish.",
          resultJson: {
            missingFields: ["description", "product_type"]
          }
        }
      ]
    },
    {
      capabilitySummary: [
        {
          platform: "DEPOP",
          capabilities: ["API_PUBLISH"],
          importMode: "NONE",
          publishMode: "API",
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
  assert.equal(depop.actionLabel, "Fix details");
  assert.equal(depop.actionKind, "fix_details");
  assert.equal(depop.connectionSummary, "Blocked by old automation runtime");
  assert.equal(depop.summary, "Depop still needs required item fields before publish.");
  assert.equal(depop.blocker, "Missing description.");
  assert.deepEqual(depop.missingRequirements, ["description"]);
});

test("Depop rows retry remote publish when Mollie already has the required fields", () => {
  const depop = getMarketplaceStatusSummaries(
    {
      id: "item-1b",
      title: "Vintage denim jacket",
      category: "Jackets",
      condition: "Good used condition",
      size: "L",
      priceRecommendation: 58,
      attributesJson: {
        description: "A clean vintage denim jacket ready to list.",
        marketplaceOverrides: {
          DEPOP: {
            attributes: {
              department: "Men",
              productType: "Jackets",
              packageSize: "Small"
            }
          }
        }
      },
      images: [{ id: "img-1", url: "https://images.example.com/jacket.jpg", position: 0 }],
      listingDrafts: [
        {
          id: "draft-1b",
          platform: "DEPOP",
          reviewStatus: "APPROVED",
          generatedPrice: 58,
          generatedTitle: "Vintage denim jacket"
        }
      ],
      platformListings: [],
      automationTasks: [
        {
          id: "task-1b",
          platform: "DEPOP",
          action: "PUBLISH_LISTING",
          state: "NEEDS_INPUT",
          needsInputReason: "Depop opened the final publish step, but Mollie could not confirm that the listing went live.",
          lastErrorMessage: "Depop publish needs another browser pass.",
          resultJson: {
            missingFields: []
          }
        }
      ]
    },
    {
      capabilitySummary: [
        {
          platform: "DEPOP",
          capabilities: ["API_PUBLISH"],
          importMode: "NONE",
          publishMode: "API",
          bulkImport: false,
          bulkPublish: false
        }
      ],
      marketplaceAccounts: [
        {
          id: "acct-1b",
          platform: "DEPOP",
          displayName: "main closet",
          status: "CONNECTED",
          validationStatus: "VALID"
        }
      ]
    }
  ).find((entry) => entry.platform === "DEPOP");

  assert.ok(depop);
  assert.equal(depop.actionLabel, "Retry publish");
  assert.equal(depop.actionKind, "retry");
  assert.equal(depop.summary, "Depop publish needs another browser pass.");
  assert.equal(
    depop.blocker,
    "Depop opened the final publish step, but Mollie could not confirm that the listing went live."
  );
});

test("Depop rows convert legacy browser transport failures into remote retry guidance", () => {
  const depop = getMarketplaceStatusSummaries(
    {
      id: "item-legacy-browser-failure",
      title: "Leather shoes",
      category: "Shoes",
      condition: "Good used condition",
      size: "10",
      priceRecommendation: 35,
      attributesJson: {
        description: "Leather shoes ready for Depop.",
        marketplaceOverrides: {
          DEPOP: {
            attributes: {
              department: "Men",
              productType: "Shoes",
              packageSize: "Small"
            }
          }
        }
      },
      images: [{ id: "img-legacy", url: "https://images.example.com/shoes.jpg", position: 0 }],
      listingDrafts: [
        {
          id: "draft-legacy",
          platform: "DEPOP",
          reviewStatus: "APPROVED",
          generatedPrice: 35,
          generatedTitle: "Leather shoes"
        }
      ],
      platformListings: [],
      automationTasks: [
        {
          id: "task-legacy",
          platform: "DEPOP",
          action: "PUBLISH_LISTING",
          state: "FAILED",
          needsInputReason: "Could not establish connection. Receiving end does not exist.",
          lastErrorMessage: "Could not establish connection. Receiving end does not exist.",
          resultJson: {
            missingFields: []
          }
        }
      ]
    },
    {
      capabilitySummary: [
        {
          platform: "DEPOP",
          capabilities: ["API_PUBLISH"],
          importMode: "NONE",
          publishMode: "API",
          bulkImport: false,
          bulkPublish: false
        }
      ],
      marketplaceAccounts: [
        {
          id: "acct-legacy",
          platform: "DEPOP",
          displayName: "main closet",
          status: "CONNECTED",
          validationStatus: "VALID"
        }
      ]
    }
  ).find((entry) => entry.platform === "DEPOP");

  assert.ok(depop);
  assert.equal(depop.actionLabel, "Retry");
  assert.equal(depop.actionKind, "retry");
  assert.equal(depop.secondaryActionLabel, null);
  assert.equal(depop.secondaryActionKind, null);
  assert.equal(depop.summary, "Depop publish is ready to retry on the remote grid.");
  assert.equal(
    depop.blocker,
    "The last automation attempt could not reach a worker. Retry publish to queue it on Mollie's remote browser grid."
  );
});

test("Depop rows do not re-mark shared fields as missing when Mollie already has them", () => {
  const depop = getMarketplaceStatusSummaries(
    {
      id: "item-1c",
      title: "Biore pore refining mask",
      category: "Beauty & Personal Care",
      condition: "Good used condition",
      size: "8 Count (Pack of 1)",
      priceRecommendation: 10,
      attributesJson: {
        description: "Biore pore refining bubbling nose mask.",
        marketplaceOverrides: {
          DEPOP: {
            attributes: {
              department: "Other",
              productType: "Beauty & Personal Care",
              packageSize: "Small"
            }
          }
        }
      },
      images: [{ id: "img-1", url: "https://images.example.com/biore.jpg", position: 0 }],
      listingDrafts: [
        {
          id: "draft-1c",
          platform: "DEPOP",
          reviewStatus: "APPROVED",
          generatedPrice: 10,
          generatedTitle: "Biore pore refining mask"
        }
      ],
      platformListings: [],
      automationTasks: [
        {
          id: "task-1c",
          platform: "DEPOP",
          action: "PUBLISH_LISTING",
          state: "NEEDS_INPUT",
          needsInputReason: "Depop opened the final publish step, but Mollie could not confirm that the listing went live.",
          lastErrorMessage: "Depop publish needs another browser pass.",
          resultJson: {
            missingFields: ["description", "title", "price", "department", "product_type", "shipping"]
          }
        }
      ]
    },
    {
      capabilitySummary: [
        {
          platform: "DEPOP",
          capabilities: ["API_PUBLISH"],
          importMode: "NONE",
          publishMode: "API",
          bulkImport: false,
          bulkPublish: false
        }
      ],
      marketplaceAccounts: [
        {
          id: "acct-1c",
          platform: "DEPOP",
          displayName: "main closet",
          status: "CONNECTED",
          validationStatus: "VALID"
        }
      ]
    }
  ).find((entry) => entry.platform === "DEPOP");

  assert.ok(depop);
  assert.deepEqual(depop.missingRequirements, []);
  assert.equal(depop.actionLabel, "Retry publish");
  assert.equal(depop.actionKind, "retry");
  assert.equal(depop.summary, "Depop publish needs another browser pass.");
  assert.equal(
    depop.blocker,
    "Depop opened the final publish step, but Mollie could not confirm that the listing went live."
  );
});

test("Depop rows offer remote publish when a ready draft exists", () => {
  const depop = getMarketplaceStatusSummaries(
    {
      id: "item-2",
      title: "Burberry wool coat",
      category: "Coats",
      condition: "Excellent used condition",
      size: "M",
      priceRecommendation: 240,
      attributesJson: {
        description: "Warm Burberry wool coat in excellent condition.",
        marketplaceOverrides: {
          DEPOP: {
            attributes: {
              department: "Women",
              productType: "Coats",
              packageSize: "Small",
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
      automationTasks: []
    },
    {
      capabilitySummary: [
        {
          platform: "DEPOP",
          capabilities: ["API_PUBLISH"],
          importMode: "NONE",
          publishMode: "API",
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
  assert.equal(depop.actionLabel, "Publish now");
  assert.equal(depop.actionKind, "publish_api");
  assert.equal(depop.summary, "Ready for Depop publish");
});

test("Depop tags stay recommended instead of blocking draft prep", () => {
  const depop = getMarketplaceStatusSummaries(
    {
      id: "item-2b",
      title: "Vintage leather jacket",
      category: "Jackets",
      condition: "Good used condition",
      size: "L",
      priceRecommendation: 95,
      attributesJson: {
        description: "Broken-in leather jacket with clean lining.",
        marketplaceOverrides: {
          DEPOP: {
            attributes: {
              department: "Men",
              productType: "Jackets",
              packageSize: "Small"
            }
          }
        }
      },
      images: [{ id: "img-1", url: "https://images.example.com/jacket.jpg", position: 0 }],
      listingDrafts: [],
      platformListings: [],
      automationTasks: []
    },
    {
      capabilitySummary: [
        {
          platform: "DEPOP",
          capabilities: ["API_PUBLISH"],
          importMode: "NONE",
          publishMode: "API",
          bulkImport: false,
          bulkPublish: false
        }
      ],
      marketplaceAccounts: [
        {
          id: "acct-2b",
          platform: "DEPOP",
          displayName: "main closet",
          status: "CONNECTED",
          validationStatus: "VALID"
        }
      ]
    }
  ).find((entry) => entry.platform === "DEPOP");

  assert.ok(depop);
  assert.equal(depop.actionLabel, "Generate draft");
  assert.equal(depop.actionKind, "generate_draft");
  assert.deepEqual(depop.missingRequirements, []);
  assert.deepEqual(depop.recommendedRequirements, ["Depop discovery tags"]);
  assert.equal(depop.summary, "Depop needs a little more listing detail");
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
      automationTasks: [],
      attributesJson: {}
    },
    {
      capabilitySummary: [
        {
          platform: "EBAY",
          capabilities: ["API_PUBLISH"],
          importMode: "NONE",
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
      attributesJson: {
        description: "Coach shoulder bag with clean lining and light wear."
      },
      images: [{ id: "img-1", url: "https://images.example.com/bag.jpg", position: 0 }],
      listingDrafts: [],
      platformListings: [],
      automationTasks: []
    },
    {
      capabilitySummary: [
        {
          platform: "POSHMARK",
          capabilities: ["API_PUBLISH", "UPDATE"],
          importMode: "NONE",
          publishMode: "API",
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
  assert.equal(poshmark.summary, "Ready for Poshmark draft generation");
  assert.equal(poshmark.actionLabel, "Retry");
});

test("Poshmark rows block on required description and size", () => {
  const poshmark = getMarketplaceStatusSummaries(
    {
      id: "item-5",
      title: "Nike hoodie",
      category: "Apparel",
      condition: "Good used condition",
      priceRecommendation: 42,
      images: [{ id: "img-1", url: "https://images.example.com/hoodie.jpg", position: 0 }],
      listingDrafts: [],
      platformListings: [],
      automationTasks: []
    },
    {
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
          id: "acct-5",
          platform: "POSHMARK",
          displayName: "main closet",
          status: "CONNECTED",
          validationStatus: "VALID"
        }
      ]
    }
  ).find((entry) => entry.platform === "POSHMARK");

  assert.ok(poshmark);
  assert.equal(poshmark.actionLabel, "Fix details");
  assert.match(poshmark.summary, /description/i);
  assert.deepEqual(poshmark.missingRequirements, ["description", "size"]);
});
