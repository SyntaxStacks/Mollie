import assert from "node:assert/strict";
import { after, before, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.RESELLEROS_DISABLE_API_BOOTSTRAP = "1";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/reselleros";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_API_BASE_URL ??= "http://localhost:4000";
process.env.API_PORT ??= "4000";
process.env.GCS_BUCKET_UPLOADS ??= "reselleros-test-uploads";
process.env.GCS_BUCKET_ARTIFACTS ??= "reselleros-test-artifacts";

type AppModule = typeof import("../../apps/api/src/index.js");
type DbModule = typeof import("@reselleros/db");

type WorkspaceSession = {
  email: string;
  token: string;
  workspaceId: string;
  headers: Record<string, string>;
};

let app: Awaited<ReturnType<AppModule["buildApiApp"]>>;
let db: DbModule["db"];
const createdEmails = new Set<string>();

function buildHeaders(token: string, workspaceId?: string) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`
  };

  if (workspaceId) {
    headers["x-workspace-id"] = workspaceId;
  }

  return headers;
}

async function createWorkspaceSession(label: string): Promise<WorkspaceSession> {
  const email = `${label}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  createdEmails.add(email);

  const requestCodeResponse = await app.inject({
    method: "POST",
    url: "/api/auth/request-code",
    payload: {
      email,
      name: label
    }
  });

  assert.equal(requestCodeResponse.statusCode, 200);
  const requestCodeBody = requestCodeResponse.json() as { devCode: string | null };
  assert.ok(requestCodeBody.devCode);

  const verifyResponse = await app.inject({
    method: "POST",
    url: "/api/auth/verify-code",
    payload: {
      email,
      code: requestCodeBody.devCode
    }
  });

  assert.equal(verifyResponse.statusCode, 200);
  const verifyBody = verifyResponse.json() as { token: string };

  const workspaceResponse = await app.inject({
    method: "POST",
    url: "/api/workspace",
    headers: buildHeaders(verifyBody.token),
    payload: {
      name: `${label} Workspace`
    }
  });

  assert.equal(workspaceResponse.statusCode, 200);
  const workspace = (workspaceResponse.json() as { workspace: { id: string } }).workspace;

  return {
    email,
    token: verifyBody.token,
    workspaceId: workspace.id,
    headers: buildHeaders(verifyBody.token, workspace.id)
  };
}

before(async () => {
  const [apiModule, dbModule] = await Promise.all([import("../../apps/api/src/index.js"), import("@reselleros/db")]);
  app = apiModule.buildApiApp();
  db = dbModule.db;
  await app.ready();
  await db.$connect();
  await db.$queryRaw`SELECT 1`;
});

after(async () => {
  for (const email of createdEmails) {
    await db.user.deleteMany({
      where: { email }
    });
  }

  if (app) {
    await app.close();
  }

  if (db) {
    await db.$disconnect();
  }
});

test("production blocks simulated automation vendor sign-in", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllow = process.env.ALLOW_SIMULATED_MARKETPLACE_PATHS;
  const originalExpose = process.env.AUTH_EXPOSE_DEV_CODE;
  process.env.NODE_ENV = "production";
  process.env.ALLOW_SIMULATED_MARKETPLACE_PATHS = "false";
  process.env.AUTH_EXPOSE_DEV_CODE = "true";

  try {
    const session = await createWorkspaceSession("vendor-connect-production-blocked");

    const startResponse = await app.inject({
      method: "POST",
      url: "/api/marketplace-accounts/DEPOP/connect/start",
      headers: session.headers,
      payload: {
        displayName: "Main Depop shop"
      }
    });

    assert.equal(startResponse.statusCode, 503);
    const body = startResponse.json() as { error: string };
    assert.match(body.error, /not live in production yet/i);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllow === undefined) {
      delete process.env.ALLOW_SIMULATED_MARKETPLACE_PATHS;
    } else {
      process.env.ALLOW_SIMULATED_MARKETPLACE_PATHS = originalAllow;
    }
    if (originalExpose === undefined) {
      delete process.env.AUTH_EXPOSE_DEV_CODE;
    } else {
      process.env.AUTH_EXPOSE_DEV_CODE = originalExpose;
    }
  }
});

test("automation vendor connect flow starts and completes after session validation", async () => {
  const session = await createWorkspaceSession("vendor-connect-success");

  const startResponse = await app.inject({
    method: "POST",
    url: "/api/marketplace-accounts/DEPOP/connect/start",
    headers: session.headers,
    payload: {
      displayName: "Main Depop shop"
    }
  });

  assert.equal(startResponse.statusCode, 200);
  const startBody = startResponse.json() as {
    attempt: {
      id: string;
      state: string;
      helperNonce: string;
      helperLaunchUrl: string;
    };
  };

  assert.equal(startBody.attempt.state, "AWAITING_LOGIN");
  assert.match(startBody.attempt.helperLaunchUrl, /connect-helper/i);

  const sessionCaptureResponse = await app.inject({
    method: "POST",
    url: `/api/marketplace-accounts/DEPOP/connect/${startBody.attempt.id}/session`,
    headers: session.headers,
    payload: {
      helperNonce: startBody.attempt.helperNonce,
      accountHandle: "depop-seller",
      sessionLabel: "Main Depop shop",
      captureMode: "WEB_POPUP_HELPER",
      challengeRequired: false
    }
  });

  assert.equal(sessionCaptureResponse.statusCode, 200);
  const sessionCaptureBody = sessionCaptureResponse.json() as {
    attempt: { state: string; marketplaceAccountId: string | null };
    account: {
      id: string;
      platform: string;
      credentialType: string;
      validationStatus: string;
      credentialMetadata?: { mode?: string; accountHandle?: string; publishMode?: string } | null;
    } | null;
  };

  assert.equal(sessionCaptureBody.attempt.state, "CONNECTED");
  assert.ok(sessionCaptureBody.account);
  assert.equal(sessionCaptureBody.account?.platform, "DEPOP");
  assert.equal(sessionCaptureBody.account?.credentialType, "SECRET_REF");
  assert.equal(sessionCaptureBody.account?.validationStatus, "VALID");
  assert.equal(sessionCaptureBody.account?.credentialMetadata?.mode, "helper-session-artifact");
  assert.equal(sessionCaptureBody.account?.credentialMetadata?.accountHandle, "Main Depop shop");
  assert.equal(sessionCaptureBody.account?.credentialMetadata?.publishMode, "automation");
});

