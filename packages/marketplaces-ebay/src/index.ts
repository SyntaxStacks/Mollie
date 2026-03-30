import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

import { ConnectorError, type MarketplaceAdapter, type MarketplaceAccountContext, type PublishListingInput } from "@reselleros/marketplaces";
import type { ConnectorPreflightCheck, EbayOperationalState } from "@reselleros/types";

const DEFAULT_EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly"
];

const OAUTH_STATE_PREFIX = "ebay-oauth-v1";

type EbayEnvironment = "sandbox" | "production";

type EbayOAuthState = {
  workspaceId: string;
  userId: string;
  displayName: string;
  iat: number;
  exp: number;
  nonce: string;
};

type EbayTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
};

type EncryptedCredentialPayload = {
  scheme: "db-encrypted-v1";
  keyVersion: "session-secret-v1";
  iv: string;
  authTag: string;
  ciphertext: string;
};

type EbayResolvedTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scopes: string[];
  issuedAt: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string | null;
};

type EbayLiveDefaults = {
  merchantLocationKey?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  fulfillmentPolicyId?: string;
  marketplaceId?: string;
  currency?: string;
};

type EbayOperationalEvaluation = {
  state: EbayOperationalState;
  status: "READY" | "WARNING" | "BLOCKED";
  publishMode: "live" | "simulated";
  summary: string;
  detail: string;
  missingConfig: string[];
};

function resolveEbayEnvironment(): EbayEnvironment {
  return process.env.EBAY_ENVIRONMENT === "production" ? "production" : "sandbox";
}

function resolveEbayScopes() {
  const configured = process.env.EBAY_SCOPES?.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean);
  return configured?.length ? configured : DEFAULT_EBAY_SCOPES;
}

function getAuthorizationBaseUrl(environment: EbayEnvironment) {
  return environment === "production"
    ? "https://auth.ebay.com/oauth2/authorize"
    : "https://auth.sandbox.ebay.com/oauth2/authorize";
}

function getApiBaseUrl(environment: EbayEnvironment) {
  return environment === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

function getListingBaseUrl(environment: EbayEnvironment) {
  return environment === "production" ? "https://www.ebay.com" : "https://www.sandbox.ebay.com";
}

function isLivePublishEnabled() {
  return process.env.EBAY_LIVE_PUBLISH_ENABLED === "1" || process.env.EBAY_LIVE_PUBLISH_ENABLED === "true";
}

function getLivePublishEnabledFlag() {
  return isLivePublishEnabled();
}

function getOauthConfig() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const callbackUrl = process.env.EBAY_REDIRECT_URI;
  const ruName = process.env.EBAY_RU_NAME;
  const oauthRedirect = ruName ?? callbackUrl;

  if (!clientId || !clientSecret || !callbackUrl || !oauthRedirect) {
    throw new ConnectorError({
      code: "PREREQUISITE_MISSING",
      message: "eBay OAuth is not configured. Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REDIRECT_URI, and for production OAuth also set EBAY_RU_NAME.",
      retryable: false
    });
  }

  return {
    clientId,
    clientSecret,
    callbackUrl,
    oauthRedirect,
    ruName,
    environment: resolveEbayEnvironment(),
    scopes: resolveEbayScopes()
  };
}

function getStateSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new ConnectorError({
      code: "PREREQUISITE_MISSING",
      message: "SESSION_SECRET is required for eBay OAuth state signing.",
      retryable: false
    });
  }

  return createHash("sha256").update(secret).update(":ebay-oauth-state").digest();
}

function getCredentialEncryptionKey() {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new ConnectorError({
      code: "PREREQUISITE_MISSING",
      message: "SESSION_SECRET is required for marketplace credential encryption.",
      retryable: false
    });
  }

  return createHash("sha256").update(secret).update(":marketplace-credentials").digest();
}

function encodeStatePayload(payload: EbayOAuthState) {
  const serialized = JSON.stringify(payload);
  return Buffer.from(serialized, "utf8").toString("base64url");
}

function signStatePayload(encodedPayload: string) {
  return createHmac("sha256", getStateSecret())
    .update(`${OAUTH_STATE_PREFIX}.${encodedPayload}`)
    .digest("base64url");
}

function buildAspectMap(attributes: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim().length > 0)
      .map(([key, value]) => [key, [String(value)]])
  );
}

function buildEbayPublishPlan(input: PublishListingInput) {
  return {
    sku: input.sku,
    quantity: input.quantity,
    locale: "en-US",
    title: input.title.trim().slice(0, 80),
    description: input.description.trim(),
    categoryHint: input.category,
    conditionDescription: input.condition,
    pricing: {
      currency: "USD",
      value: Number(input.price.toFixed(2))
    },
    images: input.images,
    product: {
      brand: input.brand ?? null,
      aspects: buildAspectMap(input.attributes)
    }
  };
}

