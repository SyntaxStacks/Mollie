import { devices, expect, test, type Page } from "@playwright/test";

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX4sAAAAASUVORK5CYII=",
  "base64"
);

async function onboardOperator(page: Page, options?: { workspaceName?: string }) {
  const email = uniqueEmail("ui-onboarding");
  const workspaceName = options?.workspaceName ?? "UI Test Workspace";

  await page.goto("/onboarding");
  await page.getByLabel(/^name$/i).fill("UI Pilot Operator");
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByRole("button", { name: /send login code/i }).click();

  const challengeNotice = page.locator(".notice").filter({ hasText: "Development code:" }).first();
  await expect(challengeNotice).toBeVisible();

  const challengeText = await challengeNotice.textContent();
  const code = challengeText?.match(/\b(\d{6})\b/)?.[1];
  expect(code).toBeTruthy();

  await page.getByLabel(/6-digit code/i).fill(code ?? "");
  await page.getByRole("button", { name: /verify and continue/i }).click();

  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: /workspace setup/i })).toBeVisible();
  await page.getByLabel(/workspace name/i).fill(workspaceName);
  await page.getByRole("button", { name: /create workspace/i }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /pilot dashboard/i })).toBeVisible();
  await expect(page.getByText(workspaceName)).toBeVisible();
}

async function createInventoryItem(page: Page, title: string) {
  await page.goto("/inventory");
  const manualEntryCard = page.locator("section").filter({ hasText: "Manual entry" }).first();
  await manualEntryCard.getByLabel(/^title$/i).fill(title);
  await manualEntryCard.getByRole("button", { name: /create item/i }).click();

  const itemLink = page.getByRole("link", { name: title });
  await expect(itemLink).toBeVisible();
  const itemHref = await itemLink.getAttribute("href");
  expect(itemHref).toBeTruthy();
  await page.goto(itemHref ?? "/inventory");

  await expect(page).toHaveURL(/\/inventory\/.+/);
}

test("logged-out operators can access the onboarding form without a redirect trap", async ({ page }) => {
  await page.goto("/onboarding");

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: /create your operator session/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /send login code/i })).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /privacy policy/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /terms of service/i })).toBeVisible();
});

test("public legal documents are reachable without authentication", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: /privacy, operator data, and marketplace information/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /what mollie collects/i })).toBeVisible();

  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: /pilot terms for operators and workspace owners/i })).toBeVisible();
  await expect(page.getByText(/workspace owners are responsible/i)).toBeVisible();
});

test("protected routes redirect logged-out operators into onboarding with client navigation", async ({ page }) => {
  await page.goto("/inventory");

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: /create your operator session/i })).toBeVisible();
});

test("operators can onboard, create a workspace, and get redirected into the app shell", async ({ page }) => {
  await onboardOperator(page);
  const storedToken = await page.evaluate(() => window.localStorage.getItem("reselleros.token"));
  expect(storedToken).toBeTruthy();

  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /pilot dashboard/i })).toBeVisible();
});

test("desktop inventory detail exposes a continue-on-mobile handoff with the canonical item url", async ({ page, baseURL }) => {
  const title = `Desktop Handoff Item ${Date.now()}`;

  await onboardOperator(page, {
    workspaceName: "UI Handoff Workspace"
  });

  await createInventoryItem(page, title);
  await page.getByTestId("continue-on-mobile-trigger").click();

  await expect(page.getByRole("dialog", { name: /continue on mobile/i })).toBeVisible();
  await expect(page.getByTestId("continue-on-mobile-url")).toHaveValue(new RegExp(`^${baseURL?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/inventory/.+`));
  await expect(page.getByTestId("continue-on-mobile-copy")).toBeVisible();
});

