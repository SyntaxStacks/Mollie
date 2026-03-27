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
  const verifyBody = verifyResponse.json() as {
    token: string;
    user: { id: string; email: string };
    workspace: { id: string; name: string } | null;
    workspaces: Array<{ id: string; name: string }>;
  };

  return {
    email,
    token: verifyBody.token,
    userId: verifyBody.user.id,
    workspace: verifyBody.workspace,
    workspaces: verifyBody.workspaces
  };
}

async function createWorkspace(token: string, name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/workspace",
    headers: buildHeaders(token),
    payload: { name }
  });

  assert.equal(response.statusCode, 200);

  return (response.json() as {
    workspace: { id: string; name: string };
  }).workspace;
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

test("workspace owners can add members and invited users land in the shared workspace", async () => {
  const owner = await issueAndVerifyLogin("workspace-owner");
  const workspace = await createWorkspace(owner.token, "Shared Workspace");

  const listBeforeResponse = await app.inject({
    method: "GET",
    url: "/api/workspace/members",
    headers: buildHeaders(owner.token, workspace.id)
  });

  assert.equal(listBeforeResponse.statusCode, 200);
  const beforeBody = listBeforeResponse.json() as {
    canManageMembers: boolean;
    members: Array<{ user: { email: string } }>;
  };
  assert.equal(beforeBody.canManageMembers, true);
  assert.equal(beforeBody.members.length, 1);
  assert.equal(beforeBody.members[0]?.user.email, owner.email);

  const inviteEmail = `teammate-${Date.now()}@example.com`;
  createdEmails.add(inviteEmail);

  const addMemberResponse = await app.inject({
    method: "POST",
    url: "/api/workspace/members",
    headers: buildHeaders(owner.token, workspace.id),
    payload: {
      email: inviteEmail,
      name: "Teammate",
      role: "MEMBER"
    }
  });

  assert.equal(addMemberResponse.statusCode, 200);

  const listAfterResponse = await app.inject({
    method: "GET",
    url: "/api/workspace/members",
    headers: buildHeaders(owner.token, workspace.id)
  });

  assert.equal(listAfterResponse.statusCode, 200);
  const afterBody = listAfterResponse.json() as {
    members: Array<{ user: { email: string }; role: string }>;
  };
  assert.equal(afterBody.members.length, 2);
  assert.ok(afterBody.members.some((member) => member.user.email === inviteEmail && member.role === "MEMBER"));

  const duplicateInviteResponse = await app.inject({
    method: "POST",
    url: "/api/workspace/members",
    headers: buildHeaders(owner.token, workspace.id),
    payload: {
      email: inviteEmail,
      role: "MEMBER"
    }
  });

  assert.equal(duplicateInviteResponse.statusCode, 409);

  const invitedLoginRequest = await app.inject({
    method: "POST",
    url: "/api/auth/request-code",
    payload: {
      email: inviteEmail,
      name: "Teammate"
    }
  });

  assert.equal(invitedLoginRequest.statusCode, 200);
  const invitedChallenge = invitedLoginRequest.json() as { devCode: string | null };

  const invitedVerifyResponse = await app.inject({
    method: "POST",
    url: "/api/auth/verify-code",
    payload: {
      email: inviteEmail,
      code: invitedChallenge.devCode
    }
  });

  assert.equal(invitedVerifyResponse.statusCode, 200);
  const invitedVerifyBody = invitedVerifyResponse.json() as {
    workspace: { id: string; name: string } | null;
    workspaces: Array<{ id: string; name: string }>;
  };

  assert.equal(invitedVerifyBody.workspace?.id, workspace.id);
  assert.equal(invitedVerifyBody.workspaces.length, 1);

  const auditLog = await db.auditLog.findFirst({
    where: {
      workspaceId: workspace.id,
      actorUserId: owner.userId,
      action: "workspace.member.added"
    }
  });

  assert.ok(auditLog);
});

test("workspace members cannot add other members", async () => {
  const owner = await issueAndVerifyLogin("workspace-owner-role-check");
  const workspace = await createWorkspace(owner.token, "Owner Restricted Workspace");

  const memberEmail = `member-${Date.now()}@example.com`;
  createdEmails.add(memberEmail);

  const inviteResponse = await app.inject({
    method: "POST",
    url: "/api/workspace/members",
    headers: buildHeaders(owner.token, workspace.id),
    payload: {
      email: memberEmail,
      role: "MEMBER"
    }
  });

  assert.equal(inviteResponse.statusCode, 200);

  const memberRequestCodeResponse = await app.inject({
    method: "POST",
    url: "/api/auth/request-code",
    payload: {
      email: memberEmail,
      name: "Member"
    }
  });

  assert.equal(memberRequestCodeResponse.statusCode, 200);
  const memberChallenge = memberRequestCodeResponse.json() as { devCode: string | null };

  const memberVerifyResponse = await app.inject({
    method: "POST",
    url: "/api/auth/verify-code",
    payload: {
      email: memberEmail,
      code: memberChallenge.devCode
    }
  });

  assert.equal(memberVerifyResponse.statusCode, 200);
  const memberSession = memberVerifyResponse.json() as { token: string };

  const forbiddenResponse = await app.inject({
    method: "POST",
    url: "/api/workspace/members",
    headers: buildHeaders(memberSession.token, workspace.id),
    payload: {
      email: `third-${Date.now()}@example.com`,
      role: "MEMBER"
    }
  });

  assert.equal(forbiddenResponse.statusCode, 403);
  assert.match(forbiddenResponse.json<{ error: string }>().error, /only workspace owners/i);
});