function resolveCategoryId(attributes: Record<string, unknown>) {
  const rawValue =
    attributes.ebayCategoryId ??
    attributes.ebay_category_id ??
    attributes["ebay.categoryId"] ??
    attributes["ebay.category_id"];

  if (!rawValue) {
    throw new ConnectorError({
      code: "PREREQUISITE_MISSING",
      message: "eBay live publish requires an ebayCategoryId attribute on the approved draft.",
      retryable: false
    });
  }

  return String(rawValue);
}

function readCategoryId(attributes: Record<string, unknown>) {
  const rawValue =
    attributes.ebayCategoryId ??
    attributes.ebay_category_id ??
    attributes["ebay.categoryId"] ??
    attributes["ebay.category_id"];

  return rawValue ? String(rawValue) : null;
}

function resolveConditionCode(condition: string) {
  const normalized = condition.toLowerCase();

  if (normalized.includes("new")) {
    return "NEW";
  }

  if (normalized.includes("excellent") || normalized.includes("like new")) {
    return "USED_EXCELLENT";
  }

  if (normalized.includes("very good")) {
    return "USED_VERY_GOOD";
  }

  if (normalized.includes("good")) {
    return "USED_GOOD";
  }

  return "USED_ACCEPTABLE";
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function getEbayLiveDefaults(metadata?: Record<string, unknown> | null): EbayLiveDefaults {
  const rawDefaults =
    metadata && typeof metadata.ebayLiveDefaults === "object" && metadata.ebayLiveDefaults
      ? (metadata.ebayLiveDefaults as Record<string, unknown>)
      : {};

  return {
    merchantLocationKey: readOptionalString(rawDefaults.merchantLocationKey),
    paymentPolicyId: readOptionalString(rawDefaults.paymentPolicyId),
    returnPolicyId: readOptionalString(rawDefaults.returnPolicyId),
    fulfillmentPolicyId: readOptionalString(rawDefaults.fulfillmentPolicyId),
    marketplaceId: readOptionalString(rawDefaults.marketplaceId),
    currency: readOptionalString(rawDefaults.currency)
  };
}

function getLivePublishConfig(metadata?: Record<string, unknown> | null) {
  const defaults = getEbayLiveDefaults(metadata);
  const merchantLocationKey = defaults.merchantLocationKey ?? process.env.EBAY_MERCHANT_LOCATION_KEY;
  const paymentPolicyId = defaults.paymentPolicyId ?? process.env.EBAY_PAYMENT_POLICY_ID;
  const returnPolicyId = defaults.returnPolicyId ?? process.env.EBAY_RETURN_POLICY_ID;
  const fulfillmentPolicyId = defaults.fulfillmentPolicyId ?? process.env.EBAY_FULFILLMENT_POLICY_ID;

  if (!merchantLocationKey || !paymentPolicyId || !returnPolicyId || !fulfillmentPolicyId) {
    throw new ConnectorError({
      code: "PREREQUISITE_MISSING",
      message:
        "eBay live publish requires EBAY_MERCHANT_LOCATION_KEY, EBAY_PAYMENT_POLICY_ID, EBAY_RETURN_POLICY_ID, and EBAY_FULFILLMENT_POLICY_ID.",
      retryable: false
    });
  }

  return {
    merchantLocationKey,
    paymentPolicyId,
    returnPolicyId,
    fulfillmentPolicyId,
    marketplaceId: defaults.marketplaceId ?? process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US",
    currency: defaults.currency ?? process.env.EBAY_CURRENCY ?? "USD",
    environment: resolveEbayEnvironment()
  };
}

function getLivePublishConfigStatus(metadata?: Record<string, unknown> | null) {
  const defaults = getEbayLiveDefaults(metadata);
  const configEntries: ReadonlyArray<readonly [string, string | undefined]> = [
    ["merchantLocationKey", defaults.merchantLocationKey ?? process.env.EBAY_MERCHANT_LOCATION_KEY],
    ["paymentPolicyId", defaults.paymentPolicyId ?? process.env.EBAY_PAYMENT_POLICY_ID],
    ["returnPolicyId", defaults.returnPolicyId ?? process.env.EBAY_RETURN_POLICY_ID],
    ["fulfillmentPolicyId", defaults.fulfillmentPolicyId ?? process.env.EBAY_FULFILLMENT_POLICY_ID]
  ];
  const missing = configEntries
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return {
    ok: missing.length === 0,
    missing
  };
}

export function getEbayOperationalState(input: {
  account: MarketplaceAccountContext;
  accountStatus?: string;
  lastErrorMessage?: string | null;
  liveEnabled?: boolean;
}): EbayOperationalEvaluation {
  const liveEnabled = input.liveEnabled ?? getLivePublishEnabledFlag();
  const accountStatus = input.accountStatus ?? input.account.status;
  const { account } = input;
  const isOauth = account.credentialType === "OAUTH_TOKEN_SET";

  if (!isOauth) {
    return {
      state: "SIMULATED",
      status: liveEnabled ? "WARNING" : "READY",
      publishMode: "simulated",
      summary: liveEnabled
        ? "Manual eBay account will stay on the simulated pilot path."
        : "Manual eBay account is ready for simulated publish.",
      detail: liveEnabled
        ? "Connect and configure OAuth if you want this workspace to publish live eBay listings."
        : "This account uses the simulated pilot connector.",
      missingConfig: []
    };
  }

  if (accountStatus === "ERROR") {
    return {
      state: "LIVE_ERROR",
      status: "BLOCKED",
      publishMode: "live",
      summary: input.lastErrorMessage?.trim() || "This eBay account is in a live connector error state.",
      detail: "Reconnect the account or clear the live connector error before publishing again.",
      missingConfig: []
    };
  }

  if (accountStatus === "DISABLED") {
    return {
      state: "LIVE_BLOCKED",
      status: "BLOCKED",
      publishMode: "live",
      summary: "This eBay account is disabled.",
      detail: "Re-enable or reconnect the account before publishing live listings.",
      missingConfig: []
    };
  }

  if (account.validationStatus === "INVALID") {
    return {
      state: "LIVE_BLOCKED",
      status: "BLOCKED",
      publishMode: "live",
      summary: "OAuth credentials are invalid.",
      detail: "Reconnect eBay before attempting another live publish.",
      missingConfig: []
    };
  }

  if (account.validationStatus === "NEEDS_REFRESH") {
    return {
      state: "LIVE_BLOCKED",
      status: "BLOCKED",
      publishMode: "live",
      summary: input.lastErrorMessage?.trim() || "OAuth token needs refresh.",
      detail: "Reconnect eBay to refresh the account token set before publishing.",
      missingConfig: []
    };
  }

  if (account.validationStatus === "UNVERIFIED") {
    return {
      state: "LIVE_BLOCKED",
      status: "BLOCKED",
      publishMode: "live",
      summary: "OAuth account has not been validated yet.",
      detail: "Finish the eBay OAuth flow before attempting live publish.",
      missingConfig: []
    };
  }

  if (!liveEnabled) {
    return {
      state: "OAUTH_CONNECTED",
      status: "WARNING",
      publishMode: "simulated",
      summary: "OAuth account is connected, but live eBay publish is disabled.",
      detail: "Enable EBAY_LIVE_PUBLISH_ENABLED or keep using a simulated manual account for pilot publish jobs.",
      missingConfig: []
    };
  }

  const configStatus = getLivePublishConfigStatus(account.credentialMetadata ?? null);

  if (!configStatus.ok) {
    return {
      state: "LIVE_CONFIG_MISSING",
      status: "WARNING",
      publishMode: "live",
      summary: "OAuth account is connected, but live eBay defaults are incomplete.",
      detail: `Missing ${configStatus.missing.join(", ")}.`,
      missingConfig: configStatus.missing
    };
  }

  return {
    state: "LIVE_READY",
    status: "READY",
    publishMode: "live",
    summary: "OAuth account is ready for live eBay publish.",
    detail: "Live token validation and required eBay defaults are in place.",
    missingConfig: []
  };
}

export function selectEbayMarketplaceAccount(accounts: MarketplaceAccountContext[], liveEnabled = getLivePublishEnabledFlag()) {
  const evaluatedAccounts = accounts.map((account) => ({
    account,
    evaluation: getEbayOperationalState({
      account,
      liveEnabled
    })
  }));
  const preferredPublishableOrder = liveEnabled ? ["LIVE_READY", "SIMULATED"] : ["SIMULATED", "LIVE_READY"];
  const publishable =
    preferredPublishableOrder
      .map((state) => evaluatedAccounts.find((candidate) => candidate.evaluation.state === state))
      .find(Boolean) ?? null;
  const fallbackOrder = ["LIVE_CONFIG_MISSING", "OAUTH_CONNECTED", "LIVE_BLOCKED", "LIVE_ERROR"];
  const fallback =
    fallbackOrder
      .map((state) => evaluatedAccounts.find((candidate) => candidate.evaluation.state === state))
      .find(Boolean) ?? null;

  return {
    account: publishable?.account ?? null,
    evaluation: publishable?.evaluation ?? fallback?.evaluation ?? null,
    mode: publishable?.evaluation.publishMode ?? (liveEnabled ? "live" : "simulated")
  };
}

export function getEbayPublishPreflight(input: {
  accounts: MarketplaceAccountContext[];
  images: string[];
  draftApproved: boolean;
  draftAttributes?: Record<string, unknown> | null;
}) {
  const liveEnabled = getLivePublishEnabledFlag();
  const selected = selectEbayMarketplaceAccount(input.accounts, liveEnabled);
  const checks: ConnectorPreflightCheck[] = [];

  const imageReady = input.images.length > 0;
  checks.push({
    key: "images",
    label: "Images",
    status: imageReady ? "READY" : "BLOCKED",
    detail: imageReady ? `${input.images.length} image${input.images.length === 1 ? "" : "s"} ready` : "Add at least one image"
  });

  checks.push({
    key: "draft",
    label: "Approved draft",
    status: input.draftApproved ? "READY" : "BLOCKED",
    detail: input.draftApproved ? "Approved eBay draft found" : "Approve an eBay draft before publishing"
  });

  if (!selected.account && !selected.evaluation) {
    checks.push({
      key: "account",
      label: "eBay account",
      status: "BLOCKED",
      detail: "Connect an eBay account before publishing"
    });
  } else {
    checks.push({
      key: "account",
      label: "eBay account",
      status: selected.evaluation?.status ?? "BLOCKED",
      detail:
        selected.account && selected.evaluation
          ? `${selected.account.displayName}: ${selected.evaluation.summary}`
          : (selected.evaluation?.summary ?? "Connect an eBay account before publishing")
    });
  }

  if (selected.evaluation?.publishMode === "live") {
    const configStatus = getLivePublishConfigStatus(selected.account?.credentialMetadata ?? null);
    checks.push({
      key: "live-config",
      label: "Live publish config",
      status: configStatus.ok ? "READY" : "BLOCKED",
      detail:
        configStatus.ok
          ? "Location and policy defaults are configured"
          : `Missing ${configStatus.missing.join(", ")}`
    });

    const categoryId = readCategoryId(input.draftAttributes ?? {});
    checks.push({
      key: "category",
      label: "eBay category",
      status: categoryId ? "READY" : "BLOCKED",
      detail: categoryId ? `Using category ${categoryId}` : "Set ebayCategoryId on the approved eBay draft attributes"
    });

    if (selected.evaluation?.state !== "LIVE_READY" && selected.account?.credentialType !== "OAUTH_TOKEN_SET") {
      checks.push({
        key: "oauth-mode",
        label: "Live account type",
        status: "BLOCKED",
        detail: "Live eBay publish requires an OAuth-connected eBay account"
      });
    }
  } else {
    checks.push({
      key: "publish-mode",
      label: "Publish mode",
      status: selected.evaluation?.state === "OAUTH_CONNECTED" ? "BLOCKED" : "WARNING",
      detail:
        selected.evaluation?.state === "OAUTH_CONNECTED"
          ? "OAuth is connected, but live eBay publish is disabled and no simulated account is selected."
          : "This item will use the simulated eBay pilot path."
    });
  }

  const blockingChecks = checks.filter((check) => check.status === "BLOCKED");

  return {
    state: selected.evaluation?.state ?? null,
    mode: selected.evaluation?.publishMode ?? (liveEnabled ? "live" : "simulated"),
    ready: blockingChecks.length === 0,
    selectedAccountId: selected.account?.id ?? null,
    selectedCredentialType: selected.account?.credentialType ?? null,
    summary:
      blockingChecks.length === 0
        ? liveEnabled
          ? "Ready for live eBay publish"
          : "Ready for simulated eBay publish"
        : blockingChecks[0]?.detail ?? "eBay publish is blocked",
    checks
  };
}

export function getEbayAccountReadiness(input: {
  account: MarketplaceAccountContext;
  accountStatus?: string;
  lastErrorMessage?: string | null;
}) {
  const evaluation = getEbayOperationalState(input);

  return {
    state: evaluation.state,
    status: evaluation.status,
    publishMode: evaluation.publishMode,
    summary: evaluation.summary,
    detail: evaluation.detail
  };
}

function decodeEncryptedPayload(payload: Record<string, unknown>): EncryptedCredentialPayload {
  if (
    payload.scheme !== "db-encrypted-v1" ||
    payload.keyVersion !== "session-secret-v1" ||
    typeof payload.iv !== "string" ||
    typeof payload.authTag !== "string" ||
    typeof payload.ciphertext !== "string"
  ) {
    throw new ConnectorError({
      code: "PREREQUISITE_MISSING",
      message: "Marketplace credential payload is missing or malformed for eBay OAuth.",
      retryable: false
    });
  }

  return payload as EncryptedCredentialPayload;
}

function buildCredentialMetadata(input: {
  tokenSet: EbayResolvedTokenSet;
  currentMetadata?: Record<string, unknown> | null;
  publishMode: "foundation-only" | "live-api";
}) {
  return {
    ...(input.currentMetadata ?? {}),
    mode: "oauth",
    environment: resolveEbayEnvironment(),
    scopes: input.tokenSet.scopes,
    tokenType: input.tokenSet.tokenType,
    connectedAt: String(input.currentMetadata?.connectedAt ?? input.tokenSet.issuedAt),
    accessTokenExpiresAt: input.tokenSet.accessTokenExpiresAt,
    refreshTokenExpiresAt: input.tokenSet.refreshTokenExpiresAt,
    publishMode: input.publishMode
  };
}

async function callEbayApi(path: string, input: {
  method: "GET" | "POST" | "PUT";
  accessToken: string;
  body?: Record<string, unknown>;
}) {
  const environment = resolveEbayEnvironment();
  const response = await fetch(`${getApiBaseUrl(environment)}${path}`, {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: "application/json",
      ...(input.body
        ? {
            "Content-Type": "application/json"
          }
        : {})
    },
    body: input.body ? JSON.stringify(input.body) : undefined
  });

  const payload = response.status === 204 ? null : ((await response.json().catch(() => null)) as Record<string, unknown> | null);

  if (!response.ok) {
    throw new ConnectorError({
      code: "ACCOUNT_UNAVAILABLE",
      message: `eBay API request failed for ${path}`,
      retryable: response.status >= 500,
      metadata: {
        path,
        status: response.status,
        response: payload
      }
    });
  }

  return payload;
}

