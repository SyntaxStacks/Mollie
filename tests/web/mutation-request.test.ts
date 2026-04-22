import assert from "node:assert/strict";
import test from "node:test";

import { buildAuthedJsonMutationInit } from "../../apps/web/lib/mutation-request";

test("item detail no-payload mutations send a parseable JSON object", () => {
  const init = buildAuthedJsonMutationInit("test-token");
  const headers = init.headers as Headers;

  assert.equal(init.method, "POST");
  assert.equal(headers.get("authorization"), "Bearer test-token");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(init.body, "{}");
});

test("item detail payload mutations preserve the provided body", () => {
  const init = buildAuthedJsonMutationInit("test-token", { platforms: ["DEPOP"] });

  assert.equal(init.body, JSON.stringify({ platforms: ["DEPOP"] }));
});
