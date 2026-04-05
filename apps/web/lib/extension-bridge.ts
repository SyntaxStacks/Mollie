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

function isBridgeResponse(value: unknown, requestId: string) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.source === "MOLLIE_EXTENSION" &&
    candidate.target === "MOLLIE_APP" &&
    candidate.requestId === requestId &&
    typeof candidate.response === "object"
  );
}

function postExtensionMessage(type: BridgeMessageType, payload?: Record<string, unknown>, timeoutMs = 1_500) {
  if (typeof window === "undefined") {
    return Promise.resolve<BridgeResponse>({
      ok: false,
      error: "Window unavailable"
    });
  }

  const requestId = crypto.randomUUID();
  const targetOrigin = window.location.origin;

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
      if (event.origin !== targetOrigin || event.source !== window || !isBridgeResponse(event.data, requestId)) {
        return;
      }

      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleResponse);
      resolve((event.data as { response: BridgeResponse }).response ?? { ok: false, error: "No response from extension" });
    }

    window.addEventListener("message", handleResponse);
    window.postMessage(
      {
        source: "MOLLIE_WEB_APP",
        target: "MOLLIE_EXTENSION",
        requestId,
        type,
        payload
      },
      targetOrigin
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
