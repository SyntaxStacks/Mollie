import { devices, expect, test, type Page, type TestInfo } from "@playwright/test";

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
  await expect(page.getByLabel(/workspace name/i)).toBeVisible();
  await page.getByLabel(/workspace name/i).fill(workspaceName);
  await page.getByRole("button", { name: /create workspace/i }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /identify fast\./i })).toBeVisible();
  await expect(page.getByText(workspaceName)).toBeVisible();
}

async function createInventoryItem(page: Page, title: string) {
  await page.goto("/");
  await page.getByRole("tab", { name: /manual\/source lookup/i }).click();
  await page.getByTestId("scan-identify-barcode").fill("012345678905");
  await page.getByTestId("scan-identify-submit").click();
  await expect(page.getByTestId("scan-identify-candidate-0")).toBeVisible();
  await page.getByTestId("scan-identify-accept-0").click();
  await page.getByTestId("scan-identify-title").fill(title);
  await page.getByTestId("scan-identify-condition").fill("Good used condition");
  await page.getByTestId("scan-identify-create").click();
  await expect(page).toHaveURL(/\/inventory\/.+/);
}

async function attachRouteScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, {
    path,
    contentType: "image/png"
  });
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
  await expect(page.getByRole("heading", { name: /identify fast\./i })).toBeVisible();
});

test("redesigned core routes render after onboarding", async ({ page }, testInfo) => {
  await onboardOperator(page, {
    workspaceName: "UI Route Smoke Workspace"
  });

  await expect(page.getByRole("heading", { name: /identify fast\./i })).toBeVisible();
  await expect(page.getByText(/fill what matters\./i)).toBeVisible();
  await attachRouteScreenshot(page, testInfo, "route-scan");

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: /photo-first item management/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /inventory built for finish-and-sell work/i })).toBeVisible();
  await attachRouteScreenshot(page, testInfo, "route-inventory");

  await page.goto("/sell");
  await expect(page.getByRole("heading", { name: /queue-based selling/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /desktop listing management/i })).toBeVisible();
  await attachRouteScreenshot(page, testInfo, "route-sell");

  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: /operational feed/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /suggested moves/i })).toBeVisible();
  await attachRouteScreenshot(page, testInfo, "route-activity");
});

test("desktop inventory detail exposes a continue-on-mobile handoff with the canonical item url", async ({ page, baseURL }) => {
  const title = `Desktop Handoff Item ${Date.now()}`;

  await onboardOperator(page, {
    workspaceName: "UI Handoff Workspace"
  });

  await createInventoryItem(page, title);
  await page.getByText("History and item tools", { exact: true }).click();
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

  await page.goto("/");
  await page.getByRole("tab", { name: /manual\/source lookup/i }).click();
  await page.getByTestId("scan-identify-barcode").fill("012345678905");
  await page.getByTestId("scan-identify-submit").click();
  const firstCandidate = page.getByTestId("scan-identify-candidate-0");
  await expect(firstCandidate).toBeVisible();
  await expect(firstCandidate.getByText(/amazon enriched/i)).toBeVisible();
  await page.getByTestId("scan-identify-accept-0").click();
  await expect(page.getByText(/^source reference$/i)).toBeVisible();
  await expect(page.getByText(/mollie used this source to prefill the fields below/i)).toBeVisible();
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
  await expect(page.getByRole("heading", { name: /ai-generated drafts awaiting approval/i })).toBeVisible();
});

test("operators can start a helper-assisted automation vendor sign-in from marketplaces", async ({ page }) => {
  await onboardOperator(page, {
    workspaceName: "UI Marketplaces Workspace"
  });

  await page.goto("/marketplaces");
  await expect(page.getByRole("heading", { name: /login required/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /open depop login/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^recheck login$/i }).first()).toBeVisible();
  await expect(page.getByText(/please log in to your depop account in another tab/i)).toBeVisible();
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

    const photoHeading = page.getByRole("heading", { name: /^photos$/i });
    const summaryHeading = page.getByRole("heading", { name: new RegExp(title, "i") });
    const listingHeading = page.getByRole("heading", { name: /choose marketplaces first, then fill one listing form/i });

    await expect(photoHeading).toBeVisible();
    await expect(summaryHeading).toBeVisible();
    await expect(listingHeading).toBeVisible();
    const photoCard = page.locator("section").filter({ has: page.getByRole("heading", { name: /^photos$/i }) }).first();
    const uploadForm = photoCard.locator("form.inventory-image-form");
    const startingImageCount = await page.locator(".detail-image-card").count();

    await page.setInputFiles('input[name="image"]', {
      name: "pilot-photo-1.png",
      mimeType: "image/png",
      buffer: tinyPng
    });
    const uploadResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === "POST" && /\/api\/inventory\/.+\/images\/upload$/.test(response.url());
    });
    await uploadForm.evaluate((node) => (node as HTMLFormElement).requestSubmit());
    const uploadResponse = await uploadResponsePromise;

    expect(uploadResponse.ok()).toBeTruthy();
    await expect(page.getByText(/^image uploaded$/i)).toBeVisible();
    await expect(page.locator(".detail-image-card")).toHaveCount(startingImageCount + 1);
    await page.reload();
    await expect(photoHeading).toBeVisible();
    await expect(page.locator(".detail-image-card")).toHaveCount(startingImageCount + 1);
  });
});
