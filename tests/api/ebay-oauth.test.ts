import assert from "node:assert/strict";
import { after, before, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.RESELLEROS_DISABLE_API_BOOTSTRAP = "1";
process.env.DATABASE_URL ??= "postgresql://localhost:5432/reselleros";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_API_BASE_URL ??= "http://localhost:4000";
process.env.API_PORT ??= "4000";
process.env.GCS_BUCKET_UPLOADS ??= "reselleros-test-uploads";
process.env.GCS_BUCKET_ARTIFACTS ??= "reselleros-test-artifacts";
process.env.OPENAI_MODEL ??= "gpt-4.1-mini";
process.env.EBAY_CLIENT_ID ??= "pilot-ebay-client-id";
process.env.EBAY_CLIENT_SECRET ??= "pilot-ebay-client-secret";
process.env.EBAY_REDIRECT_URI ??= "http://localhost:4000/api/marketplace-accounts/ebay/oauth/callback";
process.env.EBAY_ENVIRONMENT ??= "sandbox";
process.env.EBAY_SCOPES ??=
  "https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/commerce.identity.readonly";

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
const originalFetch = global.fetch;

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

  const createWorkspaceResponse = await app.inject({
    method: "POST",
    url: "/api/workspace",
    headers: buildHeaders(verifyBody.token),
    payload: {
      name: `${label} Workspace`
    }
  });

  assert.equal(createWorkspaceResponse.statusCode, 200);
  const workspace = (createWorkspaceResponse.json() as { workspace: { id: string } }).workspace;

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
  global.fetch = originalFetch;

  for (const email of createdEmails) {
    await db.user.deleteMany({
      where: { email }
    });
  }

  if (app) {
    await app.close();
  }

  await db.$disconnect();
});

