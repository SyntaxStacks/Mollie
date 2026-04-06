import { z } from "zod";

import {
  createMarketplaceAccountForWorkspace,
  createMarketplaceConnectAttemptForWorkspace,
  db,
  disableMarketplaceAccountForWorkspace,
  findMarketplaceConnectAttemptByHelperNonce,
  findMarketplaceConnectAttemptForWorkspace,
  recordAuditLog,
  updateMarketplaceAccountMetadataForWorkspace,
  updateMarketplaceConnectAttempt,
  upsertMarketplaceAccountConnectionForWorkspace,
  type Prisma
} from "@reselleros/db";
import {
  automationVendorConnectChallengeSchema,
  automationVendorConnectSessionSchema,
  automationVendorConnectStartSchema,
  automationVendorParamsSchema,
  ebayLiveDefaultsSchema,
  ebayOAuthCallbackQuerySchema,
  ebayOAuthStartSchema,
  marketplaceAccountSchema,
  type AutomationVendor,
  type OperatorHint,
  type VendorConnectAttempt,
  type VendorConnectPrompt,
  type VendorConnectState
} from "@reselleros/types";
import {
  buildEbayAuthorizationUrl,
  encryptEbayCredentialPayload,
  exchangeEbayAuthorizationCode,
  fetchEbayUserProfile,
  getEbayAccountReadiness,
  parseEbayOAuthState,
  ebayAdapter
} from "@reselleros/marketplaces-ebay";
import { depopAdapter, depopConnectAdapter } from "@reselleros/marketplaces-depop";
import {
  type AutomationVendorConnectAttemptContext,
  getAutomationAccountReadiness
} from "@reselleros/marketplaces";
import { poshmarkAdapter, poshmarkConnectAdapter } from "@reselleros/marketplaces-poshmark";
import { whatnotAdapter, whatnotConnectAdapter } from "@reselleros/marketplaces-whatnot";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";
import { redactSecretRef } from "../lib/redaction.js";

const connectorDescriptors = {
  EBAY: ebayAdapter.descriptor,
  DEPOP: depopAdapter.descriptor,
  POSHMARK: poshmarkAdapter.descriptor,
  WHATNOT: whatnotAdapter.descriptor
} as const;

const automationConnectAdapters = {
  DEPOP: depopConnectAdapter,
  POSHMARK: poshmarkConnectAdapter,
  WHATNOT: whatnotConnectAdapter
} as const;

const automationVendorLabels: Record<AutomationVendor, string> = {
  DEPOP: "Depop",
  POSHMARK: "Poshmark",
  WHATNOT: "Whatnot"
};

const finalAttemptStates = new Set<VendorConnectState>(["CONNECTED", "FAILED", "EXPIRED"]);

function simulatedMarketplacePathsAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_SIMULATED_MARKETPLACE_PATHS === "true";
}

function productionAutomationConnectAllowed(vendor: AutomationVendor) {
  return simulatedMarketplacePathsAllowed() || vendor === "DEPOP" || vendor === "POSHMARK" || vendor === "WHATNOT";
}

function buildAttemptHint(input: {
  vendor: AutomationVendor;
  title: string;
  explanation: string;
  severity: OperatorHint["severity"];
  nextActions: string[];
  canContinue: boolean;
}) {
  return {
    title: input.title,
    explanation: input.explanation,
    severity: input.severity,
    nextActions: input.nextActions,
    routeTarget: "/marketplaces",
    featureFamily:
      input.vendor === "DEPOP"
        ? "DEPOP_PROMOTION"
        : input.vendor === "POSHMARK"
          ? "POSHMARK_SOCIAL"
          : "WHATNOT_LIVE_SELLING",
    canContinue: input.canContinue,
    helpText: `${automationVendorLabels[input.vendor]} is handled by signing in on another browser tab and rechecking that session through the Mollie browser extension.`
  } satisfies OperatorHint;
}

