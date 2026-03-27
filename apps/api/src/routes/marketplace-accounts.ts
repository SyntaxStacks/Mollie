import { z } from "zod";

import {
  createMarketplaceAccountForWorkspace,
  db,
  disableMarketplaceAccountForWorkspace,
  recordAuditLog,
  updateMarketplaceAccountMetadataForWorkspace,
  upsertMarketplaceAccountConnectionForWorkspace
} from "@reselleros/db";
import {
  ebayLiveDefaultsSchema,
  ebayOAuthCallbackQuerySchema,
  ebayOAuthStartSchema,
  marketplaceAccountSchema
} from "@reselleros/types";
import {
  buildEbayAuthorizationUrl,
  encryptEbayCredentialPayload,
  exchangeEbayAuthorizationCode,
  fetchEbayUserProfile,
  getEbayAccountReadiness,
  parseEbayOAuthState
} from "@reselleros/marketplaces-ebay";
import { getAutomationAccountReadiness } from "@reselleros/marketplaces";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";
import { redactSecretRef } from "../lib/redaction.js";

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
    readiness
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

  app.post("/api/marketplace-accounts/depop/session", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = marketplaceAccountSchema.extend({ platform: z.literal("DEPOP") }).parse({
      ...(request.body as Record<string, unknown>),
      platform: "DEPOP"
    });

    const account = await createMarketplaceAccountForWorkspace(workspace.id, {
      platform: body.platform,
      displayName: body.displayName,
      secretRef: body.secretRef,
      credentialType: "SECRET_REF",
      validationStatus: "VALID",
      credentialMetadata: {
        mode: "session-secret-ref",
        publishMode: "automation"
      }
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "marketplace.depop.connected",
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

  app.post("/api/marketplace-accounts/poshmark/session", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = marketplaceAccountSchema.extend({ platform: z.literal("POSHMARK") }).parse({
      ...(request.body as Record<string, unknown>),
      platform: "POSHMARK"
    });

    const account = await createMarketplaceAccountForWorkspace(workspace.id, {
      platform: body.platform,
      displayName: body.displayName,
      secretRef: body.secretRef,
      credentialType: "SECRET_REF",
      validationStatus: "VALID",
      credentialMetadata: {
        mode: "session-secret-ref",
        publishMode: "automation"
      }
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "marketplace.poshmark.connected",
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

  app.post("/api/marketplace-accounts/whatnot/session", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = marketplaceAccountSchema.extend({ platform: z.literal("WHATNOT") }).parse({
      ...(request.body as Record<string, unknown>),
      platform: "WHATNOT"
    });

    const account = await createMarketplaceAccountForWorkspace(workspace.id, {
      platform: body.platform,
      displayName: body.displayName,
      secretRef: body.secretRef,
      credentialType: "SECRET_REF",
      validationStatus: "VALID",
      credentialMetadata: {
        mode: "session-secret-ref",
        publishMode: "automation"
      }
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "marketplace.whatnot.connected",
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
