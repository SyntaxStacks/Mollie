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

async function createInventoryItem(session: Awaited<ReturnType<typeof createWorkspaceSession>>, title: string) {
  const createInventoryResponse = await app.inject({
    method: "POST",
    url: "/api/inventory",
    headers: session.headers,
    payload: {
      title,
      category: "Apparel",
      condition: "New with tags",
      quantity: 1,
      costBasis: 12,
      attributes: {}
    }
  });

  assert.equal(createInventoryResponse.statusCode, 200);
  return (createInventoryResponse.json() as { item: { id: string } }).item;
}

async function uploadInventoryImage(
  session: Awaited<ReturnType<typeof createWorkspaceSession>>,
  itemId: string,
  options?: { position?: number; filename?: string }
) {
  const multipart = buildMultipartPayload({
    position: options?.position ?? 0,
    filename: options?.filename ?? "pilot-photo.png",
    contentType: "image/png",
    file: tinyPng
  });

  const uploadResponse = await app.inject({
    method: "POST",
    url: `/api/inventory/${itemId}/images/upload`,
    headers: {
      ...session.headers,
      "content-type": multipart.contentType
    },
    payload: multipart.body
  });

  assert.equal(uploadResponse.statusCode, 200);
  return uploadResponse.json<{ image: { id: string; url: string; position: number } }>().image;
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
  const item = await createInventoryItem(session, "Uploaded Photo Item");
  const image = await uploadInventoryImage(session, item.id);
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

test("deleting a managed uploaded image removes the image row and local file", async () => {
  const session = await createWorkspaceSession("inventory-image-delete");
  const item = await createInventoryItem(session, "Delete Uploaded Photo Item");
  const image = await uploadInventoryImage(session, item.id, {
    filename: "delete-photo.png"
  });

  const deleteResponse = await app.inject({
    method: "DELETE",
    url: `/api/inventory/${item.id}/images/${image.id}`,
    headers: session.headers
  });

  assert.equal(deleteResponse.statusCode, 200);
  const deleteBody = deleteResponse.json<{
    ok: boolean;
    imageId: string;
    storageDeletion: { managed: boolean; deleted: boolean };
  }>();
  assert.equal(deleteBody.ok, true);
  assert.equal(deleteBody.imageId, image.id);
  assert.equal(deleteBody.storageDeletion.managed, true);
  assert.equal(deleteBody.storageDeletion.deleted, true);

  const itemDetailResponse = await app.inject({
    method: "GET",
    url: `/api/inventory/${item.id}`,
    headers: session.headers
  });

  assert.equal(itemDetailResponse.statusCode, 200);
  const itemDetail = itemDetailResponse.json<{ item: { images: Array<{ id: string }> } }>().item;
  assert.equal(itemDetail.images.length, 0);

  const fetchUploadedResponse = await app.inject({
    method: "GET",
    url: new URL(image.url).pathname
  });

  assert.equal(fetchUploadedResponse.statusCode, 404);

  const auditLog = await db.auditLog.findFirst({
    where: {
      workspaceId: session.workspaceId,
      action: "inventory.image_deleted",
      targetId: item.id
    },
    orderBy: { createdAt: "desc" }
  });

  assert.ok(auditLog);
});

test("deleting an external image only removes the database row", async () => {
  const session = await createWorkspaceSession("inventory-external-image-delete");
  const item = await createInventoryItem(session, "External Image Delete");

  const attachResponse = await app.inject({
    method: "POST",
    url: `/api/inventory/${item.id}/images`,
    headers: session.headers,
    payload: {
      url: "https://images.example.com/test-photo.jpg",
      kind: "ORIGINAL",
      position: 0
    }
  });

  assert.equal(attachResponse.statusCode, 200);
  const image = attachResponse.json<{ image: { id: string } }>().image;

  const deleteResponse = await app.inject({
    method: "DELETE",
    url: `/api/inventory/${item.id}/images/${image.id}`,
    headers: session.headers
  });

  assert.equal(deleteResponse.statusCode, 200);
  const deleteBody = deleteResponse.json<{ storageDeletion: { managed: boolean; deleted: boolean } }>();
  assert.equal(deleteBody.storageDeletion.managed, false);
  assert.equal(deleteBody.storageDeletion.deleted, false);
});

test("reordering inventory images persists deterministic position order", async () => {
  const session = await createWorkspaceSession("inventory-image-reorder");
  const item = await createInventoryItem(session, "Reorder Uploaded Photos");
  const firstImage = await uploadInventoryImage(session, item.id, {
    position: 0,
    filename: "first-photo.png"
  });
  const secondImage = await uploadInventoryImage(session, item.id, {
    position: 1,
    filename: "second-photo.png"
  });

  const reorderResponse = await app.inject({
    method: "POST",
    url: `/api/inventory/${item.id}/images/reorder`,
    headers: session.headers,
    payload: {
      imageIds: [secondImage.id, firstImage.id]
    }
  });

  assert.equal(reorderResponse.statusCode, 200);
  const reorderedImages = reorderResponse.json<{ images: Array<{ id: string; position: number }> }>().images;
  assert.deepEqual(
    reorderedImages.map((image) => ({ id: image.id, position: image.position })),
    [
      { id: secondImage.id, position: 0 },
      { id: firstImage.id, position: 1 }
    ]
  );

  const itemDetailResponse = await app.inject({
    method: "GET",
    url: `/api/inventory/${item.id}`,
    headers: session.headers
  });

  assert.equal(itemDetailResponse.statusCode, 200);
  const itemDetail = itemDetailResponse.json<{
    item: { images: Array<{ id: string; position: number }> };
  }>().item;
  assert.deepEqual(
    itemDetail.images.map((image) => ({ id: image.id, position: image.position })),
    [
      { id: secondImage.id, position: 0 },
      { id: firstImage.id, position: 1 }
    ]
  );

  const auditLog = await db.auditLog.findFirst({
    where: {
      workspaceId: session.workspaceId,
      action: "inventory.images_reordered",
      targetId: item.id
    },
    orderBy: { createdAt: "desc" }
  });

  assert.ok(auditLog);
});
