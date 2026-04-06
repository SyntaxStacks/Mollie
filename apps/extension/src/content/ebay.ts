(() => {
function textContent(selectors: string[]) {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.textContent?.trim();

    if (value) {
      return value.replace(/\s+/g, " ").trim();
    }
  }

  return null;
}

function metaContent(property: string) {
  const selectors = [
    `meta[property="${property}"]`,
    `meta[name="${property}"]`
  ];

  for (const selector of selectors) {
    const value = document.querySelector(selector)?.getAttribute("content")?.trim();

    if (value) {
      return value;
    }
  }

  return null;
}

function parsePrice(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : null;
}

function cleanImageUrl(url: string) {
  return url.replace(/s-l\d+\.(jpg|png|webp)/i, "s-l1600.$1");
}

function collectPhotos() {
  const candidates = new Set<string>();

  const ogImage = metaContent("og:image");
  if (ogImage) {
    candidates.add(cleanImageUrl(ogImage));
  }

  document.querySelectorAll("img").forEach((image) => {
    const source = image.getAttribute("src") ?? image.getAttribute("data-zoom-src") ?? image.getAttribute("data-src");

    if (!source || !/^https?:\/\//i.test(source)) {
      return;
    }

    if (!source.includes("i.ebayimg.com")) {
      return;
    }

    candidates.add(cleanImageUrl(source));
  });

  return [...candidates].slice(0, 18).map((url, index) => ({
    url,
    kind: index === 0 ? "PRIMARY" as const : "GALLERY" as const
  }));
}

function extractItemSpecifics() {
  const attributes: Record<string, unknown> = {};

  document.querySelectorAll("dl, table").forEach((container) => {
    const labels = container.querySelectorAll("dt, th");

    labels.forEach((labelNode) => {
      const label = labelNode.textContent?.trim().replace(/:$/, "");

      if (!label) {
        return;
      }

      let value = "";
      const sibling = labelNode.nextElementSibling;

      if (sibling) {
        value = sibling.textContent?.trim() ?? "";
      } else {
        const row = labelNode.closest("tr");
        value = row?.querySelectorAll("td")[1]?.textContent?.trim() ?? "";
      }

      if (value) {
        attributes[label] = value.replace(/\s+/g, " ").trim();
      }
    });
  });

  return attributes;
}

function extractExternalListingId() {
  const match = window.location.pathname.match(/\/itm\/(?:[^/]+\/)?(\d+)/i) ?? window.location.href.match(/[?&]item=(\d+)/i);
  return match?.[1] ?? null;
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLElement, value: string) {
  if ("value" in element) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (element.isContentEditable) {
    element.textContent = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  }
}

function findFormField<T extends Element>(selectors: string[]) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element as T;
    }
  }

  return null;
}

function applyEbayDraft(payload: { listing?: Record<string, unknown> | null }) {
  const listing = payload.listing ?? {};
  const fieldsApplied: string[] = [];
  const missingFields: string[] = [];

  const title = typeof listing.title === "string" ? listing.title.trim() : "";
  const description = typeof listing.description === "string" ? listing.description.trim() : "";
  const price =
    typeof listing.price === "number"
      ? listing.price
      : typeof listing.price === "string" && listing.price.trim()
        ? Number(listing.price)
        : null;

  const titleField = findFormField<HTMLInputElement>([
    "input[aria-label*='Title']",
    "input[name*='title']",
    "input[id*='title']",
    "input[data-testid*='title']"
  ]);
  const priceField = findFormField<HTMLInputElement>([
    "input[aria-label*='price']",
    "input[aria-label*='Price']",
    "input[name*='price']",
    "input[id*='price']",
    "input[inputmode='decimal']"
  ]);
  const descriptionField =
    findFormField<HTMLTextAreaElement>([
      "textarea[aria-label*='Description']",
      "textarea[name*='description']",
      "textarea[id*='description']"
    ]) ??
    findFormField<HTMLElement>([
      "[contenteditable='true'][aria-label*='Description']",
      "[contenteditable='true'][role='textbox']"
    ]);

  if (title && titleField) {
    setNativeValue(titleField, title);
    fieldsApplied.push("title");
  } else {
    missingFields.push("title");
  }

  if (price != null && Number.isFinite(price) && priceField) {
    setNativeValue(priceField, price.toFixed(2));
    fieldsApplied.push("price");
  } else {
    missingFields.push("price");
  }

  if (description && descriptionField) {
    setNativeValue(descriptionField, description);
    fieldsApplied.push("description");
  } else {
    missingFields.push("description");
  }

  if (fieldsApplied.length === 0) {
    return {
      ok: false,
      needsInput: true,
      error: "eBay loaded, but this page variant does not expose the listing fields Mollie expects yet.",
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

function extractListing() {
  const externalListingId = extractExternalListingId();

  if (!externalListingId) {
    return {
      ok: false,
      error: "This page does not look like a single eBay listing."
    };
  }

  const attributes = extractItemSpecifics();
  const title =
    textContent(["h1.x-item-title__mainTitle span", "h1 span", "h1"]) ??
    metaContent("og:title") ??
    document.title.replace(/\s*\|.*$/, "").trim();
  const category =
    textContent(["nav[aria-label='Breadcrumbs'] li:last-child span", ".seo-breadcrumb-text"]) ??
    null;
  const condition =
    (typeof attributes.Condition === "string" ? attributes.Condition : null) ??
    textContent([".x-item-condition-max-view .ux-textspans", "[data-testid='ux-item-condition']"]) ??
    null;
  const brand =
    (typeof attributes.Brand === "string" ? attributes.Brand : null) ??
    (typeof attributes.Manufacturer === "string" ? attributes.Manufacturer : null) ??
    null;
  const description = metaContent("og:description") ?? null;
  const price =
    parsePrice(metaContent("product:price:amount")) ??
    parsePrice(textContent([".x-price-primary span", "[itemprop='price']", ".display-price"])) ??
    null;
  const photos = collectPhotos();

  return {
    ok: true,
    payload: {
      externalListingId,
      externalUrl: `${window.location.origin}${window.location.pathname}`,
      title,
      description,
      price,
      category,
      condition,
      brand,
      quantity: 1,
      photos,
      sourceUrl: window.location.href,
      sourceListingState: "PUBLISHED" as const,
      attributes
    }
  };
}

chrome.runtime.onMessage.addListener((message: Record<string, unknown>, _sender: unknown, sendResponse: (response?: unknown) => void) => {
  if (message.type === "MOLLIE_EXTENSION_EXTRACT_EBAY") {
    sendResponse(extractListing());
    return true;
  }

  if (message.type === "MOLLIE_EXTENSION_APPLY_EBAY_DRAFT") {
    sendResponse(applyEbayDraft((message.payload ?? {}) as { listing?: Record<string, unknown> | null }));
    return true;
  }

  return false;
});
})();
