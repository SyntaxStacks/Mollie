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
const originalOpenAiKey = process.env.OPENAI_API_KEY;

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

function buildMultipartPayload(input: { notes?: string; filename: string; contentType: string; file: Buffer }) {
  const boundary = `----reselleros-${crypto.randomUUID()}`;
  const chunks: Buffer[] = [];

  if (input.notes) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="notes"\r\n\r\n${input.notes}\r\n`, "utf8")
    );
  }

  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${input.filename}"\r\nContent-Type: ${input.contentType}\r\n\r\n`,
      "utf8"
    )
  );
  chunks.push(input.file);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"));

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
  process.env.OPENAI_API_KEY = originalOpenAiKey;

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

test("visual product lookup returns manual guidance when AI vision is not configured", async () => {
  delete process.env.OPENAI_API_KEY;
  const session = await createWorkspaceSession("vision-unconfigured");
  const multipart = buildMultipartPayload({
    notes: "pair of sneakers",
    filename: "product.png",
    contentType: "image/png",
    file: tinyPng
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/product-lookup/vision",
    headers: {
      ...session.headers,
      "content-type": multipart.contentType
    },
    payload: multipart.body
  });

  assert.equal(response.statusCode, 200);
  const result = response.json<{
    result: {
      candidate: null;
      recommendedNextAction: string;
      providerSummary: {
        enabled: boolean;
        simulated: boolean;
        visionProvider: string;
      };
      hint: {
        explanation: string;
      };
    };
  }>().result;

  assert.equal(result.candidate, null);
  assert.equal(result.providerSummary.enabled, false);
  assert.equal(result.providerSummary.simulated, true);
  assert.equal(result.providerSummary.visionProvider, "UNAVAILABLE");
  assert.match(result.recommendedNextAction, /manual/i);
  assert.match(result.hint.explanation, /OPENAI_API_KEY/i);
});

test("visual product lookup returns a structured candidate when AI vision is configured", async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  global.fetch = (async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/responses");
    assert.equal(init?.method, "POST");
    const payload = JSON.parse(String(init?.body)) as {
      input: Array<{
        content: Array<{
          type: string;
          image_url?: string;
        }>;
      }>;
    };
    const imageContent = payload.input[0]?.content.find((entry) => entry.type === "input_image");
    assert.match(imageContent?.image_url ?? "", /^data:image\/png;base64,/i);

    return new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          title: "Nike Air Force 1 Low Sneakers",
          brand: "Nike",
          category: "Shoes",
          model: "Air Force 1",
          size: null,
          color: "White",
          condition: "Pre-owned",
          priceSuggestion: 74,
          confidenceScore: 0.88,
          matchRationale: ["The photo shows a low-top white Nike sneaker.", "The silhouette matches the Air Force 1 line."],
          researchQueries: ["Nike Air Force 1 Low white sneakers", "Nike Air Force 1 used resale"]
        })
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  }) as typeof fetch;

  const session = await createWorkspaceSession("vision-configured");
  const multipart = buildMultipartPayload({
    notes: "identify this shoe",
    filename: "shoe.png",
    contentType: "image/png",
    file: tinyPng
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/product-lookup/vision",
    headers: {
      ...session.headers,
      "content-type": multipart.contentType
    },
    payload: multipart.body
  });

  global.fetch = originalFetch;

  assert.equal(response.statusCode, 200);
  const result = response.json<{
    result: {
      candidate: {
        title: string;
        brand: string | null;
        category: string | null;
        provider: string;
        confidenceState: string;
        confidenceScore: number;
        researchQueries: string[];
      } | null;
      providerSummary: {
        enabled: boolean;
        simulated: boolean;
        visionProvider: string;
      };
    };
  }>().result;

  assert.ok(result.candidate);
  assert.equal(result.providerSummary.enabled, true);
  assert.equal(result.providerSummary.simulated, false);
  assert.equal(result.providerSummary.visionProvider, "OPENAI_VISION");
  assert.equal(result.candidate?.title, "Nike Air Force 1 Low Sneakers");
  assert.equal(result.candidate?.brand, "Nike");
  assert.equal(result.candidate?.category, "Shoes");
  assert.equal(result.candidate?.provider, "OPENAI_VISION");
  assert.equal(result.candidate?.confidenceState, "HIGH");
  assert.equal(result.candidate?.confidenceScore, 0.88);
  assert.equal(result.candidate?.researchQueries.length, 2);
});
