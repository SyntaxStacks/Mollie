import { z } from "zod";

import {
  addInventoryImageForWorkspace,
  createExecutionLog,
  createInventoryItem,
  db,
  findInventoryItemDetailForWorkspace,
  findInventoryItemForWorkspace,
  findInventoryItemWithImagesForWorkspace,
  listWorkspaceInventory,
  recordAuditLog,
  updateInventoryItemForWorkspace
} from "@reselleros/db";
import { getEbayPublishPreflight, selectEbayMarketplaceAccount } from "@reselleros/marketplaces-ebay";
import { buildIdempotencyKey, enqueueJob } from "@reselleros/queue";
import { imageInputSchema, inventoryInputSchema } from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

async function queuePublish(
  app: ApiApp,
  platform: "EBAY" | "DEPOP",
  inventoryItemId: string,
  workspaceId: string
) {
  const [item, accounts, draft] = await Promise.all([
    findInventoryItemWithImagesForWorkspace(workspaceId, inventoryItemId),
    db.marketplaceAccount.findMany({
      where: {
        workspaceId,
        platform,
        status: "CONNECTED"
      },
      orderBy: { createdAt: "asc" }
    }),
    db.listingDraft.findFirst({
      where: {
        inventoryItemId,
        platform,
        reviewStatus: "APPROVED"
      }
    })
  ]);

  if (!item) {
    throw app.httpErrors.notFound("Inventory item not found");
  }

  const account =
    platform === "EBAY"
      ? selectEbayMarketplaceAccount(
          accounts.map((candidate) => ({
            id: candidate.id,
            platform: "EBAY" as const,
            displayName: candidate.displayName,
            secretRef: candidate.secretRef,
            credentialType: candidate.credentialType,
            validationStatus: candidate.validationStatus,
            externalAccountId: candidate.externalAccountId,
            credentialMetadata: (candidate.credentialMetadataJson ?? null) as Record<string, unknown> | null
          }))
        ).account
      : accounts.at(0) ?? null;

  if (!account) {
    if (platform === "EBAY" && accounts.some((candidate) => candidate.credentialType === "OAUTH_TOKEN_SET")) {
      throw app.httpErrors.preconditionFailed(
        "eBay OAuth is connected, but live eBay publish is not enabled yet. Keep using the simulated eBay connector for pilot publish jobs."
      );
    }

    throw app.httpErrors.preconditionFailed(`Connect a ${platform} account first`);
  }

  if (!draft) {
    throw app.httpErrors.preconditionFailed(`Approve a ${platform} draft before publishing`);
  }

  const correlationId = crypto.randomUUID();
  const executionLog = await createExecutionLog({
    workspaceId,
    inventoryItemId,
    jobName: platform === "EBAY" ? "listing.publishEbay" : "listing.publishDepop",
    connector: platform,
    correlationId,
    requestPayload: {
      draftId: draft.id,
      marketplaceAccountId: account.id
    }
  });

  await enqueueJob(platform === "EBAY" ? "listing.publishEbay" : "listing.publishDepop", {
    inventoryItemId,
    draftId: draft.id,
    marketplaceAccountId: account.id,
    executionLogId: executionLog.id,
    correlationId
  });

  return {
    executionLog,
    draft
  };
}