function isAutomationVendor(platform: string): platform is AutomationVendor {
  return platform === "DEPOP" || platform === "POSHMARK" || platform === "WHATNOT";
}

function buildHelperLaunchUrl(vendor: AutomationVendor, attemptId: string, helperNonce: string) {
  const helperUrl = new URL("/marketplaces/connect-helper", process.env.APP_BASE_URL);
  helperUrl.searchParams.set("vendor", vendor.toLowerCase());
  helperUrl.searchParams.set("attemptId", attemptId);
  helperUrl.searchParams.set("helperNonce", helperNonce);
  return helperUrl.toString();
}

function toAttemptContext(
  attempt: Awaited<ReturnType<typeof db.marketplaceConnectAttempt.findFirstOrThrow>>
): AutomationVendorConnectAttemptContext {
  return {
    id: attempt.id,
    workspaceId: attempt.workspaceId,
    platform: attempt.platform as AutomationVendor,
    displayName: attempt.displayName,
    state: attempt.state as VendorConnectState,
    helperNonce: attempt.helperNonce,
    metadata: (attempt.metadataJson ?? null) as Record<string, unknown> | null,
    prompts: ((attempt.promptsJson ?? []) as VendorConnectPrompt[]) ?? [],
    expiresAt: attempt.expiresAt.toISOString()
  };
}

function serializeMarketplaceAccount(
  account: Awaited<ReturnType<typeof db.marketplaceAccount.findFirstOrThrow>>,
  options?: { workspaceAutomationEnabled?: boolean }
) {
  const credentialMetadata = (account.credentialMetadataJson ?? null) as Record<string, unknown> | null;
  const readiness =
    account.platform === "EBAY"
      ? getEbayAccountReadiness({
          account: {
            id: account.id,
            platform: "EBAY",
            displayName: account.displayName,
            secretRef: account.secretRef,
            credentialType: account.credentialType,
            validationStatus: account.validationStatus,
            externalAccountId: account.externalAccountId,
            credentialMetadata
          },
          accountStatus: account.status,
          lastErrorMessage: account.lastErrorMessage
        })
      : account.platform === "DEPOP" || account.platform === "POSHMARK" || account.platform === "WHATNOT"
        ? getAutomationAccountReadiness({
            account: {
              id: account.id,
              platform: account.platform,
              displayName: account.displayName,
              secretRef: account.secretRef,
              credentialType: account.credentialType,
              validationStatus: account.validationStatus,
              externalAccountId: account.externalAccountId,
              credentialMetadata
            },
            workspaceAutomationEnabled: options?.workspaceAutomationEnabled,
            accountStatus: account.status,
            lastErrorMessage: account.lastErrorMessage
          })
        : null;

  return {
    id: account.id,
    workspaceId: account.workspaceId,
    platform: account.platform,
    displayName: account.displayName,
    status: account.status,
    secretRef: redactSecretRef(account.secretRef),
    credentialType: account.credentialType,
    validationStatus: account.validationStatus,
    externalAccountId: account.externalAccountId,
    credentialMetadata,
    lastValidatedAt: account.lastValidatedAt,
    lastErrorCode: account.lastErrorCode,
    lastErrorMessage: account.lastErrorMessage,
    createdAt: account.createdAt,
    ebayState: readiness?.state ?? null,
    publishMode: readiness?.publishMode ?? null,
    connectorDescriptor: connectorDescriptors[account.platform],
    readiness
  };
}

