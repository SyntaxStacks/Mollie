import { z } from "zod";

import {
  claimExtensionTaskForWorkspace,
  addInventoryImage,
  createExtensionTaskForWorkspace,
  createInventoryImportItemForRun,
  createInventoryImportRunForWorkspace,
  createInventoryItem,
  db,
  heartbeatExtensionTaskForWorkspace,
  findExtensionTaskForWorkspace,
  findInventoryItemDetailForWorkspace,
  listExtensionTasksForWorkspace,
  recordAuditLog,
  updateExtensionTask,
  updateInventoryImportRun
} from "@reselleros/db";
import {
  extensionEbayImportSchema,
  extensionTaskClaimSchema,
  extensionTaskCreateSchema,
  extensionTaskHeartbeatSchema,
  extensionTaskResultUpdateSchema,
  type ExtensionTaskView,
  type MarketplaceCapabilitySummary,
  type UniversalListing
} from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

const capabilitySummary: MarketplaceCapabilitySummary[] = [
  {
    platform: "EBAY",
    capabilities: ["EXTENSION_IMPORT", "API_PUBLISH", "UPDATE", "DELIST", "RELIST"],
    importMode: "EXTENSION",
    publishMode: "API",
    bulkImport: false,
    bulkPublish: false
  },
  {
    platform: "DEPOP",
    capabilities: ["EXTENSION_PUBLISH"],
    importMode: "NONE",
    publishMode: "EXTENSION",
    bulkImport: false,
    bulkPublish: false
  },
  {
    platform: "POSHMARK",
    capabilities: [],
    importMode: "NONE",
    publishMode: "NONE",
    bulkImport: false,
    bulkPublish: false
  },
  {
    platform: "WHATNOT",
    capabilities: [],
    importMode: "NONE",
    publishMode: "NONE",
    bulkImport: false,
    bulkPublish: false
  }
];

