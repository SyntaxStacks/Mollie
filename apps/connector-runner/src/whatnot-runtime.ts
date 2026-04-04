import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { ConnectorError, type PublishListingInput } from "@reselleros/marketplaces";
import type { MarketplaceSessionArtifact, PublishResult } from "@reselleros/types";

type WhatnotRuntimeDependencies = {
  chromium: Pick<typeof chromium, "launch">;
  fetch: typeof fetch;
};

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function resolveArtifactRoot() {
  return path.resolve(process.cwd(), process.env.ARTIFACT_BASE_DIR ?? "tmp/artifacts");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isWhatnotBrowserRuntimeEnabled(source: NodeJS.ProcessEnv = process.env) {
  return source.WHATNOT_BROWSER_PUBLISH_ENABLED === "true";
}

export function extractWhatnotSessionArtifact(input: PublishListingInput["marketplaceAccount"]): MarketplaceSessionArtifact | null {
  const credentialPayload = isRecord(input.credentialPayload) ? input.credentialPayload : null;
  const credentialMetadata = isRecord(input.credentialMetadata) ? input.credentialMetadata : null;
  const helperArtifact =
    (isRecord(credentialPayload?.helperSessionArtifact) ? credentialPayload?.helperSessionArtifact : null) ??
    (isRecord(credentialMetadata?.vendorSessionArtifact) ? credentialMetadata?.vendorSessionArtifact : null) ??
    (isRecord(credentialMetadata?.helperSessionArtifact) ? credentialMetadata?.helperSessionArtifact : null);

  if (!helperArtifact) {
    return null;
  }

  const storageStateJson = isRecord(helperArtifact.storageStateJson) ? helperArtifact.storageStateJson : null;
  const accountHandle =
    typeof helperArtifact.accountHandle === "string" && helperArtifact.accountHandle.trim().length > 0
      ? helperArtifact.accountHandle.trim()
      : input.displayName;
  const connectAttemptId =
    typeof helperArtifact.connectAttemptId === "string" && helperArtifact.connectAttemptId.trim().length > 0
      ? helperArtifact.connectAttemptId.trim()
      : "unknown-connect-attempt";

  return {
    platform: "WHATNOT",
    captureMode:
      helperArtifact.captureMode === "LOCAL_BRIDGE" || helperArtifact.captureMode === "WEB_POPUP_HELPER"
        ? helperArtifact.captureMode
        : "WEB_POPUP_HELPER",
    capturedAt:
      typeof helperArtifact.capturedAt === "string" && helperArtifact.capturedAt.trim().length > 0
        ? helperArtifact.capturedAt
        : new Date(0).toISOString(),
    validatedAt:
      typeof helperArtifact.validatedAt === "string" && helperArtifact.validatedAt.trim().length > 0
        ? helperArtifact.validatedAt
        : null,
    accountHandle,
    externalAccountId:
      typeof helperArtifact.externalAccountId === "string" && helperArtifact.externalAccountId.trim().length > 0
        ? helperArtifact.externalAccountId.trim()
        : input.externalAccountId ?? null,
    sessionLabel:
      typeof helperArtifact.sessionLabel === "string" && helperArtifact.sessionLabel.trim().length > 0
        ? helperArtifact.sessionLabel.trim()
        : null,
    connectAttemptId,
    cookieCount: typeof helperArtifact.cookieCount === "number" ? helperArtifact.cookieCount : null,
    origin: typeof helperArtifact.origin === "string" ? helperArtifact.origin : null,
    storageStateJson
  };
}

function getStorageOrigins(storageStateJson: Record<string, unknown> | null | undefined) {
  const origins = Array.isArray(storageStateJson?.origins) ? storageStateJson.origins : [];

  return origins
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      return typeof (entry as { origin?: unknown }).origin === "string"
        ? ((entry as { origin: string }).origin)
        : null;
    })
    .filter((value): value is string => Boolean(value));
}

function hasWhatnotOrigin(storageStateJson: Record<string, unknown> | null | undefined) {
  return getStorageOrigins(storageStateJson).some((origin) => origin.toLowerCase().includes("whatnot.com"));
}

