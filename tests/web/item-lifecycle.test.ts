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
  assert.equal(depop.actionLabel, "Finish in Depop tab");
  assert.equal(depop.actionKind, "open_extension");
  assert.equal(depop.connectionSummary, "Browser session ready - main closet");
  assert.equal(depop.summary, "Depop needs a few more listing fields finished in the browser tab.");
  assert.equal(depop.blocker, "Finish the Depop draft in the current browser tab.");
});
