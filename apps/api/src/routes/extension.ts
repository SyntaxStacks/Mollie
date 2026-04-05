import { z } from "zod";

import {
  addInventoryImage,
  createExtensionTaskForWorkspace,
  createInventoryImportItemForRun,
  createInventoryImportRunForWorkspace,
  createInventoryItem,
  db,
  findExtensionTaskForWorkspace,
  findInventoryItemDetailForWorkspace,
  listExtensionTasksForWorkspace,
  recordAuditLog,
  updateExtensionTask,
  updateInventoryImportRun
} from "@reselleros/db";
import {
  extensionEbayImportSchema,
  extensionTaskCreateSchema,
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
    capabilities: [],
    importMode: "NONE",
    publishMode: "NONE",
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

    if (!item) {
      throw app.httpErrors.notFound("Inventory item not found");
    }

    const listing = buildUniversalListing(item, body.platform);
    const task = await createExtensionTaskForWorkspace(workspace.id, {
      inventoryItemId: item.id,
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

    const updated = await updateExtensionTask(task.id, {
      state: body.state,
      lastErrorCode: body.lastErrorCode ?? null,
      lastErrorMessage: body.lastErrorMessage ?? null,
      ...(body.result && body.result !== null ? { resultJson: body.result } : {}),
      ...(body.state === "RUNNING" && !task.startedAt ? { startedAt: new Date() } : {}),
      ...(body.state === "FAILED" || body.state === "SUCCEEDED" || body.state === "CANCELED"
        ? { completedAt: new Date() }
        : {})
    });

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

    const firstEbayAccount = await db.marketplaceAccount.findFirst({
      where: {
        workspaceId: workspace.id,
        platform: "EBAY",
        status: {
          in: ["CONNECTED", "ERROR"]
        }
      },
      orderBy: { createdAt: "asc" }
    });

    let listingId: string | null = null;

    if (firstEbayAccount) {
      const listing = await db.platformListing.create({
        data: {
          inventoryItemId: item.id,
          marketplaceAccountId: firstEbayAccount.id,
          platform: "EBAY",
          externalListingId: body.externalListingId,
          status: mapSourceListingStateToPlatformStatus(body.sourceListingState),
          publishedTitle: body.title,
          publishedPrice: parsePrice(body.price),
          externalUrl
        }
      });
      listingId = listing.id;
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
      marketplaceAccountId: firstEbayAccount?.id ?? null,
      platform: "EBAY",
      action: "IMPORT_LISTING",
      state: "SUCCEEDED",
      payload: body,
      result: {
        duplicate: false,
        inventoryItemId: item.id,
        platformListingId: listingId,
        importRunId: run.id
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
      task: serializeExtensionTask(task)
    };
  });
}
