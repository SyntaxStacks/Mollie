import { z } from "zod";

import { applyOperatorResearch, buildCatalogSourceReferences, classifyIdentifier, normalizeIdentifier } from "@reselleros/catalog";
import {
  addInventoryImage,
  addInventoryImageForWorkspace,
  createExtensionTaskForWorkspace,
  createExecutionLog,
  createInventoryItem,
  db,
  deleteInventoryItemForWorkspace,
  deleteInventoryImageForWorkspace,
  findInventoryItemDetailForWorkspace,
  findInventoryItemForWorkspace,
  findInventoryItemWithImagesForWorkspace,
  listWorkspaceInventory,
  recordAuditLog,
  reorderInventoryImagesForWorkspace,
  updateInventoryItemForWorkspace
} from "@reselleros/db";
import { getAutomationAccountReadiness } from "@reselleros/marketplaces";
import { getEbayAccountReadiness, getEbayPublishPreflight, selectEbayMarketplaceAccount } from "@reselleros/marketplaces-ebay";
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
import { imageInputSchema, inventoryBarcodeImportSchema, inventoryInputSchema, platforms, type LinkedPublishPlatformResult, type Platform } from "@reselleros/types";

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

function normalizeInventoryText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function poshmarkItemNeedsSizing(item: {
  category?: string | null;
  title?: string | null;
  brand?: string | null;
}) {
  const haystack = `${item.category ?? ""} ${item.title ?? ""} ${item.brand ?? ""}`.toLowerCase();
  return [
    "jacket",
    "coat",
    "top",
    "shoe",
    "dress",
    "pants",
    "hoodie",
    "shirt",
    "sweater",
    "shorts",
    "skirt",
    "jeans",
    "sneaker",
    "boot"
  ].some((token) => haystack.includes(token));
}

function poshmarkBrandLikelyRequired(item: {
  category?: string | null;
  title?: string | null;
}) {
  const haystack = `${item.category ?? ""} ${item.title ?? ""}`.toLowerCase();
  return ["apparel", "bags", "shoes", "accessories", "fashion", "clothing", "jewelry"].some((token) => haystack.includes(token));
}

async function getPoshmarkPublishReadiness(workspaceId: string, inventoryItemId: string) {
  const item = await findInventoryItemDetailForWorkspace(workspaceId, inventoryItemId);

  if (!item) {
    return {
      item: null,
      ready: false,
      missingFields: ["inventory item"],
      blockingReasons: ["Inventory item not found."]
    };
  }

  const approvedDraft =
    item.listingDrafts.find((draft) => draft.platform === "POSHMARK" && draft.reviewStatus === "APPROVED") ?? null;
  const itemAttributes =
    item.attributesJson && typeof item.attributesJson === "object" ? (item.attributesJson as Record<string, unknown>) : {};
  const missingFields: string[] = [];
  const blockingReasons: string[] = [];

  if (!normalizeInventoryText(item.title)) {
    missingFields.push("title");
  }

  if (!normalizeInventoryText(itemAttributes.description)) {
    missingFields.push("description");
  }

  if (typeof item.priceRecommendation !== "number" || !Number.isFinite(item.priceRecommendation) || item.priceRecommendation <= 0) {
    missingFields.push("price");
  }

  if (!normalizeInventoryText(item.category)) {
    missingFields.push("category");
  }

  if (item.images.length === 0) {
    missingFields.push("photos");
  }

  if (poshmarkItemNeedsSizing(item) && !normalizeInventoryText(item.size)) {
    missingFields.push("size");
  }

  if (poshmarkBrandLikelyRequired(item) && !normalizeInventoryText(item.brand)) {
    missingFields.push("brand");
  }

  if (!approvedDraft) {
    blockingReasons.push("Approve a Poshmark draft before publishing.");
  }

  return {
    item,
    ready: missingFields.length === 0 && blockingReasons.length === 0,
    missingFields,
    blockingReasons
  };
}

