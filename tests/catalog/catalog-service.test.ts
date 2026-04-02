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

type CatalogModule = typeof import("@reselleros/catalog");
type DbModule = typeof import("@reselleros/db");
type CrawlerModule = typeof import("../../packages/catalog-tools/src/crawler.js");

let applyCrawlerHarvest: CatalogModule["applyCrawlerHarvest"];
let applyOperatorResearch: CatalogModule["applyOperatorResearch"];
let classifyIdentifier: CatalogModule["classifyIdentifier"];
let normalizeIdentifier: CatalogModule["normalizeIdentifier"];
let upsertSeedCatalogRecord: CatalogModule["upsertSeedCatalogRecord"];
let db: DbModule["db"];
let parseAmazonSearchHtml: CrawlerModule["parseAmazonSearchHtml"];
let parseEbaySearchHtml: CrawlerModule["parseEbaySearchHtml"];
let parseGoogleSearchHtml: CrawlerModule["parseGoogleSearchHtml"];

const createdEmails = new Set<string>();
const createdWorkspaceIds = new Set<string>();

before(async () => {
  const [catalogModule, dbModule, crawlerModule] = await Promise.all([
    import("@reselleros/catalog"),
    import("@reselleros/db"),
    import("../../packages/catalog-tools/src/crawler.js")
  ]);
  ({
    applyCrawlerHarvest,
    applyOperatorResearch,
    classifyIdentifier,
    normalizeIdentifier,
    upsertSeedCatalogRecord
  } = catalogModule);
  ({ db } = dbModule);
  ({ parseAmazonSearchHtml, parseEbaySearchHtml, parseGoogleSearchHtml } = crawlerModule);

  await db.$connect();
});

after(async () => {
  for (const workspaceId of createdWorkspaceIds) {
    await db.workspace.deleteMany({
      where: { id: workspaceId }
    });
  }
  for (const email of createdEmails) {
    await db.user.deleteMany({
      where: { email }
    });
  }
  await db.catalogIdentifier.deleteMany({
    where: {
      normalizedIdentifier: {
        in: ["012345678905", "9780316769488", "4006381333931", "AB-12345"]
      }
    }
  });
  await db.$disconnect();
});

async function createWorkspace(label: string) {
  const email = `${label}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  createdEmails.add(email);

  const user = await db.user.create({
    data: {
      email,
      name: label
    }
  });

  const workspace = await db.workspace.create({
    data: {
      ownerUserId: user.id,
      name: `${label} Workspace`,
      memberships: {
        create: {
          userId: user.id,
          role: "OWNER"
        }
      }
    }
  });
  createdWorkspaceIds.add(workspace.id);
  return workspace;
}

test("identifier normalization and classification cover UPC, EAN, ISBN, and Code 128", () => {
  assert.equal(normalizeIdentifier("01234-56789-05"), "012345678905");
  assert.equal(classifyIdentifier("012345678905"), "UPC");
  assert.equal(classifyIdentifier("4006381333931"), "EAN");
  assert.equal(classifyIdentifier("9780316769488"), "ISBN");
  assert.equal(normalizeIdentifier("ab-123 45"), "AB-12345");
  assert.equal(classifyIdentifier("AB-12345"), "CODE128");
});

test("seed records stay tentative and do not overwrite operator-confirmed canonical data", async () => {
  const workspace = await createWorkspace("catalog-seed-overwrite");
  await applyOperatorResearch({
    workspaceId: workspace.id,
    identifier: "012345678905",
    title: "Confirmed Wii Remote",
    brand: "Nintendo",
    category: "Video Games",
    imageUrls: ["https://example.test/wii-remote.jpg"],
    sourceReferences: [
      {
        market: "AMAZON",
        label: "Amazon reference",
        url: "https://www.amazon.com/dp/B000IMWK2G"
      }
    ],
    observations: [
      {
        market: "AMAZON",
        label: "Amazon",
        price: 39.99
      }
    ]
  });

  await upsertSeedCatalogRecord({
    identifier: "012345678905",
    title: "Weaker Seed Title"
  });

  const record = await db.catalogIdentifier.findUnique({
    where: { normalizedIdentifier: "012345678905" }
  });

  assert.equal(record?.canonicalTitle, "Confirmed Wii Remote");
  assert.equal(record?.trustStatus, "OPERATOR_CONFIRMED");
});

test("crawler harvest can promote a strong candidate into the canonical catalog", async () => {
  await applyCrawlerHarvest({
    identifier: "4006381333931",
    title: "Crawler Derived Product",
    category: "Electronics",
    imageUrls: ["https://example.test/crawler-derived.jpg"],
    sourceReferences: [
      {
        market: "AMAZON",
        label: "Amazon search result",
        url: "https://www.amazon.com/s?k=4006381333931"
      }
    ],
    observations: [
      {
        market: "EBAY",
        label: "eBay",
        price: 22.5,
        sourceUrl: "https://www.ebay.com/sch/i.html?_nkw=4006381333931"
      }
    ],
    confidenceScore: 0.82
  });

  const record = await db.catalogIdentifier.findUnique({
    where: { normalizedIdentifier: "4006381333931" },
    include: {
      observations: true
    }
  });

  assert.equal(record?.canonicalTitle, "Crawler Derived Product");
  assert.equal(record?.trustStatus, "CRAWLER_DERIVED");
  assert.equal(record?.observations.length, 1);
});

test("crawler parsers extract candidate data from representative HTML fragments", () => {
  const google = parseGoogleSearchHtml('<html><body><a href="https://example.com/item"><h3>Google Result Title</h3></a></body></html>');
  const amazon = parseAmazonSearchHtml(
    '<html><body><div data-cy="title-recipe"><h2>Amazon Result Title</h2></div><a href="/Some-Item/dp/B000IMWK2G"></a><span class="a-price-whole">39</span><span class="a-price-fraction">99</span><img src="https://example.test/a.jpg" /></body></html>'
  );
  const ebay = parseEbaySearchHtml(
    '<html><body><a class="s-item__link" href="https://www.ebay.com/itm/123"></a><span class="s-item__title">eBay Result Title</span><span class="s-item__price">$34.50</span><img class="s-item__image-img" src="https://example.test/e.jpg" /></body></html>'
  );

  assert.equal(google?.title, "Google Result Title");
  assert.equal(amazon?.price, 39.99);
  assert.equal(amazon?.url, "https://www.amazon.com/Some-Item/dp/B000IMWK2G");
  assert.equal(ebay?.price, 34.5);
  assert.equal(ebay?.title, "eBay Result Title");
});