test("ebay oauth start returns a signed authorization url for the workspace user", async () => {
  const session = await createWorkspaceSession("ebay-oauth-start");

  const response = await app.inject({
    method: "POST",
    url: "/api/marketplace-accounts/ebay/oauth/start",
    headers: session.headers,
    payload: {
      displayName: "Pilot eBay"
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    authorizeUrl: string;
    state: string;
    environment: string;
    scopes: string[];
  };

  assert.equal(body.environment, "sandbox");
  assert.ok(body.state.startsWith("ebay-oauth-v1."));
  assert.match(body.authorizeUrl, /auth\.sandbox\.ebay\.com\/oauth2\/authorize/i);

  const authorizeUrl = new URL(body.authorizeUrl);
  assert.equal(authorizeUrl.searchParams.get("client_id"), process.env.EBAY_CLIENT_ID);
  assert.equal(authorizeUrl.searchParams.get("redirect_uri"), process.env.EBAY_REDIRECT_URI);
  assert.equal(authorizeUrl.searchParams.get("response_type"), "code");
  assert.equal(authorizeUrl.searchParams.get("state"), body.state);
  assert.ok(body.scopes.includes("https://api.ebay.com/oauth/api_scope/sell.inventory"));
});

test("ebay oauth callback stores a validated encrypted token set without exposing raw secrets", async () => {
  const session = await createWorkspaceSession("ebay-oauth-callback");
  const startResponse = await app.inject({
    method: "POST",
    url: "/api/marketplace-accounts/ebay/oauth/start",
    headers: session.headers,
    payload: {
      displayName: "Pilot Seller"
    }
  });

  assert.equal(startResponse.statusCode, 200);
  const startBody = startResponse.json() as { state: string };

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/identity/v1/oauth2/token")) {
      return new Response(
        JSON.stringify({
          access_token: "live-access-token",
          token_type: "User Access Token",
          expires_in: 7200,
          refresh_token: "live-refresh-token",
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

    if (url.includes("/commerce/identity/v1/user/")) {
      return new Response(
        JSON.stringify({
          userId: "ebay-user-123",
          username: "pilot-seller"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  const callbackResponse = await app.inject({
    method: "GET",
    url: `/api/marketplace-accounts/ebay/oauth/callback?code=test-auth-code&state=${encodeURIComponent(startBody.state)}&mode=json`
  });

  assert.equal(callbackResponse.statusCode, 200);
  const callbackBody = callbackResponse.json() as {
    account: {
      id: string;
      secretRef: string | null;
      ebayState: string | null;
      publishMode: string | null;
      credentialType: string;
      validationStatus: string;
      externalAccountId: string | null;
      credentialMetadata: { username?: string; publishMode?: string } | null;
    };
  };

  assert.equal(callbackBody.account.credentialType, "OAUTH_TOKEN_SET");
  assert.equal(callbackBody.account.validationStatus, "VALID");
  assert.equal(callbackBody.account.secretRef, "db-encrypted://.../oauth");
  assert.equal(callbackBody.account.ebayState, "OAUTH_CONNECTED");
  assert.equal(callbackBody.account.publishMode, "simulated");
  assert.equal(callbackBody.account.externalAccountId, "ebay-user-123");
  assert.equal(callbackBody.account.credentialMetadata?.username, "pilot-seller");
  assert.equal(callbackBody.account.credentialMetadata?.publishMode, "foundation-only");

  const storedAccount = await db.marketplaceAccount.findFirst({
    where: {
      workspaceId: session.workspaceId,
      platform: "EBAY",
      externalAccountId: "ebay-user-123"
    }
  });

  assert.ok(storedAccount);
  assert.equal(storedAccount.validationStatus, "VALID");
  assert.equal(storedAccount.secretRef, "db-encrypted://marketplace-account/oauth");
  assert.ok(storedAccount.credentialPayloadJson);
  assert.equal(JSON.stringify(storedAccount.credentialPayloadJson).includes("live-access-token"), false);
  assert.equal(JSON.stringify(storedAccount.credentialPayloadJson).includes("live-refresh-token"), false);
});

test("marketplace account list surfaces ebay readiness for oauth refresh failures", async () => {
  const session = await createWorkspaceSession("ebay-oauth-readiness");

  await db.marketplaceAccount.create({
    data: {
      workspaceId: session.workspaceId,
      platform: "EBAY",
      displayName: "Pilot Seller",
      secretRef: "db-encrypted://marketplace-account/oauth",
      credentialType: "OAUTH_TOKEN_SET",
      validationStatus: "NEEDS_REFRESH",
      externalAccountId: "ebay-user-refresh",
      credentialMetadataJson: {
        mode: "oauth",
        username: "pilot-seller",
        publishMode: "live-api"
      },
      status: "ERROR",
      lastErrorCode: "ACCOUNT_UNAVAILABLE",
      lastErrorMessage: "Refresh token expired"
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/marketplace-accounts",
    headers: session.headers
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    accounts: Array<{
      platform: string;
      secretRef: string | null;
      ebayState: string | null;
      publishMode: string | null;
      validationStatus: string;
      lastErrorMessage: string | null;
      readiness: {
        state: string;
        status: string;
        publishMode: string;
        summary: string;
        detail: string;
      } | null;
    }>;
  };

  const ebayAccount = body.accounts.find((account) => account.platform === "EBAY");
  assert.ok(ebayAccount);
  assert.equal(ebayAccount.secretRef, "db-encrypted://.../oauth");
  assert.equal(ebayAccount.ebayState, "LIVE_ERROR");
  assert.equal(ebayAccount.publishMode, "live");
  assert.equal(ebayAccount.validationStatus, "NEEDS_REFRESH");
  assert.equal(ebayAccount.lastErrorMessage, "Refresh token expired");
  assert.equal(ebayAccount.readiness?.state, "LIVE_ERROR");
  assert.equal(ebayAccount.readiness?.status, "BLOCKED");
  assert.equal(ebayAccount.readiness?.publishMode, "live");
  assert.match(ebayAccount.readiness?.summary ?? "", /refresh token expired/i);
  assert.match(ebayAccount.readiness?.detail ?? "", /reconnect/i);
});

test("ebay oauth account can persist live defaults for operator-managed publish config", async () => {
  const session = await createWorkspaceSession("ebay-live-defaults");

  const account = await db.marketplaceAccount.create({
    data: {
      workspaceId: session.workspaceId,
      platform: "EBAY",
      displayName: "Pilot Seller",
      secretRef: "db-encrypted://marketplace-account/oauth",
      credentialType: "OAUTH_TOKEN_SET",
      validationStatus: "VALID",
      externalAccountId: "ebay-user-live-defaults",
      credentialMetadataJson: {
        mode: "oauth",
        username: "pilot-seller"
      },
      status: "CONNECTED",
      lastValidatedAt: new Date()
    }
  });

  const response = await app.inject({
    method: "PATCH",
    url: `/api/marketplace-accounts/${account.id}/ebay-live-defaults`,
    headers: session.headers,
    payload: {
      merchantLocationKey: "pilot-warehouse",
      paymentPolicyId: "payment-policy",
      returnPolicyId: "return-policy",
      fulfillmentPolicyId: "fulfillment-policy",
      marketplaceId: "EBAY_US",
      currency: "USD"
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    account: {
      credentialMetadata: {
        ebayLiveDefaults?: {
          merchantLocationKey?: string;
          paymentPolicyId?: string;
          returnPolicyId?: string;
          fulfillmentPolicyId?: string;
          marketplaceId?: string;
          currency?: string;
        };
      } | null;
    };
  };

  assert.equal(body.account.credentialMetadata?.ebayLiveDefaults?.merchantLocationKey, "pilot-warehouse");
  assert.equal(body.account.credentialMetadata?.ebayLiveDefaults?.paymentPolicyId, "payment-policy");
  assert.equal(body.account.credentialMetadata?.ebayLiveDefaults?.currency, "USD");
});
