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

type AppModule = typeof import("../../apps/api/src/index.js");
type DbModule = typeof import("@reselleros/db");

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
    email: string;
    expiresAt: string;
    devCode: string | null;
  };

  assert.equal(requestCodeBody.email, email);
  assert.ok(Date.parse(requestCodeBody.expiresAt) > 0);
  assert.ok(requestCodeBody.devCode, "test mode should return a development code");

  const verifyResponse = await app.inject({
    method: "POST",
    url: "/api/auth/verify-code",
    payload: {
      email,
      code: requestCodeBody.devCode
    }
  });

  assert.equal(verifyResponse.statusCode, 200);
  const verifyBody = verifyResponse.json() as {
    token: string;
    user: { id: string; email: string; name: string };
    workspace: { id: string; name: string } | null;
    workspaces: Array<{ id: string; name: string }>;
  };

  assert.ok(verifyBody.token);
  assert.equal(verifyBody.user.email, email);
  assert.equal(verifyBody.workspace, null);
  assert.deepEqual(verifyBody.workspaces, []);

  return {
    email,
    token: verifyBody.token,
    userId: verifyBody.user.id
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

test("onboarding bootstrap keeps auth and workspace state consistent before and after workspace creation", async () => {
  const session = await issueAndVerifyLogin("onboarding-bootstrap");

  const meBeforeWorkspace = await app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: buildHeaders(session.token)
  });

  assert.equal(meBeforeWorkspace.statusCode, 200);
  const meBeforeBody = meBeforeWorkspace.json() as {
    user: { id: string; email: string };
    workspace: null;
    workspaces: Array<unknown>;
  };
  assert.equal(meBeforeBody.user.id, session.userId);
  assert.equal(meBeforeBody.user.email, session.email);
  assert.equal(meBeforeBody.workspace, null);
  assert.deepEqual(meBeforeBody.workspaces, []);

  const workspaceBeforeCreate = await app.inject({
    method: "GET",
    url: "/api/workspace",
    headers: buildHeaders(session.token)
  });

  assert.equal(workspaceBeforeCreate.statusCode, 200);
  assert.deepEqual(
    workspaceBeforeCreate.json() as {
      workspace: null;
      workspaces: Array<unknown>;
    },
    {
      workspace: null,
      workspaces: []
    }
  );

  const createWorkspaceResponse = await app.inject({
    method: "POST",
    url: "/api/workspace",
    headers: buildHeaders(session.token),
    payload: {
      name: "Pilot Workspace"
    }
  });

  assert.equal(createWorkspaceResponse.statusCode, 200);
  const workspace = (createWorkspaceResponse.json() as {
    workspace: { id: string; name: string; plan: string; billingCustomerId: string | null };
  }).workspace;

  assert.ok(workspace.id);
  assert.equal(workspace.name, "Pilot Workspace");

  const meAfterWorkspace = await app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: buildHeaders(session.token, workspace.id)
  });

  assert.equal(meAfterWorkspace.statusCode, 200);
  const meBody = meAfterWorkspace.json() as {
    user: { id: string; email: string };
    workspace: { id: string; name: string; plan: string };
    workspaces: Array<{ id: string; name: string; plan: string }>;
  };

  assert.equal(meBody.user.id, session.userId);
  assert.equal(meBody.user.email, session.email);
  assert.equal(meBody.workspace.id, workspace.id);
  assert.equal(meBody.workspaces.length, 1);
  assert.equal(meBody.workspaces[0]?.id, workspace.id);

  const workspaceAfterCreate = await app.inject({
    method: "GET",
    url: "/api/workspace",
    headers: buildHeaders(session.token, workspace.id)
  });

  assert.equal(workspaceAfterCreate.statusCode, 200);
  const workspaceBody = workspaceAfterCreate.json() as {
    workspace: { id: string; name: string; connectorAutomationEnabled?: boolean };
    workspaces: Array<{ id: string }>;
  };

  assert.equal(workspaceBody.workspace.id, workspace.id);
  assert.equal(workspaceBody.workspace.name, "Pilot Workspace");
  assert.equal(workspaceBody.workspaces.length, 1);

  const auditLog = await db.auditLog.findFirst({
    where: {
      workspaceId: workspace.id,
      actorUserId: session.userId,
      action: "workspace.created"
    }
  });

  assert.ok(auditLog);
});

test("pilot bootstrap rejects creating a second workspace for the same operator", async () => {
  const session = await issueAndVerifyLogin("workspace-singleton");

  const firstWorkspaceResponse = await app.inject({
    method: "POST",
    url: "/api/workspace",
    headers: buildHeaders(session.token),
    payload: {
      name: "Primary Workspace"
    }
  });

  assert.equal(firstWorkspaceResponse.statusCode, 200);

  const secondWorkspaceResponse = await app.inject({
    method: "POST",
    url: "/api/workspace",
    headers: buildHeaders(session.token),
    payload: {
      name: "Second Workspace"
    }
  });

  assert.equal(secondWorkspaceResponse.statusCode, 409);
  assert.match(secondWorkspaceResponse.json<{ error: string }>().error, /already has a workspace/i);
});
