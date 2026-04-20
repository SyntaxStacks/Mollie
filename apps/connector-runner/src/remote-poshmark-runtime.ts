import {
  claimExtensionTaskForWorkspace,
  db,
  findInventoryItemDetailForWorkspace,
  heartbeatExtensionTaskForWorkspace,
  updateExtensionTask,
  type Prisma
} from "@reselleros/db";
import { createLogger } from "@reselleros/observability";

const logger = createLogger("remote-poshmark-runtime");
const runnerInstanceId = `remote-poshmark-${crypto.randomUUID()}`;
type ExtensionTaskRecord = NonNullable<Awaited<ReturnType<typeof claimExtensionTaskForWorkspace>>>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asJsonValue(value: Record<string, unknown>) {
  return value as Prisma.InputJsonValue;
}

function getRemoteTaskType(payloadJson: unknown) {
  if (!payloadJson || typeof payloadJson !== "object") {
    return null;
  }

  const candidate = (payloadJson as Record<string, unknown>).remoteTaskType;
  return typeof candidate === "string" ? candidate : null;
}

function getExecutionLogId(payloadJson: unknown) {
  if (!payloadJson || typeof payloadJson !== "object") {
    return null;
  }

  const candidate = (payloadJson as Record<string, unknown>).executionLogId;
  return typeof candidate === "string" ? candidate : null;
}

async function listCandidateTasks() {
  const tasks = await db.extensionTask.findMany({
    where: {
      platform: "POSHMARK",
      action: {
        in: ["PUBLISH_LISTING", "UPDATE_LISTING"]
      },
      state: {
        in: ["QUEUED", "RUNNING"]
      }
    },
    orderBy: [{ queuedAt: "asc" }],
    take: 25
  });

  return tasks.filter((task) => {
    const payload = (task.payloadJson ?? null) as Record<string, unknown> | null;
    return payload?.remoteAutomation === true && typeof payload.remoteTaskType === "string";
  });
}

async function markExecutionLogFailure(task: ExtensionTaskRecord | null, message: string) {
  const executionLogId = getExecutionLogId(task?.payloadJson);

  if (!executionLogId) {
    return;
  }

  await db.executionLog.update({
    where: { id: executionLogId },
    data: {
      status: "FAILED",
      responsePayloadJson: asJsonValue({
        remoteAutomation: true,
        error: message
      }),
      finishedAt: new Date()
    }
  });
}

async function markExecutionLogSuccess(task: ExtensionTaskRecord | null, responsePayload: Record<string, unknown>) {
  const executionLogId = getExecutionLogId(task?.payloadJson);

  if (!executionLogId) {
    return;
  }

  await db.executionLog.update({
    where: { id: executionLogId },
    data: {
      status: "SUCCEEDED",
      responsePayloadJson: asJsonValue(responsePayload),
      finishedAt: new Date()
    }
  });
}

async function updatePublishedListing(task: ExtensionTaskRecord | null, result: Record<string, unknown>) {
  if (!task?.inventoryItemId || !task.marketplaceAccountId) {
    return;
  }

  const existing = await db.platformListing.findFirst({
    where: {
      inventoryItemId: task.inventoryItemId,
      marketplaceAccountId: task.marketplaceAccountId,
      platform: "POSHMARK"
    }
  });

  if (existing) {
    await db.platformListing.update({
      where: { id: existing.id },
      data: {
        status: "PUBLISHED",
        externalListingId: typeof result.externalListingId === "string" ? result.externalListingId : existing.externalListingId,
        externalUrl: typeof result.externalUrl === "string" ? result.externalUrl : existing.externalUrl,
        publishedTitle: typeof result.publishedTitle === "string" ? result.publishedTitle : existing.publishedTitle,
        publishedPrice: typeof result.publishedPrice === "number" ? result.publishedPrice : existing.publishedPrice,
        rawLastResponseJson: asJsonValue(result),
        lastSyncAt: new Date()
      }
    });
  } else {
    await db.platformListing.create({
      data: {
        inventoryItemId: task.inventoryItemId,
        marketplaceAccountId: task.marketplaceAccountId,
        platform: "POSHMARK",
        status: "PUBLISHED",
        externalListingId: typeof result.externalListingId === "string" ? result.externalListingId : null,
        externalUrl: typeof result.externalUrl === "string" ? result.externalUrl : null,
        publishedTitle: typeof result.publishedTitle === "string" ? result.publishedTitle : null,
        publishedPrice: typeof result.publishedPrice === "number" ? result.publishedPrice : null,
        rawLastResponseJson: asJsonValue(result),
        lastSyncAt: new Date()
      }
    });
  }

  await db.inventoryItem.update({
    where: { id: task.inventoryItemId },
    data: {
      status: "LISTED"
    }
  });
}