function serializeExtensionTask(task: {
  id: string;
  workspaceId: string;
  inventoryItemId: string | null;
  inventoryImportRunId: string | null;
  marketplaceAccountId: string | null;
  platform: "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT";
  action: "IMPORT_LISTING" | "PREPARE_DRAFT" | "PUBLISH_LISTING" | "UPDATE_LISTING" | "DELIST_LISTING" | "RELIST_LISTING";
  state: "QUEUED" | "RUNNING" | "NEEDS_INPUT" | "FAILED" | "SUCCEEDED" | "CANCELED";
  queuedAt: Date;
  attemptCount: number;
  runnerInstanceId: string | null;
  claimedAt: Date | null;
  lastHeartbeatAt: Date | null;
  retryAfter: Date | null;
  needsInputReason: string | null;
  payloadJson: unknown;
  resultJson: unknown;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ExtensionTaskView {
  return {
    id: task.id,
    workspaceId: task.workspaceId,
    inventoryItemId: task.inventoryItemId,
    inventoryImportRunId: task.inventoryImportRunId,
    marketplaceAccountId: task.marketplaceAccountId,
    platform: task.platform,
    action: task.action,
    state: task.state,
    queuedAt: task.queuedAt.toISOString(),
    attemptCount: task.attemptCount,
    runnerInstanceId: task.runnerInstanceId ?? null,
    claimedAt: task.claimedAt?.toISOString() ?? null,
    lastHeartbeatAt: task.lastHeartbeatAt?.toISOString() ?? null,
    retryAfter: task.retryAfter?.toISOString() ?? null,
    needsInputReason: task.needsInputReason ?? null,
    lastErrorCode: task.lastErrorCode as ExtensionTaskView["lastErrorCode"],
    lastErrorMessage: task.lastErrorMessage,
    payload: (task.payloadJson ?? null) as Record<string, unknown> | null,
    result: (task.resultJson ?? null) as Record<string, unknown> | null,
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString()
  };
}

function cleanExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

function parsePrice(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function buildUniversalListing(item: Awaited<ReturnType<typeof findInventoryItemDetailForWorkspace>>, platform: "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT"): UniversalListing {
  if (!item) {
    throw new Error("Inventory item not found");
  }

  const approvedDraft =
    item.listingDrafts.find((draft) => draft.platform === platform && draft.reviewStatus === "APPROVED") ??
    item.listingDrafts.find((draft) => draft.platform === platform) ??
    null;
  const draftAttributes = (approvedDraft?.attributesJson ?? {}) as Record<string, unknown>;
  const itemAttributes = (item.attributesJson ?? {}) as Record<string, unknown>;
  const description =
    approvedDraft?.generatedDescription ??
    (typeof draftAttributes.description === "string" ? draftAttributes.description : null) ??
    (typeof itemAttributes.description === "string" ? itemAttributes.description : null) ??
    "";
  const tags = Array.isArray(approvedDraft?.generatedTagsJson)
    ? approvedDraft?.generatedTagsJson.filter((value): value is string => typeof value === "string")
    : Array.isArray(itemAttributes.tags)
      ? itemAttributes.tags.filter((value): value is string => typeof value === "string")
      : [];
  const labels = Array.isArray(itemAttributes.labels)
    ? itemAttributes.labels.filter((value): value is string => typeof value === "string")
    : [];

  return {
    inventoryItemId: item.id,
    sku: item.sku,
    title: approvedDraft?.generatedTitle ?? item.title,
    description,
    category: item.category,
    brand: item.brand ?? null,
    condition: item.condition,
    price: approvedDraft?.generatedPrice ?? item.priceRecommendation ?? item.estimatedResaleMax ?? item.estimatedResaleMin ?? null,
    quantity: item.quantity,
    size: item.size ?? null,
    color: item.color ?? null,
    tags,
    labels,
    freeShipping: itemAttributes.freeShipping === true,
    photos: item.images.map((image, index) => ({
      url: image.url,
      kind: index === 0 ? "PRIMARY" : "GALLERY",
      alt: approvedDraft?.generatedTitle ?? item.title
    })),
    marketplaceOverrides: approvedDraft
      ? {
          [platform]: {
            title: approvedDraft.generatedTitle,
            description: approvedDraft.generatedDescription,
            price: approvedDraft.generatedPrice,
            attributes: draftAttributes
          }
        }
      : {},
    metadata: {
      itemStatus: item.status,
      listingDraftId: approvedDraft?.id ?? null,
      listingDraftReviewStatus: approvedDraft?.reviewStatus ?? null
    }
  };
}

async function syncPublishedPlatformListingFromExtensionTask(input: {
  workspaceId: string;
  task: Awaited<ReturnType<typeof findExtensionTaskForWorkspace>>;
  result: Record<string, unknown> | null;
}) {
  if (!input.task?.inventoryItemId) {
    return null;
  }

  const marketplaceAccount =
    (input.task.marketplaceAccountId
      ? await db.marketplaceAccount.findFirst({
          where: {
            id: input.task.marketplaceAccountId,
            workspaceId: input.workspaceId,
            status: "CONNECTED"
          }
        })
      : null) ??
    (await db.marketplaceAccount.findFirst({
      where: {
        workspaceId: input.workspaceId,
        platform: input.task.platform,
        status: "CONNECTED"
      },
      orderBy: { createdAt: "asc" }
    }));

  if (!marketplaceAccount) {
    return null;
  }

  const externalListingId =
    typeof input.result?.externalListingId === "string" && input.result.externalListingId.trim()
      ? input.result.externalListingId.trim()
      : null;
  const externalUrl =
    typeof input.result?.externalUrl === "string" && input.result.externalUrl.trim()
      ? input.result.externalUrl.trim()
      : null;
  const publishedTitle =
    typeof input.result?.publishedTitle === "string" && input.result.publishedTitle.trim()
      ? input.result.publishedTitle.trim()
      : null;
  const publishedPrice = typeof input.result?.publishedPrice === "number" ? input.result.publishedPrice : null;

  const existing =
    (externalListingId
      ? await db.platformListing.findFirst({
          where: {
            inventoryItem: {
              workspaceId: input.workspaceId
            },
            platform: input.task.platform,
            externalListingId
          }
        })
      : null) ??
    (await db.platformListing.findFirst({
      where: {
        inventoryItemId: input.task.inventoryItemId,
        platform: input.task.platform
      }
    }));

  const listing = existing
    ? await db.platformListing.update({
        where: { id: existing.id },
        data: {
          marketplaceAccountId: marketplaceAccount.id,
          status: "PUBLISHED",
          externalListingId: externalListingId ?? existing.externalListingId,
          externalUrl: externalUrl ?? existing.externalUrl,
          publishedTitle: publishedTitle ?? existing.publishedTitle,
          publishedPrice: publishedPrice ?? existing.publishedPrice,
          lastSyncAt: new Date(),
          rawLastResponseJson: (input.result ?? undefined) as never
        }
      })
    : await db.platformListing.create({
        data: {
          inventoryItemId: input.task.inventoryItemId,
          marketplaceAccountId: marketplaceAccount.id,
          platform: input.task.platform,
          externalListingId,
          status: "PUBLISHED",
          publishedTitle,
          publishedPrice,
          externalUrl,
          lastSyncAt: new Date(),
          rawLastResponseJson: (input.result ?? undefined) as never
        }
      });

  await db.inventoryItem.update({
    where: { id: input.task.inventoryItemId },
    data: {
      status: "LISTED"
    }
  });

  return listing;
}

function mapSourceListingStateToPlatformStatus(sourceState: "DRAFT" | "PUBLISHED" | "SOLD" | "ENDED") {
  switch (sourceState) {
    case "DRAFT":
      return "PENDING" as const;
    case "SOLD":
      return "SOLD" as const;
    case "ENDED":
      return "ENDED" as const;
    default:
      return "PUBLISHED" as const;
  }
}

function mapSourceListingStateToInventoryStatus(sourceState: "DRAFT" | "PUBLISHED" | "SOLD" | "ENDED") {
  switch (sourceState) {
    case "SOLD":
      return "SOLD" as const;
    case "PUBLISHED":
      return "LISTED" as const;
    default:
      return "DRAFT" as const;
  }
}

export function registerExtensionRoutes(app: ApiApp, context: ApiRouteContext) {
  app.get("/api/extension/status", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const tasks = await listExtensionTasksForWorkspace(workspace.id);

    return {
      capabilitySummary,
      tasks: tasks.slice(0, 12).map(serializeExtensionTask)
    };
  });

  app.get("/api/extension/tasks", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const query = z
      .object({
        inventoryItemId: z.string().min(1).optional(),
        platform: z.enum(["EBAY", "DEPOP", "POSHMARK", "WHATNOT"]).optional(),
        state: z.enum(["QUEUED", "RUNNING", "NEEDS_INPUT", "FAILED", "SUCCEEDED", "CANCELED"]).optional()
      })
      .parse(request.query);
    const tasks = await listExtensionTasksForWorkspace(workspace.id, query);

    return {
      tasks: tasks.map(serializeExtensionTask)
    };
  });

  app.post("/api/extension/tasks/handoff", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = extensionTaskCreateSchema.parse(request.body);
    const item = await findInventoryItemDetailForWorkspace(workspace.id, body.inventoryItemId);
    const marketplaceAccount =
      body.platform === "EBAY"
        ? null
        : await db.marketplaceAccount.findFirst({
            where: {
              workspaceId: workspace.id,
              platform: body.platform,
              status: "CONNECTED"
            },
            orderBy: { createdAt: "asc" }
          });

    if (!item) {
      throw app.httpErrors.notFound("Inventory item not found");
    }

    const listing = buildUniversalListing(item, body.platform);
    const task = await createExtensionTaskForWorkspace(workspace.id, {
      inventoryItemId: item.id,
      marketplaceAccountId: marketplaceAccount?.id ?? null,
      platform: body.platform,
      action: body.action,
      payload: {
        universalListing: listing,
        source: "MOLLIE_WEB_APP"
      }
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "extension.task_handoff.created",
      targetType: "extension_task",
      targetId: task.id,
      metadata: {
        inventoryItemId: item.id,
        platform: body.platform,
        action: body.action
      }
    });

    return {
      task: serializeExtensionTask(task),
      listing
    };
  });

  app.post("/api/extension/tasks/:id/result", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = extensionTaskResultUpdateSchema.parse(request.body);
    const task = await findExtensionTaskForWorkspace(workspace.id, params.id);

    if (!task) {
      throw app.httpErrors.notFound("Extension task not found");
    }

    if (body.runnerInstanceId && task.runnerInstanceId && task.runnerInstanceId !== body.runnerInstanceId) {
      throw app.httpErrors.conflict("Extension task is owned by a different runner.");
    }

    const now = new Date();
    const nextRetryAt =
      body.retryAfterSeconds && body.state === "QUEUED"
        ? new Date(now.getTime() + body.retryAfterSeconds * 1000)
        : null;

    const updated = await updateExtensionTask(task.id, {
      state: body.state,
      runnerInstanceId: body.state === "QUEUED" ? null : body.runnerInstanceId ?? task.runnerInstanceId ?? null,
      claimedAt: body.state === "QUEUED" ? null : task.claimedAt ?? now,
      lastHeartbeatAt: now,
      retryAfter: nextRetryAt,
      needsInputReason: body.state === "NEEDS_INPUT" ? body.needsInputReason ?? null : null,
      lastErrorCode: body.lastErrorCode ?? null,
      lastErrorMessage: body.lastErrorMessage ?? null,
      ...(body.result && body.result !== null ? { resultJson: body.result } : {}),
      ...(body.state === "RUNNING" && !task.startedAt ? { startedAt: now } : {}),
      ...(body.state === "QUEUED" ? { startedAt: null, completedAt: null } : {}),
      ...(body.state === "FAILED" || body.state === "SUCCEEDED" || body.state === "CANCELED"
        ? { completedAt: now }
        : {})
    });

    const resultPayload =
      body.result && body.result !== null ? (body.result as Record<string, unknown>) : null;

    if (body.state === "SUCCEEDED" && task.action === "PUBLISH_LISTING") {
      await syncPublishedPlatformListingFromExtensionTask({
        workspaceId: workspace.id,
        task,
        result: resultPayload
      });
    }

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "extension.task_result.recorded",
      targetType: "extension_task",
      targetId: updated.id,
      metadata: {
        state: body.state,
        lastErrorCode: body.lastErrorCode ?? null
      }
    });

    return {
      task: serializeExtensionTask(updated)
    };
  });

  app.post("/api/extension/tasks/:id/claim", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = extensionTaskClaimSchema.parse(request.body);
    const claimed = await claimExtensionTaskForWorkspace(workspace.id, params.id, {
      runnerInstanceId: body.runnerInstanceId
    });

    if (!claimed) {
      const current = await findExtensionTaskForWorkspace(workspace.id, params.id);

      if (!current) {
        throw app.httpErrors.notFound("Extension task not found");
      }

      return {
        claimed: false,
        task: serializeExtensionTask(current)
      };
    }

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "extension.task.claimed",
      targetType: "extension_task",
      targetId: claimed.id,
      metadata: {
        runnerInstanceId: body.runnerInstanceId,
        browserName: body.browserName ?? null
      }
    });

    return {
      claimed: true,
      task: serializeExtensionTask(claimed)
    };
  });

  app.post("/api/extension/tasks/:id/heartbeat", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = extensionTaskHeartbeatSchema.parse(request.body);
    const updated = await heartbeatExtensionTaskForWorkspace(workspace.id, params.id, body.runnerInstanceId, {
      result:
        body.result && body.message
          ? {
              ...body.result,
              heartbeatMessage: body.message,
              heartbeatAt: new Date().toISOString()
            }
          : body.result ?? (body.message ? { heartbeatMessage: body.message, heartbeatAt: new Date().toISOString() } : undefined)
    });

    if (!updated) {
      throw app.httpErrors.conflict("Extension task is not owned by this runner anymore.");
    }

    return {
      task: serializeExtensionTask(updated)
    };
  });

  app.post("/api/extension/imports/ebay", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = extensionEbayImportSchema.parse(request.body);
    const externalUrl = cleanExternalUrl(body.externalUrl);
    const run = await createInventoryImportRunForWorkspace(workspace.id, {
      sourceKind: "PUBLIC_URL",
      sourcePlatform: "EBAY",
      sourceUrl: externalUrl,
      status: "RUNNING",
      startedAt: new Date(),
      stats: {
        source: "EXTENSION_IMPORT"
      }
    });
    const duplicate = await db.platformListing.findFirst({
      where: {
        platform: "EBAY",
        inventoryItem: {
          workspaceId: workspace.id
        },
        OR: [
          {
            externalListingId: body.externalListingId
          },
          {
            externalUrl
          }
        ]
      },
      include: {
        inventoryItem: true
      }
    });

    if (duplicate) {
      await createInventoryImportItemForRun(run.id, {
        matchedInventoryItemId: duplicate.inventoryItemId,
        externalItemId: body.externalListingId,
        sourceUrl: externalUrl,
        dedupeKey: `EBAY:${body.externalListingId}`,
        status: "SKIPPED",
        normalizedCandidate: {
          title: body.title,
          brand: body.brand ?? null,
          category: body.category ?? "General Merchandise",
          condition: body.condition ?? "Good used condition",
          quantity: body.quantity,
          costBasis: 0,
          estimatedResaleMin: parsePrice(body.price),
          estimatedResaleMax: parsePrice(body.price),
          priceRecommendation: parsePrice(body.price),
          sourceUrl: externalUrl,
          externalItemId: body.externalListingId,
          imageUrls: body.photos.map((photo) => photo.url),
          attributes: body.attributes
        },
        rawSourcePayload: body
      });

      await updateInventoryImportRun(run.id, {
        status: "SUCCEEDED",
        progressCount: 1,
        skippedCount: 1,
        finishedAt: new Date()
      });

      const task = await createExtensionTaskForWorkspace(workspace.id, {
        inventoryItemId: duplicate.inventoryItemId,
        inventoryImportRunId: run.id,
        platform: "EBAY",
        action: "IMPORT_LISTING",
        state: "SUCCEEDED",
        payload: body,
        result: {
          duplicate: true,
          inventoryItemId: duplicate.inventoryItemId,
          platformListingId: duplicate.id,
          importRunId: run.id
        },
        startedAt: new Date(),
        completedAt: new Date()
      });

      return {
        duplicate: true,
        importRunId: run.id,
        inventoryItemId: duplicate.inventoryItemId,
        task: serializeExtensionTask(task)
      };
    }

    const item = await createInventoryItem(workspace.id, {
      title: body.title,
      brand: body.brand ?? null,
      category: body.category ?? "General Merchandise",
      condition: body.condition ?? "Good used condition",
      quantity: body.quantity,
      costBasis: 0,
      estimatedResaleMin: parsePrice(body.price),
      estimatedResaleMax: parsePrice(body.price),
      priceRecommendation: parsePrice(body.price),
      attributes: {
        importSource: "EXTENSION_EBAY",
        sourceUrl: externalUrl,
        externalListingId: body.externalListingId,
        sourceListingState: body.sourceListingState,
        description: body.description ?? "",
        importedAt: new Date().toISOString(),
        sourceAttributes: body.attributes
      }
    });

    await Promise.all(
      body.photos.map((photo, index) =>
        addInventoryImage(item.id, {
          url: photo.url,
          kind: "ORIGINAL",
          width: photo.width ?? null,
          height: photo.height ?? null,
          position: index
        })
      )
    );

    await db.inventoryItem.update({
      where: { id: item.id },
      data: {
        status: mapSourceListingStateToInventoryStatus(body.sourceListingState)
      }
    });

    const firstHealthyEbayAccount = await db.marketplaceAccount.findFirst({
      where: {
        workspaceId: workspace.id,
        platform: "EBAY",
        status: "CONNECTED"
      },
      orderBy: { createdAt: "asc" }
    });

    let listingId: string | null = null;
    let linkageWarning: string | null = null;

    if (firstHealthyEbayAccount) {
      const listing = await db.platformListing.create({
        data: {
          inventoryItemId: item.id,
          marketplaceAccountId: firstHealthyEbayAccount.id,
          platform: "EBAY",
          externalListingId: body.externalListingId,
          status: mapSourceListingStateToPlatformStatus(body.sourceListingState),
          publishedTitle: body.title,
          publishedPrice: parsePrice(body.price),
          externalUrl
        }
      });
      listingId = listing.id;
    } else {
      linkageWarning = "Imported listing data was saved without linking to an unhealthy or missing eBay account.";
    }

    await createInventoryImportItemForRun(run.id, {
      matchedInventoryItemId: item.id,
      externalItemId: body.externalListingId,
      sourceUrl: externalUrl,
      dedupeKey: `EBAY:${body.externalListingId}`,
      status: "APPLIED",
      normalizedCandidate: {
        title: body.title,
        brand: body.brand ?? null,
        category: body.category ?? "General Merchandise",
        condition: body.condition ?? "Good used condition",
        quantity: body.quantity,
        costBasis: 0,
        estimatedResaleMin: parsePrice(body.price),
        estimatedResaleMax: parsePrice(body.price),
        priceRecommendation: parsePrice(body.price),
        sourceUrl: externalUrl,
        externalItemId: body.externalListingId,
        imageUrls: body.photos.map((photo) => photo.url),
        attributes: body.attributes
      },
      rawSourcePayload: body
    });

    await updateInventoryImportRun(run.id, {
      status: "SUCCEEDED",
      progressCount: 1,
      appliedCount: 1,
      finishedAt: new Date()
    });

    const task = await createExtensionTaskForWorkspace(workspace.id, {
      inventoryItemId: item.id,
      inventoryImportRunId: run.id,
      marketplaceAccountId: firstHealthyEbayAccount?.id ?? null,
      platform: "EBAY",
      action: "IMPORT_LISTING",
      state: "SUCCEEDED",
      payload: body,
      result: {
        duplicate: false,
        inventoryItemId: item.id,
        platformListingId: listingId,
        importRunId: run.id,
        linkageWarning
      },
      startedAt: new Date(),
      completedAt: new Date()
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "extension.ebay_import.applied",
      targetType: "inventory_item",
      targetId: item.id,
      metadata: {
        externalListingId: body.externalListingId,
        importRunId: run.id,
        platformListingId: listingId
      }
    });

    return {
      duplicate: false,
      importRunId: run.id,
      inventoryItemId: item.id,
      platformListingId: listingId,
      linkageWarning,
      task: serializeExtensionTask(task)
    };
  });
}
