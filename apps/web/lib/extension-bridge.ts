"use client";

type BridgeResponse = {
  ok?: boolean;
  error?: string;
  pendingCount?: number;
  version?: string;
};

type BridgeMessageType =
  | "MOLLIE_EXTENSION_PING"
  | "MOLLIE_EXTENSION_AUTH_SESSION"
  | "MOLLIE_EXTENSION_TASK_HANDOFF";

function postExtensionMessage(type: BridgeMessageType, payload?: Record<string, unknown>, timeoutMs = 1_500) {
  if (typeof window === "undefined") {
    return Promise.resolve<BridgeResponse>({
      ok: false,
      error: "Window unavailable"
    });
  }

  const requestId = crypto.randomUUID();

  return new Promise<BridgeResponse>((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      window.removeEventListener("message", handleResponse);
      resolve({
        ok: false,
        error: "Extension unavailable"
      });
    }, timeoutMs);

    function handleResponse(event: MessageEvent) {
      const data = event.data as { target?: string; requestId?: string; response?: BridgeResponse } | null;

      if (event.source !== window || !data || data.target !== "MOLLIE_APP" || data.requestId !== requestId) {
        return;
      }

      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleResponse);
      resolve(data.response ?? { ok: false, error: "No response from extension" });
    }

    window.addEventListener("message", handleResponse);
    window.postMessage(
      {
        target: "MOLLIE_EXTENSION",
        requestId,
        type,
        payload
      },
      "*"
    );
  });
}

export async function detectMollieExtension() {
  const response = await postExtensionMessage("MOLLIE_EXTENSION_PING", undefined, 1_000);
  return Boolean(response.ok);
}

export async function connectMollieExtensionSession(input: {
  token: string;
  userId: string;
  email: string;
  workspaceId: string;
  apiBaseUrl: string;
}) {
  return postExtensionMessage("MOLLIE_EXTENSION_AUTH_SESSION", input, 2_000);
}

export async function handoffExtensionTask(input: {
  taskId: string;
  platform: string;
  action: string;
  listing: Record<string, unknown>;
}) {
  return postExtensionMessage("MOLLIE_EXTENSION_TASK_HANDOFF", input, 2_000);
}
