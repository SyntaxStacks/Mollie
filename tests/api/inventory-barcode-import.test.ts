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
type QueueModule = typeof import("@reselleros/queue");

let app: Awaited<ReturnType<AppModule["buildApiApp"]>>;
let db: DbModule["db"];
let setEnqueueHandler: QueueModule["setEnqueueHandler"];
const queuedJobs: Array<{ name: string; payload: unknown }> = [];
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
    token: verifyBody.token,
    workspaceId: workspace.id,
    headers: buildHeaders(verifyBody.token, workspace.id)
  };
}

before(async () => {
  const [apiModule, dbModule, queueModule] = await Promise.all([
    import("../../apps/api/src/index.js"),
    import("@reselleros/db"),
    import("@reselleros/queue")
  ]);
  app = apiModule.buildApiApp();
  db = dbModule.db;
  setEnqueueHandler = queueModule.setEnqueueHandler;
  setEnqueueHandler(async (name, payload) => {
    queuedJobs.push({
      name,
      payload
    });

    return { id: `${name}-${queuedJobs.length}` };
  });
  await app.ready();
  await db.$connect();
  await db.$queryRaw`SELECT 1`;
});

after(async () => {
  setEnqueueHandler(null);
  await db.catalogIdentifier.deleteMany({
    where: {
      normalizedIdentifier: "012345678905"
    }
  });

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

test("barcode import creates an inventory item with market observations and imported images", async () => {
  queuedJobs.length = 0;
  await db.catalogObservation.deleteMany({
    where: {
      catalogIdentifier: {
        normalizedIdentifier: "012345678905"
      }
    }
  });
  await db.workspaceCatalogObservation.deleteMany({
    where: {
      catalogIdentifier: {
        normalizedIdentifier: "012345678905"
      }
    }
  });
  await db.workspaceCatalogOverride.deleteMany({
    where: {
      catalogIdentifier: {
        normalizedIdentifier: "012345678905"
      }
    }
  });
  await db.catalogIdentifier.deleteMany({
    where: {
      normalizedIdentifier: "012345678905"
    }
  });
  const session = await createWorkspaceSession("barcode-import");

  const importResponse = await app.inject({
    method: "POST",
    url: "/api/inventory/import/barcode",
    headers: session.headers,
    payload: {
      identifier: "012345678905",
      title: "Nintendo Wii Remote",
      brand: "Nintendo",
      category: "Video Games",
      condition: "Good used condition",
      costBasis: 14,
      primarySourceMarket: "AMAZON",
      primarySourceUrl: "https://www.amazon.com/dp/B000IMWK2G",
      referenceUrls: [
        "https://www.ebay.com/sch/i.html?_nkw=012345678905"
      ],
      imageUrls: [
        "https://m.media-amazon.com/images/I/example-one.jpg",
        "https://m.media-amazon.com/images/I/example-two.jpg",
        "https://m.media-amazon.com/images/I/example-one.jpg"
      ],
      acceptedCandidate: {
        id: "amazon-enriched-012345678905",
        barcode: "012345678905",
        identifierType: "UPC",
        title: "Nintendo Wii Remote",
        brand: "Nintendo",
        category: "Video Games",
        model: "RVL-003",
        size: null,
        color: "White",
        primaryImageUrl: "https://m.media-amazon.com/images/I/example-one.jpg",
        imageUrls: [
          "https://m.media-amazon.com/images/I/example-one.jpg",
          "https://m.media-amazon.com/images/I/example-two.jpg"
        ],
        asin: "B000IMWK2G",
        productUrl: "https://www.amazon.com/dp/B000IMWK2G",
        provider: "AMAZON_ENRICHMENT",
        confidenceScore: 0.84,
        confidenceState: "HIGH",
        matchRationale: ["Matched barcode to a likely Wii Remote product."],
        hint: {
          title: "Likely match found",
          explanation: "Double-check the product photo and title before applying it.",
          severity: "SUCCESS",
          nextActions: ["Compare the product photo to the item in hand."],
          canContinue: true
        },
        safeToPrefill: true,
        simulated: true
      },
      generateDrafts: true,
      draftPlatforms: ["EBAY", "DEPOP", "POSHMARK", "WHATNOT"],
      observations: [
        {
          market: "AMAZON",
          label: "Amazon",
          price: 39.99,
          sourceUrl: "https://www.amazon.com/dp/B000IMWK2G"
        }
      ]
    }
  });

  assert.equal(importResponse.statusCode, 200);
  const importedItem = importResponse.json<{
    draftsQueued: boolean;
    draftPlatforms: string[];
    item: {
      id: string;
      title: string;
      priceRecommendation: number;
      estimatedResaleMin: number;
      estimatedResaleMax: number;
      images: Array<{ url: string; position: number }>;
    };
  }>();
  assert.equal(importedItem.draftsQueued, true);
  assert.deepEqual(importedItem.draftPlatforms, ["EBAY", "DEPOP", "POSHMARK", "WHATNOT"]);
  assert.equal(queuedJobs.length, 1);
  assert.equal(queuedJobs[0]?.name, "inventory.generateListingDraft");
  const itemPayload = importedItem.item;

  assert.ok(itemPayload.id);
  assert.equal(itemPayload.title, "Nintendo Wii Remote");
  assert.equal(itemPayload.priceRecommendation, 39.99);
  assert.equal(itemPayload.estimatedResaleMin, 39.99);
  assert.equal(itemPayload.estimatedResaleMax, 39.99);
  assert.equal(itemPayload.images.length, 2);
  assert.deepEqual(
    itemPayload.images.map((image) => ({ url: image.url, position: image.position })),
    [
      { url: "https://m.media-amazon.com/images/I/example-one.jpg", position: 0 },
      { url: "https://m.media-amazon.com/images/I/example-two.jpg", position: 1 }
    ]
  );

  const persistedItem = await db.inventoryItem.findUnique({
    where: { id: itemPayload.id }
  });

  assert.ok(persistedItem);
  const attributes = persistedItem?.attributesJson as {
    identifier: string;
    identifierType: string;
    primarySourceMarket: string;
    catalogIdentifierId: string;
    acceptedCandidate: { provider: string; confidenceState: string; asin: string | null };
    marketObservations: Array<{ market: string; price: number; observedAt: string }>;
  };
  assert.equal(attributes.identifier, "012345678905");
  assert.equal(attributes.identifierType, "UPC");
  assert.equal(attributes.primarySourceMarket, "AMAZON");
  assert.ok(attributes.catalogIdentifierId);
  assert.equal(attributes.acceptedCandidate.provider, "AMAZON_ENRICHMENT");
  assert.equal(attributes.acceptedCandidate.confidenceState, "HIGH");
  assert.equal(attributes.acceptedCandidate.asin, "B000IMWK2G");
  assert.equal(attributes.marketObservations.length, 1);
  assert.equal(attributes.marketObservations[0]?.market, "AMAZON");
  assert.equal(attributes.marketObservations[0]?.price, 39.99);
  assert.ok(Date.parse(attributes.marketObservations[0]?.observedAt ?? "") > 0);

  const catalogIdentifier = await db.catalogIdentifier.findUnique({
    where: {
      id: attributes.catalogIdentifierId
    },
    include: {
      observations: true,
      workspaceOverrides: {
        where: {
          workspaceId: session.workspaceId
        }
      }
    }
  });

  assert.ok(catalogIdentifier);
  assert.equal(catalogIdentifier?.canonicalTitle, "Nintendo Wii Remote");
  assert.equal(catalogIdentifier?.trustStatus, "OPERATOR_CONFIRMED");
  assert.equal(catalogIdentifier?.observations.length, 1);
  assert.equal(catalogIdentifier?.workspaceOverrides.length, 1);

  const auditLog = await db.auditLog.findFirst({
    where: {
      workspaceId: session.workspaceId,
      action: "inventory.imported_from_barcode",
      targetId: itemPayload.id
    }
  });

  assert.ok(auditLog);
});
