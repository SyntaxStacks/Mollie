import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.EBAY_CLIENT_ID ??= "pilot-ebay-client-id";
process.env.EBAY_CLIENT_SECRET ??= "pilot-ebay-client-secret";
process.env.EBAY_REDIRECT_URI ??= "http://localhost:4000/api/marketplace-accounts/ebay/oauth/callback";
process.env.EBAY_ENVIRONMENT ??= "sandbox";

type EbayModule = typeof import("../../packages/marketplaces-ebay/src/index.js");
type DepopModule = typeof import("../../packages/marketplaces-depop/src/index.js");
type PoshmarkModule = typeof import("../../packages/marketplaces-poshmark/src/index.js");
type WhatnotModule = typeof import("../../packages/marketplaces-whatnot/src/index.js");

let ebayAdapter: EbayModule["ebayAdapter"];
let depopAdapter: DepopModule["depopAdapter"];
let poshmarkAdapter: PoshmarkModule["poshmarkAdapter"];
let whatnotAdapter: WhatnotModule["whatnotAdapter"];

before(async () => {
  const [ebayModule, depopModule, poshmarkModule, whatnotModule] = await Promise.all([
    import("../../packages/marketplaces-ebay/src/index.js"),
    import("../../packages/marketplaces-depop/src/index.js"),
    import("../../packages/marketplaces-poshmark/src/index.js"),
    import("../../packages/marketplaces-whatnot/src/index.js")
  ]);

  ebayAdapter = ebayModule.ebayAdapter;
  depopAdapter = depopModule.depopAdapter;
  poshmarkAdapter = poshmarkModule.poshmarkAdapter;
  whatnotAdapter = whatnotModule.whatnotAdapter;
});

test("all marketplace adapters declare execution mode, capabilities, and feature families", () => {
  const adapters = [ebayAdapter, depopAdapter, poshmarkAdapter, whatnotAdapter];

  for (const adapter of adapters) {
    assert.equal(adapter.platform, adapter.descriptor.platform);
    assert.ok(adapter.descriptor.displayName.length > 0);
    assert.ok(adapter.descriptor.supportedCapabilities.length > 0);
  }

  assert.equal(ebayAdapter.descriptor.executionMode, "OAUTH_API");
  assert.equal(ebayAdapter.descriptor.fallbackMode, "SIMULATED");
  assert.ok(
    ebayAdapter.descriptor.supportedCapabilities.some(
      (entry) => entry.capability === "REFRESH_AUTH" && entry.support === "SUPPORTED"
    )
  );
  assert.ok(
    ebayAdapter.descriptor.supportedFeatureFamilies.some(
      (entry) => entry.family === "EBAY_POLICY_CONFIGURATION" && entry.support === "SUPPORTED"
    )
  );

  assert.equal(depopAdapter.descriptor.executionMode, "SIMULATED");
  assert.ok(
    depopAdapter.descriptor.supportedFeatureFamilies.some(
      (entry) => entry.family === "DEPOP_PROMOTION" && entry.support === "PLANNED"
    )
  );

  assert.equal(poshmarkAdapter.descriptor.executionMode, "SIMULATED");
  assert.ok(
    poshmarkAdapter.descriptor.supportedFeatureFamilies.some(
      (entry) => entry.family === "POSHMARK_SOCIAL" && entry.support === "PLANNED"
    )
  );

  assert.equal(whatnotAdapter.descriptor.executionMode, "SIMULATED");
  assert.ok(
    whatnotAdapter.descriptor.supportedFeatureFamilies.some(
      (entry) => entry.family === "WHATNOT_LIVE_SELLING" && entry.support === "PLANNED"
    )
  );
});