export function registerInventoryRoutes(app: ApiApp, context: ApiRouteContext) {
  app.get("/api/inventory", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const items = await listWorkspaceInventory(workspace.id);

    return { items };
  });

  app.post("/api/inventory", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = inventoryInputSchema.parse(request.body);
    const item = await createInventoryItem(workspace.id, {
      ...body,
      attributes: body.attributes
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "inventory.created",
      targetType: "inventory_item",
      targetId: item.id
    });

    return { item };
  });

  app.get("/api/inventory/:id", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const item = await findInventoryItemDetailForWorkspace(workspace.id, params.id);

    if (!item) {
      throw app.httpErrors.notFound("Inventory item not found");
    }

    return { item };
  });

  app.patch("/api/inventory/:id", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = inventoryInputSchema.partial().parse(request.body);
    const item = await updateInventoryItemForWorkspace(workspace.id, params.id, {
      title: body.title,
      brand: body.brand,
      category: body.category,
      condition: body.condition,
      size: body.size,
      color: body.color,
      quantity: body.quantity,
      costBasis: body.costBasis,
      estimatedResaleMin: body.estimatedResaleMin,
      estimatedResaleMax: body.estimatedResaleMax,
      priceRecommendation: body.priceRecommendation,
      attributesJson: body.attributes
    });

    if (!item) {
      throw app.httpErrors.notFound("Inventory item not found");
    }

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "inventory.updated",
      targetType: "inventory_item",
      targetId: item.id
    });

    return { item };
  });

  app.post("/api/inventory/:id/images", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = imageInputSchema.parse(request.body);
    const createdImage = await addInventoryImageForWorkspace(workspace.id, params.id, {
      url: body.url,
      kind: body.kind,
      width: body.width ?? null,
      height: body.height ?? null,
      position: body.position
    });

    if (!createdImage) {
      throw app.httpErrors.notFound("Inventory item not found");
    }

    return { image: createdImage.image };
  });

  app.post("/api/inventory/:id/generate-drafts", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        platforms: z.array(z.enum(["EBAY", "DEPOP"])).min(1)
      })
      .parse(request.body);
    const item = await findInventoryItemForWorkspace(workspace.id, params.id);

    if (!item) {
      throw app.httpErrors.notFound("Inventory item not found");
    }

    await enqueueJob(
      "inventory.generateListingDraft",
      {
        inventoryItemId: item.id,
        workspaceId: workspace.id,
        platforms: body.platforms,
        correlationId: crypto.randomUUID()
      },
      {
        jobId: buildIdempotencyKey("inventory.generateListingDraft", `${item.id}:${body.platforms.join(",")}`)
      }
    );

    return { ok: true };
  });

  app.get("/api/inventory/:id/drafts", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const drafts = await db.listingDraft.findMany({
      where: {
        inventoryItemId: params.id,
        inventoryItem: {
          workspaceId: workspace.id
        }
      },
      orderBy: { createdAt: "desc" }
    });

    return { drafts };
  });

  app.get("/api/inventory/:id/preflight/ebay", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);

    const [item, accounts, draft] = await Promise.all([
      findInventoryItemWithImagesForWorkspace(workspace.id, params.id),
      db.marketplaceAccount.findMany({
        where: {
          workspaceId: workspace.id,
          platform: "EBAY",
          status: {
            in: ["CONNECTED", "ERROR"]
          }
        },
        orderBy: { createdAt: "asc" }
      }),
      db.listingDraft.findFirst({
        where: {
          inventoryItemId: params.id,
          platform: "EBAY",
          reviewStatus: "APPROVED"
        }
      })
    ]);

    if (!item) {
      throw app.httpErrors.notFound("Inventory item not found");
    }

    const preflight = getEbayPublishPreflight({
      accounts: accounts.map((account) => ({
        id: account.id,
        platform: "EBAY",
        displayName: account.displayName,
        secretRef: account.secretRef,
        credentialType: account.credentialType,
        validationStatus: account.validationStatus,
        externalAccountId: account.externalAccountId,
        credentialMetadata: (account.credentialMetadataJson ?? null) as Record<string, unknown> | null
      })),
      images: item.images.map((image) => image.url),
      draftApproved: Boolean(draft),
      draftAttributes: draft ? ((draft.attributesJson ?? {}) as Record<string, unknown>) : null
    });

    return { preflight };
  });

  app.post("/api/inventory/:id/publish/ebay", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);

    return queuePublish(app, "EBAY", params.id, workspace.id);
  });

  app.post("/api/inventory/:id/publish/depop", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);

    return queuePublish(app, "DEPOP", params.id, workspace.id);
  });
}