function serializeMarketplaceConnectAttempt(
  attempt: Awaited<ReturnType<typeof db.marketplaceConnectAttempt.findFirstOrThrow>>
): VendorConnectAttempt {
  const metadata = (attempt.metadataJson ?? {}) as Record<string, unknown>;
  const prompts = ((attempt.promptsJson ?? []) as VendorConnectPrompt[]) ?? [];
  const hint = (metadata.hint ?? buildAttemptHint({
    vendor: attempt.platform as AutomationVendor,
    title: `${automationVendorLabels[attempt.platform as AutomationVendor]} sign-in is in progress.`,
    explanation: "Follow the secure sign-in steps to capture and validate the workspace session artifact.",
    severity: "INFO",
    nextActions: ["Finish the sign-in flow on desktop.", "Wait for Mollie to validate the captured session."],
    canContinue: true
  })) as OperatorHint;

  return {
    id: attempt.id,
    workspaceId: attempt.workspaceId,
    vendor: attempt.platform as AutomationVendor,
    displayName: attempt.displayName,
    state: attempt.state as VendorConnectState,
    helperNonce: attempt.helperNonce,
    expiresAt: attempt.expiresAt.toISOString(),
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString(),
    helperLaunchUrl: buildHelperLaunchUrl(attempt.platform as AutomationVendor, attempt.id, attempt.helperNonce),
    prompts,
    hint,
    externalAccountId: attempt.externalAccountId ?? null,
    marketplaceAccountId: attempt.marketplaceAccountId ?? null,
    lastErrorCode: attempt.lastErrorCode ?? null,
    lastErrorMessage: attempt.lastErrorMessage ?? null
  };
}

async function expireAttemptIfNeeded(
  attempt: Awaited<ReturnType<typeof db.marketplaceConnectAttempt.findFirstOrThrow>>
) {
  if (finalAttemptStates.has(attempt.state as VendorConnectState) || attempt.expiresAt >= new Date()) {
    return attempt;
  }

  return updateMarketplaceConnectAttempt(attempt.id, {
    state: "EXPIRED",
    lastErrorCode: "CONNECT_ATTEMPT_EXPIRED",
    lastErrorMessage: "This sign-in window expired before the session could be validated.",
    metadataJson: {
      ...((attempt.metadataJson ?? {}) as Record<string, unknown>),
      hint: buildAttemptHint({
        vendor: attempt.platform as AutomationVendor,
        title: `${automationVendorLabels[attempt.platform as AutomationVendor]} sign-in expired.`,
        explanation: "The secure sign-in window sat too long without a validated session. Start the connect flow again.",
        severity: "ERROR",
        nextActions: ["Restart the connect flow from Marketplace Accounts.", "Finish vendor sign-in before the helper window expires."],
        canContinue: false
      })
    } satisfies Prisma.InputJsonValue
  });
}

