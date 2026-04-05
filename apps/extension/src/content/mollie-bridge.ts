function isBridgeRequest(value: unknown): value is {
  source: "MOLLIE_WEB_APP";
  target: "MOLLIE_EXTENSION";
  requestId: string;
  type: "MOLLIE_EXTENSION_PING" | "MOLLIE_EXTENSION_AUTH_SESSION" | "MOLLIE_EXTENSION_TASK_HANDOFF";
  payload?: Record<string, unknown>;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.source === "MOLLIE_WEB_APP" &&
    candidate.target === "MOLLIE_EXTENSION" &&
    typeof candidate.requestId === "string" &&
    typeof candidate.type === "string"
  );
}

function sendRuntimeMessage(message: Record<string, unknown>) {
  return new Promise<Record<string, unknown>>((resolve) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      resolve((response ?? {}) as Record<string, unknown>);
    });
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin || !isBridgeRequest(event.data)) {
    return;
  }

  void sendRuntimeMessage({
    type: event.data.type,
    payload: event.data.payload
  }).then((response) => {
    window.postMessage(
      {
        source: "MOLLIE_EXTENSION",
        target: "MOLLIE_APP",
        requestId: event.data.requestId,
        response
      },
      window.location.origin
    );
  });
});

export {};
