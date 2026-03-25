import { z } from "zod";

import {
  createMarketplaceAccountForWorkspace,
  db,
  disableMarketplaceAccountForWorkspace,
  recordAuditLog
} from "@reselleros/db";
import { marketplaceAccountSchema } from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

export function registerMarketplaceAccountRoutes(app: ApiApp, context: ApiRouteContext) {
  app.get("/api/marketplace-accounts", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const accounts = await db.marketplaceAccount.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" }
    });

    return { accounts };
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
      secretRef: body.secretRef
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

    return { account };
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
      secretRef: body.secretRef
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

    return { account };
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

    return { account };
  });
}
