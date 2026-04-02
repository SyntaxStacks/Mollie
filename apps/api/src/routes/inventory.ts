import { z } from "zod";

import { applyOperatorResearch, buildCatalogSourceReferences, classifyIdentifier, normalizeIdentifier } from "@reselleros/catalog";
import {
  addInventoryImage,
  addInventoryImageForWorkspace,
  createExecutionLog,
  createInventoryItem,
  db,
  deleteInventoryImageForWorkspace,
  findInventoryItemDetailForWorkspace,
  findInventoryItemForWorkspace,
  findInventoryItemWithImagesForWorkspace,
  listWorkspaceInventory,
  recordAuditLog,
  reorderInventoryImagesForWorkspace,
  updateInventoryItemForWorkspace
} from "@reselleros/db";
import { getEbayPublishPreflight, selectEbayMarketplaceAccount } from "@reselleros/marketplaces-ebay";
import { buildIdempotencyKey, enqueueJob, getPublishJobName } from "@reselleros/queue";
import {
  acceptedImageContentTypes,
  deleteManagedInventoryImage,
  inferContentTypeFromStorageKey,
  maxInventoryImageBytes,
  managedUploadExists,
  openManagedUploadStream,
  uploadInventoryImage
} from "@reselleros/storage";
import { imageInputSchema, inventoryBarcodeImportSchema, inventoryInputSchema, platforms, type Platform } from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

