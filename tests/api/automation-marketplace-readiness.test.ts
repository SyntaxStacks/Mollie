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

test("automation marketplace accounts surface ready and error readiness states", async () => {
  const session = await createWorkspaceSession("automation-readiness");

  const [poshmarkResponse, whatnotResponse] = await Promise.all([
    app.inject({
      method: "POST",
      url: "/api/marketplace-accounts/poshmark/session",
      headers: session.headers,
      payload: {
        displayName: "Main Poshmark closet",
        secretRef: "secret://poshmark/session"
      }
    }),
    app.inject({
      method: "POST",
      url: "/api/marketplace-accounts/whatnot/session",
      headers: session.headers,
      payload: {
        displayName: "Main Whatnot account",
        secretRef: "secret://whatnot/session"
      }
    })
  ]);

  assert.equal(poshmarkResponse.statusCode, 200);
  assert.equal(whatnotResponse.statusCode, 200);

  const whatnotAccountId = ((whatnotResponse.json() as { account: { id: string } }).account.id);
  await db.marketplaceAccount.update({
    where: { id: whatnotAccountId },
    data: {
      status: "ERROR",
      lastErrorCode: "AUTOMATION_FAILED",
      lastErrorMessage: "Whatnot browser session expired"
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
      connectorDescriptor?: {
        executionMode: string;
        fallbackMode: string;
        riskLevel: string;
        supportedFeatureFamilies: Array<{
          family: string;
          support: string;
        }>;
      } | null;
      readiness: {
        state: string;
        status: string;
        publishMode: string;
        summary: string;
        detail: string;
        hint?: {
          title: string;
          explanation: string;
          severity: string;
          nextActions: string[];
          routeTarget?: string | null;
          featureFamily?: string | null;
          canContinue?: boolean;
          helpText?: string | null;
        } | null;
      } | null;
    }>;
  };

  const poshmark = body.accounts.find((account) => account.platform === "POSHMARK");
  const whatnot = body.accounts.find((account) => account.platform === "WHATNOT");

  assert.ok(poshmark?.readiness);
  assert.equal(poshmark.readiness.state, "AUTOMATION_READY");
  assert.equal(poshmark.readiness.status, "READY");
  assert.equal(poshmark.readiness.publishMode, "automation");
  assert.equal(poshmark.readiness.hint?.severity, "SUCCESS");
  assert.equal(poshmark.readiness.hint?.featureFamily, "POSHMARK_SOCIAL");
  assert.equal(poshmark.readiness.hint?.canContinue, true);
  assert.match(poshmark.readiness.hint?.title ?? "", /ready/i);
  assert.equal(poshmark.connectorDescriptor?.executionMode, "SIMULATED");
  assert.equal(poshmark.connectorDescriptor?.fallbackMode, "MANUAL");
  assert.equal(poshmark.connectorDescriptor?.riskLevel, "HIGH");
  assert.equal(poshmark.connectorDescriptor?.supportedFeatureFamilies[0]?.family, "POSHMARK_SOCIAL");

  assert.ok(whatnot?.readiness);
  assert.equal(whatnot.readiness.state, "AUTOMATION_ERROR");
  assert.equal(whatnot.readiness.status, "BLOCKED");
  assert.match(whatnot.readiness.summary, /whatnot browser session expired/i);
  assert.equal(whatnot.readiness.hint?.severity, "ERROR");
  assert.equal(whatnot.readiness.hint?.featureFamily, "WHATNOT_LIVE_SELLING");
  assert.equal(whatnot.readiness.hint?.routeTarget, "/marketplaces");
  assert.match(whatnot.readiness.hint?.explanation ?? "", /session expired/i);
  assert.equal(whatnot.connectorDescriptor?.executionMode, "SIMULATED");
  assert.equal(whatnot.connectorDescriptor?.supportedFeatureFamilies[0]?.family, "WHATNOT_LIVE_SELLING");
});

test("workspace connector automation disable blocks automation market readiness", async () => {
  const session = await createWorkspaceSession("automation-blocked");

  const depopResponse = await app.inject({
    method: "POST",
    url: "/api/marketplace-accounts/depop/session",
    headers: session.headers,
    payload: {
      displayName: "Main Depop shop",
      secretRef: "secret://depop/session"
    }
  });

  assert.equal(depopResponse.statusCode, 200);

  const disableAutomationResponse = await app.inject({
    method: "PATCH",
    url: "/api/workspace/connector-automation",
    headers: session.headers,
    payload: {
      enabled: false
    }
  });

  assert.equal(disableAutomationResponse.statusCode, 200);

  const response = await app.inject({
    method: "GET",
    url: "/api/marketplace-accounts",
    headers: session.headers
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    accounts: Array<{
      platform: string;
      readiness: {
        state: string;
        status: string;
        publishMode: string;
        summary: string;
        detail: string;
        hint?: {
          title: string;
          explanation: string;
          severity: string;
          nextActions: string[];
        } | null;
      } | null;
    }>;
  };

  const depop = body.accounts.find((account) => account.platform === "DEPOP");
  assert.ok(depop?.readiness);
  assert.equal(depop.readiness.state, "AUTOMATION_BLOCKED");
  assert.equal(depop.readiness.status, "BLOCKED");
  assert.equal(depop.readiness.publishMode, "automation");
  assert.match(depop.readiness.detail, /re-enable workspace connector automation/i);
  assert.equal(depop.readiness.hint?.severity, "ERROR");
  assert.match(depop.readiness.hint?.title ?? "", /turned back on/i);
  assert.ok(depop.readiness.hint?.nextActions.some((action) => /workspace settings/i.test(action)));
});
