const AUTH_STORAGE_KEY = "mollie.extension.auth";
const TASK_STORAGE_KEY = "mollie.extension.tasks";
const RUNNER_INSTANCE_STORAGE_KEY = "mollie.extension.runnerInstanceId";
const RUNNER_ALARM_NAME = "mollie.extension.runner";
const MAX_STORED_TASKS = 25;
const TASK_STALE_MS = 2 * 60 * 1000;

type ExtensionAuthSession = {
  token: string;
  workspaceId: string;
  userId: string;
  email: string;
  apiBaseUrl: string;
};

type ExtensionTaskPayload = {
  taskId: string;
  platform: string;
  action: string;
  listing: Record<string, unknown>;
};

type MarketplaceVendor = "DEPOP" | "POSHMARK" | "WHATNOT";

type MarketplaceSessionRecheckPayload = {
  vendor: MarketplaceVendor;
  attemptId: string;
  helperNonce: string;
  displayName: string;
};

type StoredTaskState = "QUEUED" | "RUNNING" | "NEEDS_INPUT" | "FAILED" | "SUCCEEDED" | "CANCELED";

type StoredExtensionTask = ExtensionTaskPayload & {
  localState: StoredTaskState;
  queuedAt: string;
  updatedAt: string;
  claimedAt?: string | null;
  lastHeartbeatAt?: string | null;
  retryAfter?: string | null;
  attemptCount: number;
  runnerInstanceId?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
};

type EbayImportPayload = {
  externalListingId: string;
  externalUrl: string;
  title: string;
  description?: string | null;
  price?: number | null;
  category?: string | null;
  condition?: string | null;
  brand?: string | null;
  quantity: number;
  photos: Array<{
    url: string;
    kind: "PRIMARY" | "GALLERY";
    alt?: string | null;
    width?: number | null;
    height?: number | null;
  }>;
  sourceUrl?: string | null;
  sourceListingState: "DRAFT" | "PUBLISHED" | "SOLD" | "ENDED";
  attributes: Record<string, unknown>;
};

type ClaimResponse = {
  claimed?: boolean;
  task?: {
    id: string;
    state: StoredTaskState;
    attemptCount: number;
    runnerInstanceId?: string | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    needsInputReason?: string | null;
    retryAfter?: string | null;
  };
  error?: string;
};

type MarketplaceSessionDetection = {
  ok: boolean;
  vendor: MarketplaceVendor;
  loggedIn: boolean;
  accountHandle: string | null;
  externalAccountId: string | null;
  pageUrl: string;
  pageTitle: string | null;
  reason: string;
};

let queuePump: Promise<void> | null = null;

const MARKETPLACE_SESSION_CONFIG: Record<
  MarketplaceVendor,
  {
    label: string;
    loginUrl: string;
    tabPatterns: string[];
    cookieUrl: string;
  }
