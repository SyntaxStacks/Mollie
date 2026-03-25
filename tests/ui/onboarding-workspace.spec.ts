import { expect, test, type Page } from "@playwright/test";

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

test("logged-out operators can access the onboarding form without a redirect trap", async ({ page }) => {
  await page.goto("/onboarding");

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: /create your operator session/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /send login code/i })).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
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

test("operators can create inventory, reorder photos, and delete a bad upload from the browser", async ({ page }) => {
  const title = `UI Upload Item ${Date.now()}`;

  await onboardOperator(page, {
    workspaceName: "UI Upload Workspace"
  });

  await page.goto("/inventory");
  await page.getByLabel(/^title$/i).fill(title);
  await page.getByRole("button", { name: /create item/i }).click();

  const itemLink = page.getByRole("link", { name: title });
  await expect(itemLink).toBeVisible();
  await itemLink.click();

  await expect(page).toHaveURL(/\/inventory\/.+/);
  await page.setInputFiles('input[name="image"]', {
    name: "pilot-photo-1.png",
    mimeType: "image/png",
    buffer: tinyPng
  });
  await page.locator('button[type="submit"]').filter({ hasText: /^Upload image$/i }).click();

  await expect(page.getByText(/image uploaded/i)).toBeVisible();
  await expect(page.locator(".image-upload-row")).toHaveCount(1);

  await page.setInputFiles('input[name="image"]', {
    name: "pilot-photo-2.png",
    mimeType: "image/png",
    buffer: tinyPng
  });
  await page.locator('button[type="submit"]').filter({ hasText: /^Upload image$/i }).click();

  await expect(page.locator(".image-upload-row")).toHaveCount(2);
  const secondImageId = await page.locator(".image-upload-row").nth(1).getAttribute("data-image-id");
  expect(secondImageId).toBeTruthy();
  await page.locator(".image-upload-row").nth(1).getByRole("button", { name: /move up/i }).click();

  await expect(page.getByText(/image moved up/i)).toBeVisible();
  await expect(page.locator(".image-upload-row").first()).toHaveAttribute("data-image-id", secondImageId ?? "");

  await page.locator(".image-upload-row").nth(1).getByRole("button", { name: /delete image/i }).click();

  await expect(page.getByText(/image deleted/i)).toBeVisible();
  await expect(page.locator(".image-upload-row")).toHaveCount(1);
  await expect(page.getByText(/\/api\/uploads\/workspaces\//i)).toBeVisible();
});
