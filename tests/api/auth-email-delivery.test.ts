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
const originalFetch = globalThis.fetch;

before(async () => {
  const [apiModule, dbModule] = await Promise.all([import("../../apps/api/src/index.js"), import("@reselleros/db")]);
  app = apiModule.buildApiApp();
  db = dbModule.db;
  await app.ready();
  await db.$connect();
});

after(async () => {
  globalThis.fetch = originalFetch;

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

test("request-code sends email through resend and suppresses inline dev code in production mode", async () => {
  const email = `resend-${Date.now()}@example.com`;
  createdEmails.add(email);
  const originalNodeEnv = process.env.NODE_ENV;
  const originalExpose = process.env.AUTH_EXPOSE_DEV_CODE;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalEmailFrom = process.env.AUTH_EMAIL_FROM;

  let sentRequestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://api.resend.com/emails");
    assert.equal(init?.method, "POST");
    sentRequestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

    return new Response(JSON.stringify({ id: "email_123" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }) as typeof fetch;

  process.env.NODE_ENV = "production";
  process.env.AUTH_EXPOSE_DEV_CODE = "false";
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.AUTH_EMAIL_FROM = "login@mail.mollie.biz";

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/request-code",
      payload: {
        email,
        name: "Email Pilot"
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      email: string;
      expiresAt: string;
      devCode: string | null;
      deliveryMethod: string;
    };

    assert.equal(body.email, email);
    assert.equal(body.devCode, null);
    assert.equal(body.deliveryMethod, "email");
    assert.ok(sentRequestBody);
    assert.deepEqual(sentRequestBody?.to, [email]);
    assert.equal(sentRequestBody?.from, "login@mail.mollie.biz");
    assert.equal(sentRequestBody?.subject, "Your Mollie login code");
    assert.match(String(sentRequestBody?.text ?? ""), /only the most recent login code will work/i);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.AUTH_EXPOSE_DEV_CODE = originalExpose;
    process.env.RESEND_API_KEY = originalResendKey;
    process.env.AUTH_EMAIL_FROM = originalEmailFrom;
    globalThis.fetch = originalFetch;
  }
});

test("requesting a fresh code invalidates older active codes for the same email", async () => {
  const email = `rotating-${Date.now()}@example.com`;
  createdEmails.add(email);
  const originalNodeEnv = process.env.NODE_ENV;
  const originalExpose = process.env.AUTH_EXPOSE_DEV_CODE;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalEmailFrom = process.env.AUTH_EMAIL_FROM;

  process.env.NODE_ENV = "test";
  process.env.AUTH_EXPOSE_DEV_CODE = "true";
  delete process.env.RESEND_API_KEY;
  delete process.env.AUTH_EMAIL_FROM;

  try {
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/auth/request-code",
      payload: {
        email,
        name: "Rotation Test"
      }
    });

    assert.equal(firstResponse.statusCode, 200);
    const firstCode = firstResponse.json<{ devCode: string | null }>().devCode;
    assert.ok(firstCode);

    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/auth/request-code",
      payload: {
        email,
        name: "Rotation Test"
      }
    });

    assert.equal(secondResponse.statusCode, 200);
    const secondCode = secondResponse.json<{ devCode: string | null }>().devCode;
    assert.ok(secondCode);
    assert.notEqual(secondCode, firstCode);

    const activeChallenges = await db.authChallenge.findMany({
      where: {
        email,
        consumedAt: null
      }
    });

    assert.equal(activeChallenges.length, 1);

    const verifySecond = await app.inject({
      method: "POST",
      url: "/api/auth/verify-code",
      payload: {
        email,
        code: secondCode
      }
    });

    assert.equal(verifySecond.statusCode, 200);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.AUTH_EXPOSE_DEV_CODE = originalExpose;
    process.env.RESEND_API_KEY = originalResendKey;
    process.env.AUTH_EMAIL_FROM = originalEmailFrom;
  }
});