> = {
  DEPOP: {
    label: "Depop",
    loginUrl: "https://www.depop.com/login/",
    tabPatterns: ["https://www.depop.com/*"],
    cookieUrl: "https://www.depop.com/"
  },
  POSHMARK: {
    label: "Poshmark",
    loginUrl: "https://poshmark.com/login",
    tabPatterns: ["https://poshmark.com/*"],
    cookieUrl: "https://poshmark.com/"
  },
  WHATNOT: {
    label: "Whatnot",
    loginUrl: "https://www.whatnot.com/login",
    tabPatterns: ["https://www.whatnot.com/*"],
    cookieUrl: "https://www.whatnot.com/"
  }
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeStoredTask(task: ExtensionTaskPayload | StoredExtensionTask): StoredExtensionTask {
  const current = task as Partial<StoredExtensionTask>;
  const queuedAt = current.queuedAt ?? nowIso();

  return {
    taskId: current.taskId ?? "",
    platform: current.platform ?? "",
    action: current.action ?? "",
    listing: current.listing ?? {},
    localState: current.localState ?? "QUEUED",
    queuedAt,
    updatedAt: current.updatedAt ?? queuedAt,
    claimedAt: current.claimedAt ?? null,
    lastHeartbeatAt: current.lastHeartbeatAt ?? null,
    retryAfter: current.retryAfter ?? null,
    attemptCount: current.attemptCount ?? 0,
    runnerInstanceId: current.runnerInstanceId ?? null,
    lastErrorCode: current.lastErrorCode ?? null,
    lastErrorMessage: current.lastErrorMessage ?? null
  };
}

async function getStoredAuth() {
  const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
  return (stored[AUTH_STORAGE_KEY] ?? null) as ExtensionAuthSession | null;
}

async function getRunnerInstanceId() {
  const stored = await chrome.storage.local.get(RUNNER_INSTANCE_STORAGE_KEY);
  const existing = stored[RUNNER_INSTANCE_STORAGE_KEY];

  if (typeof existing === "string" && existing.trim()) {
    return existing;
  }

  const runnerInstanceId = crypto.randomUUID();
  await chrome.storage.local.set({
    [RUNNER_INSTANCE_STORAGE_KEY]: runnerInstanceId
  });
  return runnerInstanceId;
}

async function getStoredTasks() {
  const stored = await chrome.storage.local.get(TASK_STORAGE_KEY);
  const tasks = Array.isArray(stored[TASK_STORAGE_KEY]) ? (stored[TASK_STORAGE_KEY] as Array<ExtensionTaskPayload | StoredExtensionTask>) : [];
  return tasks.map(normalizeStoredTask);
}

async function setStoredTasks(tasks: StoredExtensionTask[]) {
  await chrome.storage.local.set({
    [TASK_STORAGE_KEY]: tasks
  });
}

async function updateStoredTask(taskId: string, updater: (task: StoredExtensionTask) => StoredExtensionTask | null) {
  const tasks = await getStoredTasks();
  const nextTasks = tasks
    .map((task) => (task.taskId === taskId ? updater(task) : task))
    .filter((task): task is StoredExtensionTask => Boolean(task));

  await setStoredTasks(nextTasks);
  return nextTasks;
}

function scheduleRunner(delayMs = 250) {
  chrome.alarms.create(RUNNER_ALARM_NAME, {
    when: Date.now() + delayMs
  });
}

async function updateMollieTask(path: string, body: Record<string, unknown>) {
  const auth = await getStoredAuth();

  if (!auth) {
    return {
      ok: false,
      error: "Connect the extension to Mollie first."
    };
  }

  const response = await fetch(`${auth.apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
      "x-workspace-id": auth.workspaceId
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ error: "Could not update task" }))) as { error?: string };
    return {
      ok: false,
      error: payload.error ?? "Could not update task"
    };
  }

  return {
    ok: true,
    payload: (await response.json()) as Record<string, unknown>
  };
}

async function claimMollieTask(taskId: string, runnerInstanceId: string) {
  return updateMollieTask(`/api/extension/tasks/${taskId}/claim`, {
    runnerInstanceId,
    browserName: "chrome-extension"
  });
}

async function heartbeatMollieTask(taskId: string, runnerInstanceId: string, input: { message?: string; result?: Record<string, unknown> } = {}) {
  return updateMollieTask(`/api/extension/tasks/${taskId}/heartbeat`, {
    runnerInstanceId,
    message: input.message ?? null,
    result: input.result ?? null
  });
}

async function updateMollieTaskResult(taskId: string, body: Record<string, unknown>) {
  return updateMollieTask(`/api/extension/tasks/${taskId}/result`, body);
}

async function importActiveEbayListing() {
  const auth = await getStoredAuth();

  if (!auth) {
    return {
      ok: false,
      error: "Open Mollie in this browser first so the extension can connect."
    };
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!activeTab?.id || !activeTab.url?.includes("ebay.com")) {
    return {
      ok: false,
      error: "Open an eBay listing tab first."
    };
  }

  const extracted = (await chrome.tabs.sendMessage(activeTab.id, {
    type: "MOLLIE_EXTENSION_EXTRACT_EBAY"
  })) as { ok: boolean; payload?: EbayImportPayload; error?: string };

  if (!extracted?.ok || !extracted.payload) {
    return {
      ok: false,
      error: extracted?.error ?? "Could not read the active eBay listing."
    };
  }

  const response = await fetch(`${auth.apiBaseUrl}/api/extension/imports/ebay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
      "x-workspace-id": auth.workspaceId
    },
    body: JSON.stringify(extracted.payload)
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ error: "eBay import failed" }))) as { error?: string };
    return {
      ok: false,
      error: payload.error ?? "eBay import failed"
    };
  }

  return {
    ok: true,
    payload: (await response.json()) as Record<string, unknown>
  };
}

