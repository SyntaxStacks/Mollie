import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.RESELLEROS_DISABLE_API_BOOTSTRAP = "1";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/reselleros";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_API_BASE_URL ??= "http://localhost:4000";
process.env.API_PUBLIC_BASE_URL ??= "http://localhost:4000";
process.env.API_PORT ??= "4000";
process.env.GCS_BUCKET_UPLOADS ??= "reselleros-test-uploads";
process.env.GCS_BUCKET_ARTIFACTS ??= "reselleros-test-artifacts";

type AppModule = typeof import("../../apps/api/src/index.js");
type DbModule = typeof import("@reselleros/db");

type WorkspaceSession = {
  email: string;
  token: string;
  userId: string;
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

async function issueAndVerifyLogin(label: string) {
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
  const requestCodeBody = requestCodeResponse.json() as {
    devCode: string | null;
  };

  const verifyResponse = await app.inject({
    method: "POST",
    url: "/api/auth/verify-code",
    payload: {
      email,
      code: requestCodeBody.devCode
    }
  });

  assert.equal(verifyResponse.statusCode, 200);
  return {
    email,
    ...(verifyResponse.json() as {
      token: string;
      user: { id: string; email: string };
    })
  };
}

async function createWorkspaceSession(label: string): Promise<WorkspaceSession> {
  const login = await issueAndVerifyLogin(label);
  const workspaceResponse = await app.inject({
    method: "POST",
    url: "/api/workspace",
    headers: buildHeaders(login.token),
    payload: {
      name: `${label} Workspace`
    }
  });

  assert.equal(workspaceResponse.statusCode, 200);
  const workspace = (workspaceResponse.json() as { workspace: { id: string } }).workspace;

  return {
    email: login.email,
    token: login.token,
    userId: login.user.id,
    workspaceId: workspace.id,
    headers: buildHeaders(login.token, workspace.id)
  };
}

async function inviteMember(owner: WorkspaceSession, label: string) {
  const memberLogin = await issueAndVerifyLogin(label);
  const inviteResponse = await app.inject({
    method: "POST",
    url: "/api/workspace/members",
    headers: owner.headers,
    payload: {
      email: memberLogin.email,
      role: "MEMBER"
    }
  });

  assert.equal(inviteResponse.statusCode, 200);

  return {
    email: memberLogin.email,
    token: memberLogin.token,
    userId: memberLogin.user.id,
    workspaceId: owner.workspaceId,
    headers: buildHeaders(memberLogin.token, owner.workspaceId)
  } satisfies WorkspaceSession;
}

before(async () => {
  const [apiModule, dbModule] = await Promise.all([import("../../apps/api/src/index.js"), import("@reselleros/db")]);
  app = apiModule.buildApiApp();
  db = dbModule.db;
  await app.ready();
  await db.$connect();
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

test("workspace members cannot change shared automation or marketplace settings", async () => {
  const owner = await createWorkspaceSession("security-owner");
  const member = await inviteMember(owner, "security-member");
  const account = await db.marketplaceAccount.create({
    data: {
      workspaceId: owner.workspaceId,
      platform: "EBAY",
      displayName: "Protected Seller",
      status: "CONNECTED",
      secretRef: "db-encrypted://marketplace-account/oauth",
      credentialType: "OAUTH_TOKEN_SET",
      validationStatus: "VALID",
      externalAccountId: "security-ebay-account",
      credentialMetadataJson: {
        mode: "oauth",
        username: "protected-seller"
      }
    }
  });

  const [toggleResponse, disableResponse, defaultsResponse] = await Promise.all([
    app.inject({
      method: "PATCH",
      url: "/api/workspace/connector-automation",
      headers: member.headers,
      payload: {
        enabled: false
      }
    }),
    app.inject({
      method: "POST",
      url: `/api/marketplace-accounts/${account.id}/disable`,
      headers: member.headers
    }),
    app.inject({
      method: "PATCH",
      url: `/api/marketplace-accounts/${account.id}/ebay-live-defaults`,
      headers: member.headers,
      payload: {
        merchantLocationKey: "blocked-member-write"
      }
    })
  ]);

  assert.equal(toggleResponse.statusCode, 403);
  assert.equal(disableResponse.statusCode, 403);
  assert.equal(defaultsResponse.statusCode, 403);
  assert.match(toggleResponse.json<{ error: string }>().error, /only workspace owners/i);
  assert.match(disableResponse.json<{ error: string }>().error, /only workspace owners/i);
  assert.match(defaultsResponse.json<{ error: string }>().error, /only workspace owners/i);
});

test("url preview rejects private-network targets", async () => {
  const session = await createWorkspaceSession("security-ssrf");

  const response = await app.inject({
    method: "POST",
    url: "/api/imports/url/preview",
    headers: session.headers,
    payload: {
      sourcePlatform: "EBAY",
      url: "http://127.0.0.1/internal"
    }
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json<{ error: string }>().error, /public host/i);
});

test("audit logs omit raw eBay deletion notification secrets", async () => {
  const session = await createWorkspaceSession("security-audit");
  const account = await db.marketplaceAccount.create({
    data: {
      workspaceId: session.workspaceId,
      platform: "EBAY",
      displayName: "Audit Seller",
      status: "CONNECTED",
      secretRef: "db-encrypted://marketplace-account/oauth",
      credentialType: "OAUTH_TOKEN_SET",
      validationStatus: "VALID",
      externalAccountId: "audit-ebay-user",
      credentialMetadataJson: {
        mode: "oauth",
        username: "audit-seller"
      }
    }
  });

  const notificationId = randomUUID();
  const deletionResponse = await app.inject({
    method: "POST",
    url: "/api/ebay/marketplace-account-deletion",
    payload: {
      metadata: {
        topic: "MARKETPLACE_ACCOUNT_DELETION",
        schemaVersion: "1.0",
        deprecated: false
      },
      notification: {
        notificationId,
        eventDate: new Date().toISOString(),
        publishDate: new Date().toISOString(),
        publishAttemptCount: 1,
        data: {
          username: "audit-seller",
          userId: "audit-ebay-user",
          eiasToken: "secret-token-value"
        }
      }
    }
  });

  assert.equal(deletionResponse.statusCode, 204);

  const logsResponse = await app.inject({
    method: "GET",
    url: "/api/audit-logs",
    headers: session.headers
  });

  assert.equal(logsResponse.statusCode, 200);
  const logs = logsResponse.json() as {
    logs: Array<{
      action: string;
      targetId: string;
      metadata: Record<string, unknown> | null;
    }>;
  };
  const auditLog = logs.logs.find((entry) => entry.action === "marketplace.ebay.account_deleted" && entry.targetId === account.id);

  assert.ok(auditLog);
  assert.equal(auditLog?.metadata?.notificationId, notificationId);
  assert.equal(auditLog?.metadata?.hasEiasToken, true);
  assert.equal("eiasToken" in (auditLog?.metadata ?? {}), false);
  assert.equal("rawNotification" in (auditLog?.metadata ?? {}), false);
});
