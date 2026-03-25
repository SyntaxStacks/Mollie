import { expect, test } from "@playwright/test";

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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
  const email = uniqueEmail("ui-onboarding");

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

  const storedToken = await page.evaluate(() => window.localStorage.getItem("reselleros.token"));
  expect(storedToken).toBeTruthy();

  await page.getByLabel(/workspace name/i).fill("UI Test Workspace");
  await page.getByRole("button", { name: /create workspace/i }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /pilot dashboard/i })).toBeVisible();
  await expect(page.getByText("UI Test Workspace")).toBeVisible();

  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /pilot dashboard/i })).toBeVisible();
});