async function ensurePendingPoshmarkListing(inventoryItemId: string, marketplaceAccountId: string) {
  const existing = await db.platformListing.findFirst({
    where: {
      inventoryItemId,
      marketplaceAccountId,
      platform: "POSHMARK"
    }
  });

  if (existing) {
    return db.platformListing.update({
      where: { id: existing.id },
      data: {
        status: existing.status === "PUBLISHED" ? existing.status : "PENDING"
      }
    });
  }

  return db.platformListing.create({
    data: {
      inventoryItemId,
      marketplaceAccountId,
      platform: "POSHMARK",
      status: "PENDING"
    }
  });
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

  if (platform === "POSHMARK") {
    const readiness = await getPoshmarkPublishReadiness(workspaceId, inventoryItemId);

    if (!readiness.item) {
      throw app.httpErrors.notFound("Inventory item not found");
    }

    if (!readiness.ready) {
      throw app.httpErrors.preconditionFailed(
        [...readiness.blockingReasons, ...readiness.missingFields.map((field) => `Missing ${field}.`)].join(" ")
      );
    }

    const correlationId = crypto.randomUUID();
    const executionLog = await createExecutionLog({
      workspaceId,
      inventoryItemId,
      jobName: getPublishJobName(platform),
      connector: platform,
      correlationId,
      requestPayload: {
        marketplaceAccountId: account.id,
        mode: "remote-automation"
      }
    });

    await ensurePendingPoshmarkListing(inventoryItemId, account.id);

    const task = await createExtensionTaskForWorkspace(workspaceId, {
      inventoryItemId,
      marketplaceAccountId: account.id,
      platform: "POSHMARK",
      action: "PUBLISH_LISTING",
      payload: {
        remoteAutomation: true,
        remoteTaskType: "PUBLISH_LISTING",
        correlationId,
        executionLogId: executionLog.id,
        phase: "open_session"
      }
    });

    return {
      executionLog,
      draft,
      task
    };
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

async function getLinkedPublishTargets(workspaceId: string): Promise<Array<{
  platform: Platform;
  marketplaceAccountId?: string | null;
  displayName?: string | null;
  ready: boolean;
  hint?: LinkedPublishPlatformResult["hint"];
  summary: string;
}>> {
  const accounts = await db.marketplaceAccount.findMany({
    where: {
      workspaceId,
      status: {
        in: ["CONNECTED", "ERROR", "DISABLED"]
      }
    },
    orderBy: { createdAt: "asc" }
  });

  const ebayAccounts = accounts
    .filter((account) => account.platform === "EBAY")
    .map((account) => ({
      id: account.id,
      platform: "EBAY" as const,
      displayName: account.displayName,
      secretRef: account.secretRef,
      status: account.status,
      credentialType: account.credentialType,
      validationStatus: account.validationStatus,
      externalAccountId: account.externalAccountId,
      credentialMetadata: (account.credentialMetadataJson ?? null) as Record<string, unknown> | null
    }));
  const ebaySelection = selectEbayMarketplaceAccount(ebayAccounts);
  const ebayReadiness = ebaySelection?.evaluation
    ? ebaySelection.evaluation
    : ebaySelection?.account
      ? getEbayAccountReadiness({
          account: ebaySelection.account,
          accountStatus: ebaySelection.account.status,
          lastErrorMessage: null
        })
      : null;

  const automationPlatforms: Platform[] = ["DEPOP", "POSHMARK", "WHATNOT"];
  const automationTargets = automationPlatforms.map((platform) => {
    const account = accounts.find((candidate) => candidate.platform === platform) ?? null;

    if (!account) {
      return {
        platform,
        ready: false,
        summary: `Connect a ${platform === "DEPOP" ? "Depop" : platform === "POSHMARK" ? "Poshmark" : "Whatnot"} account first.`,
        hint: null
      };
    }

    const readiness = getAutomationAccountReadiness({
      account: {
        id: account.id,
        platform,
        displayName: account.displayName,
        secretRef: account.secretRef,
        status: account.status,
        credentialType: account.credentialType,
        validationStatus: account.validationStatus,
        externalAccountId: account.externalAccountId,
        credentialMetadata: (account.credentialMetadataJson ?? null) as Record<string, unknown> | null
      },
      accountStatus: account.status,
      lastErrorMessage: account.lastErrorMessage
    });

    return {
      platform,
      marketplaceAccountId: account.id,
      displayName: account.displayName,
      ready: readiness.status === "READY",
      summary: readiness.summary,
      hint: readiness.hint
    };
  });

  return [
    {
      platform: "EBAY",
      marketplaceAccountId: ebaySelection?.account?.id ?? null,
      displayName: ebaySelection?.account?.displayName ?? null,
      ready: ebayReadiness?.status === "READY",
      summary: ebayReadiness?.summary ?? "Connect an eBay account first.",
      hint: ebayReadiness?.hint ?? null
    },
    ...automationTargets
  ];
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
        intakeDecision: body.intakeDecision,
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

  app.delete("/api/inventory/:id", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const deletedItem = await deleteInventoryItemForWorkspace(workspace.id, params.id);

    if (!deletedItem) {
      throw app.httpErrors.notFound("Inventory item not found");
    }

    const storageDeletion = await Promise.all(
      deletedItem.images.map((image) => deleteManagedInventoryImage(image.url))
    );

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "inventory.deleted",
      targetType: "inventory_item",
      targetId: params.id,
      metadata: {
        title: deletedItem.title,
        imageCount: deletedItem.images.length,
        managedImageDeletes: storageDeletion.filter((entry) => entry.deleted).length
      }
    });

    return {
      ok: true,
      itemId: deletedItem.id
    };
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

  app.post("/api/inventory/:id/drafts/generate-linked", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        platforms: z.array(z.enum(platforms)).min(1).optional()
      })
      .parse(request.body ?? {});
    const item = await findInventoryItemForWorkspace(workspace.id, params.id);

    if (!item) {
      throw app.httpErrors.notFound("Inventory item not found");
    }

    const allowedPlatforms = body.platforms ?? [...platforms];
    const targets = (await getLinkedPublishTargets(workspace.id)).filter((target) => allowedPlatforms.includes(target.platform));
    const readyPlatforms = targets.filter((target) => target.ready).map((target) => target.platform);

    if (readyPlatforms.length > 0) {
      await enqueueJob(
        "inventory.generateListingDraft",
        {
          inventoryItemId: item.id,
          workspaceId: workspace.id,
          platforms: readyPlatforms,
          correlationId: crypto.randomUUID()
        },
        {
          jobId: buildIdempotencyKey("inventory.generateListingDraft", `${item.id}:${readyPlatforms.join(",")}`)
        }
      );
    }

    return {
      inventoryItemId: item.id,
      results: targets.map((target) => ({
        platform: target.platform,
        marketplaceAccountId: target.marketplaceAccountId ?? null,
        displayName: target.displayName ?? null,
        state: target.ready ? "QUEUED" : "BLOCKED",
        summary: target.ready ? `Queued draft generation for ${target.platform}.` : target.summary,
        hint: target.hint ?? null,
        executionLogId: null
      }))
    };
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

  app.post("/api/inventory/:id/publish-linked", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        platforms: z.array(z.enum(platforms)).min(1).optional()
      })
      .parse(request.body ?? {});
    const item = await findInventoryItemForWorkspace(workspace.id, params.id);

    if (!item) {
      throw app.httpErrors.notFound("Inventory item not found");
    }

    const allowedPlatforms = body.platforms ?? [...platforms];
    const targets = (await getLinkedPublishTargets(workspace.id)).filter((target) => allowedPlatforms.includes(target.platform));
    const results: LinkedPublishPlatformResult[] = [];

    for (const target of targets) {
      if (!target.ready) {
        results.push({
          platform: target.platform,
          marketplaceAccountId: target.marketplaceAccountId ?? null,
          displayName: target.displayName ?? null,
          state: "BLOCKED",
          summary: target.summary,
          hint: target.hint ?? null,
          executionLogId: null
        });
        continue;
      }

      try {
        const queued = await queuePublish(app, target.platform, item.id, workspace.id);
        results.push({
          platform: target.platform,
          marketplaceAccountId: target.marketplaceAccountId ?? null,
          displayName: target.displayName ?? null,
          state: "QUEUED",
          summary: `Queued ${target.platform} publish.`,
          hint: target.hint ?? null,
          executionLogId: queued.executionLog.id
        });
      } catch (error) {
        results.push({
          platform: target.platform,
          marketplaceAccountId: target.marketplaceAccountId ?? null,
          displayName: target.displayName ?? null,
          state: "FAILED_TO_QUEUE",
          summary: error instanceof Error ? error.message : `Could not queue ${target.platform} publish.`,
          hint: target.hint ?? null,
          executionLogId: null
        });
      }
    }

    return {
      inventoryItemId: item.id,
      results
    };
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