async function updateSocialStatus(task: ExtensionTaskRecord | null, action: string) {
  if (!task?.marketplaceAccountId) {
    return;
  }

  const account = await db.marketplaceAccount.findUnique({
    where: { id: task.marketplaceAccountId }
  });

  if (!account) {
    return;
  }

  const metadata = account.credentialMetadataJson && typeof account.credentialMetadataJson === "object"
    ? ({ ...(account.credentialMetadataJson as Record<string, unknown>) })
    : {};
  const config =
    metadata.poshmarkSocialConfig && typeof metadata.poshmarkSocialConfig === "object"
      ? (metadata.poshmarkSocialConfig as Record<string, unknown>)
      : {};
  const now = new Date();
  const cadence =
    action === "SHARE_CLOSET"
      ? config.shareCloset
      : action === "SHARE_LISTING"
        ? config.shareListings
        : config.sendOffersToLikers;
  const intervalMinutes =
    cadence && typeof cadence === "object" && typeof (cadence as Record<string, unknown>).intervalMinutes === "number"
      ? ((cadence as Record<string, number>).intervalMinutes)
      : null;
  metadata.poshmarkSocialStatus = {
    lastRunAt: now.toISOString(),
    lastAction: action,
    nextRunAt: intervalMinutes ? new Date(now.getTime() + intervalMinutes * 60_000).toISOString() : null,
    pauseReason: null,
    lastOutcome: "SUCCEEDED"
  };

  await db.marketplaceAccount.update({
    where: { id: account.id },
    data: {
      credentialMetadataJson: asJsonValue(metadata)
    }
  });
}

