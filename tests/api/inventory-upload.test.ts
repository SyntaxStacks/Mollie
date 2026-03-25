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
process.env.STORAGE_BACKEND ??= "local";

type AppModule = typeof import("../../apps/api/src/index.js");
type DbModule = typeof import("@reselleros/db");

let app: Awaited<ReturnType<AppModule["buildApiApp"]>>;
let db: DbModule["db"];
const createdEmails = new Set<string>();

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX4sAAAAASUVORK5CYII=",
  "base64"
);

function buildHeaders(token: string, workspaceId?: string) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`
  };

  if (workspaceId) {
    headers["x-workspace-id"] = workspaceId;
  }

  return headers;
}

function buildMultipartPayload(input: { position: number; filename: string; contentType: string; file: Buffer }) {
  const boundary = `----reselleros-${crypto.randomUUID()}`;
  const chunks = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="position"\r\n\r\n${input.position}\r\n`, "utf8"),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${input.filename}"\r\nContent-Type: ${input.contentType}\r\n\r\n`,
      "utf8"
    ),
    input.file,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
  ];

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

async function createWorkspaceSession(label: string) {
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

test("inventory image upload stores a local object and creates an image asset", async () => {
  const session = await createWorkspaceSession("inventory-upload");

  const createInventoryResponse = await app.inject({
    method: "POST",
    url: "/api/inventory",
    headers: session.headers,
    payload: {
      title: "Uploaded Photo Item",
      category: "Apparel",
      condition: "New with tags",
      quantity: 1,
      costBasis: 12,
      attributes: {}
    }
  });

  assert.equal(createInventoryResponse.statusCode, 200);
  const item = (createInventoryResponse.json() as { item: { id: string } }).item;
  const multipart = buildMultipartPayload({
    position: 0,
    filename: "pilot-photo.png",
    contentType: "image/png",
    file: tinyPng
  });

  const uploadResponse = await app.inject({
    method: "POST",
    url: `/api/inventory/${item.id}/images/upload`,
    headers: {
      ...session.headers,
      "content-type": multipart.contentType
    },
    payload: multipart.body
  });

  assert.equal(uploadResponse.statusCode, 200);
  const image = uploadResponse.json<{ image: { id: string; url: string; position: number } }>().image;
  assert.ok(image.id);
  assert.equal(image.position, 0);
  assert.match(image.url, /\/api\/uploads\/workspaces\//i);

  const itemDetailResponse = await app.inject({
    method: "GET",
    url: `/api/inventory/${item.id}`,
    headers: session.headers
  });

  assert.equal(itemDetailResponse.statusCode, 200);
  const itemDetail = itemDetailResponse.json<{ item: { images: Array<{ id: string; url: string }> } }>().item;
  assert.equal(itemDetail.images.length, 1);
  assert.equal(itemDetail.images[0]?.id, image.id);

  const uploadedPath = new URL(image.url).pathname;
  const fetchUploadedResponse = await app.inject({
    method: "GET",
    url: uploadedPath
  });

  assert.equal(fetchUploadedResponse.statusCode, 200);
  assert.equal(fetchUploadedResponse.headers["content-type"], "image/png");
  assert.deepEqual(fetchUploadedResponse.rawPayload, tinyPng);

  const auditLog = await db.auditLog.findFirst({
    where: {
      workspaceId: session.workspaceId,
      action: "inventory.image_uploaded",
      targetId: item.id
    }
  });

  assert.ok(auditLog);
});
