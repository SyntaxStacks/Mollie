import { z } from "zod";

import {
  createExtensionTaskForWorkspace,
  db,
  findInventoryItemDetailForWorkspace,
  findExtensionTaskForWorkspace,
  listExtensionTasksForWorkspace,
  recordAuditLog,
  updateExtensionTask,
  type Prisma
} from "@reselleros/db";
import {
  poshmarkSocialActions,
  poshmarkSocialConfigSchema,
  poshmarkReadinessSchema,
  remoteAutomationTaskActionSchema,
  remoteAutomationTaskCreateSchema,
  remoteAutomationTaskTypes,
  type MarketplaceAccountStatus,
  type OperatorHint,
  type PoshmarkReadiness,
  type PoshmarkSocialConfig,
  type RemoteAutomationRetryClass,
  type RemoteAutomationTaskPhase,
  type RemoteAutomationTaskType,
  type RemoteAutomationTaskView
} from "@reselleros/types";
import { getAutomationAccountReadiness } from "@reselleros/marketplaces";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function itemNeedsSizingLike(item: {
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

function brandLikelyRequired(item: {
  category?: string | null;
  title?: string | null;
}) {
  const haystack = `${item.category ?? ""} ${item.title ?? ""}`.toLowerCase();
  return ["apparel", "bags", "shoes", "accessories", "fashion", "clothing", "jewelry"].some((token) =>
    haystack.includes(token)
  );
}

function getDraftApproved(item: Awaited<ReturnType<typeof findInventoryItemDetailForWorkspace>>) {
  return item?.listingDrafts.find((draft) => draft.platform === "POSHMARK" && draft.reviewStatus === "APPROVED") ?? null;
}

function computePoshmarkReadiness(item: Awaited<ReturnType<typeof findInventoryItemDetailForWorkspace>>): PoshmarkReadiness {
  const missingFields: string[] = [];
  const blockingReasons: string[] = [];
  const approvedDraft = getDraftApproved(item);
  const itemAttributes =
    item?.attributesJson && typeof item.attributesJson === "object" ? (item.attributesJson as Record<string, unknown>) : {};
  const description = normalizeText(itemAttributes.description);
  const price = typeof item?.priceRecommendation === "number" ? item.priceRecommendation : null;
  const category = normalizeText(item?.category);
  const size = normalizeText(item?.size);
  const brand = normalizeText(item?.brand);

  if (!item) {
    return {
      ready: false,
      missingFields: ["inventory item"],
      blockingReasons: ["Inventory item not found."],
      transformPlan: {
        imageMode: "NONE"
      }
    };
  }

  if (!normalizeText(item.title)) {
    missingFields.push("title");
  }

  if (!description) {
    missingFields.push("description");
  }

  if (price == null || !Number.isFinite(price) || price <= 0) {
    missingFields.push("price");
  }

  if (!category) {
    missingFields.push("category");
  }

  if (item.images.length === 0) {
    missingFields.push("photos");
  }

  if (itemNeedsSizingLike(item) && !size) {
    missingFields.push("size");
  }

  if (brandLikelyRequired(item) && !brand) {
    missingFields.push("brand");
  }

  if (!approvedDraft) {
    blockingReasons.push("Approve a Poshmark draft before queueing publish.");
  }

  return poshmarkReadinessSchema.parse({
    ready: missingFields.length === 0 && blockingReasons.length === 0,
    missingFields,
    blockingReasons,
    transformPlan: {
      imageMode: item.images.length > 0 ? "PAD_TO_SQUARE" : "NONE"
    }
  });
}

function getRemoteTaskType(payloadJson: unknown): RemoteAutomationTaskType | null {
  if (!payloadJson || typeof payloadJson !== "object") {
    return null;
  }

  const candidate = (payloadJson as Record<string, unknown>).remoteTaskType;
  return typeof candidate === "string" && remoteAutomationTaskTypes.includes(candidate as RemoteAutomationTaskType)
    ? (candidate as RemoteAutomationTaskType)
    : null;
}

function serializeRemoteTask(task: Awaited<ReturnType<typeof findExtensionTaskForWorkspace>>): RemoteAutomationTaskView | null {
  if (!task) {
    return null;
  }

  const payload = (task.payloadJson ?? null) as Record<string, unknown> | null;
  const result = (task.resultJson ?? null) as Record<string, unknown> | null;
  const taskType = getRemoteTaskType(payload);

  if (task.platform !== "POSHMARK" || !taskType) {
    return null;
  }

  let status: RemoteAutomationTaskView["status"];
  switch (task.state) {
    case "NEEDS_INPUT":
      status = "PAUSED_FOR_CHALLENGE";
      break;
    case "RUNNING":
      status = "RUNNING";
      break;
    case "FAILED":
      status = "FAILED";
      break;
    case "SUCCEEDED":
      status = "SUCCEEDED";
      break;
    case "CANCELED":
      status = "CANCELED";
      break;
    default:
      status = "QUEUED";
      break;
  }

  const phase =
    typeof result?.phase === "string" ? (result.phase as RemoteAutomationTaskPhase) : typeof payload?.phase === "string" ? (payload.phase as RemoteAutomationTaskPhase) : null;
  const retryClass =
    typeof result?.retryClass === "string"
      ? (result.retryClass as RemoteAutomationRetryClass)
      : task.lastErrorCode === "RATE_LIMITED"
        ? "TRANSIENT"
        : task.state === "NEEDS_INPUT"
          ? "CHALLENGE"
          : "NONE";
  const artifactUrls = Array.isArray(result?.artifactUrls)
    ? result?.artifactUrls.filter((value): value is string => typeof value === "string")
    : [];

  return {
    id: task.id,
    workspaceId: task.workspaceId,
    inventoryItemId: task.inventoryItemId ?? null,
    marketplaceAccountId: task.marketplaceAccountId ?? null,
    platform: "POSHMARK",
    taskType,
    status,
    phase,
    pauseReason: task.needsInputReason ?? task.lastErrorMessage ?? null,
    retryClass,
    externalListingId: typeof result?.externalListingId === "string" ? result.externalListingId : null,
    externalUrl: typeof result?.externalUrl === "string" ? result.externalUrl : null,
    publishedTitle: typeof result?.publishedTitle === "string" ? result.publishedTitle : null,
    publishedPrice: typeof result?.publishedPrice === "number" ? result.publishedPrice : null,
    artifactUrls,
    queuedAt: task.queuedAt.toISOString(),
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    updatedAt: task.updatedAt.toISOString()
  };
}

function getPoshmarkSocialConfig(account: {
  credentialMetadataJson: Prisma.JsonValue | null;
}): PoshmarkSocialConfig {
  const metadata = account.credentialMetadataJson && typeof account.credentialMetadataJson === "object"
    ? (account.credentialMetadataJson as Record<string, unknown>)
    : {};
  return poshmarkSocialConfigSchema.parse(metadata.poshmarkSocialConfig ?? {});
}

async function findPrimaryPoshmarkAccount(workspaceId: string) {
  return db.marketplaceAccount.findFirst({
    where: {
      workspaceId,
      platform: "POSHMARK"
    },
    orderBy: { createdAt: "asc" }
  });
}

function getPoshmarkAccountReadiness(account: Awaited<ReturnType<typeof findPrimaryPoshmarkAccount>> | null, workspaceAutomationEnabled = true) {
  if (!account) {
    return null;
  }

  return getAutomationAccountReadiness({
    account: {
      id: account.id,
      platform: "POSHMARK",
      displayName: account.displayName,
      secretRef: account.secretRef,
      status: account.status as MarketplaceAccountStatus,
      credentialType: account.credentialType,
      validationStatus: account.validationStatus,
      externalAccountId: account.externalAccountId,
      credentialMetadata:
        account.credentialMetadataJson && typeof account.credentialMetadataJson === "object"
          ? (account.credentialMetadataJson as Record<string, unknown>)
          : null
    },
    workspaceAutomationEnabled,
    accountStatus: account.status as MarketplaceAccountStatus,
    lastErrorMessage: account.lastErrorMessage
  });
}

async function ensurePendingPoshmarkListing(input: {
  inventoryItemId: string;
  workspaceId: string;
  marketplaceAccountId: string;
}) {
  const existing = await db.platformListing.findFirst({
    where: {
      inventoryItemId: input.inventoryItemId,
      marketplaceAccountId: input.marketplaceAccountId,
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
      inventoryItemId: input.inventoryItemId,
      marketplaceAccountId: input.marketplaceAccountId,
      platform: "POSHMARK",
      status: "PENDING"
    }
  });
}

export function registerAutomationRoutes(app: ApiApp, context: ApiRouteContext) {
  app.get("/api/automation/poshmark/readiness/:inventoryItemId", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ inventoryItemId: z.string().min(1) }).parse(request.params);
    const item = await findInventoryItemDetailForWorkspace(workspace.id, params.inventoryItemId);

    if (!item) {
      throw app.httpErrors.notFound("Inventory item not found");
    }

    return {
      readiness: computePoshmarkReadiness(item)
    };
  });

  app.get("/api/automation/tasks", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const query = z
      .object({
        inventoryItemId: z.string().min(1).optional()
      })
      .parse(request.query);
    const tasks = await listExtensionTasksForWorkspace(workspace.id, {
      inventoryItemId: query.inventoryItemId,
      platform: "POSHMARK"
    });

    return {
      tasks: tasks
        .map((task) => serializeRemoteTask(task))
        .filter((task): task is RemoteAutomationTaskView => Boolean(task))
    };
  });

  app.post("/api/automation/tasks", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = remoteAutomationTaskCreateSchema.parse(request.body);
    const account = await findPrimaryPoshmarkAccount(workspace.id);
    const accountReadiness = getPoshmarkAccountReadiness(account, workspace.connectorAutomationEnabled);

    if (!account || accountReadiness?.status !== "READY") {
      throw app.httpErrors.preconditionFailed(accountReadiness?.summary ?? "Connect a ready Poshmark account first.");
    }

    if (body.taskType === "PUBLISH_LISTING") {
      if (!body.inventoryItemId) {
        throw app.httpErrors.badRequest("Publishing requires an inventory item.");
      }

      const item = await findInventoryItemDetailForWorkspace(workspace.id, body.inventoryItemId);
      if (!item) {
        throw app.httpErrors.notFound("Inventory item not found");
      }

      const readiness = computePoshmarkReadiness(item);
      if (!readiness.ready) {
        throw app.httpErrors.preconditionFailed(
          [...readiness.blockingReasons, ...readiness.missingFields.map((field) => `Missing ${field}.`)].join(" ")
        );
      }

      await ensurePendingPoshmarkListing({
        inventoryItemId: item.id,
        workspaceId: workspace.id,
        marketplaceAccountId: account.id
      });
    }

    const created = await createExtensionTaskForWorkspace(workspace.id, {
      inventoryItemId: body.inventoryItemId ?? null,
      marketplaceAccountId: account.id,
      platform: "POSHMARK",
      action: body.taskType === "PUBLISH_LISTING" ? "PUBLISH_LISTING" : "UPDATE_LISTING",
      payload: {
        remoteAutomation: true,
        remoteTaskType: body.taskType,
        phase: body.taskType === "PUBLISH_LISTING" ? "open_session" : "share_closet"
      }
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: `automation.poshmark.${body.taskType.toLowerCase()}.queued`,
      targetType: "extension_task",
      targetId: created.id,
      metadata: {
        inventoryItemId: body.inventoryItemId ?? null
      }
    });

    return {
      task: serializeRemoteTask(created)
    };
  });

  app.post("/api/automation/tasks/:taskId/cancel", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = remoteAutomationTaskActionSchema.extend({ taskId: z.string().min(1) }).parse(request.params);
    const task = await findExtensionTaskForWorkspace(workspace.id, params.taskId);
    const serialized = serializeRemoteTask(task);

    if (!task || !serialized) {
      throw app.httpErrors.notFound("Automation task not found");
    }

    const updated = await updateExtensionTask(task.id, {
      state: "CANCELED",
      completedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
      needsInputReason: null
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "automation.poshmark.task_canceled",
      targetType: "extension_task",
      targetId: updated.id
    });

    return {
      task: serializeRemoteTask(updated)
    };
  });

  app.post("/api/automation/tasks/:taskId/retry", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = remoteAutomationTaskActionSchema.extend({ taskId: z.string().min(1) }).parse(request.params);
    const task = await findExtensionTaskForWorkspace(workspace.id, params.taskId);
    const serialized = serializeRemoteTask(task);

    if (!task || !serialized) {
      throw app.httpErrors.notFound("Automation task not found");
    }

    const updated = await updateExtensionTask(task.id, {
      state: "QUEUED",
      runnerInstanceId: null,
      claimedAt: null,
      lastHeartbeatAt: null,
      retryAfter: null,
      needsInputReason: null,
      startedAt: null,
      completedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      resultJson: {
        ...(task.resultJson && typeof task.resultJson === "object" ? (task.resultJson as Record<string, unknown>) : {}),
        retryClass: "TRANSIENT"
      } as Prisma.InputJsonValue
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "automation.poshmark.task_retried",
      targetType: "extension_task",
      targetId: updated.id
    });

    return {
      task: serializeRemoteTask(updated)
    };
  });

  app.get("/api/automation/poshmark/social", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const account = await findPrimaryPoshmarkAccount(workspace.id);
    const readiness = getPoshmarkAccountReadiness(account, workspace.connectorAutomationEnabled);

    if (!account) {
      return {
        connected: false,
        readiness: null,
        config: poshmarkSocialConfigSchema.parse({}),
        status: null
      };
    }

    const metadata = account.credentialMetadataJson && typeof account.credentialMetadataJson === "object"
      ? (account.credentialMetadataJson as Record<string, unknown>)
      : {};

    return {
      connected: true,
      readiness,
      config: getPoshmarkSocialConfig(account),
      status:
        metadata.poshmarkSocialStatus && typeof metadata.poshmarkSocialStatus === "object"
          ? (metadata.poshmarkSocialStatus as Record<string, unknown>)
          : null
    };
  });

  app.patch("/api/automation/poshmark/social", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = poshmarkSocialConfigSchema.parse(request.body);
    const account = await findPrimaryPoshmarkAccount(workspace.id);

    if (!account) {
      throw app.httpErrors.preconditionFailed("Connect a Poshmark account first.");
    }

    const metadata = account.credentialMetadataJson && typeof account.credentialMetadataJson === "object"
      ? (account.credentialMetadataJson as Record<string, unknown>)
      : {};
    const nextMetadata = {
      ...metadata,
      poshmarkSocialConfig: body
    } satisfies Prisma.InputJsonValue;

    const updated = await db.marketplaceAccount.update({
      where: { id: account.id },
      data: {
        credentialMetadataJson: nextMetadata
      }
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "automation.poshmark.social_config.updated",
      targetType: "marketplace_account",
      targetId: updated.id,
      metadata: {
        config: body
      }
    });

    return {
      connected: true,
      readiness: getPoshmarkAccountReadiness(updated, workspace.connectorAutomationEnabled),
      config: getPoshmarkSocialConfig(updated)
    };
  });

  app.post("/api/automation/poshmark/social/run", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = z
      .object({
        action: z.enum(poshmarkSocialActions)
      })
      .parse(request.body);
    const account = await findPrimaryPoshmarkAccount(workspace.id);
    const readiness = getPoshmarkAccountReadiness(account, workspace.connectorAutomationEnabled);

    if (!account || readiness?.status !== "READY") {
      throw app.httpErrors.preconditionFailed(readiness?.summary ?? "Connect a ready Poshmark account first.");
    }

    const task = await createExtensionTaskForWorkspace(workspace.id, {
      marketplaceAccountId: account.id,
      platform: "POSHMARK",
      action: "UPDATE_LISTING",
      payload: {
        remoteAutomation: true,
        remoteTaskType: body.action,
        phase: body.action === "SHARE_CLOSET" ? "share_closet" : body.action === "SHARE_LISTING" ? "share_listing" : "send_offer_to_likers"
      }
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: `automation.poshmark.social.${body.action.toLowerCase()}.queued`,
      targetType: "extension_task",
      targetId: task.id
    });

    return {
      task: serializeRemoteTask(task)
    };
  });
}