async function getMarketplaceCookieCount(vendor: MarketplaceVendor) {
  const cookies = await chrome.cookies.getAll({
    url: MARKETPLACE_SESSION_CONFIG[vendor].cookieUrl
  });
  return cookies.length;
}

function urlMatchesPatterns(url: string, patterns: string[]) {
  return patterns.some((pattern) => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i").test(url);
  });
}

async function findOrOpenMarketplaceTab(vendor: MarketplaceVendor) {
  const config = MARKETPLACE_SESSION_CONFIG[vendor];
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (activeTab?.id && activeTab.url && urlMatchesPatterns(activeTab.url, config.tabPatterns)) {
    return {
      tab: activeTab,
      openedNewTab: false
    };
  }

  const existingTabs = await chrome.tabs.query({
    url: config.tabPatterns
  });
  const reusableTab = existingTabs.find((tab: { id?: number | null }) => typeof tab.id === "number");

  if (reusableTab?.id) {
    await chrome.tabs.update(reusableTab.id, { active: true });
    return {
      tab: reusableTab,
      openedNewTab: false
    };
  }

  const tab = await chrome.tabs.create({
    url: config.loginUrl,
    active: true
  });

  return {
    tab,
    openedNewTab: true
  };
}

async function detectMarketplaceSessionInTab(tabId: number) {
  try {
    return (await chrome.tabs.sendMessage(tabId, {
      type: "MOLLIE_EXTENSION_DETECT_MARKETPLACE_SESSION"
    })) as MarketplaceSessionDetection;
  } catch {
    return null;
  }
}

