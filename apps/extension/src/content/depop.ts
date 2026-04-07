(() => {
type DepopExecutionMode = "draft" | "publish";

type DepopExecutionResult =
  | {
      ok: true;
      result: {
        fieldsApplied: string[];
        missingFields: string[];
        tabUrl: string | null;
        externalUrl?: string | null;
        externalListingId?: string | null;
        publishedTitle?: string | null;
        publishedPrice?: number | null;
      };
    }
  | {
      ok: false;
      needsInput?: boolean;
      error?: string;
      result?: {
        fieldsApplied?: string[];
        missingFields?: string[];
        tabUrl?: string | null;
        externalUrl?: string | null;
        externalListingId?: string | null;
        publishedTitle?: string | null;
        publishedPrice?: number | null;
      };
    };

function findFormField<T extends Element>(selectors: string[]) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element as T;
    }
  }

  return null;
}

function textContent(node: Element | null | undefined) {
  return node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function isVisible(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.offsetParent !== null;
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLElement, value: string) {
  if ("value" in element) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
    return;
  }

  if (element.isContentEditable) {
    element.textContent = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function openAndSelectOption(triggerSelectors: string[], optionText: string) {
  const trigger = findFormField<HTMLElement>(triggerSelectors);

  if (!trigger) {
    return false;
  }

  trigger.click();
  await sleep(250);

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[role='option'], [role='menuitem'], [role='listbox'] [role='button'], [data-testid*='option'], li, button, div"
    )
  ).filter((candidate) => isVisible(candidate));
  const normalizedOptionText = optionText.trim().toLowerCase();
  const match =
    candidates.find((candidate) => textContent(candidate).toLowerCase() === normalizedOptionText) ??
    candidates.find((candidate) => textContent(candidate).toLowerCase().includes(normalizedOptionText));

  if (!match) {
    return false;
  }

  match.click();
  await sleep(150);
  return true;
}

function buildDepopDescription(listing: Record<string, unknown>) {
  const title = typeof listing.title === "string" ? listing.title.trim() : "";
  const description = typeof listing.description === "string" ? listing.description.trim() : "";

  if (!title) {
    return description;
  }

  if (!description) {
    return title;
  }

  return description.toLowerCase().startsWith(title.toLowerCase()) ? description : `${title}\n\n${description}`;
}

function normalizeSelectorValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveDepopOverride(listing: Record<string, unknown>) {
  const marketplaceOverrides =
    listing.marketplaceOverrides && typeof listing.marketplaceOverrides === "object"
      ? (listing.marketplaceOverrides as Record<string, unknown>)
      : null;

  return marketplaceOverrides?.DEPOP && typeof marketplaceOverrides.DEPOP === "object"
    ? (marketplaceOverrides.DEPOP as Record<string, unknown>)
    : null;
}

function resolveDepopOverrideAttributes(listing: Record<string, unknown>) {
  const depopOverride = resolveDepopOverride(listing);

  return depopOverride?.attributes && typeof depopOverride.attributes === "object"
    ? (depopOverride.attributes as Record<string, unknown>)
    : null;
}

function resolveMarketplaceValue(listing: Record<string, unknown>, field: string) {
  const depopOverride = resolveDepopOverride(listing);
  return depopOverride?.[field] ?? listing[field];
}

function resolveDepopAttribute(listing: Record<string, unknown>, field: string) {
  const depopOverrideAttributes = resolveDepopOverrideAttributes(listing);

  return depopOverrideAttributes?.[field] ?? null;
}

function mapDepopCondition(value: string) {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return "";
  }

  if (normalized.includes("brand new") || normalized === "new" || normalized.includes("new with")) {
    return "Brand new";
  }

  if (normalized.includes("like new")) {
    return "Like new";
  }

  if (normalized.includes("excellent")) {
    return "Used - Excellent";
  }

  if (normalized.includes("good")) {
    return "Used - Good";
  }

  if (normalized.includes("fair")) {
    return "Used - Fair";
  }

  return "Used - Good";
}

function mapDepopShippingMode(value: string) {
  const normalized = value.trim().toUpperCase();

  if (normalized === "OWN_SHIPPING") {
    return "My own shipping";
  }

  if (normalized === "DEPOP_SHIPPING") {
    return "Depop shipping";
  }

  return value;
}

