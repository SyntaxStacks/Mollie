const AUTH_STORAGE_KEY = "mollie.extension.auth";
const TASK_STORAGE_KEY = "mollie.extension.tasks";

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

async function getStoredAuth() {
  const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
  return (stored[AUTH_STORAGE_KEY] ?? null) as ExtensionAuthSession | null;
}

async function getQueuedTasks() {
  const stored = await chrome.storage.local.get(TASK_STORAGE_KEY);
  return ((stored[TASK_STORAGE_KEY] ?? []) as ExtensionTaskPayload[]) ?? [];
}

async function setQueuedTasks(tasks: ExtensionTaskPayload[]) {
  await chrome.storage.local.set({
    [TASK_STORAGE_KEY]: tasks
  });
}

async function updateMollieTask(taskId: string, body: Record<string, unknown>) {
  const auth = await getStoredAuth();

  if (!auth) {
    return {
      ok: false,
      error: "Connect the extension to Mollie first."
    };
  }

  const response = await fetch(`${auth.apiBaseUrl}/api/extension/tasks/${taskId}/result`, {
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

      const queuedTasks = await getQueuedTasks();
      const nextTasks = [payload, ...queuedTasks.filter((task) => task.taskId !== payload.taskId)].slice(0, 25);
      await setQueuedTasks(nextTasks);
      await updateMollieTask(payload.taskId, {
        state: "RUNNING",
        result: {
          queuedInExtension: true,
          acceptedAt: new Date().toISOString()
        }
      });

      sendResponse({
        ok: true,
        pendingCount: nextTasks.length
      });
      return;
    }

    if (type === "MOLLIE_EXTENSION_GET_STATUS") {
      const [auth, tasks] = await Promise.all([getStoredAuth(), getQueuedTasks()]);
      sendResponse({
        ok: true,
        connected: Boolean(auth?.token),
        workspaceId: auth?.workspaceId ?? null,
        pendingCount: tasks.length
      });
      return;
    }

    if (type === "MOLLIE_EXTENSION_IMPORT_ACTIVE_EBAY") {
      sendResponse(await importActiveEbayListing());
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