function simulatePublish(input: PublishListingInput) {
  const publishPlan = buildEbayPublishPlan(input);
  const externalListingId = `ebay_${crypto.randomUUID().slice(0, 12)}`;
  return {
    externalListingId,
    externalUrl: `https://www.ebay.com/itm/${externalListingId}`,
    title: input.title,
    price: input.price,
    rawResponse: {
      mode: "simulated",
      platform: "EBAY",
      account: input.marketplaceAccount.displayName,
      credentialType: input.marketplaceAccount.credentialType,
      publishPlan
    }
  };
}

export function createEbayOAuthState(input: {
  workspaceId: string;
  userId: string;
  displayName: string;
  ttlMinutes?: number;
}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: EbayOAuthState = {
    workspaceId: input.workspaceId,
    userId: input.userId,
    displayName: input.displayName,
    iat: nowSeconds,
    exp: nowSeconds + (input.ttlMinutes ?? 15) * 60,
    nonce: crypto.randomUUID()
  };
  const encodedPayload = encodeStatePayload(payload);
  const signature = signStatePayload(encodedPayload);

  return `${OAUTH_STATE_PREFIX}.${encodedPayload}.${signature}`;
}

export function parseEbayOAuthState(state: string) {
  const [prefix, encodedPayload, signature] = state.split(".");

  if (prefix !== OAUTH_STATE_PREFIX || !encodedPayload || !signature) {
    throw new ConnectorError({
      code: "ACCOUNT_UNAVAILABLE",
      message: "Invalid eBay OAuth state.",
      retryable: false
    });
  }

  const expectedSignature = signStatePayload(encodedPayload);

  if (signature !== expectedSignature) {
    throw new ConnectorError({
      code: "ACCOUNT_UNAVAILABLE",
      message: "Invalid eBay OAuth state signature.",
      retryable: false
    });
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as EbayOAuthState;

  if (payload.exp * 1000 <= Date.now()) {
    throw new ConnectorError({
      code: "ACCOUNT_UNAVAILABLE",
      message: "eBay OAuth state has expired.",
      retryable: false
    });
  }

  return payload;
}

export function buildEbayAuthorizationUrl(input: {
  workspaceId: string;
  userId: string;
  displayName: string;
}) {
  const config = getOauthConfig();
  const state = createEbayOAuthState(input);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.oauthRedirect,
    response_type: "code",
    scope: config.scopes.join(" "),
    state
  });

  return {
    authorizeUrl: `${getAuthorizationBaseUrl(config.environment)}?${params.toString()}`,
    state,
    environment: config.environment,
    scopes: config.scopes
  };
}

