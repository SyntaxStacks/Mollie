function sendRuntimeMessage(message: Record<string, unknown>) {
  return new Promise<Record<string, unknown>>((resolve) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      resolve((response ?? {}) as Record<string, unknown>);
    });
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== window) {
    return;
  }

  const payload = event.data as { target?: string; requestId?: string; type?: string; payload?: Record<string, unknown> } | null;

  if (!payload || payload.target !== "MOLLIE_EXTENSION" || !payload.type) {
    return;
  }

  void sendRuntimeMessage({
    type: payload.type,
    payload: payload.payload
  }).then((response) => {
    window.postMessage(
      {
        target: "MOLLIE_APP",
        requestId: payload.requestId,
        response
      },
      "*"
    );
  });
});

export {};