test("verify-code rejects stale codes as a client auth error", async () => {
  const email = `stale-${Date.now()}@example.com`;
  createdEmails.add(email);
  const originalNodeEnv = process.env.NODE_ENV;
  const originalExpose = process.env.AUTH_EXPOSE_DEV_CODE;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalEmailFrom = process.env.AUTH_EMAIL_FROM;

  process.env.NODE_ENV = "test";
  process.env.AUTH_EXPOSE_DEV_CODE = "true";
  delete process.env.RESEND_API_KEY;
  delete process.env.AUTH_EMAIL_FROM;

  try {
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/auth/request-code",
      payload: {
        email,
        name: "Stale Code"
      }
    });

    assert.equal(firstResponse.statusCode, 200);
    const firstCode = firstResponse.json<{ devCode: string | null }>().devCode;
    assert.ok(firstCode);

    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/auth/request-code",
      payload: {
        email,
        name: "Stale Code"
      }
    });

    assert.equal(secondResponse.statusCode, 200);
    const secondCode = secondResponse.json<{ devCode: string | null }>().devCode;
    assert.ok(secondCode);
    assert.notEqual(firstCode, secondCode);

    const staleVerify = await app.inject({
      method: "POST",
      url: "/api/auth/verify-code",
      payload: {
        email: ` ${email.toUpperCase()} `,
        code: ` ${firstCode} `
      }
    });

    assert.equal(staleVerify.statusCode, 400);
    assert.match(staleVerify.json<{ error: string }>().error, /invalid login code/i);

    const freshVerify = await app.inject({
      method: "POST",
      url: "/api/auth/verify-code",
      payload: {
        email,
        code: secondCode
      }
    });

    assert.equal(freshVerify.statusCode, 200);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.AUTH_EXPOSE_DEV_CODE = originalExpose;
    process.env.RESEND_API_KEY = originalResendKey;
    process.env.AUTH_EMAIL_FROM = originalEmailFrom;
  }
});

test("verify-code expires a login challenge after too many invalid attempts", async () => {
  const email = `lockout-${Date.now()}@example.com`;
  createdEmails.add(email);
  const originalNodeEnv = process.env.NODE_ENV;
  const originalExpose = process.env.AUTH_EXPOSE_DEV_CODE;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalEmailFrom = process.env.AUTH_EMAIL_FROM;
  const originalMaxAttempts = process.env.AUTH_MAX_VERIFY_ATTEMPTS;

  process.env.NODE_ENV = "test";
  process.env.AUTH_EXPOSE_DEV_CODE = "true";
  process.env.AUTH_MAX_VERIFY_ATTEMPTS = "3";
  delete process.env.RESEND_API_KEY;
  delete process.env.AUTH_EMAIL_FROM;

  try {
    const issueResponse = await app.inject({
      method: "POST",
      url: "/api/auth/request-code",
      payload: {
        email,
        name: "Lockout Test"
      }
    });

    assert.equal(issueResponse.statusCode, 200);
    const issuedCode = issueResponse.json<{ devCode: string | null }>().devCode;
    assert.ok(issuedCode);
    const invalidCode = issuedCode === "999999" ? "888888" : "999999";

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/verify-code",
        payload: {
          email,
          code: invalidCode
        }
      });

      assert.equal(response.statusCode, 400);
      assert.match(response.json<{ error: string }>().error, /invalid login code/i);
    }

    const finalInvalidAttempt = await app.inject({
      method: "POST",
      url: "/api/auth/verify-code",
      payload: {
        email,
        code: invalidCode
      }
    });

    assert.equal(finalInvalidAttempt.statusCode, 400);
    assert.match(finalInvalidAttempt.json<{ error: string }>().error, /expired/i);

    const validAfterLockout = await app.inject({
      method: "POST",
      url: "/api/auth/verify-code",
      payload: {
        email,
        code: issuedCode
      }
    });

    assert.equal(validAfterLockout.statusCode, 400);
    assert.match(validAfterLockout.json<{ error: string }>().error, /no active login code|expired/i);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.AUTH_EXPOSE_DEV_CODE = originalExpose;
    process.env.RESEND_API_KEY = originalResendKey;
    process.env.AUTH_EMAIL_FROM = originalEmailFrom;
    if (originalMaxAttempts === undefined) {
      delete process.env.AUTH_MAX_VERIFY_ATTEMPTS;
    } else {
      process.env.AUTH_MAX_VERIFY_ATTEMPTS = originalMaxAttempts;
    }
  }
});
