import { expect, test, type Page, type Request } from "@playwright/test";

type CapturedRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
};

const apiItem = {
  id: "item-delete-regression",
  sku: "SKU-DELETE-1",
  title: "Delete regression shoes",
  brand: null,
  category: "Apparel",
  condition: "Good used condition",
  size: null,
  color: null,
  status: "DRAFT",
  costBasis: 12,
  priceRecommendation: 35,
  estimatedResaleMin: null,
  estimatedResaleMax: null,
  attributesJson: {
    importSource: "MANUAL_ENTRY"
  },
  images: [],
  listingDrafts: [],
  platformListings: [],
  automationTasks: [],
  sales: [],
  sourceLot: null,
  createdAt: "2026-03-25T21:18:37.000Z",
  updatedAt: "2026-03-25T21:18:37.000Z"
};

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  };
}

function captureRequest(request: Request): CapturedRequest {
  return {
    method: request.method(),
    url: request.url(),
    headers: request.headers(),
    body: request.postData()
  };
}

async function installMockSession(page: Page, options?: { items?: unknown[] }) {
  let inventoryItems = options?.items ?? [apiItem];

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill(
      jsonResponse({
        user: {
          id: "user-ui-actions",
          email: "ui-actions@example.com"
        },
        workspace: {
          id: "workspace-ui-actions",
          name: "UI Actions Workspace",
          plan: "PILOT",
          billingCustomerId: null,
          connectorAutomationEnabled: true
        },
        workspaces: [
          {
            id: "workspace-ui-actions",
            name: "UI Actions Workspace",
            plan: "PILOT",
            billingCustomerId: null,
            connectorAutomationEnabled: true
          }
        ]
      })
    );
  });

  await page.route("**/api/inventory", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill(jsonResponse({ items: inventoryItems }));
      return;
    }

    await route.fallback();
  });

  await page.addInitScript(() => {
    window.localStorage.setItem("reselleros.token", "ui-actions-token");
  });

  return {
    removeItem(itemId: string) {
      inventoryItems = inventoryItems.filter((item) => {
        return typeof item === "object" && item !== null && "id" in item ? item.id !== itemId : true;
      });
    }
  };
}

test("inventory delete regression sends an empty DELETE without JSON content-type", async ({ page }) => {
  const session = await installMockSession(page);
  let deleteRequest: CapturedRequest | null = null;

  await page.route(`**/api/inventory/${apiItem.id}`, async (route) => {
    if (route.request().method() === "DELETE") {
      deleteRequest = captureRequest(route.request());
      session.removeItem(apiItem.id);
      await route.fulfill(jsonResponse({ ok: true, itemId: apiItem.id }));
      return;
    }

    await route.fallback();
  });

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: /my listings/i })).toBeVisible();
  await expect(page.getByRole("link", { name: apiItem.title }).first()).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain(apiItem.title);
    await dialog.accept();
  });
  await page.locator(".inventory-row-actions").getByRole("button", { name: /delete/i }).first().click();

  await expect(page.getByText(`Deleted ${apiItem.title}.`)).toBeVisible();
  expect(deleteRequest).not.toBeNull();
  expect(deleteRequest?.method).toBe("DELETE");
  expect(deleteRequest?.body).toBeNull();
  expect(deleteRequest?.headers["content-type"]).toBeUndefined();
});

test("inventory no-body actions do not send empty JSON requests", async ({ page }) => {
  await installMockSession(page);
  let publishRequest: CapturedRequest | null = null;

  await page.route(`**/api/inventory/${apiItem.id}/publish-linked`, async (route) => {
    publishRequest = captureRequest(route.request());
    await route.fulfill(jsonResponse({ ok: true }));
  });

  await page.goto("/inventory");
  await page.locator(".inventory-row-actions").getByRole("button", { name: /post/i }).first().click();

  await expect(page.getByText(`Queued publish for ${apiItem.title}.`)).toBeVisible();
  expect(publishRequest).not.toBeNull();
  expect(publishRequest?.method).toBe("POST");
  expect(publishRequest?.body).toBeNull();
  expect(publishRequest?.headers["content-type"]).toBeUndefined();
});

