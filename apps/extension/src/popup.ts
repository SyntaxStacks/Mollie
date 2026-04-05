type PopupStatusResponse = {
  ok: boolean;
  connected?: boolean;
  workspaceId?: string | null;
  pendingCount?: number;
  error?: string;
};

const connectionState = document.querySelector("#connection-state") as HTMLSpanElement | null;
const pendingCount = document.querySelector("#pending-count") as HTMLSpanElement | null;
const activeTabHint = document.querySelector("#active-tab-hint") as HTMLParagraphElement | null;
const importButton = document.querySelector("#import-ebay-button") as HTMLButtonElement | null;
const importResult = document.querySelector("#import-result") as HTMLParagraphElement | null;

function setImportResult(message: string, isError = false) {
  if (!importResult) {
    return;
  }

  importResult.textContent = message;
  importResult.style.color = isError ? "#9d2b1f" : "#102218";
}

async function getStatus() {
  return (await chrome.runtime.sendMessage({
    type: "MOLLIE_EXTENSION_GET_STATUS"
  })) as PopupStatusResponse;
}

async function refreshStatus() {
  const [status, tabs] = await Promise.all([
    getStatus(),
    chrome.tabs.query({
      active: true,
      currentWindow: true
    })
  ]);
  const activeTab = tabs[0];
  const ebayReady = Boolean(activeTab?.url?.includes("ebay.com"));

  if (connectionState) {
    connectionState.textContent = status.connected ? "Connected" : "Not connected";
  }

  if (pendingCount) {
    pendingCount.textContent = String(status.pendingCount ?? 0);
  }

  if (activeTabHint) {
    if (!status.connected) {
      activeTabHint.textContent = "Open Mollie first so the extension can receive your workspace session.";
    } else if (ebayReady) {
      activeTabHint.textContent = "Active tab looks like eBay. Import the listing when ready.";
    } else {
      activeTabHint.textContent = "Open a single eBay listing page to import it into Mollie.";
    }
  }

  if (importButton) {
    importButton.disabled = !status.connected || !ebayReady;
  }
}

async function importActiveEbayListing() {
  if (importButton) {
    importButton.disabled = true;
  }

  setImportResult("Importing active eBay listing...");
  const result = (await chrome.runtime.sendMessage({
    type: "MOLLIE_EXTENSION_IMPORT_ACTIVE_EBAY"
  })) as { ok: boolean; error?: string; payload?: { duplicate?: boolean; inventoryItemId?: string } };

  if (!result.ok) {
    setImportResult(result.error ?? "eBay import failed.", true);
  } else if (result.payload?.duplicate) {
    setImportResult("Listing already exists in Mollie. Linked to the existing inventory item.");
  } else {
    setImportResult("Imported into Mollie.");
  }

  await refreshStatus();
}

if (importButton) {
  importButton.addEventListener("click", () => {
    void importActiveEbayListing();
  });
}

void refreshStatus();

export {};