function getPreferredBrand(listing: Record<string, unknown>) {
  const brandValue = normalizeSelectorValue(resolveMarketplaceValue(listing, "brand"));
  return brandValue || "unbranded";
}

function getSharedCondition(listing: Record<string, unknown>) {
  const overrideCondition = normalizeSelectorValue(resolveDepopAttribute(listing, "condition"));
  const listingCondition = normalizeSelectorValue(resolveMarketplaceValue(listing, "condition"));

  return mapDepopCondition(overrideCondition || listingCondition);
}

function findDropdownTriggerByText(labels: string[]) {
  const normalizedLabels = labels.map((label) => label.trim().toLowerCase());
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("button, [role='button'], [aria-haspopup='listbox'], [aria-haspopup='dialog']")
  ).filter((candidate) => isVisible(candidate));

  return (
    candidates.find((candidate) =>
      normalizedLabels.some((label) => {
        const text = `${textContent(candidate)} ${candidate.getAttribute("aria-label") ?? ""}`.toLowerCase();
        return text.includes(label);
      })
    ) ?? null
  );
}

async function openAndSelectOptionByTriggerText(labels: string[], optionText: string) {
  const trigger = findDropdownTriggerByText(labels);

  if (!trigger) {
    return false;
  }

  trigger.click();
  await sleep(250);
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[role='option'], [role='menuitem'], [role='listbox'] [role='button'], [data-testid*='option'], li, button, div"
    )
  ).filter((candidate) => isVisible(candidate));
  const normalizedOptionText = optionText.trim().toLowerCase();
  const match =
    candidates.find((candidate) => textContent(candidate).toLowerCase() === normalizedOptionText) ??
    candidates.find((candidate) => textContent(candidate).toLowerCase().includes(normalizedOptionText));

  if (!match) {
    return false;
  }

  match.click();
  await sleep(150);
  return true;
}

async function selectDepopOption(input: {
  triggerSelectors: string[];
  triggerLabels: string[];
  optionText: string;
}) {
  const optionText = input.optionText.trim();

  if (!optionText) {
    return false;
  }

  const selectedFromSelector =
    input.triggerSelectors.length > 0 ? await openAndSelectOption(input.triggerSelectors, optionText) : false;

  if (selectedFromSelector) {
    return true;
  }

  return openAndSelectOptionByTriggerText(input.triggerLabels, optionText);
}

function appendMissingField(target: string[], field: string) {
  if (!target.includes(field)) {
    target.push(field);
  }
}

function itemNeedsSizingLike(productType: string, listing: Record<string, unknown>) {
  const haystack = `${productType} ${normalizeSelectorValue(resolveMarketplaceValue(listing, "category"))} ${normalizeSelectorValue(resolveMarketplaceValue(listing, "title"))}`.toLowerCase();
  return ["jacket", "coat", "top", "shoe", "dress", "pants", "hoodie", "shirt", "sweater", "shorts", "skirt", "bag"].some((token) =>
    haystack.includes(token)
  );
}

function ensureCoreTextFields(input: {
  listing: Record<string, unknown>;
  titleField: HTMLInputElement | null;
  descriptionField: HTMLTextAreaElement | HTMLElement | null;
  priceField: HTMLInputElement | null;
  fieldsApplied: string[];
  missingFields: string[];
}) {
  const titleValue = normalizeSelectorValue(resolveMarketplaceValue(input.listing, "title"));
  const descriptionValue = buildDepopDescription(input.listing);
  const priceSource = resolveMarketplaceValue(input.listing, "price");
  const price =
    typeof priceSource === "number"
      ? priceSource
      : typeof priceSource === "string" && priceSource.trim()
        ? Number(priceSource)
        : null;

  if (titleValue && input.titleField) {
    setNativeValue(input.titleField, titleValue);
    input.fieldsApplied.push("title");
  } else if (!titleValue) {
    appendMissingField(input.missingFields, "title");
  }

  if (descriptionValue && input.descriptionField) {
    setNativeValue(input.descriptionField, descriptionValue);
    input.fieldsApplied.push("description");
  } else if (!descriptionValue) {
    appendMissingField(input.missingFields, "description");
  }

  if (price != null && Number.isFinite(price) && input.priceField) {
    setNativeValue(input.priceField, price.toFixed(2));
    input.fieldsApplied.push("price");
  } else if (price == null || !Number.isFinite(price)) {
    appendMissingField(input.missingFields, "price");
  }

  return {
    titleValue,
    price
  };
}