async function prepareRuntimeDirectory(input: { inventoryItemId: string; marketplaceAccountId: string }) {
  const folder = path.join(
    resolveArtifactRoot(),
    "whatnot-runtime",
    sanitizeSegment(input.marketplaceAccountId),
    sanitizeSegment(input.inventoryItemId),
    Date.now().toString()
  );

  await mkdir(folder, { recursive: true });
  return folder;
}

async function writeRuntimeNote(folder: string, name: string, contents: Record<string, unknown>) {
  const filePath = path.join(folder, `${sanitizeSegment(name)}.json`);
  await writeFile(filePath, JSON.stringify(contents, null, 2), "utf8");
  return filePath;
}

function getFileExtension(url: string, contentType: string | null) {
  if (contentType?.includes("png")) {
    return ".png";
  }

  if (contentType?.includes("webp")) {
    return ".webp";
  }

  if (contentType?.includes("gif")) {
    return ".gif";
  }

  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) {
    return ".jpg";
  }

  try {
    const pathname = new URL(url).pathname;
    const extension = path.extname(pathname);
    return extension || ".jpg";
  } catch {
    return ".jpg";
  }
}

async function downloadListingImages(input: {
  imageUrls: string[];
  folder: string;
  fetchImpl: typeof fetch;
}) {
  const paths: string[] = [];

  for (const [index, imageUrl] of input.imageUrls.entries()) {
    const response = await input.fetchImpl(imageUrl);

    if (!response.ok) {
      throw new ConnectorError({
        code: "PREREQUISITE_MISSING",
        message: `Whatnot publish could not fetch listing image ${index + 1}.`,
        retryable: false,
        metadata: {
          imageUrl,
          status: response.status
        }
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const extension = getFileExtension(imageUrl, response.headers.get("content-type"));
    const filePath = path.join(input.folder, `image-${String(index + 1).padStart(2, "0")}${extension}`);
    await writeFile(filePath, buffer);
    paths.push(filePath);
  }

  return paths;
}

async function locatorExists(locator: {
  count?: () => Promise<number>;
  isVisible?: () => Promise<boolean>;
}) {
  if (typeof locator.count === "function") {
    return (await locator.count()) > 0;
  }

  if (typeof locator.isVisible === "function") {
    return locator.isVisible();
  }

  return false;
}

async function fillFirstAvailableField(
  locators: Array<{
    count?: () => Promise<number>;
    first?: () => { fill: (value: string) => Promise<void> };
    fill?: (value: string) => Promise<void>;
  }>,
  value: string | null | undefined
) {
  if (!value?.trim()) {
    return false;
  }

  for (const locator of locators) {
    if (!(await locatorExists(locator))) {
      continue;
    }

    if (typeof locator.first === "function") {
      await locator.first().fill(value);
      return true;
    }

    if (typeof locator.fill === "function") {
      await locator.fill(value);
      return true;
    }
  }

  return false;
}

async function clickFirstAvailable(
  locators: Array<{
    count?: () => Promise<number>;
    first?: () => { click: () => Promise<void> };
    click?: () => Promise<void>;
  }>
) {
  for (const locator of locators) {
    if (!(await locatorExists(locator))) {
      continue;
    }

    if (typeof locator.first === "function") {
      await locator.first().click();
      return true;
    }

    if (typeof locator.click === "function") {
      await locator.click();
      return true;
    }
  }

  return false;
}

async function looksLikeWhatnotComposer(page: {
  locator: (selector: string) => { count: () => Promise<number> };
  getByLabel: (text: RegExp) => { count: () => Promise<number> };
}) {
  const checks = await Promise.all([
    page.locator('input[type="file"]').count(),
    page.getByLabel(/title/i).count(),
    page.getByLabel(/price/i).count()
  ]);

  return checks.some((count) => count > 0);
}

async function openWhatnotListingComposer(page: any) {
  const sellerHubUrl = process.env.WHATNOT_SELLER_HUB_URL ?? "https://seller.whatnot.com/";
  const directComposerUrls = [process.env.WHATNOT_LIST_ITEM_URL, sellerHubUrl].filter(
    (value): value is string => Boolean(value && value.trim())
  );

  for (const url of directComposerUrls) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);

    if (page.url().toLowerCase().includes("login")) {
      throw new ConnectorError({
        code: "ACCOUNT_UNAVAILABLE",
        message: "Whatnot redirected the saved browser session back to login.",
        retryable: false,
        metadata: {
          currentUrl: page.url()
        }
      });
    }

    if (await looksLikeWhatnotComposer(page)) {
      return url;
    }
  }

  await clickFirstAvailable([
    page.getByRole("button", { name: /list an item/i }),
    page.getByRole("link", { name: /list an item/i }),
    page.getByText(/list an item/i)
  ]);

  await page.waitForTimeout(1500);

  if (await looksLikeWhatnotComposer(page)) {
    return page.url();
  }

  throw new ConnectorError({
    code: "AUTOMATION_FAILED",
    message: "Whatnot seller hub opened, but Mollie could not reach the listing composer.",
    retryable: true,
    metadata: {
      currentUrl: page.url()
    }
  });
}

async function publishWhatnotWithBrowser(input: {
  publishInput: PublishListingInput;
  sessionArtifact: MarketplaceSessionArtifact;
  dependencies: WhatnotRuntimeDependencies;
}) {
  if (!input.publishInput.images.length) {
    throw new ConnectorError({
      code: "PREREQUISITE_MISSING",
      message: "Whatnot publish requires at least one image",
      retryable: false,
      metadata: {
        inventoryItemId: input.publishInput.inventoryItemId
      }
    });
  }

  if (!input.sessionArtifact.storageStateJson || !hasWhatnotOrigin(input.sessionArtifact.storageStateJson)) {
    throw new ConnectorError({
      code: "ACCOUNT_UNAVAILABLE",
      message: "Whatnot publish needs a helper-captured browser session artifact with a signed-in Whatnot origin.",
      retryable: false,
      metadata: {
        marketplaceAccountId: input.publishInput.marketplaceAccount.id
      }
    });
  }

  const runtimeFolder = await prepareRuntimeDirectory({
    inventoryItemId: input.publishInput.inventoryItemId,
    marketplaceAccountId: input.publishInput.marketplaceAccount.id
  });
  const imagePaths = await downloadListingImages({
    imageUrls: input.publishInput.images,
    folder: runtimeFolder,
    fetchImpl: input.dependencies.fetch
  });
  const runtimeArtifacts = [
    await writeRuntimeNote(path.join(runtimeFolder), "whatnot-session-summary", {
      inventoryItemId: input.publishInput.inventoryItemId,
      accountHandle: input.sessionArtifact.accountHandle,
      connectAttemptId: input.sessionArtifact.connectAttemptId,
      capturedAt: input.sessionArtifact.capturedAt,
      imageCount: imagePaths.length
    })
  ];

  const browser = await input.dependencies.chromium.launch({
    headless: process.env.WHATNOT_BROWSER_HEADLESS !== "false"
  });

  try {
    const context = await browser.newContext({
      storageState: input.sessionArtifact.storageStateJson as any
    });
    const page = await context.newPage();

    const sellerHubEntry = await openWhatnotListingComposer(page);
    const initialScreenshot = path.join(runtimeFolder, "whatnot-seller-hub.png");
    await page.screenshot({ path: initialScreenshot, fullPage: true });
    runtimeArtifacts.push(initialScreenshot);

    const fileInput = page.locator('input[type="file"]');
    if ((await fileInput.count()) === 0) {
      throw new ConnectorError({
        code: "AUTOMATION_FAILED",
        message: "Whatnot listing composer did not expose an image upload input.",
        retryable: true,
        metadata: {
          currentUrl: page.url(),
          runtimeArtifacts
        }
      });
    }
    await fileInput.setInputFiles(imagePaths);

    await fillFirstAvailableField(
      [
        page.getByLabel(/title/i),
        page.locator('input[name*="title"]'),
        page.locator('textarea[name*="title"]')
      ] as never,
      input.publishInput.title
    );

    await fillFirstAvailableField(
      [
        page.getByLabel(/description/i),
        page.locator('textarea[name*="description"]')
      ] as never,
      input.publishInput.description
    );

    await fillFirstAvailableField(
      [
        page.getByLabel(/price/i),
        page.getByLabel(/buy it now/i),
        page.locator('input[name*="price"]')
      ] as never,
      input.publishInput.price.toFixed(2)
    );

    await fillFirstAvailableField(
      [
        page.getByLabel(/quantity/i),
        page.locator('input[name*="quantity"]')
      ] as never,
      String(Math.max(1, input.publishInput.quantity))
    );

    await fillFirstAvailableField(
      [
        page.getByLabel(/brand/i),
        page.locator('input[name*="brand"]')
      ] as never,
      input.publishInput.brand ?? null
    );

    const populatedScreenshot = path.join(runtimeFolder, "whatnot-listing-populated.png");
    await page.screenshot({ path: populatedScreenshot, fullPage: true });
    runtimeArtifacts.push(populatedScreenshot);

    const publishClicked = await clickFirstAvailable([
      page.getByRole("button", { name: /publish/i }),
      page.getByRole("button", { name: /create listing/i }),
      page.getByRole("button", { name: /list item/i }),
      page.getByRole("button", { name: /save/i }),
      page.getByText(/publish/i),
      page.getByText(/create listing/i)
    ]);

    if (!publishClicked) {
      throw new ConnectorError({
        code: "AUTOMATION_FAILED",
        message: "Whatnot seller hub opened the listing form, but Mollie could not find a publish action.",
        retryable: true,
        metadata: {
          currentUrl: page.url(),
          runtimeArtifacts
        }
      });
    }

    await page.waitForTimeout(4000);
    const resultScreenshot = path.join(runtimeFolder, "whatnot-post-publish.png");
    await page.screenshot({ path: resultScreenshot, fullPage: true });
    runtimeArtifacts.push(resultScreenshot);

    const currentUrl = page.url();
    if (currentUrl.toLowerCase().includes("login")) {
      throw new ConnectorError({
        code: "ACCOUNT_UNAVAILABLE",
        message: "Whatnot sign-in expired during publish.",
        retryable: false,
        metadata: {
          currentUrl,
          runtimeArtifacts
        }
      });
    }

    const externalListingId = currentUrl.split("/").filter(Boolean).at(-1) ?? `whatnot_${crypto.randomUUID().slice(0, 12)}`;

    return {
      externalListingId,
      externalUrl: currentUrl.startsWith("http") ? currentUrl : sellerHubEntry,
      title: input.publishInput.title,
      price: input.publishInput.price,
      rawResponse: {
        mode: "browser-session",
        platform: "WHATNOT",
        sellerHubEntry,
        accountHandle: input.sessionArtifact.accountHandle,
        currentUrl,
        imageCount: imagePaths.length
      },
      artifactUrls: runtimeArtifacts,
      marketplaceAccountUpdate: {
        validationStatus: "VALID",
        lastValidatedAt: new Date().toISOString(),
        credentialMetadata: {
          ...(isRecord(input.publishInput.marketplaceAccount.credentialMetadata)
            ? input.publishInput.marketplaceAccount.credentialMetadata
            : {}),
          publishMode: "browser-session",
          lastSessionCheckAt: new Date().toISOString()
        }
      }
    } satisfies PublishResult;
  } catch (error) {
    if (error instanceof ConnectorError) {
      error.metadata = {
        ...(error.metadata ?? {}),
        runtimeArtifacts
      };
    }

    throw error;
  } finally {
    await browser.close();
  }
}

export async function publishWhatnotListing(
  input: PublishListingInput,
  dependencies: WhatnotRuntimeDependencies = {
    chromium,
    fetch
  }
) {
  const sessionArtifact = extractWhatnotSessionArtifact(input.marketplaceAccount);

  if (!isWhatnotBrowserRuntimeEnabled() || !sessionArtifact) {
    return null;
  }

  return publishWhatnotWithBrowser({
    publishInput: input,
    sessionArtifact,
    dependencies
  });
}
