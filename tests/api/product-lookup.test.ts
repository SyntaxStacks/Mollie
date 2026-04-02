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
const originalFetch = global.fetch;

async function clearCatalogIdentifiers(...identifiers: string[]) {
  await db.catalogIdentifier.deleteMany({
    where: {
      normalizedIdentifier: {
        in: identifiers
      }
    }
  });
}

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

  if (db) {
    await db.$disconnect();
  }
});

test("product lookup returns an operator-review candidate for a known barcode", async () => {
  await clearCatalogIdentifiers("012345678905");
  const session = await createWorkspaceSession("product-lookup-known");

  const response = await app.inject({
    method: "POST",
    url: "/api/product-lookup/barcode",
    headers: session.headers,
    payload: {
      barcode: "012345678905"
    }
  });

  assert.equal(response.statusCode, 200);
  const result = response.json<{
    result: {
      barcode: string;
      identifierType: string;
      providerSummary: { simulated: boolean };
      recommendedNextAction: string;
      hint: { title: string };
      candidates: Array<{
        provider: string;
        confidenceState: string;
        safeToPrefill: boolean;
        productUrl: string | null;
        title: string;
      }>;
    };
  }>().result;

  assert.equal(result.barcode, "012345678905");
  assert.equal(result.identifierType, "UPC");
  assert.equal(typeof result.providerSummary.simulated, "boolean");
  assert.match(result.recommendedNextAction, /review/i);
  assert.ok(result.candidates.length >= 1);
  assert.equal(result.candidates[0]?.provider, "AMAZON_ENRICHMENT");
  assert.match(result.candidates[0]?.confidenceState ?? "", /HIGH|MEDIUM/);
  assert.equal(result.candidates[0]?.safeToPrefill, true);
  assert.match(result.candidates[0]?.productUrl ?? "", /amazon\.com/i);
  assert.doesNotMatch(result.candidates[0]?.title ?? "", /possible product match/i);
  assert.ok((result.candidates[0]?.title ?? "").trim().length > 10);
});

test("product lookup warns operators when only a low-confidence candidate exists", async () => {
  await clearCatalogIdentifiers("111111111111");
  const session = await createWorkspaceSession("product-lookup-low");

  global.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;

  const response = await app.inject({
    method: "POST",
    url: "/api/product-lookup/barcode",
    headers: session.headers,
    payload: {
      barcode: "111111111111"
    }
  });

  global.fetch = originalFetch;

  assert.equal(response.statusCode, 200);
  const result = response.json<{
    result: {
      hint: { title: string; explanation: string; nextActions: string[] };
      candidates: Array<{
        provider: string;
        confidenceState: string;
        safeToPrefill: boolean;
      }>;
    };
  }>().result;

  assert.ok(result.candidates.length >= 1);
  assert.equal(result.candidates[0]?.provider, "SIMULATED");
  assert.equal(result.candidates[0]?.confidenceState, "LOW");
  assert.equal(result.candidates[0]?.safeToPrefill, false);
  assert.match(result.hint.title, /low-confidence|possible match|match/i);
  assert.ok(result.hint.nextActions.some((action) => /manual entry/i.test(action)));
});

test("product lookup fetches richer source data before falling back to a generic simulated candidate", async () => {
  await clearCatalogIdentifiers("019100296459");
  const session = await createWorkspaceSession("product-lookup-source");

  global.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes("amazon.com")) {
      return new Response(
        `
          <html>
            <body>
              <div data-cy="title-recipe"><h2>Acme Red Blender 700W</h2></div>
              <a href="/Acme-Blender/dp/B012345678"></a>
              <span class="a-price-whole">49</span>
              <span class="a-price-fraction">99</span>
              <img src="https://images.example.com/blender.jpg" />
            </body>
          </html>
        `,
        { status: 200 }
      );
    }

    if (url.includes("ebay.com")) {
      return new Response(
        `
          <html>
            <body>
              <a class="s-item__link" href="https://www.ebay.com/itm/1234567890"></a>
              <span class="s-item__title">Acme Red Blender Mixer</span>
              <span class="s-item__price">$39.99</span>
              <img class="s-item__image-img" src="https://images.example.com/blender-ebay.jpg" />
            </body>
          </html>
        `,
        { status: 200 }
      );
    }

    if (url.includes("google.com")) {
      return new Response(
        `
          <html>
            <body>
              <a href="https://example.com/acme-blender">
                <h3>Acme Blender UPC result</h3>
              </a>
            </body>
          </html>
        `,
        { status: 200 }
      );
    }

    return new Response("", { status: 404 });
  }) as typeof fetch;

  const response = await app.inject({
    method: "POST",
    url: "/api/product-lookup/barcode",
    headers: session.headers,
    payload: {
      barcode: "019100296459"
    }
  });

  global.fetch = originalFetch;

  assert.equal(response.statusCode, 200);
  const result = response.json<{
    result: {
      providerSummary: { simulated: boolean; barcodeLookupProvider: string };
      candidates: Array<{
        provider: string;
        title: string;
        productUrl: string | null;
        confidenceState: string;
      }>;
    };
  }>().result;

  assert.equal(result.providerSummary.simulated, false);
  assert.equal(result.providerSummary.barcodeLookupProvider, "web-source-research");
  assert.ok(result.candidates.length >= 1);
  assert.equal(result.candidates[0]?.provider, "AMAZON_ENRICHMENT");
  assert.match(result.candidates[0]?.title ?? "", /acme red blender/i);
  assert.match(result.candidates[0]?.productUrl ?? "", /amazon\.com\/Acme-Blender\/dp\/B012345678/i);
  assert.equal(result.candidates[0]?.confidenceState, "MEDIUM");
});