async function completeAutomationAttempt(input: {
  attempt: Awaited<ReturnType<typeof db.marketplaceConnectAttempt.findFirstOrThrow>>;
  authUserId: string;
  accountHandle: string;
  externalAccountId?: string | null;
  sessionLabel?: string | null;
  captureMode: "WEB_POPUP_HELPER" | "LOCAL_BRIDGE" | "EXTENSION_BROWSER";
  cookieCount?: number | null;
  origin?: string | null;
  storageStateJson?: Record<string, unknown> | null;
}) {
  const vendor = input.attempt.platform as AutomationVendor;
  const adapter = automationConnectAdapters[vendor];
  const validation = adapter.validateSession({
    attempt: toAttemptContext(input.attempt),
    accountHandle: input.accountHandle,
    externalAccountId: input.externalAccountId,
    captureMode: input.captureMode,
    sessionLabel: input.sessionLabel,
    cookieCount: input.cookieCount ?? null,
    origin: input.origin ?? null,
    storageStateJson: input.storageStateJson ?? null
  });

  if (validation.validationStatus !== "VALID") {
    const failedAttempt = await updateMarketplaceConnectAttempt(input.attempt.id, {
      state: "FAILED",
      lastErrorCode: "SESSION_VALIDATION_FAILED",
      lastErrorMessage: validation.detail,
      metadataJson: {
        ...((input.attempt.metadataJson ?? {}) as Record<string, unknown>),
        hint: validation.operatorHint
      } satisfies Prisma.InputJsonValue
    });

    return {
      attempt: failedAttempt,
      account: null
    };
  }

  const validatedAt = new Date();
  const secretRef = `db-session://${vendor.toLowerCase()}/${input.attempt.workspaceId}/${input.attempt.id}`;
  const sessionArtifact = {
    connectAttemptId: input.attempt.id,
    captureMode: input.captureMode,
    capturedAt: validatedAt.toISOString(),
    validatedAt: validatedAt.toISOString(),
    accountHandle: validation.accountHandle,
    externalAccountId: validation.externalAccountId ?? null,
    sessionLabel: input.sessionLabel ?? null,
    cookieCount: input.cookieCount ?? null,
    origin: input.origin ?? null,
    storageStateJson: (input.storageStateJson ?? null) as Prisma.InputJsonValue | null
  };
  const account = await upsertMarketplaceAccountConnectionForWorkspace(input.attempt.workspaceId, {
    platform: vendor,
    displayName: input.attempt.displayName,
    secretRef,
    credentialType: "SECRET_REF",
    validationStatus: "VALID",
    externalAccountId: validation.externalAccountId ?? null,
    credentialMetadata: {
      mode: "helper-session-artifact",
      publishMode: "automation",
      captureMode: input.captureMode,
      accountHandle: validation.accountHandle,
      validationSummary: validation.summary,
      validationDetail: validation.detail,
      connectedAt: validatedAt.toISOString(),
      lastSessionCheckAt: validatedAt.toISOString(),
      vendorSessionArtifact: sessionArtifact
    } satisfies Prisma.InputJsonValue,
    credentialPayload: {
      helperSessionArtifact: sessionArtifact
    } satisfies Prisma.InputJsonValue
  });

  const connectedAttempt = await updateMarketplaceConnectAttempt(input.attempt.id, {
    state: "CONNECTED",
    marketplaceAccount: {
      connect: {
        id: account.id
      }
    },
    externalAccountId: account.externalAccountId,
    lastErrorCode: null,
    lastErrorMessage: null,
    metadataJson: {
      ...((input.attempt.metadataJson ?? {}) as Record<string, unknown>),
      hint: validation.operatorHint
    } satisfies Prisma.InputJsonValue
  });

  await recordAuditLog({
    workspaceId: input.attempt.workspaceId,
    actorUserId: input.authUserId,
    action: `marketplace.${vendor.toLowerCase()}.connected`,
    targetType: "marketplace_account",
    targetId: account.id,
    metadata: {
      displayName: account.displayName,
      externalAccountId: account.externalAccountId,
      captureMode: input.captureMode,
      connectAttemptId: input.attempt.id
    }
  });

  return {
    attempt: connectedAttempt,
    account
  };
}