function resolveApiPublicBaseUrl(request: {
  protocol?: string;
  headers: Record<string, unknown>;
}) {
  const configured =
    process.env.API_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    null;

  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const forwardedProto = typeof request.headers["x-forwarded-proto"] === "string" ? request.headers["x-forwarded-proto"] : null;
  const forwardedHost = typeof request.headers["x-forwarded-host"] === "string" ? request.headers["x-forwarded-host"] : null;
  const host = forwardedHost ?? (typeof request.headers.host === "string" ? request.headers.host : null);
  const protocol = forwardedProto ?? request.protocol ?? "http";

  if (!host) {
    return (process.env.APP_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
  }

  return `${protocol}://${host}`;
}

async function queuePublish(
  app: ApiApp,
  platform: Platform,
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

  const ebaySelection =
    platform === "EBAY"
      ? selectEbayMarketplaceAccount(
          accounts.map((candidate) => ({
            id: candidate.id,
            platform: "EBAY" as const,
            displayName: candidate.displayName,
            secretRef: candidate.secretRef,
            status: candidate.status,
            credentialType: candidate.credentialType,
            validationStatus: candidate.validationStatus,
            externalAccountId: candidate.externalAccountId,
            credentialMetadata: (candidate.credentialMetadataJson ?? null) as Record<string, unknown> | null
          }))
        )
      : null;
  const account =
    platform === "EBAY"
      ? ebaySelection?.account ?? null
      : accounts.at(0) ?? null;

  if (!account) {
    if (platform === "EBAY" && ebaySelection?.evaluation) {
      throw app.httpErrors.preconditionFailed(`${ebaySelection.evaluation.summary} ${ebaySelection.evaluation.detail}`.trim());
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
    jobName: getPublishJobName(platform),
    connector: platform,
    correlationId,
    requestPayload: {
      draftId: draft.id,
      marketplaceAccountId: account.id,
      ...(platform === "EBAY"
        ? {
            ebayState: ebaySelection?.evaluation?.state ?? null,
            ebayPublishMode: ebaySelection?.evaluation?.publishMode ?? null
          }
        : {})
    }
  });

  await enqueueJob(getPublishJobName(platform), {
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

  app.post("/api/inventory/import/barcode", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = inventoryBarcodeImportSchema.parse(request.body);
    const identifier = (body.identifier?.trim() || body.barcode?.trim() || "").trim();
    const normalizedIdentifier = normalizeIdentifier(identifier);
    const identifierType = body.identifierType ?? classifyIdentifier(normalizedIdentifier);
    const uniqueImageUrls = [...new Set(body.imageUrls.map((url) => url.trim()).filter(Boolean))];
    const observedPrices = body.observations.map((observation) => observation.price);
    const primaryObservation = body.observations[0] ?? null;

    const sourceReferences = buildCatalogSourceReferences({
      primarySourceMarket: body.primarySourceMarket,
      primarySourceUrl: body.primarySourceUrl ?? primaryObservation?.sourceUrl ?? null,
      referenceUrls: body.referenceUrls
    });

    const catalogRecord = await applyOperatorResearch({
      workspaceId: workspace.id,
      identifier: normalizedIdentifier,
      identifierType,
      title: body.title,
      brand: body.brand ?? null,
      category: body.category,
      imageUrls: uniqueImageUrls,
      sourceReferences,
      observations: body.observations.map((observation) => ({
        ...observation,
        observedAt: new Date()
      }))
    });

    const item = await createInventoryItem(workspace.id, {
      title: body.title,
      brand: body.brand ?? null,
      category: body.category,
      condition: body.condition,
      size: body.size ?? null,
      color: body.color ?? null,
      quantity: body.quantity,
      costBasis: body.costBasis,
      estimatedResaleMin: body.estimatedResaleMin ?? (observedPrices.length ? Math.min(...observedPrices) : null),
      estimatedResaleMax: body.estimatedResaleMax ?? (observedPrices.length ? Math.max(...observedPrices) : null),
      priceRecommendation: body.priceRecommendation ?? body.observations[0]?.price ?? null,
      attributes: {
        importSource: "IDENTIFIER_RESEARCH",
        identifier: normalizedIdentifier,
        identifierType,
        primarySourceMarket: body.primarySourceMarket,
        primarySourceUrl: body.primarySourceUrl ?? primaryObservation?.sourceUrl ?? null,
        referenceUrls: body.referenceUrls,
        catalogIdentifierId: catalogRecord.id,
        acceptedCandidate: body.acceptedCandidate,
        productLookup: body.acceptedCandidate
          ? {
              provider: body.acceptedCandidate.provider,
              confidenceScore: body.acceptedCandidate.confidenceScore,
              confidenceState: body.acceptedCandidate.confidenceState,
              safeToPrefill: body.acceptedCandidate.safeToPrefill,
              productUrl: body.acceptedCandidate.productUrl ?? null,
              asin: body.acceptedCandidate.asin ?? null
            }
          : null,
        marketObservations: body.observations.map((observation) => ({
          ...observation,
          observedAt: new Date().toISOString()
        }))
      }
    });

    await Promise.all(
      uniqueImageUrls.map((url, position) =>
        addInventoryImage(item.id, {
          url,
          kind: "ORIGINAL",
          position
        })
      )
    );

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "inventory.imported_from_barcode",
      targetType: "inventory_item",
      targetId: item.id,
      metadata: {
        identifier: normalizedIdentifier,
        identifierType,
        primarySourceMarket: body.primarySourceMarket,
        catalogIdentifierId: catalogRecord.id,
        generateDrafts: body.generateDrafts,
        draftPlatforms: body.generateDrafts ? body.draftPlatforms : [],
        imageCount: uniqueImageUrls.length,
        observationCount: body.observations.length
      }
    });

    if (body.generateDrafts && body.draftPlatforms.length > 0) {
      await enqueueJob(
        "inventory.generateListingDraft",
        {
          inventoryItemId: item.id,
          workspaceId: workspace.id,
          platforms: body.draftPlatforms,
          correlationId: crypto.randomUUID()
        },
        {
          jobId: buildIdempotencyKey("inventory.generateListingDraft", `${item.id}:${body.draftPlatforms.join(",")}`)
        }
      );
    }

    const detail = await findInventoryItemDetailForWorkspace(workspace.id, item.id);

    return {
      item: detail ?? item,
      draftsQueued: body.generateDrafts && body.draftPlatforms.length > 0,
      draftPlatforms: body.generateDrafts ? body.draftPlatforms : []
    };
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

  app.post("/api/inventory/:id/images/upload", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const item = await findInventoryItemForWorkspace(workspace.id, params.id);

    if (!item) {
      throw app.httpErrors.notFound("Inventory item not found");
    }

    const file = await request.file({
      limits: {
        files: 1,
        fileSize: maxInventoryImageBytes
      }
    });

    if (!file) {
      throw app.httpErrors.badRequest("Choose an image file to upload");
    }

    if (!acceptedImageContentTypes.has(file.mimetype)) {
      throw app.httpErrors.unsupportedMediaType("Upload a JPG, PNG, WEBP, or GIF image");
    }

    const positionValue = file.fields.position;
    const position =
      positionValue && "value" in positionValue && typeof positionValue.value === "string"
        ? Number(positionValue.value)
        : 0;

    if (!Number.isFinite(position) || position < 0) {
      throw app.httpErrors.badRequest("Position must be a non-negative number");
    }

    const upload = await uploadInventoryImage({
      workspaceId: workspace.id,
      inventoryItemId: params.id,
      filename: file.filename,
      contentType: file.mimetype,
      buffer: await file.toBuffer(),
      publicBaseUrl: resolveApiPublicBaseUrl(request)
    });

    const createdImage = await addInventoryImageForWorkspace(workspace.id, item.id, {
      url: upload.url,
      kind: "ORIGINAL",
      position,
      width: null,
      height: null
    });

    if (!createdImage) {
      throw app.httpErrors.notFound("Inventory item not found");
    }

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "inventory.image_uploaded",
      targetType: "inventory_item",
      targetId: item.id,
      metadata: {
        storageKey: upload.storageKey,
        contentType: upload.contentType,
        size: upload.size
      }
    });

    return { image: createdImage.image };
  });

  app.delete("/api/inventory/:id/images/:imageId", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z
      .object({
        id: z.string().min(1),
        imageId: z.string().min(1)
      })
      .parse(request.params);
    const deletedImage = await deleteInventoryImageForWorkspace(workspace.id, params.id, params.imageId);

    if (!deletedImage) {
      throw app.httpErrors.notFound("Inventory image not found");
    }

    const storageDeletion = await deleteManagedInventoryImage(deletedImage.image.url);

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "inventory.image_deleted",
      targetType: "inventory_item",
      targetId: params.id,
      metadata: {
        imageId: deletedImage.image.id,
        url: deletedImage.image.url,
        storageManaged: storageDeletion.managed,
        storageDeleted: storageDeletion.deleted
      }
    });

    return {
      ok: true,
      imageId: deletedImage.image.id,
      storageDeletion
    };
  });

  app.post("/api/inventory/:id/images/reorder", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        imageIds: z.array(z.string().min(1))
      })
      .parse(request.body);

    try {
      const item = await reorderInventoryImagesForWorkspace(workspace.id, params.id, body.imageIds);

      if (!item) {
        throw app.httpErrors.notFound("Inventory item not found");
      }

      await recordAuditLog({
        workspaceId: workspace.id,
        actorUserId: auth.userId,
        action: "inventory.images_reordered",
        targetType: "inventory_item",
        targetId: item.id,
        metadata: {
          imageIds: body.imageIds
        }
      });

      return { images: item.images };
    } catch (error) {
      if (error instanceof Error && error.message === "Image reorder must include every image exactly once") {
        throw app.httpErrors.badRequest(error.message);
      }

      throw error;
    }
  });

  app.get("/api/uploads/*", async (request, reply) => {
    const wildcard = (request.params as { "*": string })["*"];

    if (!wildcard) {
      throw app.httpErrors.notFound("Upload not found");
    }

    const storageKey = wildcard
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
    const exists = await managedUploadExists(storageKey);

    if (!exists) {
      throw app.httpErrors.notFound("Upload not found");
    }

    const stream = openManagedUploadStream(storageKey);

    if (!stream) {
      throw app.httpErrors.notFound("Upload not found");
    }

    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.type(inferContentTypeFromStorageKey(storageKey));
    return reply.send(stream);
  });

  app.post("/api/inventory/:id/generate-drafts", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        platforms: z.array(z.enum(platforms)).min(1)
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
        status: account.status,
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

  app.post("/api/inventory/:id/publish/poshmark", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);

    return queuePublish(app, "POSHMARK", params.id, workspace.id);
  });

  app.post("/api/inventory/:id/publish/whatnot", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);

    return queuePublish(app, "WHATNOT", params.id, workspace.id);
  });
}
