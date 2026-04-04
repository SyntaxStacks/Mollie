import assert from "node:assert/strict";
import { test } from "node:test";

import { extractWhatnotSessionArtifact, isWhatnotBrowserRuntimeEnabled, publishWhatnotListing } from "../../apps/connector-runner/src/whatnot-runtime.js";

test("extractWhatnotSessionArtifact prefers helper session payload data", () => {
  const artifact = extractWhatnotSessionArtifact({
    id: "acct_123",
    platform: "WHATNOT",
    displayName: "Main Whatnot account",
    secretRef: "db-session://whatnot/workspace/attempt",
    credentialType: "SECRET_REF",
    validationStatus: "VALID",
    externalAccountId: "whatnot:seller",
    credentialMetadata: null,
    credentialPayload: {
      helperSessionArtifact: {
        captureMode: "LOCAL_BRIDGE",
        capturedAt: "2026-04-04T07:00:00.000Z",
        validatedAt: "2026-04-04T07:01:00.000Z",
        accountHandle: "seller-one",
        sessionLabel: "Primary Whatnot",
        connectAttemptId: "attempt_123",
        cookieCount: 4,
        origin: "https://www.whatnot.com",
        storageStateJson: {
          cookies: [{ name: "wn_session", value: "abc", domain: ".whatnot.com" }],
          origins: [{ origin: "https://www.whatnot.com", localStorage: [] }]
        }
      }
    }
  });

  assert.ok(artifact);
  assert.equal(artifact?.platform, "WHATNOT");
  assert.equal(artifact?.captureMode, "LOCAL_BRIDGE");
  assert.equal(artifact?.accountHandle, "seller-one");
  assert.equal(artifact?.sessionLabel, "Primary Whatnot");
  assert.equal(artifact?.connectAttemptId, "attempt_123");
});

test("isWhatnotBrowserRuntimeEnabled only enables the runtime when the env flag is true", () => {
  assert.equal(isWhatnotBrowserRuntimeEnabled({ WHATNOT_BROWSER_PUBLISH_ENABLED: "true" } as NodeJS.ProcessEnv), true);
  assert.equal(isWhatnotBrowserRuntimeEnabled({ WHATNOT_BROWSER_PUBLISH_ENABLED: "false" } as NodeJS.ProcessEnv), false);
  assert.equal(isWhatnotBrowserRuntimeEnabled({} as NodeJS.ProcessEnv), false);
});

test("publishWhatnotListing returns null when the browser runtime is disabled", async () => {
  const originalFlag = process.env.WHATNOT_BROWSER_PUBLISH_ENABLED;
  process.env.WHATNOT_BROWSER_PUBLISH_ENABLED = "false";

  try {
    const result = await publishWhatnotListing({
      inventoryItemId: "item_123",
      sku: "SKU-123",
      quantity: 1,
      title: "Vintage Tee",
      description: "Soft cotton tee",
      price: 19.99,
      images: ["https://cdn.example.com/item-1.jpg"],
      category: "Tops",
      condition: "Good used condition",
      brand: "Nike",
      attributes: {},
      marketplaceAccount: {
        id: "acct_123",
        platform: "WHATNOT",
        displayName: "Main Whatnot account",
        secretRef: "db-session://whatnot/workspace/attempt",
        credentialType: "SECRET_REF",
        validationStatus: "VALID",
        externalAccountId: "whatnot:seller",
        credentialMetadata: null,
        credentialPayload: {
          helperSessionArtifact: {
            captureMode: "LOCAL_BRIDGE",
            capturedAt: "2026-04-04T07:00:00.000Z",
            validatedAt: "2026-04-04T07:01:00.000Z",
            accountHandle: "seller-one",
            sessionLabel: "Primary Whatnot",
            connectAttemptId: "attempt_123",
            cookieCount: 4,
            origin: "https://www.whatnot.com",
            storageStateJson: {
              cookies: [{ name: "wn_session", value: "abc", domain: ".whatnot.com" }],
              origins: [{ origin: "https://www.whatnot.com", localStorage: [] }]
            }
          }
        }
      }
    });

    assert.equal(result, null);
  } finally {
    if (originalFlag === undefined) {
      delete process.env.WHATNOT_BROWSER_PUBLISH_ENABLED;
    } else {
      process.env.WHATNOT_BROWSER_PUBLISH_ENABLED = originalFlag;
    }
  }
});
