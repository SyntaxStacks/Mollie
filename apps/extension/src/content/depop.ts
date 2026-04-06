(() => {
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

function resolveMarketplaceValue(listing: Record<string, unknown>, field: string) {
  const marketplaceOverrides =
    listing.marketplaceOverrides && typeof listing.marketplaceOverrides === "object"
      ? (listing.marketplaceOverrides as Record<string, unknown>)
      : null;
  const depopOverride =
    marketplaceOverrides?.DEPOP && typeof marketplaceOverrides.DEPOP === "object"
      ? (marketplaceOverrides.DEPOP as Record<string, unknown>)
      : null;

  return depopOverride?.[field] ?? listing[field];
}

async function applyDepopDraft(payload: { listing?: Record<string, unknown> | null }) {
  const listing = payload.listing ?? {};
  const fieldsApplied: string[] = [];
  const missingFields: string[] = [];

  const titleValue = normalizeSelectorValue(resolveMarketplaceValue(listing, "title"));
  const priceSource = resolveMarketplaceValue(listing, "price");
  const descriptionValue = buildDepopDescription(listing);
  const brandValue = normalizeSelectorValue(resolveMarketplaceValue(listing, "brand"));
  const categoryValue = normalizeSelectorValue(resolveMarketplaceValue(listing, "category"));
  const conditionValue = normalizeSelectorValue(resolveMarketplaceValue(listing, "condition"));
  const sizeValue = normalizeSelectorValue(resolveMarketplaceValue(listing, "size"));
  const price =
    typeof priceSource === "number"
      ? priceSource
      : typeof priceSource === "string" && priceSource.trim()
        ? Number(priceSource)
        : null;

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

  if (titleValue && titleField) {
    setNativeValue(titleField, titleValue);
    fieldsApplied.push("title");
  } else {
    missingFields.push("title");
  }

  if (descriptionValue && descriptionField) {
    setNativeValue(descriptionField, descriptionValue);
    fieldsApplied.push("description");
  } else {
    missingFields.push("description");
  }

  if (price != null && Number.isFinite(price) && priceField) {
    setNativeValue(priceField, price.toFixed(2));
    fieldsApplied.push("price");
  } else {
    missingFields.push("price");
  }

  if (brandValue) {
    const brandApplied = await openAndSelectOption(
      [
        "button[aria-label*='Brand']",
        "[data-testid*='brand'] button",
        "[aria-labelledby*='brand']",
        "button[name*='brand']"
      ],
      brandValue
    );

    if (brandApplied) {
      fieldsApplied.push("brand");
    } else {
      missingFields.push("brand");
    }
  }

  if (categoryValue) {
    const categoryApplied = await openAndSelectOption(
      [
        "button[aria-label*='Category']",
        "[data-testid*='category'] button",
        "[aria-labelledby*='category']",
        "button[name*='category']"
      ],
      categoryValue
    );

    if (categoryApplied) {
      fieldsApplied.push("category");
    } else {
      missingFields.push("category");
    }
  }

  if (conditionValue) {
    const conditionApplied = await openAndSelectOption(
      [
        "button[aria-label*='Condition']",
        "[data-testid*='condition'] button",
        "[aria-labelledby*='condition']",
        "button[name*='condition']"
      ],
      conditionValue
    );

    if (conditionApplied) {
      fieldsApplied.push("condition");
    } else {
      missingFields.push("condition");
    }
  }

  if (sizeValue) {
    const sizeApplied = await openAndSelectOption(
      [
        "button[aria-label*='Size']",
        "[data-testid*='size'] button",
        "[aria-labelledby*='size']",
        "button[name*='size']"
      ],
      sizeValue
    );

    if (sizeApplied) {
      fieldsApplied.push("size");
    } else {
      missingFields.push("size");
    }
  }

  if (Array.isArray(listing.photos) && listing.photos.length > 0) {
    missingFields.push("photos");
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

  if (missingFields.length > 0) {
    return {
      ok: false,
      needsInput: true,
      error: "Depop needs a few more listing fields finished in the browser tab.",
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

chrome.runtime.onMessage.addListener((message: Record<string, unknown>, _sender: unknown, sendResponse: (response?: unknown) => void) => {
  if (message.type !== "MOLLIE_EXTENSION_APPLY_DEPOP_DRAFT") {
    return false;
  }

  void (async () => {
    sendResponse(await applyDepopDraft((message.payload ?? {}) as { listing?: Record<string, unknown> | null }));
  })();

  return true;
});
})();