export async function exchangeEbayAuthorizationCode(code: string) {
  const config = getOauthConfig();
  const response = await fetch(`${getApiBaseUrl(config.environment)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.oauthRedirect
    })
  });

  const payload = (await response.json().catch(() => null)) as EbayTokenResponse | Record<string, unknown> | null;

  if (!response.ok || !payload || typeof payload !== "object" || !("access_token" in payload)) {
    throw new ConnectorError({
      code: "ACCOUNT_UNAVAILABLE",
      message: "eBay token exchange failed.",
      retryable: false,
      metadata: {
        status: response.status,
        response: payload
      }
    });
  }

  const tokenPayload = payload as EbayTokenResponse;
  const issuedAt = new Date();
  const accessTokenExpiresAt = new Date(issuedAt.getTime() + tokenPayload.expires_in * 1000);
  const refreshTokenExpiresAt = tokenPayload.refresh_token_expires_in
    ? new Date(issuedAt.getTime() + tokenPayload.refresh_token_expires_in * 1000)
    : null;

  return {
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token ?? null,
    tokenType: tokenPayload.token_type,
    scopes: tokenPayload.scope?.split(" ").filter(Boolean) ?? config.scopes,
    issuedAt: issuedAt.toISOString(),
    accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
    refreshTokenExpiresAt: refreshTokenExpiresAt?.toISOString() ?? null
  };
}

export async function refreshEbayAccessToken(refreshToken: string) {
  const config = getOauthConfig();
  const response = await fetch(`${getApiBaseUrl(config.environment)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: config.scopes.join(" ")
    })
  });

  const payload = (await response.json().catch(() => null)) as EbayTokenResponse | Record<string, unknown> | null;

  if (!response.ok || !payload || typeof payload !== "object" || !("access_token" in payload)) {
    throw new ConnectorError({
      code: "ACCOUNT_UNAVAILABLE",
      message: "eBay token refresh failed.",
      retryable: false,
      metadata: {
        status: response.status,
        response: payload
      }
    });
  }

  const tokenPayload = payload as EbayTokenResponse;
  const issuedAt = new Date();
  const accessTokenExpiresAt = new Date(issuedAt.getTime() + tokenPayload.expires_in * 1000);
  const refreshTokenExpiresAt = tokenPayload.refresh_token_expires_in
    ? new Date(issuedAt.getTime() + tokenPayload.refresh_token_expires_in * 1000)
    : null;

  return {
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token ?? refreshToken,
    tokenType: tokenPayload.token_type,
    scopes: tokenPayload.scope?.split(" ").filter(Boolean) ?? config.scopes,
    issuedAt: issuedAt.toISOString(),
    accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
    refreshTokenExpiresAt: refreshTokenExpiresAt?.toISOString() ?? null
  };
}