export function registerMarketplaceAccountRoutes(app: ApiApp, context: ApiRouteContext) {
  app.get("/api/marketplace-accounts", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const accounts = await db.marketplaceAccount.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" }
    });

    return {
      accounts: accounts.map((account) =>
        serializeMarketplaceAccount(account, {
          workspaceAutomationEnabled: workspace.connectorAutomationEnabled
        })
      )
    };
  });

  app.post("/api/marketplace-accounts/ebay/connect", async (request) => {
    if (!simulatedMarketplacePathsAllowed()) {
      throw app.httpErrors.serviceUnavailable(
        "Manual simulated eBay accounts are disabled in production. Use eBay OAuth or wait for the live marketplace path."
      );
    }

    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = marketplaceAccountSchema.extend({ platform: z.literal("EBAY") }).parse({
      ...(request.body as Record<string, unknown>),
      platform: "EBAY"
    });

    const account = await createMarketplaceAccountForWorkspace(workspace.id, {
      platform: body.platform,
      displayName: body.displayName,
      secretRef: body.secretRef,
      credentialType: "SECRET_REF",
      validationStatus: "VALID",
      credentialMetadata: {
        mode: "manual-secret-ref",
        publishMode: "simulated"
      }
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "marketplace.ebay.connected",
      targetType: "marketplace_account",
      targetId: account.id,
      metadata: {
        displayName: account.displayName
      }
    });

    return {
      account: serializeMarketplaceAccount(account, {
        workspaceAutomationEnabled: workspace.connectorAutomationEnabled
      })
    };
  });

  app.post("/api/marketplace-accounts/ebay/oauth/start", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = ebayOAuthStartSchema.parse(request.body);
    const start = buildEbayAuthorizationUrl({
      workspaceId: workspace.id,
      userId: auth.userId,
      displayName: body.displayName
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "marketplace.ebay.oauth.started",
      targetType: "workspace",
      targetId: workspace.id,
      metadata: {
        displayName: body.displayName,
        environment: start.environment,
        scopes: start.scopes
      }
    });

    return start;
  });

  app.get("/api/marketplace-accounts/ebay/oauth/callback", async (request, reply) => {
    const query = ebayOAuthCallbackQuerySchema.parse(request.query);

    const fail = (message: string, code = "oauth_failed") => {
      if (query.mode === "json") {
        return reply.status(400).send({
          error: message,
          code
        });
      }

      const redirectUrl = new URL("/marketplaces", process.env.APP_BASE_URL);
      redirectUrl.searchParams.set("ebay_oauth", "error");
      redirectUrl.searchParams.set("code", code);
      redirectUrl.searchParams.set("message", message);
      return reply.redirect(redirectUrl.toString());
    };

    if (query.error) {
      return fail(query.error_description ?? `eBay authorization failed: ${query.error}`, query.error);
    }

    if (!query.code) {
      return fail("Missing eBay authorization code", "missing_code");
    }

    try {
      const state = parseEbayOAuthState(query.state);
      const tokenSet = await exchangeEbayAuthorizationCode(query.code);
      const profile = await fetchEbayUserProfile(tokenSet.accessToken);
      const account = await upsertMarketplaceAccountConnectionForWorkspace(state.workspaceId, {
        platform: "EBAY",
        displayName: state.displayName,
        secretRef: "db-encrypted://marketplace-account/oauth",
        credentialType: "OAUTH_TOKEN_SET",
        validationStatus: "VALID",
        externalAccountId: profile.userId,
        credentialMetadata: {
          mode: "oauth",
          environment: process.env.EBAY_ENVIRONMENT === "production" ? "production" : "sandbox",
          username: profile.username,
          scopes: tokenSet.scopes,
          tokenType: tokenSet.tokenType,
          connectedAt: tokenSet.issuedAt,
          accessTokenExpiresAt: tokenSet.accessTokenExpiresAt,
          refreshTokenExpiresAt: tokenSet.refreshTokenExpiresAt,
          publishMode: "foundation-only"
        },
        credentialPayload: encryptEbayCredentialPayload(tokenSet)
      });

      await recordAuditLog({
        workspaceId: state.workspaceId,
        actorUserId: state.userId,
        action: "marketplace.ebay.oauth.connected",
        targetType: "marketplace_account",
        targetId: account.id,
        metadata: {
          displayName: account.displayName,
          externalAccountId: account.externalAccountId,
          validationStatus: account.validationStatus
        }
      });

      if (query.mode === "json") {
        return {
          account: serializeMarketplaceAccount(account)
        };
      }

      const redirectUrl = new URL("/marketplaces", process.env.APP_BASE_URL);
      redirectUrl.searchParams.set("ebay_oauth", "connected");
      redirectUrl.searchParams.set("accountId", account.id);
      return reply.redirect(redirectUrl.toString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "eBay OAuth callback failed";
      return fail(message);
    }
  });

  app.post("/api/marketplace-accounts/:vendor/connect/start", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = automationVendorParamsSchema.parse(request.params);
    if (!productionAutomationConnectAllowed(params.vendor)) {
      throw app.httpErrors.serviceUnavailable(
        `${automationVendorLabels[params.vendor]} secure sign-in is not live in production yet. Mollie blocks this simulated marketplace path until the real automation runtime is ready.`
      );
    }

    const body = automationVendorConnectStartSchema.parse(request.body);
    const adapter = automationConnectAdapters[params.vendor];
    const start = adapter.startConnect({
      displayName: body.displayName
    });
    const helperNonce = crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + start.expiresInSeconds * 1000);

    const attempt = await createMarketplaceConnectAttemptForWorkspace(workspace.id, {
      platform: params.vendor,
      displayName: body.displayName,
      state: start.state,
      helperNonce,
      prompts: start.prompts as unknown as Prisma.InputJsonValue,
      metadata: {
        ...start.metadata,
        hint: start.hint,
        helperPath: start.helperPath,
        captureMode: "WEB_POPUP_HELPER"
      } satisfies Prisma.InputJsonValue,
      expiresAt
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: `marketplace.${params.vendor.toLowerCase()}.connect_started`,
      targetType: "marketplace_connect_attempt",
      targetId: attempt.id,
      metadata: {
        displayName: body.displayName
      }
    });

    return {
      attempt: serializeMarketplaceConnectAttempt(attempt)
    };
  });

  app.get("/api/marketplace-accounts/:vendor/connect/:attemptId", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = automationVendorParamsSchema.extend({ attemptId: z.string().min(1) }).parse(request.params);
    const existing = await findMarketplaceConnectAttemptForWorkspace(workspace.id, params.attemptId, params.vendor);

    if (!existing) {
      throw app.httpErrors.notFound("Marketplace connect attempt not found");
    }

    const attempt = await expireAttemptIfNeeded(existing);

    return {
      attempt: serializeMarketplaceConnectAttempt(attempt)
    };
  });

  app.post("/api/marketplace-accounts/:vendor/connect/:attemptId/challenge", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = automationVendorParamsSchema.extend({ attemptId: z.string().min(1) }).parse(request.params);
    if (!productionAutomationConnectAllowed(params.vendor)) {
      throw app.httpErrors.serviceUnavailable(
        `${automationVendorLabels[params.vendor]} secure sign-in is not live in production yet.`
      );
    }

    const body = automationVendorConnectChallengeSchema.parse(request.body);
    const adapter = automationConnectAdapters[params.vendor];
    const existing = await findMarketplaceConnectAttemptForWorkspace(workspace.id, params.attemptId, params.vendor);

    if (!existing) {
      throw app.httpErrors.notFound("Marketplace connect attempt not found");
    }

    const attempt = await expireAttemptIfNeeded(existing);

    if (attempt.state !== "AWAITING_2FA") {
      throw app.httpErrors.badRequest("This connect attempt is not waiting for a verification code");
    }

    const challenge = adapter.acceptChallenge({
      attempt: toAttemptContext(attempt),
      code: body.code,
      method: body.method
    });

    if (challenge.state === "FAILED") {
      const failedAttempt = await updateMarketplaceConnectAttempt(attempt.id, {
        state: "FAILED",
        lastErrorCode: "CHALLENGE_FAILED",
        lastErrorMessage: challenge.hint.explanation,
        promptsJson: challenge.prompts as unknown as Prisma.InputJsonValue,
        metadataJson: {
          ...((attempt.metadataJson ?? {}) as Record<string, unknown>),
          hint: challenge.hint
        } satisfies Prisma.InputJsonValue
      });

      return {
        attempt: serializeMarketplaceConnectAttempt(failedAttempt)
      };
    }

    const pendingSession = (((attempt.metadataJson ?? {}) as Record<string, unknown>).pendingSession ?? {}) as {
      accountHandle?: string;
      externalAccountId?: string | null;
      sessionLabel?: string | null;
      captureMode?: "WEB_POPUP_HELPER" | "LOCAL_BRIDGE" | "EXTENSION_BROWSER";
      cookieCount?: number | null;
      origin?: string | null;
      storageStateJson?: Record<string, unknown> | null;
    };

    const validatingAttempt = await updateMarketplaceConnectAttempt(attempt.id, {
      state: "VALIDATING",
      promptsJson: [] as unknown as Prisma.InputJsonValue,
      metadataJson: {
        ...((attempt.metadataJson ?? {}) as Record<string, unknown>),
        hint: challenge.hint
      } satisfies Prisma.InputJsonValue
    });

    const completed = await completeAutomationAttempt({
      attempt: validatingAttempt,
      authUserId: auth.userId,
      accountHandle: pendingSession.accountHandle ?? validatingAttempt.displayName,
      externalAccountId: pendingSession.externalAccountId ?? null,
      sessionLabel: pendingSession.sessionLabel ?? null,
      captureMode: pendingSession.captureMode ?? "WEB_POPUP_HELPER",
      cookieCount: typeof pendingSession.cookieCount === "number" ? pendingSession.cookieCount : null,
      origin: typeof pendingSession.origin === "string" ? pendingSession.origin : null,
      storageStateJson:
        pendingSession.storageStateJson && typeof pendingSession.storageStateJson === "object"
          ? (pendingSession.storageStateJson as Record<string, unknown>)
          : null
    });

    return {
      attempt: serializeMarketplaceConnectAttempt(completed.attempt),
      account: completed.account
        ? serializeMarketplaceAccount(completed.account, {
            workspaceAutomationEnabled: workspace.connectorAutomationEnabled
          })
        : null
    };
  });

  app.post("/api/marketplace-accounts/:vendor/connect/:attemptId/session", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = automationVendorParamsSchema.extend({ attemptId: z.string().min(1) }).parse(request.params);
    if (!productionAutomationConnectAllowed(params.vendor)) {
      throw app.httpErrors.serviceUnavailable(
        `${automationVendorLabels[params.vendor]} secure sign-in is not live in production yet.`
      );
    }

    const body = automationVendorConnectSessionSchema.parse(request.body);
    const adapter = automationConnectAdapters[params.vendor];
    const existing = await findMarketplaceConnectAttemptByHelperNonce(params.attemptId, body.helperNonce);

    if (!existing || existing.workspaceId !== workspace.id || existing.platform !== params.vendor) {
      throw app.httpErrors.notFound("Marketplace connect attempt not found");
    }

    const attempt = await expireAttemptIfNeeded(existing);

    if (attempt.state !== "AWAITING_LOGIN" && attempt.state !== "CAPTURING_SESSION") {
      throw app.httpErrors.badRequest("This connect attempt cannot accept a captured session right now");
    }

    const capture = adapter.captureSession({
      attempt: toAttemptContext(attempt),
      accountHandle: body.accountHandle ?? "",
      externalAccountId: body.externalAccountId ?? null,
      sessionLabel: body.sessionLabel ?? null,
      captureMode: body.captureMode,
      challengeRequired: body.challengeRequired,
      cookieCount: body.cookieCount ?? null,
      origin: body.origin ?? null,
      storageStateJson: body.storageStateJson ?? null
    });

    const nextAttempt = await updateMarketplaceConnectAttempt(attempt.id, {
      state: capture.state,
      promptsJson: capture.prompts as unknown as Prisma.InputJsonValue,
      externalAccountId: body.externalAccountId ?? null,
      metadataJson: {
        ...((attempt.metadataJson ?? {}) as Record<string, unknown>),
        ...capture.metadata,
        hint: capture.hint
      } satisfies Prisma.InputJsonValue
    });

    if (capture.state === "AWAITING_2FA") {
      return {
        attempt: serializeMarketplaceConnectAttempt(nextAttempt)
      };
    }

    const completed = await completeAutomationAttempt({
      attempt: nextAttempt,
      authUserId: auth.userId,
      accountHandle: body.accountHandle ?? "",
      externalAccountId: body.externalAccountId ?? null,
      sessionLabel: body.sessionLabel ?? null,
      captureMode: body.captureMode,
      cookieCount: body.cookieCount ?? null,
      origin: body.origin ?? null,
      storageStateJson: body.storageStateJson ?? null
    });

    return {
      attempt: serializeMarketplaceConnectAttempt(completed.attempt),
      account: completed.account
        ? serializeMarketplaceAccount(completed.account, {
            workspaceAutomationEnabled: workspace.connectorAutomationEnabled
          })
        : null
    };
  });

  app.post("/api/marketplace-accounts/:vendor/connect/:attemptId/cancel", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = automationVendorParamsSchema.extend({ attemptId: z.string().min(1) }).parse(request.params);
    const existing = await findMarketplaceConnectAttemptForWorkspace(workspace.id, params.attemptId, params.vendor);

    if (!existing) {
      throw app.httpErrors.notFound("Marketplace connect attempt not found");
    }

    const attempt = await updateMarketplaceConnectAttempt(existing.id, {
      state: "FAILED",
      lastErrorCode: "CONNECT_ATTEMPT_CANCELED",
      lastErrorMessage: "The operator canceled the sign-in flow before the session was validated.",
      metadataJson: {
        ...((existing.metadataJson ?? {}) as Record<string, unknown>),
        hint: buildAttemptHint({
          vendor: params.vendor,
          title: `${automationVendorLabels[params.vendor]} sign-in was canceled.`,
          explanation: "No session artifact was stored for this vendor account.",
          severity: "WARNING",
          nextActions: ["Start the connect flow again when you are ready to finish vendor sign-in."],
          canContinue: false
        })
      } satisfies Prisma.InputJsonValue
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: `marketplace.${params.vendor.toLowerCase()}.connect_canceled`,
      targetType: "marketplace_connect_attempt",
      targetId: attempt.id
    });

    return {
      attempt: serializeMarketplaceConnectAttempt(attempt)
    };
  });

  app.post("/api/marketplace-accounts/:id/disable", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const account = await disableMarketplaceAccountForWorkspace(workspace.id, params.id);

    if (!account) {
      throw app.httpErrors.notFound("Marketplace account not found");
    }

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "marketplace.disabled",
      targetType: "marketplace_account",
      targetId: account.id
    });

    return {
      account: serializeMarketplaceAccount(account, {
        workspaceAutomationEnabled: workspace.connectorAutomationEnabled
      })
    };
  });

  app.patch("/api/marketplace-accounts/:id/ebay-live-defaults", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = ebayLiveDefaultsSchema.parse(request.body);
    const existing = await db.marketplaceAccount.findFirst({
      where: {
        id: params.id,
        workspaceId: workspace.id
      }
    });

    if (!existing) {
      throw app.httpErrors.notFound("Marketplace account not found");
    }

    if (existing.platform !== "EBAY") {
      throw app.httpErrors.badRequest("Live defaults can only be updated for eBay accounts");
    }

    const currentMetadata = (existing.credentialMetadataJson ?? {}) as Record<string, unknown>;
    const liveDefaults = Object.fromEntries(
      Object.entries(body).filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    );
    const nextMetadata = {
      ...currentMetadata,
      ebayLiveDefaults: liveDefaults
    };

    const account = await updateMarketplaceAccountMetadataForWorkspace(workspace.id, existing.id, nextMetadata);

    if (!account) {
      throw app.httpErrors.notFound("Marketplace account not found");
    }

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "marketplace.ebay.live_defaults.updated",
      targetType: "marketplace_account",
      targetId: account.id,
      metadata: {
        ebayLiveDefaults: liveDefaults
      }
    });

    return {
      account: serializeMarketplaceAccount(account, {
        workspaceAutomationEnabled: workspace.connectorAutomationEnabled
      })
    };
  });
}
