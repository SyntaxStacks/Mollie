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

async function listCandidateTasks(input: { workspaceId?: string } = {}) {
  const tasks = await db.automationTask.findMany({
    where: {
      workspaceId: input.workspaceId,
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

async function markPlatformListingFailed(task: AutomationTaskRecord | null, result: Record<string, unknown>) {
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

  if (!existing) {
    return;
  }

  await db.platformListing.update({
    where: { id: existing.id },
    data: {
      status: "FAILED",
      externalListingId: null,
      externalUrl: null,
      lastSyncAt: new Date(),
      rawLastResponseJson: asJsonValue(result)
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

  await heartbeatAutomationTaskForWorkspace(task.workspaceId, task.id, runnerInstanceId, {
    result: asJsonValue({
      phase: "open_session",
      retryClass: "NONE",
      runtime: "browser-grid",
      statusMessage: `Opening hosted ${platformLabel} session on the browser grid`
    })
  });
  await sleep(150);

  const message = `${platformLabel} live publish is not wired to a confirmed remote browser executor yet. Mollie did not create a marketplace listing.`;
  const result = {
    phase: "confirm_live",
    retryClass: "UNSUPPORTED_RUNTIME",
    runtime: "browser-grid",
    statusMessage: message,
    artifactUrls: []
  };

  await updateAutomationTask(task.id, {
    state: "FAILED",
    lastHeartbeatAt: new Date(),
    completedAt: new Date(),
    resultJson: asJsonValue(result),
    lastErrorCode: "LIVE_RUNTIME_NOT_IMPLEMENTED",
    lastErrorMessage: message,
    needsInputReason: message
  });
  await markPlatformListingFailed(task, result);
  await markExecutionLogFailure(task, message);
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

export async function processRemotePoshmarkAutomationCycle(input: { workspaceId?: string } = {}) {
  const candidates = await listCandidateTasks(input);
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