async function recheckMarketplaceSession(payload: MarketplaceSessionRecheckPayload) {
  const auth = await getStoredAuth();

  if (!auth) {
    return {
      ok: false,
      error: "Open Mollie in this browser first so the extension can connect."
    };
  }

  const config = MARKETPLACE_SESSION_CONFIG[payload.vendor];
  const { tab, openedNewTab } = await findOrOpenMarketplaceTab(payload.vendor);

  if (!tab.id) {
    return {
      ok: false,
      error: `Could not open ${config.label} in a browser tab.`
    };
  }

  const readyTab = await waitForTabComplete(tab.id);
  const detection = await detectMarketplaceSessionInTab(tab.id);
  const cookieCount = await getMarketplaceCookieCount(payload.vendor);
  const pageUrl = detection?.pageUrl ?? readyTab.url ?? config.loginUrl;
  const pageOrigin = (() => {
    try {
      return new URL(pageUrl).origin;
    } catch {
      return new URL(config.cookieUrl).origin;
    }
  })();
  const looksLoggedIn = Boolean(detection?.loggedIn) || (cookieCount > 0 && !/\/login\b/i.test(pageUrl));

  if (!looksLoggedIn) {
    return {
      ok: false,
      needsLogin: true,
      vendor: payload.vendor,
      openedNewTab,
      tabUrl: pageUrl,
      error: `Log in to ${config.label} in the opened tab, then click recheck login again.`
    };
  }

  const response = await fetch(`${auth.apiBaseUrl}/api/marketplace-accounts/${payload.vendor}/connect/${payload.attemptId}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
      "x-workspace-id": auth.workspaceId
    },
    body: JSON.stringify({
      helperNonce: payload.helperNonce,
      accountHandle: detection?.accountHandle ?? payload.displayName,
      externalAccountId: detection?.externalAccountId ?? null,
      sessionLabel: payload.displayName,
      captureMode: "EXTENSION_BROWSER",
      challengeRequired: false,
      cookieCount,
      origin: pageOrigin,
      storageStateJson: {
        origins: [{ origin: pageOrigin }],
        detectedBy: "browser-extension",
        pageTitle: detection?.pageTitle ?? null
      }
    })
  });

  const body = (await response.json().catch(() => ({ error: `Could not recheck ${config.label} login.` }))) as {
    error?: string;
    attempt?: { state?: string };
    account?: { displayName?: string | null };
  };

  if (!response.ok) {
    return {
      ok: false,
      error: body.error ?? `Could not recheck ${config.label} login.`
    };
  }

  return {
    ok: true,
    vendor: payload.vendor,
    state: body.attempt?.state ?? "UNKNOWN",
    accountHandle: detection?.accountHandle ?? payload.displayName,
    accountDisplayName: body.account?.displayName ?? payload.displayName,
    message:
      body.attempt?.state === "CONNECTED"
        ? `${config.label} is connected and saved to this workspace.`
        : `${config.label} login moved to ${body.attempt?.state ?? "UNKNOWN"}.`
  };
}

async function waitForTabComplete(tabId: number, timeoutMs = 30_000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") {
    return current;
  }

  return await new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      reject(new Error("Marketplace tab took too long to load."));
    }, timeoutMs);

    function handleUpdated(updatedTabId: number, changeInfo: { status?: string }, tab: any) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }

      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      resolve(tab);
    }

    chrome.tabs.onUpdated.addListener(handleUpdated);
  });
}

async function runEbayPrepareDraftTask(task: StoredExtensionTask, runnerInstanceId: string) {
  const listing = task.listing;

  await heartbeatMollieTask(task.taskId, runnerInstanceId, {
    message: "Opening eBay listing flow",
    result: {
      phase: "open_tab"
    }
  });

  const tab = await chrome.tabs.create({
    url: "https://www.ebay.com/sl/sell",
    active: true
  });

  if (!tab.id) {
    return {
      state: "FAILED" as const,
      lastErrorCode: "UNKNOWN" as const,
      lastErrorMessage: "Could not open the eBay sell flow.",
      result: {
        phase: "open_tab"
      }
    };
  }

  const readyTab = await waitForTabComplete(tab.id);

  await heartbeatMollieTask(task.taskId, runnerInstanceId, {
    message: "Applying listing fields on eBay",
    result: {
      phase: "fill_form",
      tabId: tab.id,
      tabUrl: readyTab.url ?? null
    }
  });

  const applied = (await chrome.tabs.sendMessage(tab.id, {
    type: "MOLLIE_EXTENSION_APPLY_EBAY_DRAFT",
    payload: {
      taskId: task.taskId,
      listing
    }
  })) as
    | {
        ok: true;
        result: {
          fieldsApplied: string[];
          missingFields: string[];
          tabUrl: string | null;
        };
      }
    | {
        ok: false;
        needsInput?: boolean;
        error?: string;
        result?: {
          fieldsApplied?: string[];
          missingFields?: string[];
          tabUrl?: string | null;
        };
      };

  if (applied?.ok) {
    return {
      state: "SUCCEEDED" as const,
      result: {
        browserExecution: "EBAY_PREPARE_DRAFT",
        tabId: tab.id,
        tabUrl: applied.result.tabUrl,
        fieldsApplied: applied.result.fieldsApplied,
        missingFields: applied.result.missingFields
      }
    };
  }

  if (applied?.needsInput) {
    return {
      state: "NEEDS_INPUT" as const,
      lastErrorCode: "MISSING_REQUIRED_FIELD" as const,
      lastErrorMessage: applied.error ?? "eBay needs more input before the draft can be prepared.",
      needsInputReason: applied.error ?? "Finish the eBay listing form in the current browser tab.",
      result: {
        browserExecution: "EBAY_PREPARE_DRAFT",
        tabId: tab.id,
        tabUrl: applied.result?.tabUrl ?? readyTab.url ?? null,
        fieldsApplied: applied.result?.fieldsApplied ?? [],
        missingFields: applied.result?.missingFields ?? []
      }
    };
  }

  return {
    state: "FAILED" as const,
    lastErrorCode: "SELECTOR_FAILED" as const,
    lastErrorMessage: applied?.error ?? "Could not apply the eBay draft fields in the browser.",
    result: {
      browserExecution: "EBAY_PREPARE_DRAFT",
      tabId: tab.id,
      tabUrl: readyTab.url ?? null,
      fieldsApplied: applied?.result?.fieldsApplied ?? [],
      missingFields: applied?.result?.missingFields ?? []
    }
  };
}

async function runTask(task: StoredExtensionTask, runnerInstanceId: string) {
  if (task.platform === "EBAY" && task.action === "PREPARE_DRAFT") {
    return runEbayPrepareDraftTask(task, runnerInstanceId);
  }

  return {
    state: "FAILED" as const,
    lastErrorCode: "UNSUPPORTED_FLOW" as const,
    lastErrorMessage: `${task.platform} ${task.action.replace(/_/g, " ").toLowerCase()} is not live in the extension yet.`,
    result: {
      browserExecution: "UNSUPPORTED"
    }
  };
}

async function recoverStaleTasks(tasks: StoredExtensionTask[]) {
  const now = Date.now();
  let changed = false;

  const nextTasks = tasks.map((task) => {
    if (task.localState !== "RUNNING" || !task.lastHeartbeatAt) {
      return task;
    }

    const heartbeatAt = new Date(task.lastHeartbeatAt).getTime();
    if (Number.isNaN(heartbeatAt) || now - heartbeatAt < TASK_STALE_MS) {
      return task;
    }

    changed = true;
    return {
      ...task,
      localState: "QUEUED" as const,
      claimedAt: null,
      lastHeartbeatAt: null,
      runnerInstanceId: null,
      updatedAt: nowIso()
    };
  });

  if (changed) {
    await setStoredTasks(nextTasks);
  }

  return nextTasks;
}

async function pumpTaskQueue() {
  const auth = await getStoredAuth();

  if (!auth) {
    return;
  }

  const runnerInstanceId = await getRunnerInstanceId();
  const tasks = await recoverStaleTasks(await getStoredTasks());
  const now = Date.now();
  const nextTask = tasks.find((task) => {
    if (task.localState !== "QUEUED") {
      return false;
    }

    if (!task.retryAfter) {
      return true;
    }

    return new Date(task.retryAfter).getTime() <= now;
  });

  if (!nextTask) {
    const nextRetryAt = tasks
      .filter((task) => task.localState === "QUEUED" && task.retryAfter)
      .map((task) => new Date(task.retryAfter as string).getTime())
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right)[0];

    if (nextRetryAt) {
      scheduleRunner(Math.max(1_000, nextRetryAt - now));
    }
    return;
  }

  const claim = (await claimMollieTask(nextTask.taskId, runnerInstanceId)) as { ok: boolean; error?: string; payload?: ClaimResponse };

  if (!claim.ok) {
    await updateStoredTask(nextTask.taskId, (task) => ({
      ...task,
      localState: "FAILED",
      updatedAt: nowIso(),
      lastErrorCode: "UNKNOWN",
      lastErrorMessage: claim.error ?? "Could not claim the task from Mollie."
    }));
    return;
  }

  const claimPayload = claim.payload ?? {};

  if (!claimPayload.claimed) {
    const remoteTask = claimPayload.task;

    if (!remoteTask) {
      return;
    }

    await updateStoredTask(nextTask.taskId, (task) => ({
      ...task,
      localState: remoteTask.state,
      attemptCount: remoteTask.attemptCount ?? task.attemptCount,
      runnerInstanceId: remoteTask.runnerInstanceId ?? null,
      lastErrorCode: remoteTask.lastErrorCode ?? null,
      lastErrorMessage: remoteTask.lastErrorMessage ?? null,
      updatedAt: nowIso()
    }));
    return;
  }

  await updateStoredTask(nextTask.taskId, (task) => ({
    ...task,
    localState: "RUNNING",
    attemptCount: claimPayload.task?.attemptCount ?? task.attemptCount + 1,
    runnerInstanceId,
    claimedAt: nowIso(),
    lastHeartbeatAt: nowIso(),
    updatedAt: nowIso()
  }));

  try {
    const execution = await runTask(nextTask, runnerInstanceId);
    const resultResponse = await updateMollieTaskResult(nextTask.taskId, {
      state: execution.state,
      runnerInstanceId,
      lastErrorCode: execution.lastErrorCode ?? null,
      lastErrorMessage: execution.lastErrorMessage ?? null,
      needsInputReason: "needsInputReason" in execution ? execution.needsInputReason ?? null : null,
      result: execution.result ?? null
    });

    if (!resultResponse.ok) {
      throw new Error(resultResponse.error ?? "Could not persist the extension task result.");
    }

    await updateStoredTask(nextTask.taskId, (task) =>
      execution.state === "SUCCEEDED"
        ? null
        : {
            ...task,
            localState: execution.state,
            runnerInstanceId: runnerInstanceId,
            lastErrorCode: execution.lastErrorCode ?? null,
            lastErrorMessage: execution.lastErrorMessage ?? null,
            updatedAt: nowIso(),
            lastHeartbeatAt: nowIso()
          }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown extension execution error";
    await updateMollieTaskResult(nextTask.taskId, {
      state: "FAILED",
      runnerInstanceId,
      lastErrorCode: "UNKNOWN",
      lastErrorMessage: message,
      result: {
        browserExecution: "UNHANDLED_FAILURE"
      }
    });
    await updateStoredTask(nextTask.taskId, (task) => ({
      ...task,
      localState: "FAILED",
      runnerInstanceId,
      lastErrorCode: "UNKNOWN",
      lastErrorMessage: message,
      updatedAt: nowIso(),
      lastHeartbeatAt: nowIso()
    }));
  }

  scheduleRunner(500);
}

function ensureQueuePump() {
  if (!queuePump) {
    queuePump = pumpTaskQueue().finally(() => {
      queuePump = null;
    });
  }

  return queuePump;
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleRunner();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleRunner();
});

chrome.alarms.onAlarm.addListener((alarm: { name?: string }) => {
  if (alarm.name === RUNNER_ALARM_NAME) {
    void ensureQueuePump();
  }
});

chrome.runtime.onMessage.addListener((message: Record<string, unknown>, _sender: unknown, sendResponse: (response?: unknown) => void) => {
  void (async () => {
    const type = typeof message.type === "string" ? message.type : "";

    if (type === "MOLLIE_EXTENSION_PING") {
      sendResponse({
        ok: true,
        version: chrome.runtime.getManifest().version
      });
      return;
    }

    if (type === "MOLLIE_EXTENSION_AUTH_SESSION") {
      const payload = message.payload as ExtensionAuthSession | undefined;

      if (!payload?.token || !payload.workspaceId || !payload.apiBaseUrl) {
        sendResponse({
          ok: false,
          error: "Missing Mollie session payload."
        });
        return;
      }

      await chrome.storage.local.set({
        [AUTH_STORAGE_KEY]: payload
      });
      scheduleRunner();
      sendResponse({
        ok: true
      });
      return;
    }

    if (type === "MOLLIE_EXTENSION_TASK_HANDOFF") {
      const payload = message.payload as ExtensionTaskPayload | undefined;

      if (!payload?.taskId) {
        sendResponse({
          ok: false,
          error: "Missing extension task payload."
        });
        return;
      }

      const queuedTasks = await getStoredTasks();
      const nextTask = normalizeStoredTask({
        ...payload,
        localState: "QUEUED",
        queuedAt: nowIso(),
        updatedAt: nowIso(),
        attemptCount: 0
      });
      const nextTasks = [nextTask, ...queuedTasks.filter((task) => task.taskId !== payload.taskId)].slice(0, MAX_STORED_TASKS);
      await setStoredTasks(nextTasks);
      scheduleRunner();

      sendResponse({
        ok: true,
        pendingCount: nextTasks.filter((task) => task.localState === "QUEUED" || task.localState === "RUNNING").length
      });
      return;
    }

    if (type === "MOLLIE_EXTENSION_GET_STATUS") {
      const [auth, tasks] = await Promise.all([getStoredAuth(), getStoredTasks()]);
      sendResponse({
        ok: true,
        connected: Boolean(auth?.token),
        workspaceId: auth?.workspaceId ?? null,
        pendingCount: tasks.filter((task) => task.localState === "QUEUED" || task.localState === "RUNNING").length,
        taskStates: tasks.map((task) => ({
          taskId: task.taskId,
          state: task.localState,
          action: task.action,
          platform: task.platform
        }))
      });
      return;
    }

    if (type === "MOLLIE_EXTENSION_IMPORT_ACTIVE_EBAY") {
      sendResponse(await importActiveEbayListing());
      return;
    }

    if (type === "MOLLIE_EXTENSION_RECHECK_MARKETPLACE_AUTH") {
      const payload = message.payload as MarketplaceSessionRecheckPayload | undefined;

      if (!payload?.vendor || !payload.attemptId || !payload.helperNonce || !payload.displayName) {
        sendResponse({
          ok: false,
          error: "Missing marketplace recheck payload."
        });
        return;
      }

      sendResponse(await recheckMarketplaceSession(payload));
      return;
    }

    sendResponse({
      ok: false,
      error: "Unsupported extension message."
    });
  })();

  return true;
});

export {};
