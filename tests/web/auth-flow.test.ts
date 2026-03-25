import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateProtectedView, getPostLoginPath, getWorkspaceSetupRedirect } from "../../apps/web/components/auth-flow.js";

test("protected view allows the onboarding page for logged-out operators", () => {
  const decision = evaluateProtectedView({
    hydrated: true,
    token: null,
    hasWorkspace: false,
    pathname: "/onboarding"
  });

  assert.deepEqual(decision, {
    kind: "allow"
  });
});

test("protected view redirects logged-out operators away from protected routes", () => {
  const decision = evaluateProtectedView({
    hydrated: true,
    token: null,
    hasWorkspace: false,
    pathname: "/inventory"
  });

  assert.deepEqual(decision, {
    kind: "redirect",
    location: "/onboarding",
    message: "Redirecting to onboarding..."
  });
});

test("protected view redirects authenticated operators without a workspace", () => {
  const decision = evaluateProtectedView({
    hydrated: true,
    token: "pilot-token",
    hasWorkspace: false,
    pathname: "/inventory"
  });

  assert.deepEqual(decision, {
    kind: "redirect",
    location: "/workspace",
    message: "Redirecting to workspace setup..."
  });
});

test("workspace page stays accessible while authenticated operators finish setup", () => {
  const decision = evaluateProtectedView({
    hydrated: true,
    token: "pilot-token",
    hasWorkspace: false,
    pathname: "/workspace",
    requireWorkspace: false
  });

  assert.deepEqual(decision, {
    kind: "allow"
  });
});

test("post-login destination prefers workspace setup until a workspace exists", () => {
  assert.equal(getPostLoginPath(false), "/workspace");
  assert.equal(getPostLoginPath(true), "/");
});

test("workspace setup redirects home after provisioning", () => {
  assert.equal(getWorkspaceSetupRedirect(false, true), null);
  assert.equal(getWorkspaceSetupRedirect(true, false), null);
  assert.equal(getWorkspaceSetupRedirect(true, true), "/");
});
