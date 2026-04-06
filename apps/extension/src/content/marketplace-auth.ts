(() => {
type MarketplaceVendor = "DEPOP" | "POSHMARK" | "WHATNOT";

type SessionDetection = {
  ok: boolean;
  vendor: MarketplaceVendor;
  loggedIn: boolean;
  accountHandle: string | null;
  externalAccountId: string | null;
  pageUrl: string;
  pageTitle: string | null;
  reason: string;
};

function bodyText() {
  return document.body?.textContent?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

function queryText(selectors: string[]) {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function queryAttr(selectors: string[], attribute: string) {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.getAttribute(attribute)?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function firstHandleFromLinks(patterns: RegExp[]) {
  const links = Array.from(document.querySelectorAll("a[href]"));
  for (const link of links) {
    const href = link.getAttribute("href") ?? "";
    for (const pattern of patterns) {
      const match = href.match(pattern);
      if (match?.[1]) {
        return decodeURIComponent(match[1]).replace(/^@/, "").trim();
      }
    }
  }

  return null;
}

function detectDepop(): SessionDetection {
  const lowerBody = bodyText();
  const handle =
    firstHandleFromLinks([/\/shop\/([^/?#]+)/i, /\/@([^/?#]+)/i]) ??
    queryAttr(["meta[property='profile:username']", "meta[name='profile:username']"], "content");
  const loginVisible =
    /log in|sign in/.test(lowerBody) &&
    Boolean(document.querySelector("input[type='email'], input[type='password'], form[action*='login']"));
  const loggedIn =
    !loginVisible &&
    (Boolean(handle) ||
      Boolean(document.querySelector("a[href*='/sell'], a[href*='/settings'], a[href*='/likes']")) ||
      /sell|profile|likes|saved/i.test(lowerBody));

  return {
    ok: true,
    vendor: "DEPOP",
    loggedIn,
    accountHandle: handle,
    externalAccountId: null,
    pageUrl: window.location.href,
    pageTitle: document.title || null,
    reason: loggedIn ? "Depop session markers detected in this tab." : "Depop still looks like a login page."
  };
}

function detectPoshmark(): SessionDetection {
  const lowerBody = bodyText();
  const handle =
    firstHandleFromLinks([/\/closet\/([^/?#]+)/i, /\/seller\/([^/?#]+)/i, /\/user\/([^/?#]+)/i]) ??
    queryText(["[data-testid='desktop-nav-user-menu-trigger']", "button[aria-label*='account']", "a[href*='/closet/']"]);
  const loginVisible =
    /log in|sign in/.test(lowerBody) &&
    Boolean(document.querySelector("input[type='email'], input[type='password'], form[action*='login']"));
  const loggedIn =
    !loginVisible &&
    (Boolean(handle) ||
      Boolean(document.querySelector("a[href*='/listing/create'], a[href*='/closet/'], a[href*='/account-tab']")) ||
      /closet|sell on poshmark|my closet|account/i.test(lowerBody));

  return {
    ok: true,
    vendor: "POSHMARK",
    loggedIn,
    accountHandle: typeof handle === "string" ? handle.replace(/^@/, "").trim() : null,
    externalAccountId: null,
    pageUrl: window.location.href,
    pageTitle: document.title || null,
    reason: loggedIn ? "Poshmark session markers detected in this tab." : "Poshmark still looks like a login page."
  };
}

function detectWhatnot(): SessionDetection {
  const lowerBody = bodyText();
  const handle =
    firstHandleFromLinks([/\/user\/([^/?#]+)/i, /\/seller\/([^/?#]+)/i, /\/@([^/?#]+)/i]) ??
    queryText(["button[aria-label*='profile']", "[data-testid='user-menu-trigger']", "a[href*='/seller/']", "a[href*='/user/']"]);
  const loginVisible =
    /log in|sign in|continue with google/.test(lowerBody) &&
    Boolean(document.querySelector("input[type='email'], input[type='password'], button, a[href*='login']"));
  const loggedIn =
    !loginVisible &&
    (Boolean(handle) ||
      Boolean(document.querySelector("a[href*='/seller/'], a[href*='/user/'], a[href*='/settings'], button[aria-label*='profile']")) ||
      /my shows|notifications|profile|sell/i.test(lowerBody));

  return {
    ok: true,
    vendor: "WHATNOT",
    loggedIn,
    accountHandle: typeof handle === "string" ? handle.replace(/^@/, "").trim() : null,
    externalAccountId: null,
    pageUrl: window.location.href,
    pageTitle: document.title || null,
    reason: loggedIn ? "Whatnot session markers detected in this tab." : "Whatnot still looks like a login page."
  };
}

function detectMarketplaceSession(): SessionDetection | null {
  const host = window.location.hostname.toLowerCase();
  if (host.includes("depop.com")) {
    return detectDepop();
  }

  if (host.includes("poshmark.com")) {
    return detectPoshmark();
  }

  if (host.includes("whatnot.com")) {
    return detectWhatnot();
  }

  return null;
}

chrome.runtime.onMessage.addListener((message: Record<string, unknown>, _sender: unknown, sendResponse: (response?: unknown) => void) => {
  if (message.type !== "MOLLIE_EXTENSION_DETECT_MARKETPLACE_SESSION") {
    return;
  }

  sendResponse(
    detectMarketplaceSession() ?? {
      ok: false,
      error: "This tab does not match a supported marketplace session detector."
    }
  );
});
})();