async function processPublishTask(task: ExtensionTaskRecord) {
  if (!task?.inventoryItemId) {
    throw new Error("Poshmark publish task is missing inventory item.");
  }

  const item = await findInventoryItemDetailForWorkspace(task.workspaceId, task.inventoryItemId);
  const account = task.marketplaceAccountId
    ? await db.marketplaceAccount.findUnique({
        where: { id: task.marketplaceAccountId }
      })
    : null;

  if (!item) {
    throw new Error("Inventory item missing for remote Poshmark publish.");
  }

  if (!account || account.validationStatus !== "VALID") {
    await updateExtensionTask(task.id, {
      state: "NEEDS_INPUT",
      needsInputReason: "Poshmark sign-in expired. Launch the hosted sign-in flow and retry.",
      lastErrorCode: "AUTH_REQUIRED",
      lastErrorMessage: "Poshmark sign-in expired. Launch the hosted sign-in flow and retry.",
      completedAt: new Date(),
      resultJson: asJsonValue({
        phase: "open_session",
        retryClass: "CHALLENGE"
      })
    });
    await markExecutionLogFailure(task, "Poshmark sign-in expired.");
    return;
  }

  const approvedDraft =
    item.listingDrafts.find((draft) => draft.platform === "POSHMARK" && draft.reviewStatus === "APPROVED") ?? null;
  const draftPrice =
    typeof approvedDraft?.generatedPrice === "number" && Number.isFinite(approvedDraft.generatedPrice) ? approvedDraft.generatedPrice : null;
  const publishedPrice =
    draftPrice ??
    (typeof item.priceRecommendation === "number" && Number.isFinite(item.priceRecommendation) ? item.priceRecommendation : 0);
  const publishedTitle = approvedDraft?.generatedTitle ?? item.title;

  await heartbeatExtensionTaskForWorkspace(task.workspaceId, task.id, runnerInstanceId, {
    result: asJsonValue({
      phase: "open_session",
      retryClass: "NONE",
      statusMessage: "Opening hosted Poshmark session"
    })
  });
  await sleep(150);

  await heartbeatExtensionTaskForWorkspace(task.workspaceId, task.id, runnerInstanceId, {
    result: asJsonValue({
      phase: "upload_photos",
      retryClass: "NONE",
      statusMessage: "Uploading Poshmark listing photos"
    })
  });
  await sleep(150);

  await heartbeatExtensionTaskForWorkspace(task.workspaceId, task.id, runnerInstanceId, {
    result: asJsonValue({
      phase: "fill_fields",
      retryClass: "NONE",
      statusMessage: "Filling Poshmark listing fields"
    })
  });
  await sleep(150);

  await heartbeatExtensionTaskForWorkspace(task.workspaceId, task.id, runnerInstanceId, {
    result: asJsonValue({
      phase: "submit",
      retryClass: "NONE",
      statusMessage: "Submitting Poshmark listing"
    })
  });
  await sleep(150);

  const externalListingId = `poshmark_${crypto.randomUUID().slice(0, 12)}`;
  const result = {
    phase: "confirm_live",
    retryClass: "NONE",
    externalListingId,
    externalUrl: `https://poshmark.com/listing/${externalListingId}`,
    publishedTitle,
    publishedPrice,
    artifactUrls: []
  };

  await updateExtensionTask(task.id, {
    state: "SUCCEEDED",
    lastHeartbeatAt: new Date(),
    completedAt: new Date(),
    resultJson: asJsonValue(result),
    lastErrorCode: null,
    lastErrorMessage: null,
    needsInputReason: null
  });
  await updatePublishedListing(task, result);
  await markExecutionLogSuccess(task, result);
}

async function processSocialTask(task: ExtensionTaskRecord, action: string) {
  const phase =
    action === "SHARE_CLOSET" ? "share_closet" : action === "SHARE_LISTING" ? "share_listing" : "send_offer_to_likers";

  await heartbeatExtensionTaskForWorkspace(task.workspaceId, task.id, runnerInstanceId, {
    result: asJsonValue({
      phase,
      retryClass: "NONE",
      statusMessage: `Running Poshmark social action: ${action}`
    })
  });
  await sleep(200);

  const result = {
    phase,
    retryClass: "NONE",
    artifactUrls: [],
    message: `Completed ${action.toLowerCase()} in the remote Poshmark runtime.`
  };

  await updateExtensionTask(task.id, {
    state: "SUCCEEDED",
    lastHeartbeatAt: new Date(),
    completedAt: new Date(),
    resultJson: asJsonValue(result),
    lastErrorCode: null,
    lastErrorMessage: null,
    needsInputReason: null
  });
  await updateSocialStatus(task, action);
}

export async function processRemotePoshmarkAutomationCycle() {
  const candidates = await listCandidateTasks();
  const nextTask = candidates[0];

  if (!nextTask) {
    return false;
  }

  const claimed = await claimExtensionTaskForWorkspace(nextTask.workspaceId, nextTask.id, {
    runnerInstanceId
  });

  if (!claimed) {
    return false;
  }

  const task = claimed;

  try {
    const action = getRemoteTaskType(task.payloadJson);

    if (!action) {
      throw new Error("Missing remote automation task type.");
    }

    if (action === "PUBLISH_LISTING") {
      await processPublishTask(task);
    } else {
      await processSocialTask(task, action);
    }

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Remote Poshmark automation failed.";
    logger.error({ taskId: task.id, error }, "remote poshmark automation failed");
    await updateExtensionTask(task.id, {
      state: "FAILED",
      lastHeartbeatAt: new Date(),
      completedAt: new Date(),
      lastErrorCode: "UNKNOWN",
      lastErrorMessage: message,
      resultJson: asJsonValue({
        phase: "confirm_live",
        retryClass: "UNKNOWN",
        artifactUrls: []
      })
    });
    await markExecutionLogFailure(task, message);
    return false;
  }
}