function resolveCreateFlowFieldNames(listing: Record<string, unknown>) {
  return {
    department: normalizeSelectorValue(resolveDepopAttribute(listing, "department")),
    productType: normalizeSelectorValue(resolveDepopAttribute(listing, "productType")),
    shippingMode: mapDepopShippingMode(normalizeSelectorValue(resolveDepopAttribute(listing, "shippingMode"))),
    condition: getSharedCondition(listing),
    size: normalizeSelectorValue(resolveMarketplaceValue(listing, "size")),
    brand: getPreferredBrand(listing)
  };
}

function resolveDepopMissingFields(listing: Record<string, unknown>, fields: ReturnType<typeof resolveCreateFlowFieldNames>) {
  const missingFields: string[] = [];

  if (!fields.department) {
    appendMissingField(missingFields, "department");
  }

  if (!fields.productType) {
    appendMissingField(missingFields, "product type");
  }

  if (!fields.shippingMode) {
    appendMissingField(missingFields, "shipping");
  }

  if (!fields.condition) {
    appendMissingField(missingFields, "condition");
  }

  if (itemNeedsSizingLike(fields.productType, listing) && !fields.size) {
    appendMissingField(missingFields, "size");
  }

  return missingFields;
}

function fileNameFromUrl(url: string, index: number) {
  try {
    const { pathname } = new URL(url);
    const lastSegment = pathname.split("/").at(-1)?.trim();
    return lastSegment && lastSegment.includes(".") ? lastSegment : `mollie-photo-${index + 1}.jpg`;
  } catch {
    return `mollie-photo-${index + 1}.jpg`;
  }
}

