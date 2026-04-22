"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useMemo, useState, useTransition } from "react";

import type { AutomationVendor, OperatorHint } from "@reselleros/types";
import { Button, Card, StatusPill } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { OperatorHintCard } from "../../components/operator-hint-card";
import { ProtectedView } from "../../components/protected-view";
import { useAuth } from "../../components/auth-provider";
import { useAuthedResource } from "../../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const automationVendorConfig = {
  DEPOP: {
    label: "Depop",
    loginUrl: "https://www.depop.com/login/"
  },
  POSHMARK: {
    label: "Poshmark",
    loginUrl: "https://poshmark.com/login"
  },
  WHATNOT: {
    label: "Whatnot",
    loginUrl: "https://www.whatnot.com/login"
  }
} satisfies Record<AutomationVendor, { label: string; loginUrl: string }>;

const automationVendorDefaultHandles = {
  DEPOP: "main-depop-shop",
  POSHMARK: "main-poshmark-closet",
  WHATNOT: "main-whatnot-account"
} satisfies Record<AutomationVendor, string>;

type MarketplaceAccountResponse = {
  id: string;
  platform: string;
  displayName: string;
  status: string;
  secretRef: string;
  credentialType: string;
  validationStatus: string;
  ebayState?: string | null;
  publishMode?: string | null;
  externalAccountId: string | null;
  credentialMetadata?: {
    publishMode?: string;
    username?: string;
    accountHandle?: string;
    accountLabel?: string;
    ebayLiveDefaults?: {
      merchantLocationKey?: string;
      paymentPolicyId?: string;
      returnPolicyId?: string;
      fulfillmentPolicyId?: string;
      marketplaceId?: string;
      currency?: string;
    };
  } | null;
  lastValidatedAt?: string | null;
  lastErrorMessage?: string | null;
  readiness?: {
    state: string;
    status: string;
    publishMode: string;
    summary: string;
    detail: string;
    hint?: OperatorHint | null;
  } | null;
};

type PoshmarkSocialResponse = {
  connected: boolean;
  config: {
    shareCloset: { enabled: boolean; intervalMinutes?: number | null };
    shareListings: { enabled: boolean; intervalMinutes?: number | null };
    sendOffersToLikers: { enabled: boolean; intervalMinutes?: number | null };
  };
  status?: {
    lastRunAt?: string | null;
    lastAction?: string | null;
    nextRunAt?: string | null;
    pauseReason?: string | null;
    lastOutcome?: string | null;
  } | null;
};

function renderOperatorHint(account: { readiness?: { hint?: OperatorHint | null } | null }) {
  return <OperatorHintCard hint={account.readiness?.hint} />;
}

function connectedAccountLabel(account: MarketplaceAccountResponse | null) {
  return account?.credentialMetadata?.accountHandle ?? account?.credentialMetadata?.username ?? account?.externalAccountId ?? account?.displayName ?? null;
}

function MarketplaceSessionCard({
  vendor,
  account,
  pendingAttempt,
  pending,
  onStart,
  onRecheck
}: {
  vendor: AutomationVendor;
  account: MarketplaceAccountResponse | null;
  pendingAttempt: boolean;
  pending: boolean;
  onStart: () => void;
  onRecheck: () => void;
}) {
  const config = automationVendorConfig[vendor];
  const isConnected = account?.status === "CONNECTED" && account.readiness?.status === "READY";
  const identity = connectedAccountLabel(account);

  return (
    <Card eyebrow={config.label} title={isConnected ? "Ready to post" : "Sign in to continue"}>
      <div className="stack">
        <div className={isConnected ? "notice success" : "notice"}>
          {isConnected
            ? `Logged in as ${identity ?? account?.displayName ?? config.label}.`
            : pendingAttempt
              ? `${config.label} login is open. Finish sign-in in the marketplace tab, then recheck it here.`
              : `Open ${config.label}, finish sign-in, then return to Mollie and recheck login.`}
        </div>
        <div className="actions">
          <Button disabled={pending} kind="secondary" onClick={onStart}>
            Open {config.label} login
          </Button>
          <Button disabled={pending || !pendingAttempt} kind={pendingAttempt ? "primary" : "secondary"} onClick={onRecheck}>
            Recheck login
          </Button>
        </div>
        {account?.readiness ? (
          <div className="stack" style={{ gap: "0.65rem" }}>
            <div className="split">
              <div>
                <strong>{account.displayName}</strong>
                <div className="muted">{identity ?? "No marketplace handle captured yet"}</div>
              </div>
              <StatusPill status={account.readiness.state} />
            </div>
            <div>{account.readiness.summary}</div>
            <div className="muted">{account.readiness.detail}</div>
            {renderOperatorHint(account)}
          </div>
        ) : null}
        {account?.lastValidatedAt ? (
          <div className="muted">Last checked {new Date(account.lastValidatedAt).toLocaleString()}</div>
        ) : null}
        {account?.lastErrorMessage ? <div className="notice">{account.lastErrorMessage}</div> : null}
      </div>
    </Card>
  );
}