export async function fetchEbayUserProfile(accessToken: string) {
  const environment = resolveEbayEnvironment();
  const response = await fetch(`${getApiBaseUrl(environment)}/commerce/identity/v1/user/`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok || !payload) {
    throw new ConnectorError({
      code: "ACCOUNT_UNAVAILABLE",
      message: "eBay account validation failed.",
      retryable: false,
      metadata: {
        status: response.status,
        response: payload
      }
    });
  }

  const username = String(payload.username ?? payload.userId ?? "unknown");
  const userId = String(payload.userId ?? username);

  return {
    userId,
    username,
    raw: payload
  };
}

export function encryptEbayCredentialPayload(payload: Record<string, unknown>): EncryptedCredentialPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getCredentialEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    scheme: "db-encrypted-v1",
    keyVersion: "session-secret-v1",
    iv: iv.toString("base64url"),
    authTag: authTag.toString("base64url"),
    ciphertext: ciphertext.toString("base64url")
  };
}

export function decryptEbayCredentialPayload(payload: Record<string, unknown>) {
  const encryptedPayload = decodeEncryptedPayload(payload);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getCredentialEncryptionKey(),
    Buffer.from(encryptedPayload.iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(encryptedPayload.authTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encryptedPayload.ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");

  return JSON.parse(plaintext) as EbayResolvedTokenSet;
}

async function resolveLiveAccessToken(input: PublishListingInput) {
  if (!input.marketplaceAccount.credentialPayload) {
    throw new ConnectorError({
      code: "PREREQUISITE_MISSING",
      message: "eBay OAuth account is missing encrypted credentials.",
      retryable: false
    });
  }

  const tokenSet = decryptEbayCredentialPayload(input.marketplaceAccount.credentialPayload);
  const expiresAt =
    Date.parse(String(input.marketplaceAccount.credentialMetadata?.accessTokenExpiresAt ?? tokenSet.accessTokenExpiresAt)) || 0;

  if (expiresAt > Date.now() + 5 * 60 * 1000) {
    return {
      accessToken: tokenSet.accessToken,
      marketplaceAccountUpdate: undefined
    };
  }

  if (!tokenSet.refreshToken) {
    throw new ConnectorError({
      code: "ACCOUNT_UNAVAILABLE",
      message: "eBay OAuth token has expired and no refresh token is available.",
      retryable: false
    });
  }

  const refreshedTokenSet = await refreshEbayAccessToken(tokenSet.refreshToken);
  return {
    accessToken: refreshedTokenSet.accessToken,
    marketplaceAccountUpdate: {
      validationStatus: "VALID" as const,
      credentialPayload: encryptEbayCredentialPayload(refreshedTokenSet) as unknown as Record<string, unknown>,
      credentialMetadata: buildCredentialMetadata({
        tokenSet: refreshedTokenSet,
        currentMetadata: input.marketplaceAccount.credentialMetadata,
        publishMode: "live-api"
      }),
      lastValidatedAt: new Date().toISOString()
    }
  };
}

function buildInventoryItemPayload(input: PublishListingInput) {
  if (!input.images.length) {
    throw new ConnectorError({
      code: "PREREQUISITE_MISSING",
      message: "eBay live publish requires at least one image.",
      retryable: false
    });
  }

  return {
    availability: {
      shipToLocationAvailability: {
        quantity: input.quantity
      }
    },
    condition: resolveConditionCode(input.condition),
    conditionDescription: input.condition,
    product: {
      title: input.title.trim(),
      description: input.description.trim(),
      imageUrls: input.images,
      aspects: buildAspectMap(input.attributes),
      brand: input.brand ?? undefined
    }
  };
}

function buildOfferPayload(input: PublishListingInput) {
  const config = getLivePublishConfig(input.marketplaceAccount.credentialMetadata ?? null);
  return {
    sku: input.sku,
    marketplaceId: config.marketplaceId,
    format: "FIXED_PRICE",
    availableQuantity: input.quantity,
    categoryId: resolveCategoryId(input.attributes),
    merchantLocationKey: config.merchantLocationKey,
    listingDescription: input.description.trim(),
    pricingSummary: {
      price: {
        currency: config.currency,
        value: input.price.toFixed(2)
      }
    },
    listingPolicies: {
      fulfillmentPolicyId: config.fulfillmentPolicyId,
      paymentPolicyId: config.paymentPolicyId,
      returnPolicyId: config.returnPolicyId
    }
  };
}

async function publishLiveListing(input: PublishListingInput) {
  const { accessToken, marketplaceAccountUpdate } = await resolveLiveAccessToken(input);
  const config = getLivePublishConfig(input.marketplaceAccount.credentialMetadata ?? null);
  const inventoryPayload = buildInventoryItemPayload(input);
  const offerPayload = buildOfferPayload(input);

  await callEbayApi(`/sell/inventory/v1/inventory_item/${encodeURIComponent(input.sku)}`, {
    method: "PUT",
    accessToken,
    body: inventoryPayload
  });

  const createdOffer = await callEbayApi("/sell/inventory/v1/offer", {
    method: "POST",
    accessToken,
    body: offerPayload
  });
  const offerId = String(createdOffer?.offerId ?? "");

  if (!offerId) {
    throw new ConnectorError({
      code: "ACCOUNT_UNAVAILABLE",
      message: "eBay createOffer did not return an offerId.",
      retryable: false,
      metadata: {
        response: createdOffer
      }
    });
  }

  const publishedOffer = await callEbayApi(`/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`, {
    method: "POST",
    accessToken
  });
  const nestedListing =
    publishedOffer && typeof publishedOffer.listing === "object" && publishedOffer.listing
      ? (publishedOffer.listing as Record<string, unknown>)
      : null;
  const listingId = String(publishedOffer?.listingId ?? nestedListing?.listingId ?? "");

  if (!listingId) {
    throw new ConnectorError({
      code: "ACCOUNT_UNAVAILABLE",
      message: "eBay publishOffer did not return a listingId.",
      retryable: false,
      metadata: {
        response: publishedOffer
      }
    });
  }

  const defaultAccountUpdate = {
    validationStatus: "VALID" as const,
    credentialMetadata: {
      ...(input.marketplaceAccount.credentialMetadata ?? {}),
      publishMode: "live-api"
    },
    lastValidatedAt: new Date().toISOString()
  };

  return {
    externalListingId: listingId,
    externalUrl: `${getListingBaseUrl(config.environment)}/itm/${listingId}`,
    title: input.title,
    price: input.price,
    rawResponse: {
      mode: "live",
      platform: "EBAY",
      account: input.marketplaceAccount.displayName,
      offerId,
      listingId,
      inventoryPayload,
      offerPayload,
      publishResponse: publishedOffer
    },
    marketplaceAccountUpdate: marketplaceAccountUpdate ?? defaultAccountUpdate
  };
}

export const ebayAdapter: MarketplaceAdapter = {
  platform: "EBAY",
  descriptor: {
    platform: "EBAY",
    displayName: "eBay",
    executionMode: "OAUTH_API",
    riskLevel: "MEDIUM",
    fallbackMode: "SIMULATED",
    rateLimitStrategy: "PROVIDER",
    supportedCapabilities: [
      {
        capability: "CONNECT_ACCOUNT",
        support: "SUPPORTED",
        detail: "Supports both OAuth account connection and manual simulated account setup."
      },
      {
        capability: "VALIDATE_AUTH",
        support: "SUPPORTED",
        detail: "Validates account readiness through OAuth state, account health, and live config checks."
      },
      {
        capability: "REFRESH_AUTH",
        support: "SUPPORTED",
        detail: "Refreshes OAuth access tokens when a valid refresh token is available."
      },
      {
        capability: "SYNC_ACCOUNT_STATE",
        support: "SUPPORTED",
        detail: "Can sync identity and account-level OAuth state for connected sellers."
      },
      {
        capability: "SYNC_LISTINGS",
        support: "SUPPORTED",
        detail: "Supports listing status sync through the standard sync job path."
      },
      {
        capability: "SYNC_ORDERS",
        support: "PLANNED",
        detail: "Order and fulfillment sync are planned but not implemented yet."
      },
      {
        capability: "CREATE_LISTING",
        support: "SUPPORTED",
        detail: "Supports simulated publish today and live Inventory API publish when live mode is enabled and configured."
      },
      {
        capability: "UPDATE_LISTING",
        support: "PLANNED",
        detail: "Revision support is not implemented yet."
      },
      {
        capability: "DELIST_LISTING",
        support: "PLANNED",
        detail: "Delist/end-listing support is planned."
      },
      {
        capability: "RELIST_LISTING",
        support: "PLANNED",
        detail: "Relist flows are planned."
      },
      {
        capability: "SEND_OFFER",
        support: "PLANNED",
        detail: "Offer workflows are planned once the listing lifecycle is broader than initial publish."
      },
      {
        capability: "FETCH_MESSAGES",
        support: "UNSUPPORTED",
        detail: "Buyer messaging is not part of the current eBay connector scope."
      },
      {
        capability: "RECORD_HEALTH",
        support: "SUPPORTED",
        detail: "Readiness and health are surfaced through canonical eBay operational states."
      },
      {
        capability: "FETCH_ANALYTICS",
        support: "PLANNED",
        detail: "Analytics and account activity retrieval are planned."
      }
    ],
    supportedFeatureFamilies: [
      {
        family: "EBAY_POLICY_CONFIGURATION",
        support: "SUPPORTED",
        detail: "Merchant location, business policies, category mapping, and preflight checks are already part of the live eBay direction."
      }
    ]
  },
  async publishListing(input) {
    const evaluation = getEbayOperationalState({
      account: input.marketplaceAccount
    });

    if (evaluation.state === "SIMULATED") {
      return simulatePublish(input);
    }

    if (evaluation.state === "LIVE_READY") {
      return publishLiveListing(input);
    }

    throw new ConnectorError({
      code: "ACCOUNT_UNAVAILABLE",
      message: evaluation.summary,
      retryable: false,
      metadata: {
        accountId: input.marketplaceAccount.id,
        externalAccountId: input.marketplaceAccount.externalAccountId ?? null,
        ebayState: evaluation.state,
        publishMode: evaluation.publishMode,
        detail: evaluation.detail,
        publishPlan: buildEbayPublishPlan(input)
      }
    });
  },
  async syncListing({ currentStatus }) {
    return { status: currentStatus === "PUBLISHED" ? "SYNCED" : currentStatus };
  },
  async testConnection({ marketplaceAccount }) {
    return {
      ok: true,
      detail:
        marketplaceAccount.credentialType === "OAUTH_TOKEN_SET"
          ? `eBay OAuth foundation connected for ${marketplaceAccount.displayName}`
          : `Simulated eBay connection ready for ${marketplaceAccount.displayName}`
    };
  }
};