async function fetchPhotoAsFile(url: string, index: number) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Could not fetch photo ${index + 1}.`);
  }

  const blob = await response.blob();
  return new File([blob], fileNameFromUrl(url, index), {
    type: blob.type || "image/jpeg"
  });
}

async function uploadListingPhotos(listing: Record<string, unknown>) {
  const photos = Array.isArray(listing.photos)
    ? listing.photos.filter(
        (photo): photo is { url: string } =>
          typeof photo === "object" && photo !== null && typeof (photo as { url?: unknown }).url === "string"
      )
    : [];

  if (photos.length === 0) {
    return {
      uploaded: true,
      reason: null as string | null
    };
  }

  const input = findFormField<HTMLInputElement>([
    "input[type='file'][accept*='image']",
    "input[type='file'][multiple]",
    "input[type='file']"
  ]);

  if (!input) {
    return {
      uploaded: false,
      reason: "Depop did not expose a stable image uploader on this page."
    };
  }

  try {
    const files = await Promise.all(photos.map((photo, index) => fetchPhotoAsFile(photo.url, index)));
    const transfer = new DataTransfer();

    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(1_500);

    return {
      uploaded: true,
      reason: null as string | null
    };
  } catch (error) {
    return {
      uploaded: false,
      reason: error instanceof Error ? error.message : "Could not upload listing photos to Depop."
    };
  }
}

function findPublishButton() {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], a")).filter((candidate) =>
    isVisible(candidate)
  );
  const labels = ["list item", "publish", "post listing", "sell now"];

  return (
    candidates.find((candidate) => labels.includes(textContent(candidate).toLowerCase())) ??
    candidates.find((candidate) => labels.some((label) => textContent(candidate).toLowerCase().includes(label)))
  );
}

async function waitForPublishConfirmation() {
  const startedAt = Date.now();
  const timeoutMs = 12_000;

  while (Date.now() - startedAt < timeoutMs) {
    const path = window.location.pathname;
    const href = window.location.href;
    const successCopy = Array.from(document.querySelectorAll<HTMLElement>("h1, h2, [role='alert'], div, span")).some((candidate) => {
      const normalized = textContent(candidate).toLowerCase();
      return isVisible(candidate) && /listed|published|live/i.test(normalized);
    });

    if (/\/products\/(?!create\b|drafts\b|edit\b)/i.test(path) || successCopy) {
      const externalListingId = path.split("/").filter(Boolean).at(-1) ?? null;
      return {
        published: true,
        externalUrl: href,
        externalListingId
      };
    }

    await sleep(400);
  }

  return {
    published: false,
    externalUrl: window.location.href,
    externalListingId: null
  };
}

async function applyDepopListing(payload: { listing?: Record<string, unknown> | null }, mode: DepopExecutionMode): Promise<DepopExecutionResult> {
  const listing = payload.listing ?? {};
  const fieldsApplied: string[] = [];
  const missingFields: string[] = [];
  const depopFields = resolveCreateFlowFieldNames(listing);
  const gatingMissingFields = resolveDepopMissingFields(listing, depopFields);

  const createFlowDetected =
    /\/sell\b|\/products\/create\b|\/drafts\b|\/edit\b/i.test(window.location.pathname) ||
    Boolean(
      findFormField([
        "input[name*='title']",
        "input[placeholder*='Title']",
        "input[aria-label*='Title']",
        "textarea[name*='description']",
        "textarea[placeholder*='describe']",
        "input[name*='price']",
        "input[inputmode='decimal']",
        "button[aria-label*='Category']",
        "button[aria-haspopup='listbox']"
      ])
    );

  if (!createFlowDetected) {
    return {
      ok: false,
      error: "This Depop tab is not a compatible listing or draft page.",
      result: {
        fieldsApplied,
        missingFields,
        tabUrl: window.location.href
      }
    };
  }

  const titleField = findFormField<HTMLInputElement>([
    "input[name*='title']",
    "input[id*='title']",
    "input[placeholder*='Title']",
    "input[aria-label*='Title']",
    "input[data-testid*='title']"
  ]);
  const descriptionField =
    findFormField<HTMLTextAreaElement>([
      "textarea[name*='description']",
      "textarea[placeholder*='Describe']",
      "textarea[aria-label*='description']"
    ]) ??
    findFormField<HTMLElement>([
      "[contenteditable='true'][aria-label*='description']",
      "[contenteditable='true'][role='textbox']"
    ]);
  const priceField = findFormField<HTMLInputElement>([
    "input[name*='price']",
    "input[aria-label*='Price']",
    "input[inputmode='decimal']"
  ]);
  const { titleValue, price } = ensureCoreTextFields({
    listing,
    titleField,
    descriptionField,
    priceField,
    fieldsApplied,
    missingFields
  });

  const brandApplied = await selectDepopOption({
    triggerSelectors: [
      "button[aria-label*='Brand']",
      "[data-testid*='brand'] button",
      "[aria-labelledby*='brand']",
      "button[name*='brand']"
    ],
    triggerLabels: ["brand"],
    optionText: depopFields.brand
  });
  if (brandApplied) {
    fieldsApplied.push("brand");
  }

  const departmentApplied = depopFields.department
    ? await selectDepopOption({
        triggerSelectors: [
          "button[aria-label*='Department']",
          "[data-testid*='department'] button",
          "[aria-labelledby*='department']",
          "button[name*='department']"
        ],
        triggerLabels: ["department"],
        optionText: depopFields.department
      })
    : false;
  if (departmentApplied) {
    fieldsApplied.push("department");
  }

  const productTypeApplied = depopFields.productType
    ? await selectDepopOption({
        triggerSelectors: [
          "button[aria-label*='Product type']",
          "button[aria-label*='Category']",
          "[data-testid*='product-type'] button",
          "[data-testid*='category'] button",
          "[aria-labelledby*='product']",
          "[aria-labelledby*='category']",
          "button[name*='product']",
          "button[name*='category']"
        ],
        triggerLabels: ["product type", "category"],
        optionText: depopFields.productType
      })
    : false;
  if (productTypeApplied) {
    fieldsApplied.push("product type");
  }

  const conditionApplied = depopFields.condition
    ? await selectDepopOption({
        triggerSelectors: [
          "button[aria-label*='Condition']",
          "[data-testid*='condition'] button",
          "[aria-labelledby*='condition']",
          "button[name*='condition']"
        ],
        triggerLabels: ["condition"],
        optionText: depopFields.condition
      })
    : false;
  if (conditionApplied) {
    fieldsApplied.push("condition");
  }

  const sizeApplied = depopFields.size
    ? await selectDepopOption({
        triggerSelectors: [
          "button[aria-label*='Size']",
          "[data-testid*='size'] button",
          "[aria-labelledby*='size']",
          "button[name*='size']"
        ],
        triggerLabels: ["size"],
        optionText: depopFields.size
      })
    : false;
  if (sizeApplied) {
    fieldsApplied.push("size");
  }

  const shippingApplied = depopFields.shippingMode
    ? await selectDepopOption({
        triggerSelectors: [
          "button[aria-label*='Shipping']",
          "button[aria-label*='Delivery']",
          "[data-testid*='shipping'] button",
          "[aria-labelledby*='shipping']",
          "button[name*='shipping']"
        ],
        triggerLabels: ["shipping", "delivery"],
        optionText: depopFields.shippingMode
      })
    : false;
  if (shippingApplied) {
    fieldsApplied.push("shipping");
  }

  const photoUpload = await uploadListingPhotos(listing);

  if (photoUpload.uploaded) {
    if (Array.isArray(listing.photos) && listing.photos.length > 0) {
      fieldsApplied.push("photos");
    }
  } else {
    appendMissingField(missingFields, "photos");
  }

  if (gatingMissingFields.includes("department") && !departmentApplied) {
    appendMissingField(missingFields, "department");
  }

  if (gatingMissingFields.includes("product type") && !productTypeApplied) {
    appendMissingField(missingFields, "product type");
  }

  if (gatingMissingFields.includes("shipping") && !shippingApplied) {
    appendMissingField(missingFields, "shipping");
  }

  if (gatingMissingFields.includes("condition") && !conditionApplied) {
    appendMissingField(missingFields, "condition");
  }

  if (gatingMissingFields.includes("size") && !sizeApplied) {
    appendMissingField(missingFields, "size");
  }

  if (fieldsApplied.length === 0) {
    return {
      ok: false,
      error: "Depop loaded, but Mollie could not find stable listing fields to fill on this page variant.",
      result: {
        fieldsApplied,
        missingFields,
        tabUrl: window.location.href
      }
    };
  }

  if (mode === "draft") {
    if (missingFields.length > 0) {
      return {
        ok: false,
        needsInput: true,
        error: photoUpload.reason ?? "Depop needs a few more listing fields finished in the browser tab.",
        result: {
          fieldsApplied,
          missingFields,
          tabUrl: window.location.href
        }
      };
    }

    return {
      ok: true,
      result: {
        fieldsApplied,
        missingFields,
        tabUrl: window.location.href
      }
    };
  }

  if (missingFields.length > 0) {
    return {
      ok: false,
      needsInput: true,
      error: photoUpload.reason ?? "Depop still needs a few required fields before publish.",
      result: {
        fieldsApplied,
        missingFields,
        tabUrl: window.location.href
      }
    };
  }

  const publishButton = findPublishButton();

  if (!publishButton) {
    return {
      ok: false,
      needsInput: true,
      error: "Depop is ready, but Mollie could not find a stable publish button on this page variant.",
      result: {
        fieldsApplied,
        missingFields,
        tabUrl: window.location.href
      }
    };
  }

  publishButton.click();
  await sleep(600);

  const confirmation = await waitForPublishConfirmation();

  if (!confirmation.published) {
    return {
      ok: false,
      needsInput: true,
      error: "Depop opened the final publish step, but Mollie could not confirm that the listing went live.",
      result: {
        fieldsApplied,
        missingFields,
        tabUrl: confirmation.externalUrl ?? window.location.href,
        externalUrl: confirmation.externalUrl
      }
    };
  }

  return {
    ok: true,
    result: {
      fieldsApplied,
      missingFields,
      tabUrl: confirmation.externalUrl ?? window.location.href,
      externalUrl: confirmation.externalUrl,
      externalListingId: confirmation.externalListingId,
      publishedTitle: titleValue || null,
      publishedPrice: price
    }
  };
}

chrome.runtime.onMessage.addListener((message: Record<string, unknown>, _sender: unknown, sendResponse: (response?: unknown) => void) => {
  if (message.type !== "MOLLIE_EXTENSION_APPLY_DEPOP_DRAFT" && message.type !== "MOLLIE_EXTENSION_PUBLISH_DEPOP_LISTING") {
    return false;
  }

  void (async () => {
    const mode: DepopExecutionMode = message.type === "MOLLIE_EXTENSION_PUBLISH_DEPOP_LISTING" ? "publish" : "draft";
    sendResponse(await applyDepopListing((message.payload ?? {}) as { listing?: Record<string, unknown> | null }, mode));
  })();

  return true;
});
})();