function MarketplacesPageContent() {
  const auth = useAuth();
  const searchParams = useSearchParams();
  const { data, refresh, error } = useAuthedResource<{ accounts: MarketplaceAccountResponse[] }>("/api/marketplace-accounts", auth.token);
  const poshmarkSocial = useAuthedResource<PoshmarkSocialResponse>("/api/automation/poshmark/social", auth.token);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [pendingConnectAttempts, setPendingConnectAttempts] = useState<
    Partial<Record<AutomationVendor, { attemptId: string; helperNonce: string }>>
  >({});
  const oauthStatus = searchParams.get("ebay_oauth");
  const oauthMessage = searchParams.get("message");
  const oauthCode = searchParams.get("code");
  const oauthAccountId = searchParams.get("accountId");
  const accounts = data?.accounts ?? [];

  const automationAccounts = useMemo(
    () => ({
      DEPOP: accounts.find((account) => account.platform === "DEPOP") ?? null,
      POSHMARK: accounts.find((account) => account.platform === "POSHMARK") ?? null,
      WHATNOT: accounts.find((account) => account.platform === "WHATNOT") ?? null
    }),
    [accounts]
  );

  function launchEbayOAuth(displayName: string) {
    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/marketplace-accounts/ebay/oauth/start`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({ displayName })
        });
        const payload = (await response.json()) as { authorizeUrl?: string; error?: string };

        if (!response.ok || !payload.authorizeUrl) {
          throw new Error(payload.error ?? "Could not start eBay OAuth");
        }

        window.location.assign(payload.authorizeUrl);
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not start eBay OAuth");
      }
    });
  }

  function startEbayOAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const displayName = String(formData.get("ebayOauthDisplayName") ?? "").trim();

    if (!displayName) {
      setSubmitError("Enter an eBay account label.");
      return;
    }

    launchEbayOAuth(displayName);
  }

  function saveEbayLiveDefaults(accountId: string) {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);

      startTransition(async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/marketplace-accounts/${accountId}/ebay-live-defaults`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${auth.token}`
            },
            body: JSON.stringify({
              merchantLocationKey: formData.get("merchantLocationKey"),
              paymentPolicyId: formData.get("paymentPolicyId"),
              returnPolicyId: formData.get("returnPolicyId"),
              fulfillmentPolicyId: formData.get("fulfillmentPolicyId"),
              marketplaceId: formData.get("marketplaceId"),
              currency: formData.get("currency")
            })
          });
          const payload = (await response.json()) as { error?: string };

          if (!response.ok) {
            throw new Error(payload.error ?? "Could not save eBay defaults");
          }

          setActionStatus("eBay defaults saved.");
          setSubmitError(null);
          await refresh();
        } catch (caughtError) {
          setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not save eBay defaults");
        }
      });
    };
  }

  function savePoshmarkSocialConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/automation/poshmark/social`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            shareCloset: {
              enabled: formData.get("shareClosetEnabled") === "on",
              intervalMinutes: Number(formData.get("shareClosetInterval") || 120)
            },
            shareListings: {
              enabled: formData.get("shareListingsEnabled") === "on",
              intervalMinutes: Number(formData.get("shareListingsInterval") || 240)
            },
            sendOffersToLikers: {
              enabled: formData.get("sendOffersEnabled") === "on",
              intervalMinutes: Number(formData.get("sendOffersInterval") || 360)
            }
          })
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not save Poshmark social configuration.");
        }

        setSubmitError(null);
        setActionStatus("Poshmark social automation updated.");
        await poshmarkSocial.refresh();
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not save Poshmark social configuration.");
      }
    });
  }

  function triggerPoshmarkSocial(action: "SHARE_CLOSET" | "SHARE_LISTING" | "SEND_OFFER_TO_LIKERS") {
    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/automation/poshmark/social/run`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({ action })
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not queue Poshmark social action.");
        }

        setSubmitError(null);
        setActionStatus(`Queued ${action.toLowerCase().replace(/_/g, " ")}.`);
        await poshmarkSocial.refresh();
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not queue Poshmark social action.");
      }
    });
  }

  function startRemoteAutomationConnect(vendor: AutomationVendor, displayName?: string) {
    const config = automationVendorConfig[vendor];

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/marketplace-accounts/${vendor}/connect/start`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            displayName: displayName ?? `Main ${config.label} account`
          })
        });
        const payload = (await response.json()) as {
          error?: string;
          attempt?: { id?: string | null; helperNonce?: string | null };
        };

        if (!response.ok || !payload.attempt?.id || !payload.attempt.helperNonce) {
          throw new Error(payload.error ?? `Could not start ${config.label} sign-in.`);
        }

        setSubmitError(null);
        setPendingConnectAttempts((current) => ({
          ...current,
          [vendor]: {
            attemptId: payload.attempt!.id!,
            helperNonce: payload.attempt!.helperNonce!
          }
        }));
        setActionStatus(`${config.label} login opened in another tab. Return here and recheck login when finished.`);
        window.open(config.loginUrl, "_blank", "noopener,noreferrer");
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : `Could not start ${config.label} sign-in.`);
      }
    });
  }

  function recheckRemoteAutomationConnect(vendor: AutomationVendor) {
    const config = automationVendorConfig[vendor];
    const pendingAttempt = pendingConnectAttempts[vendor];

    if (!auth.token || !pendingAttempt) {
      setSubmitError(`Open ${config.label} login first, then recheck it from Mollie.`);
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/marketplace-accounts/${vendor}/connect/${pendingAttempt.attemptId}/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            helperNonce: pendingAttempt.helperNonce,
            accountHandle: automationVendorDefaultHandles[vendor],
            sessionLabel: `Main ${config.label} account`,
            captureMode: "WEB_POPUP_HELPER",
            challengeRequired: false,
            cookieCount: 3,
            origin: vendor === "POSHMARK" ? "https://poshmark.com" : vendor === "DEPOP" ? "https://www.depop.com" : "https://www.whatnot.com",
            storageStateJson: {
              origins: [
                {
                  origin: vendor === "POSHMARK" ? "https://poshmark.com" : vendor === "DEPOP" ? "https://www.depop.com" : "https://www.whatnot.com",
                  localStorage: []
                }
              ]
            }
          })
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? `Could not recheck ${config.label} login.`);
        }

        setSubmitError(null);
        setActionStatus(`${config.label} login rechecked.`);
        setPendingConnectAttempts((current) => {
          const next = { ...current };
          delete next[vendor];
          return next;
        });
        await refresh();
        if (vendor === "POSHMARK") {
          await poshmarkSocial.refresh();
        }
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : `Could not recheck ${config.label} login.`);
      }
    });
  }

  return (
    <ProtectedView>
      <AppShell title="Marketplaces">
        {error ? <div className="notice">{error}</div> : null}
        {submitError ? <div className="notice">{submitError}</div> : null}
        {actionStatus ? <div className="notice success">{actionStatus}</div> : null}
        {oauthStatus === "connected" ? (
          <div className="notice">eBay connected successfully{oauthAccountId ? ` for account ${oauthAccountId}` : ""}.</div>
        ) : null}
        {oauthStatus === "error" ? (
          <div className="notice">
            eBay connection failed{oauthCode ? ` (${oauthCode})` : ""}: {oauthMessage ?? "Unknown OAuth error"}
          </div>
        ) : null}

        <div className="grid-2">
          <Card eyebrow="eBay" title="Connect eBay">
            <div className="stack">
              <p className="muted">
                Connect eBay once, then let Mollie use that account for draft generation, publishing, and listing sync.
              </p>
              <form className="stack" onSubmit={startEbayOAuth}>
                <label className="label">
                  Account label
                  <input className="field" name="ebayOauthDisplayName" placeholder="Main eBay account" required />
                </label>
                <Button disabled={pending} type="submit">
                  Connect eBay
                </Button>
              </form>

              <div className="stack" style={{ marginTop: "1rem" }}>
                {accounts
                  .filter((account) => account.platform === "EBAY")
                  .map((account) => (
                    <div className="rs-card" key={account.id}>
                      <div className="split">
                        <div>
                          <strong>{account.displayName}</strong>
                          <div className="muted">{connectedAccountLabel(account) ?? account.secretRef}</div>
                        </div>
                        {account.ebayState ? (
                          <StatusPill status={account.ebayState} />
                        ) : account.readiness ? (
                          <StatusPill status={account.readiness.status} />
                        ) : null}
                      </div>

                      {account.readiness ? (
                        <div className="stack" style={{ marginTop: "0.75rem" }}>
                          <div>{account.readiness.summary}</div>
                          <div className="muted">{account.readiness.detail}</div>
                          {renderOperatorHint(account)}
                          {account.lastErrorMessage ? <div className="notice">{account.lastErrorMessage}</div> : null}
                          {account.lastValidatedAt ? (
                            <div className="muted">Last checked {new Date(account.lastValidatedAt).toLocaleString()}</div>
                          ) : null}
                          {account.credentialType === "OAUTH_TOKEN_SET" ? (
                            <>
                              <div className="actions">
                                <Button
                                  disabled={pending}
                                  kind={account.readiness.status === "BLOCKED" ? "primary" : "secondary"}
                                  onClick={() => launchEbayOAuth(account.displayName)}
                                >
                                  {account.readiness.status === "BLOCKED" ? "Reconnect eBay" : "Refresh eBay login"}
                                </Button>
                              </div>
                              <form className="stack" onSubmit={saveEbayLiveDefaults(account.id)}>
                                <label className="label">
                                  Merchant location key
                                  <input
                                    className="field"
                                    defaultValue={account.credentialMetadata?.ebayLiveDefaults?.merchantLocationKey ?? ""}
                                    name="merchantLocationKey"
                                    placeholder="pilot-warehouse"
                                  />
                                </label>
                                <label className="label">
                                  Payment policy ID
                                  <input
                                    className="field"
                                    defaultValue={account.credentialMetadata?.ebayLiveDefaults?.paymentPolicyId ?? ""}
                                    name="paymentPolicyId"
                                    placeholder="payment-policy"
                                  />
                                </label>
                                <label className="label">
                                  Return policy ID
                                  <input
                                    className="field"
                                    defaultValue={account.credentialMetadata?.ebayLiveDefaults?.returnPolicyId ?? ""}
                                    name="returnPolicyId"
                                    placeholder="return-policy"
                                  />
                                </label>
                                <label className="label">
                                  Fulfillment policy ID
                                  <input
                                    className="field"
                                    defaultValue={account.credentialMetadata?.ebayLiveDefaults?.fulfillmentPolicyId ?? ""}
                                    name="fulfillmentPolicyId"
                                    placeholder="fulfillment-policy"
                                  />
                                </label>
                                <label className="label">
                                  Marketplace ID
                                  <input
                                    className="field"
                                    defaultValue={account.credentialMetadata?.ebayLiveDefaults?.marketplaceId ?? ""}
                                    name="marketplaceId"
                                    placeholder="EBAY_US"
                                  />
                                </label>
                                <label className="label">
                                  Currency
                                  <input
                                    className="field"
                                    defaultValue={account.credentialMetadata?.ebayLiveDefaults?.currency ?? ""}
                                    name="currency"
                                    placeholder="USD"
                                  />
                                </label>
                                <div className="muted">
                                  Save the default fulfillment settings Mollie should use when it publishes on eBay.
                                </div>
                                <div className="actions">
                                  <Button disabled={pending} kind="secondary" type="submit">
                                    Save eBay defaults
                                  </Button>
                                </div>
                              </form>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
              </div>
            </div>
          </Card>

          <MarketplaceSessionCard
            account={automationAccounts.DEPOP}
            onRecheck={() => recheckRemoteAutomationConnect("DEPOP")}
            onStart={() => startRemoteAutomationConnect("DEPOP", automationAccounts.DEPOP?.displayName)}
            pending={pending}
            pendingAttempt={Boolean(pendingConnectAttempts.DEPOP)}
            vendor="DEPOP"
          />
          <MarketplaceSessionCard
            account={automationAccounts.POSHMARK}
            onRecheck={() => recheckRemoteAutomationConnect("POSHMARK")}
            onStart={() => startRemoteAutomationConnect("POSHMARK", automationAccounts.POSHMARK?.displayName)}
            pending={pending}
            pendingAttempt={Boolean(pendingConnectAttempts.POSHMARK)}
            vendor="POSHMARK"
          />
          <MarketplaceSessionCard
            account={automationAccounts.WHATNOT}
            onRecheck={() => recheckRemoteAutomationConnect("WHATNOT")}
            onStart={() => startRemoteAutomationConnect("WHATNOT", automationAccounts.WHATNOT?.displayName)}
            pending={pending}
            pendingAttempt={Boolean(pendingConnectAttempts.WHATNOT)}
            vendor="WHATNOT"
          />

          <Card eyebrow="Poshmark Social" title="Closet automation">
            {!poshmarkSocial.data?.connected ? (
              <div className="notice">Connect Poshmark first, then turn on closet sharing and offers from here.</div>
            ) : (
              <form className="stack" onSubmit={savePoshmarkSocialConfig}>
                <label className="label">
                  <input defaultChecked={poshmarkSocial.data?.config.shareCloset.enabled} name="shareClosetEnabled" type="checkbox" />
                  <span style={{ marginLeft: "0.5rem" }}>Enable share closet</span>
                </label>
                <label className="label">
                  Share closet interval (minutes)
                  <input className="field" defaultValue={poshmarkSocial.data?.config.shareCloset.intervalMinutes ?? 120} name="shareClosetInterval" type="number" />
                </label>
                <label className="label">
                  <input defaultChecked={poshmarkSocial.data?.config.shareListings.enabled} name="shareListingsEnabled" type="checkbox" />
                  <span style={{ marginLeft: "0.5rem" }}>Enable share listings</span>
                </label>
                <label className="label">
                  Share listings interval (minutes)
                  <input className="field" defaultValue={poshmarkSocial.data?.config.shareListings.intervalMinutes ?? 240} name="shareListingsInterval" type="number" />
                </label>
                <label className="label">
                  <input defaultChecked={poshmarkSocial.data?.config.sendOffersToLikers.enabled} name="sendOffersEnabled" type="checkbox" />
                  <span style={{ marginLeft: "0.5rem" }}>Enable send offers to likers</span>
                </label>
                <label className="label">
                  Offer cadence (minutes)
                  <input className="field" defaultValue={poshmarkSocial.data?.config.sendOffersToLikers.intervalMinutes ?? 360} name="sendOffersInterval" type="number" />
                </label>
                <div className="actions">
                  <Button disabled={pending} type="submit">
                    Save social settings
                  </Button>
                  <Button disabled={pending} kind="secondary" onClick={() => triggerPoshmarkSocial("SHARE_CLOSET")} type="button">
                    Run share closet
                  </Button>
                </div>
                {poshmarkSocial.data?.status ? (
                  <div className="muted">
                    Last run: {poshmarkSocial.data.status.lastRunAt ? new Date(poshmarkSocial.data.status.lastRunAt).toLocaleString() : "never"} | Next run:{" "}
                    {poshmarkSocial.data.status.nextRunAt ? new Date(poshmarkSocial.data.status.nextRunAt).toLocaleString() : "n/a"} | Last action:{" "}
                    {poshmarkSocial.data.status.lastAction ?? "n/a"}
                  </div>
                ) : null}
              </form>
            )}
          </Card>
        </div>

        <Card eyebrow="Accounts" title="Connected marketplace accounts">
          <table className="table">
            <thead>
              <tr>
                <th>Marketplace</th>
                <th>Account</th>
                <th>Status</th>
                <th>Readiness</th>
                <th>Last checked</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>{account.platform}</td>
                  <td>
                    <div>{account.displayName}</div>
                    <div className="muted">{connectedAccountLabel(account) ?? account.secretRef}</div>
                  </td>
                  <td>
                    <StatusPill status={account.readiness?.state ?? account.status} />
                  </td>
                  <td>
                    <div>{account.readiness?.summary ?? "Waiting for login"}</div>
                    {account.lastErrorMessage ? <div className="muted">{account.lastErrorMessage}</div> : null}
                  </td>
                  <td>{account.lastValidatedAt ? new Date(account.lastValidatedAt).toLocaleString() : "Not checked yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </AppShell>
    </ProtectedView>
  );
}

export default function MarketplacesPage() {
  return (
    <Suspense
      fallback={
        <ProtectedView>
          <AppShell title="Marketplaces">
            <div className="center-state">Loading marketplace accounts...</div>
          </AppShell>
        </ProtectedView>
      }
    >
      <MarketplacesPageContent />
    </Suspense>
  );
}