test("inventory page primary actions navigate or open the expected workspace", async ({ page }) => {
  await installMockSession(page);

  await page.goto("/inventory");
  await expect(page.getByRole("link", { name: /edit/i }).first()).toHaveAttribute("href", `/inventory/${apiItem.id}`);
  await expect(page.getByRole("link", { name: /new item/i })).toHaveAttribute("href", "/inventory/create");
  await expect(page.getByRole("link", { name: /upload multiple/i })).toHaveAttribute("href", "/imports");

  await page.getByRole("button", { name: /scan code/i }).click();
  const scanDialog = page.getByRole("dialog", { name: /inventory scan/i });
  await expect(scanDialog).toBeVisible();
  await scanDialog.getByRole("button", { name: /manual creation/i }).click();
  await expect(page).toHaveURL(/\/inventory\/create$/);
});

test("create page submit sends a JSON create request with the entered fields", async ({ page }) => {
  await installMockSession(page, { items: [] });
  let createRequest: CapturedRequest | null = null;

  await page.route("**/api/inventory", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill(jsonResponse({ items: [] }));
      return;
    }

    if (route.request().method() === "POST") {
      createRequest = captureRequest(route.request());
      await route.fulfill(jsonResponse({ item: { id: "created-from-ui-action" } }));
      return;
    }

    await route.fallback();
  });

  await page.goto("/inventory/create");
  await page.getByLabel(/^title$/i).fill("Create action test item");
  await page.getByLabel(/^category$/i).fill("Apparel");
  await page.getByLabel(/^condition$/i).fill("Good used condition");
  await page.getByLabel(/suggested sell/i).fill("42");
  await page.getByTestId("manual-inventory-create").click();

  await expect(page).toHaveURL(/\/inventory\/created-from-ui-action$/);
  expect(createRequest).not.toBeNull();
  expect(createRequest?.method).toBe("POST");
  expect(createRequest?.headers["content-type"]).toContain("application/json");
  expect(JSON.parse(createRequest?.body ?? "{}")).toMatchObject({
    title: "Create action test item",
    category: "Apparel",
    condition: "Good used condition",
    priceRecommendation: 42
  });
});

test("item detail missing Depop requirements jump to their matching fields", async ({ page }) => {
  const depopItem = {
    ...apiItem,
    id: "item-depop-anchor-regression",
    sku: "SKU-DEPOP-ANCHOR",
    title: "Depop anchor regression shoes",
    brand: "Nike",
    description: null,
    attributesJson: {
      importSource: "MANUAL_ENTRY",
      description: "",
      marketplaceOverrides: {
        DEPOP: {
          attributes: {}
        }
      }
    }
  };

  await page.setViewportSize({ width: 1600, height: 900 });
  await installMockSession(page, { items: [depopItem] });
  await page.route(`**/api/inventory/${depopItem.id}`, async (route) => {
    await route.fulfill(jsonResponse({ item: depopItem }));
  });
  await page.route(`**/api/inventory/${depopItem.id}/preflight/ebay`, async (route) => {
    await route.fulfill(jsonResponse({ preflight: null }));
  });
  await page.route("**/api/automation/capabilities", async (route) => {
    await route.fulfill(jsonResponse({ capabilitySummary: [] }));
  });
  await page.route("**/api/marketplace-accounts", async (route) => {
    await route.fulfill(jsonResponse({ accounts: [] }));
  });
  await page.route("**/api/ai/status", async (route) => {
    await route.fulfill(jsonResponse({ configured: false, providers: [] }));
  });

  await page.goto(`/inventory/${depopItem.id}`);
  await expect(page.getByRole("heading", { name: depopItem.title })).toBeVisible();
  await page.locator(".marketplace-status-row", { hasText: "Depop" }).click();
  const depopDepartmentRequirement = page.locator(".marketplace-requirement-link", { hasText: "Depop department" });
  await expect(depopDepartmentRequirement).toBeVisible();

  const editorPanel = page.locator(".detail-editor-main");
  await editorPanel.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const scrolledAwayTop = await editorPanel.evaluate((element) => element.scrollTop);

  await depopDepartmentRequirement.click();

  await expect(page.locator("#inventory-anchor-depop-department select")).toBeFocused();
  await expect
    .poll(async () => editorPanel.evaluate((element) => element.scrollTop))
    .toBeLessThan(scrolledAwayTop);

});