test("operators can scan to identify, accept a candidate, and queue drafts", async ({ page }) => {
  const title = `Identifier Scan Item ${Date.now()}`;

  await onboardOperator(page, {
    workspaceName: "UI Barcode Workspace"
  });

  await page.goto("/inventory");
  await page.getByTestId("scan-identify-barcode").fill("012345678905");
  await page.getByTestId("scan-identify-submit").click();
  const firstCandidate = page.getByTestId("scan-identify-candidate-0");
  await expect(firstCandidate).toBeVisible();
  await expect(firstCandidate.getByText(/amazon enriched/i)).toBeVisible();
  await page.getByTestId("scan-identify-accept-0").click();
  await expect(page.getByText(/accepted source/i)).toBeVisible();
  await expect(page.getByText(/valid starting point for this item/i)).toBeVisible();
  await page.getByTestId("scan-identify-title").fill(title);
  await page.getByTestId("scan-identify-condition").fill("Good used condition");
  await page.getByTestId("scan-identify-amazon-price").fill("39.99");
  await page.getByTestId("scan-identify-ebay-price").fill("34.99");
  await page.getByTestId("scan-identify-ebay-url").fill("https://www.ebay.com/itm/1234567890");
  await page.getByTestId("scan-identify-image-urls").fill(
    "https://m.media-amazon.com/images/I/example-one.jpg\nhttps://m.media-amazon.com/images/I/example-two.jpg"
  );
  await page.getByTestId("scan-identify-generate-drafts").check();
  await page.getByTestId("scan-identify-create").click();

  await expect(page).toHaveURL(/\/drafts\?fromScan=/);
  await expect(page.getByRole("heading", { name: /draft review queue/i })).toBeVisible();
});

test.describe("inventory continuity on mobile", () => {
  test.use({
    viewport: devices["iPhone 13"].viewport,
    userAgent: devices["iPhone 13"].userAgent,
    deviceScaleFactor: devices["iPhone 13"].deviceScaleFactor,
    isMobile: devices["iPhone 13"].isMobile,
    hasTouch: devices["iPhone 13"].hasTouch
  });

  test("operators can use the same inventory route for photo-first mobile work", async ({ page }) => {
    const title = `UI Upload Item ${Date.now()}`;

    await onboardOperator(page, {
      workspaceName: "UI Upload Workspace"
    });

    await createInventoryItem(page, title);

    const photoHeading = page.getByRole("heading", { name: /photo capture/i });
    const summaryHeading = page.getByRole("heading", { name: new RegExp(title, "i") });

    await expect(photoHeading).toBeVisible();
    await expect(summaryHeading).toBeVisible();
    const photoBox = await photoHeading.boundingBox();
    const summaryBox = await summaryHeading.boundingBox();
    expect(photoBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(summaryBox?.y ?? Number.POSITIVE_INFINITY);
    await expect(page.getByRole("heading", { name: /publish readiness/i })).toBeVisible();
    const photoCard = page.locator("section").filter({ has: page.getByRole("heading", { name: /photo capture/i }) }).first();

    await page.setInputFiles('input[name="image"]', {
      name: "pilot-photo-1.png",
      mimeType: "image/png",
      buffer: tinyPng
    });
    await photoCard.getByTestId("inventory-upload-submit").click();

    await expect(page.getByText(/image uploaded/i)).toBeVisible();
    await expect(page.locator(".image-upload-row")).toHaveCount(1);

    await page.setInputFiles('input[name="image"]', {
      name: "pilot-photo-2.png",
      mimeType: "image/png",
      buffer: tinyPng
    });
    await photoCard.getByTestId("inventory-upload-submit").click();

    await expect(page.locator(".image-upload-row")).toHaveCount(2);
    const secondImageId = await page.locator(".image-upload-row").nth(1).getAttribute("data-image-id");
    expect(secondImageId).toBeTruthy();
    await page.locator(".image-upload-row").nth(1).getByRole("button", { name: /move up/i }).click();

    await expect(page.getByText(/image moved up/i)).toBeVisible();
    await expect(page.locator(".image-upload-row").first()).toHaveAttribute("data-image-id", secondImageId ?? "");

    await page.locator(".image-upload-row").nth(1).getByRole("button", { name: /delete image/i }).click();

    await expect(page.getByText(/image deleted/i)).toBeVisible();
    await expect(page.locator(".image-upload-row")).toHaveCount(1);
    await page.reload();
    await expect(photoHeading).toBeVisible();
    await expect(page.locator(".image-upload-row")).toHaveCount(1);
    await expect(page.locator(".image-upload-row").first()).toHaveAttribute("data-image-id", secondImageId ?? "");
    await expect(page.getByText(/\/api\/uploads\/workspaces\//i)).toBeVisible();
  });
});
