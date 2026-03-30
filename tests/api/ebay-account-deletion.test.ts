import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.RESELLEROS_DISABLE_API_BOOTSTRAP = "1";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/reselleros";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.API_PUBLIC_BASE_URL ??= "http://localhost:4000";
process.env.API_PORT ??= "4000";
process.env.GCS_BUCKET_UPLOADS ??= "reselleros-test-uploads";
process.env.GCS_BUCKET_ARTIFACTS ??= "reselleros-test-artifacts";

type AppModule = typeof import("../../apps/api/src/index.js");
type DbModule = typeof import("@reselleros/db");

let app: Awaited<ReturnType<AppModule["buildApiApp"]>>;
let db: DbModule["db"];
const createdWorkspaceIds = new Set<string>();
const createdUserIds = new Set<string>();
const createdAccountIds = new Set<string>();

before(async () => {
  const [apiModule, dbModule] = await Promise.all([import("../../apps/api/src/index.js"), import("@reselleros/db")]);
  app = apiModule.buildApiApp();
  db = dbModule.db;
  await app.ready();
  await db.$connect();
});

after(async () => {
  for (const accountId of createdAccountIds) {
    await db.marketplaceAccount.deleteMany({ where: { id: accountId } });
  }

  for (const workspaceId of createdWorkspaceIds) {
    await db.workspace.deleteMany({ where: { id: workspaceId } });
  }

  for (const userId of createdUserIds) {
    await db.user.deleteMany({ where: { id: userId } });
  }

  if (app) {
    await app.close();
  }

  if (db) {
    await db.$disconnect();
  }
});

test("ebay marketplace account deletion challenge returns the expected response hash", async () => {
  const originalToken = process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN;
  const originalApiBaseUrl = process.env.API_PUBLIC_BASE_URL;
  process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN = "test-marketplace-deletion-token";
  process.env.API_PUBLIC_BASE_URL = "https://api.mollie.biz";

  try {
    const challengeCode = "challenge-123";
    const response = await app.inject({
      method: "GET",
      url: `/api/ebay/marketplace-account-deletion?challenge_code=${challengeCode}`
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");

    const body = response.json() as { challengeResponse: string };
    const expected = createHash("sha256")
      .update(challengeCode)
      .update("test-marketplace-deletion-token")
      .update("https://api.mollie.biz/api/ebay/marketplace-account-deletion")
      .digest("hex");

    assert.equal(body.challengeResponse, expected);
  } finally {
    process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN = originalToken;
    process.env.API_PUBLIC_BASE_URL = originalApiBaseUrl;
  }
});

test("ebay marketplace account deletion notification disables matching oauth accounts and records an audit log", async () => {
  const user = await db.user.create({
    data: {
      email: `ebay-delete-${Date.now()}@example.com`,
      name: "eBay Delete"
    }
  });
  createdUserIds.add(user.id);

  const workspace = await db.workspace.create({
    data: {
      ownerUserId: user.id,
      name: "eBay Delete Workspace"
    }
  });
  createdWorkspaceIds.add(workspace.id);

  await db.workspaceMembership.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role: "OWNER"
    }
  });

  const account = await db.marketplaceAccount.create({
    data: {
      workspaceId: workspace.id,
      platform: "EBAY",
      displayName: "Pilot eBay",
      status: "CONNECTED",
      secretRef: "db-encrypted://marketplace-account/oauth",
      credentialType: "OAUTH_TOKEN_SET",
      validationStatus: "VALID",
      externalAccountId: "ebay-user-123",
      credentialMetadataJson: {
        mode: "oauth",
        username: "pilot-seller"
      }
    }
  });
  createdAccountIds.add(account.id);

  const response = await app.inject({
    method: "POST",
    url: "/api/ebay/marketplace-account-deletion",
    payload: {
      metadata: {
        topic: "MARKETPLACE_ACCOUNT_DELETION",
        schemaVersion: "1.0",
        deprecated: false
      },
      notification: {
        notificationId: randomUUID(),
        eventDate: new Date().toISOString(),
        publishDate: new Date().toISOString(),
        publishAttemptCount: 1,
        data: {
          username: "pilot-seller",
          userId: "ebay-user-123",
          eiasToken: "token-123"
        }
      }
    }
  });

  assert.equal(response.statusCode, 204);

  const updated = await db.marketplaceAccount.findUniqueOrThrow({
    where: { id: account.id }
  });

  assert.equal(updated.status, "DISABLED");
  assert.equal(updated.validationStatus, "INVALID");
  assert.equal(updated.lastErrorCode, "EBAY_MARKETPLACE_ACCOUNT_DELETION");

  const auditLog = await db.auditLog.findFirst({
    where: {
      workspaceId: workspace.id,
      targetType: "marketplace_account",
      targetId: account.id,
      action: "marketplace.ebay.account_deleted"
    }
  });

  assert.ok(auditLog);
});