test("automation vendor connect flow supports inline challenge before connection", async () => {
  const session = await createWorkspaceSession("vendor-connect-challenge");

  const startResponse = await app.inject({
    method: "POST",
    url: "/api/marketplace-accounts/POSHMARK/connect/start",
    headers: session.headers,
    payload: {
      displayName: "Main Poshmark closet"
    }
  });

  assert.equal(startResponse.statusCode, 200);
  const startBody = startResponse.json() as {
    attempt: { id: string; helperNonce: string };
  };

  const sessionCaptureResponse = await app.inject({
    method: "POST",
    url: `/api/marketplace-accounts/POSHMARK/connect/${startBody.attempt.id}/session`,
    headers: session.headers,
    payload: {
      helperNonce: startBody.attempt.helperNonce,
      accountHandle: "poshmark-closet",
      sessionLabel: "Main Poshmark closet",
      captureMode: "WEB_POPUP_HELPER",
      challengeRequired: true
    }
  });

  assert.equal(sessionCaptureResponse.statusCode, 200);
  const sessionCaptureBody = sessionCaptureResponse.json() as {
    attempt: { state: string };
  };
  assert.equal(sessionCaptureBody.attempt.state, "AWAITING_2FA");

  const challengeResponse = await app.inject({
    method: "POST",
    url: `/api/marketplace-accounts/POSHMARK/connect/${startBody.attempt.id}/challenge`,
    headers: session.headers,
    payload: {
      code: "123456",
      method: "SMS"
    }
  });

  assert.equal(challengeResponse.statusCode, 200);
  const challengeBody = challengeResponse.json() as {
    attempt: { state: string };
    account: { id: string; platform: string } | null;
  };
  assert.equal(challengeBody.attempt.state, "CONNECTED");
  assert.equal(challengeBody.account?.platform, "POSHMARK");
});

test("automation vendor validation failure keeps the attempt failed and does not connect an account", async () => {
  const session = await createWorkspaceSession("vendor-connect-invalid");

  const startResponse = await app.inject({
    method: "POST",
    url: "/api/marketplace-accounts/WHATNOT/connect/start",
    headers: session.headers,
    payload: {
      displayName: "Main Whatnot account"
    }
  });

  assert.equal(startResponse.statusCode, 200);
  const startBody = startResponse.json() as {
    attempt: { id: string; helperNonce: string };
  };

  const sessionCaptureResponse = await app.inject({
    method: "POST",
    url: `/api/marketplace-accounts/WHATNOT/connect/${startBody.attempt.id}/session`,
    headers: session.headers,
    payload: {
      helperNonce: startBody.attempt.helperNonce,
      accountHandle: "invalid-whatnot-session",
      sessionLabel: "Main Whatnot account",
      captureMode: "WEB_POPUP_HELPER",
      challengeRequired: false
    }
  });

  assert.equal(sessionCaptureResponse.statusCode, 200);
  const body = sessionCaptureResponse.json() as {
    attempt: { state: string; lastErrorCode?: string | null };
    account: null;
  };

  assert.equal(body.attempt.state, "FAILED");
  assert.equal(body.account, null);

  const accounts = await db.marketplaceAccount.findMany({
    where: {
      workspaceId: session.workspaceId,
      platform: "WHATNOT"
    }
  });
  assert.equal(accounts.length, 0);
});

test("reconnect reuses the same marketplace account when the display name matches", async () => {
  const session = await createWorkspaceSession("vendor-connect-reconnect");

  for (const handle of ["depop-seller-one", "depop-seller-two"]) {
    const startResponse = await app.inject({
      method: "POST",
      url: "/api/marketplace-accounts/DEPOP/connect/start",
      headers: session.headers,
      payload: {
        displayName: "Main Depop shop"
      }
    });

    assert.equal(startResponse.statusCode, 200);
    const startBody = startResponse.json() as {
      attempt: { id: string; helperNonce: string };
    };

    const sessionCaptureResponse = await app.inject({
      method: "POST",
      url: `/api/marketplace-accounts/DEPOP/connect/${startBody.attempt.id}/session`,
      headers: session.headers,
      payload: {
        helperNonce: startBody.attempt.helperNonce,
        accountHandle: handle,
        sessionLabel: "Main Depop shop",
        captureMode: "WEB_POPUP_HELPER",
        challengeRequired: false
      }
    });

    assert.equal(sessionCaptureResponse.statusCode, 200);
  }

  const accounts = await db.marketplaceAccount.findMany({
    where: {
      workspaceId: session.workspaceId,
      platform: "DEPOP"
    }
  });

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0]?.displayName, "Main Depop shop");
});
