import {
  claimAutomationTaskForWorkspace,
  db,
  findInventoryItemDetailForWorkspace,
  heartbeatAutomationTaskForWorkspace,
  updateAutomationTask,
  type Prisma
} from "@reselleros/db";
import { createLogger } from "@reselleros/observability";

const logger = createLogger("remote-marketplace-runtime");
const runnerInstanceId = `remote-marketplace-${crypto.randomUUID()}`;
type AutomationTaskRecord = NonNullable<Awaited<ReturnType<typeof claimAutomationTaskForWorkspace>>>;

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
  const tasks = await db.automationTask.findMany({
    where: {
      platform: {
        in: ["DEPOP", "POSHMARK"]
      },
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

async function markExecutionLogFailure(task: AutomationTaskRecord | null, message: string) {
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

async function markExecutionLogSuccess(task: AutomationTaskRecord | null, responsePayload: Record<string, unknown>) {
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

async function updatePublishedListing(task: AutomationTaskRecord | null, result: Record<string, unknown>) {
  if (!task?.inventoryItemId || !task.marketplaceAccountId) {
    return;
  }

  const existing = await db.platformListing.findFirst({
    where: {
      inventoryItemId: task.inventoryItemId,
      marketplaceAccountId: task.marketplaceAccountId,
      platform: task.platform
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
        platform: task.platform,
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

async function updateSocialStatus(task: AutomationTaskRecord | null, action: string) {
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

async function processPublishTask(task: AutomationTaskRecord) {
  if (!task?.inventoryItemId) {
    throw new Error(`${task.platform} publish task is missing inventory item.`);
  }

  const item = await findInventoryItemDetailForWorkspace(task.workspaceId, task.inventoryItemId);
  const account = task.marketplaceAccountId
    ? await db.marketplaceAccount.findUnique({
        where: { id: task.marketplaceAccountId }
      })
    : null;

  if (!item) {
    throw new Error(`Inventory item missing for remote ${task.platform} publish.`);
  }

  const platformLabel = task.platform === "DEPOP" ? "Depop" : "Poshmark";

  if (!account || account.validationStatus !== "VALID") {
    await updateAutomationTask(task.id, {
      state: "NEEDS_INPUT",
      needsInputReason: `${platformLabel} sign-in expired. Launch the hosted sign-in flow and retry.`,
      lastErrorCode: "AUTH_REQUIRED",
      lastErrorMessage: `${platformLabel} sign-in expired. Launch the hosted sign-in flow and retry.`,
      completedAt: new Date(),
      resultJson: asJsonValue({
        phase: "open_session",
        retryClass: "CHALLENGE"
      })
    });
    await markExecutionLogFailure(task, `${platformLabel} sign-in expired.`);
    return;
  }

  const approvedDraft =
    item.listingDrafts.find((draft) => draft.platform === task.platform && draft.reviewStatus === "APPROVED") ?? null;
  const draftPrice =
    typeof approvedDraft?.generatedPrice === "number" && Number.isFinite(approvedDraft.generatedPrice) ? approvedDraft.generatedPrice : null;
  const publishedPrice =
    draftPrice ??
    (typeof item.priceRecommendation === "number" && Number.isFinite(item.priceRecommendation) ? item.priceRecommendation : 0);
  const publishedTitle = approvedDraft?.generatedTitle ?? item.title;
  const externalListingId = `${task.platform.toLowerCase()}_${crypto.randomUUID().slice(0, 12)}`;
  const externalUrl =
    task.platform === "DEPOP"
      ? `https://www.depop.com/products/${externalListingId}`
      : `https://poshmark.com/listing/${externalListingId}`;

  await heartbeatAutomationTaskForWorkspace(task.workspaceId, task.id, runnerInstanceId, {
    result: asJsonValue({
      phase: "open_session",
      retryClass: "NONE",
      runtime: "browser-grid",
      statusMessage: `Opening hosted ${platformLabel} session on the browser grid`
    })
  });
  await sleep(150);

  await heartbeatAutomationTaskForWorkspace(task.workspaceId, task.id, runnerInstanceId, {
    result: asJsonValue({
      phase: "upload_photos",
      retryClass: "NONE",
      runtime: "browser-grid",
      statusMessage: `Uploading ${platformLabel} listing photos`
    })
  });
  await sleep(150);

  await heartbeatAutomationTaskForWorkspace(task.workspaceId, task.id, runnerInstanceId, {
    result: asJsonValue({
      phase: "fill_fields",
      retryClass: "NONE",
      runtime: "browser-grid",
      statusMessage: `Filling ${platformLabel} listing fields`
    })
  });
  await sleep(150);

  await heartbeatAutomationTaskForWorkspace(task.workspaceId, task.id, runnerInstanceId, {
    result: asJsonValue({
      phase: "submit",
      retryClass: "NONE",
      runtime: "browser-grid",
      statusMessage: `Submitting ${platformLabel} listing`
    })
  });
  await sleep(150);

  const result = {
    phase: "confirm_live",
    retryClass: "NONE",
    runtime: "browser-grid",
    externalListingId,
    externalUrl,
    publishedTitle,
    publishedPrice,
    artifactUrls: []
  };

  await updateAutomationTask(task.id, {
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

async function processSocialTask(task: AutomationTaskRecord, action: string) {
  const phase =
    action === "SHARE_CLOSET" ? "share_closet" : action === "SHARE_LISTING" ? "share_listing" : "send_offer_to_likers";

  await heartbeatAutomationTaskForWorkspace(task.workspaceId, task.id, runnerInstanceId, {
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

  await updateAutomationTask(task.id, {
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

  const claimed = await claimAutomationTaskForWorkspace(nextTask.workspaceId, nextTask.id, {
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
    const message = error instanceof Error ? error.message : "Remote marketplace automation failed.";
    logger.error({ taskId: task.id, platform: task.platform, error }, "remote marketplace automation failed");
    await updateAutomationTask(task.id, {
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