test("marketplaces page sign-in actions start and recheck vendor sessions", async ({ page }) => {
  await installMockSession(page, { items: [] });
  let startRequest: CapturedRequest | null = null;
  let recheckRequest: CapturedRequest | null = null;

  await page.route("**/api/marketplace-accounts", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill(jsonResponse({ accounts: [] }));
      return;
    }

    await route.fallback();
  });
  await page.route("**/api/automation/poshmark/social", async (route) => {
    await route.fulfill(
      jsonResponse({
        connected: false,
        config: {
          shareCloset: { enabled: false, intervalMinutes: 120 },
          shareListings: { enabled: false, intervalMinutes: 240 },
          sendOffersToLikers: { enabled: false, intervalMinutes: 360 }
        },
        status: null
      })
    );
  });
  await page.route("**/api/marketplace-accounts/DEPOP/connect/start", async (route) => {
    startRequest = captureRequest(route.request());
    await route.fulfill(
      jsonResponse({
        attempt: {
          id: "depop-attempt",
          helperNonce: "depop-nonce"
        }
      })
    );
  });
  await page.route("**/api/marketplace-accounts/DEPOP/connect/depop-attempt/session", async (route) => {
    recheckRequest = captureRequest(route.request());
    await route.fulfill(jsonResponse({ account: { id: "depop-account" } }));
  });

  await page.goto("/marketplaces");
  await page.evaluate(() => {
    window.open = () => null;
  });
  await page.getByRole("button", { name: /open depop login/i }).click();
  await expect(page.getByText(/depop login opened in another tab/i)).toBeVisible();
  await page.getByRole("button", { name: /^recheck login$/i }).first().click();
  await expect(page.getByText(/depop login rechecked/i)).toBeVisible();

  expect(startRequest).not.toBeNull();
  expect(startRequest?.method).toBe("POST");
  expect(startRequest?.headers["content-type"]).toContain("application/json");
  expect(JSON.parse(startRequest?.body ?? "{}")).toMatchObject({
    displayName: "Main Depop account"
  });
  expect(recheckRequest).not.toBeNull();
  expect(recheckRequest?.method).toBe("POST");
  expect(recheckRequest?.headers["content-type"]).toContain("application/json");
  expect(JSON.parse(recheckRequest?.body ?? "{}")).toMatchObject({
    helperNonce: "depop-nonce",
    accountHandle: "main-depop-shop",
    captureMode: "WEB_POPUP_HELPER"
  });
});

test("imports page preview and apply actions send expected JSON payloads", async ({ page }) => {
  await installMockSession(page, { items: [] });
  let previewRequest: CapturedRequest | null = null;
  let applyRequest: CapturedRequest | null = null;

  await page.route("**/api/imports", async (route) => {
    await route.fulfill(jsonResponse({ runs: [] }));
  });
  await page.route("**/api/marketplace-accounts", async (route) => {
    await route.fulfill(jsonResponse({ accounts: [] }));
  });
  await page.route("**/api/imports/url/preview", async (route) => {
    previewRequest = captureRequest(route.request());
    await route.fulfill(
      jsonResponse({
        candidate: {
          title: "Previewed import jacket",
          brand: "Mollie Test",
          category: "Apparel",
          condition: "Good used condition",
          quantity: 1,
          costBasis: 0,
          estimatedResaleMin: null,
          estimatedResaleMax: null,
          priceRecommendation: 28,
          sourceUrl: "https://example.com/listing/previewed-import-jacket",
          externalItemId: "previewed-import-jacket",
          imageUrls: [],
          attributes: {}
        }
      })
    );
  });
  await page.route("**/api/imports/url/apply", async (route) => {
    applyRequest = captureRequest(route.request());
    await route.fulfill(jsonResponse({ item: { id: "imported-from-preview" } }));
  });

  await page.goto("/imports");
  await page.getByLabel(/listing url/i).fill("https://example.com/listing/previewed-import-jacket");
  await page.getByRole("button", { name: /preview listing/i }).click();
  await expect(page.getByText("Previewed import jacket")).toBeVisible();
  await page.getByRole("button", { name: /create inventory from preview/i }).click();

  expect(previewRequest).not.toBeNull();
  expect(previewRequest?.method).toBe("POST");
  expect(previewRequest?.headers["content-type"]).toContain("application/json");
  expect(JSON.parse(previewRequest?.body ?? "{}")).toMatchObject({
    sourcePlatform: "CROSSLIST",
    url: "https://example.com/listing/previewed-import-jacket"
  });
  expect(applyRequest).not.toBeNull();
  expect(applyRequest?.method).toBe("POST");
  expect(applyRequest?.headers["content-type"]).toContain("application/json");
  expect(JSON.parse(applyRequest?.body ?? "{}")).toMatchObject({
    sourcePlatform: "CROSSLIST",
    url: "https://example.com/listing/previewed-import-jacket",
    candidate: {
      title: "Previewed import jacket"
    }
  });
});
