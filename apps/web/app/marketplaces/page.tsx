"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useMemo, useState, useTransition } from "react";

import type { AutomationVendor, OperatorHint } from "@reselleros/types";
import { Button, Card, StatusPill } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { OperatorHintCard } from "../../components/operator-hint-card";
import { ProtectedView } from "../../components/protected-view";
import { useAuth } from "../../components/auth-provider";
import { HostedMarketplaceSigninModal } from "../../components/hosted-marketplace-signin-modal";
import { useAuthedResource } from "../../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const simulatedMarketplacePathsAllowed =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ALLOW_SIMULATED_MARKETPLACE_PATHS === "true";

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
  connectorDescriptor?: {
    executionMode: string;
    fallbackMode: string;
    riskLevel: string;
    rateLimitStrategy: string;
    supportedCapabilities: Array<{
      capability: string;
      support: string;
      detail: string;
    }>;
    supportedFeatureFamilies: Array<{
      family: string;
      support: string;
      detail: string;
    }>;
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

function renderConnectorDescriptor(account: { connectorDescriptor?: MarketplaceAccountResponse["connectorDescriptor"] | null }) {
  const descriptor = account.connectorDescriptor;

  if (!descriptor) {
    return null;
  }

  const visibleCapabilities = descriptor.supportedCapabilities.filter((entry) => entry.support !== "UNSUPPORTED");
  const visibleFamilies = descriptor.supportedFeatureFamilies.filter((entry) => entry.support !== "UNSUPPORTED");

  return (
    <div className="stack" style={{ marginTop: "0.75rem" }}>
      <div className="muted">
        Execution mode: {descriptor.executionMode} | Fallback: {descriptor.fallbackMode} | Risk: {descriptor.riskLevel} |
        Rate limit: {descriptor.rateLimitStrategy}
      </div>
      <div className="stack" style={{ gap: "0.45rem" }}>
        <div className="muted">Shared capabilities</div>
        <div className="inline-actions">
          {visibleCapabilities.map((entry) => (
            <span className="execution-inline-code" key={`${entry.capability}-${entry.support}`} title={entry.detail}>
              {entry.capability} · {entry.support}
            </span>
          ))}
        </div>
      </div>
      {visibleFamilies.length > 0 ? (
        <div className="stack" style={{ gap: "0.45rem" }}>
          <div className="muted">Marketplace-native feature families</div>
          <div className="inline-actions">
            {visibleFamilies.map((entry) => (
              <span className="execution-inline-code" key={`${entry.family}-${entry.support}`} title={entry.detail}>
                {entry.family} · {entry.support}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderOperatorHint(account: { readiness?: { hint?: OperatorHint | null } | null }) {
  return <OperatorHintCard hint={account.readiness?.hint} />;
}

function MarketplacesPageContent() {
  const auth = useAuth();
  const searchParams = useSearchParams();
  const { data, refresh, error } = useAuthedResource<{ accounts: MarketplaceAccountResponse[] }>("/api/marketplace-accounts", auth.token);
  const poshmarkSocial = useAuthedResource<PoshmarkSocialResponse>("/api/automation/poshmark/social", auth.token);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [hostedSignInAttempt, setHostedSignInAttempt] = useState<{ vendor: AutomationVendor; attemptId: string } | null>(null);
  const oauthStatus = searchParams.get("ebay_oauth");
  const oauthMessage = searchParams.get("message");
  const oauthCode = searchParams.get("code");
  const oauthAccountId = searchParams.get("accountId");
  const accounts = data?.accounts ?? [];

  const automationAccounts = useMemo(
    () => ({
      DEPOP: accounts.filter((account) => account.platform === "DEPOP"),
      POSHMARK: accounts.filter((account) => account.platform === "POSHMARK"),
      WHATNOT: accounts.filter((account) => account.platform === "WHATNOT")
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
      setSubmitError("Enter an eBay OAuth display name.");
      return;
    }

    launchEbayOAuth(displayName);
  }

  function connectSimulatedEbay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/marketplace-accounts/ebay/connect`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            displayName: formData.get("ebayDisplayName"),
            secretRef: formData.get("ebaySecretRef")
          })
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not connect simulated eBay account");
        }

        setSubmitError(null);
        setActionStatus("Manual eBay account connected.");
        form.reset();
        await refresh();
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not connect simulated eBay account");
      }
    });
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
            throw new Error(payload.error ?? "Could not save eBay live defaults");
          }

          setActionStatus("eBay defaults saved.");
          setSubmitError(null);
          await refresh();
        } catch (caughtError) {
          setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not save eBay live defaults");
        }
      });
    };
  }

  function openImports() {
    window.location.assign("/imports");
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
          attempt?: { id?: string | null };
        };

        if (!response.ok || !payload.attempt?.id) {
          throw new Error(payload.error ?? `Could not start ${config.label} hosted sign-in.`);
        }

        setSubmitError(null);
        setActionStatus(`Hosted ${config.label} sign-in is ready in Mollie.`);
        setHostedSignInAttempt({
          vendor,
          attemptId: payload.attempt.id
        });
        window.open(config.loginUrl, "_blank");
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : `Could not start ${config.label} hosted sign-in.`);
      }
    });
  }

  function renderAutomationCard(vendor: AutomationVendor) {
    const config = automationVendorConfig[vendor];
    const account = automationAccounts[vendor][0] ?? null;
    const isConnected = account?.status === "CONNECTED" && account.readiness?.status === "READY";
    const accountIdentity = account?.credentialMetadata?.accountHandle ?? account?.externalAccountId ?? account?.displayName ?? null;

    return (
      <Card eyebrow={config.label} title={isConnected ? "Connected" : "Login required"}>
        <div className="stack">
          <div className={isConnected ? "notice success" : "notice"}>
            {isConnected
              ? `Logged in as ${accountIdentity ?? account?.displayName ?? config.label}.`
              : `Open ${config.label} in another tab, finish login there, then recheck it from Mollie.`}
          </div>
          <div className="muted">{config.label} uses Mollie's hosted remote sign-in and automation runtime.</div>
          <div className="actions">
            <a className="public-doc-link" href={config.loginUrl} rel="noreferrer" target="_blank">
              Open {config.label} login
            </a>
            <Button disabled={pending} kind="secondary" onClick={() => startRemoteAutomationConnect(vendor, account?.displayName)}>
              Open {config.label} login
            </Button>
            <Button disabled={pending} kind="secondary" onClick={openImports}>
              Import inventory
            </Button>
          </div>
          {account?.readiness ? (
            <div className="stack" style={{ gap: "0.65rem" }}>
              <div className="split">
                <div>
                  <strong>{account.displayName}</strong>
                  <div className="muted">{accountIdentity ?? "No account label detected yet"}</div>
                </div>
                <StatusPill status={account.readiness.state} />
              </div>
              <div>{account.readiness.summary}</div>
              <div className="muted">{account.readiness.detail}</div>
              {renderOperatorHint(account)}
              {renderConnectorDescriptor(account)}
            </div>
          ) : null}
          {account?.lastValidatedAt ? (
            <div className="muted">Last validated {new Date(account.lastValidatedAt).toLocaleString()}</div>
          ) : null}
          {account?.lastErrorMessage ? <div className="notice">{account.lastErrorMessage}</div> : null}
        </div>
      </Card>
    );
  }

  return (
    <ProtectedView>
      <AppShell title="Marketplaces">
        {error ? <div className="notice">{error}</div> : null}
        {submitError ? <div className="notice">{submitError}</div> : null}
        {actionStatus ? <div className="notice success">{actionStatus}</div> : null}
        {oauthStatus === "connected" ? (
          <div className="notice">eBay OAuth connected successfully{oauthAccountId ? ` for account ${oauthAccountId}` : ""}.</div>
        ) : null}
        {oauthStatus === "error" ? (
          <div className="notice">
            eBay OAuth failed{oauthCode ? ` (${oauthCode})` : ""}: {oauthMessage ?? "Unknown OAuth error"}
          </div>
        ) : null}

        <div className="grid-2">
          <Card eyebrow="eBay" title="Primary connector">
            <form className="stack" onSubmit={startEbayOAuth}>
              <label className="label">
                OAuth display name
                <input className="field" name="ebayOauthDisplayName" placeholder="Main eBay account" required />
              </label>
              <Button disabled={pending} type="submit">
                Start eBay OAuth
              </Button>
            </form>

            <div className="notice">OAuth validates the eBay account and stores the credentials Mollie needs to publish.</div>

            <div className="stack" style={{ marginTop: "1rem" }}>
              {accounts
                .filter((account) => account.platform === "EBAY")
                .map((account) => (
                  <div className="rs-card" key={account.id}>
                    <div className="split">
                      <div>
                        <strong>{account.displayName}</strong>
                        <div className="muted">{account.credentialMetadata?.username ?? account.externalAccountId ?? account.secretRef}</div>
                      </div>
                      {account.ebayState ? (
                        <StatusPill status={account.ebayState} />
                      ) : account.readiness ? (
                        <StatusPill status={account.readiness.status} />
                      ) : null}
                    </div>
                    {account.readiness ? (
                      <div className="stack" style={{ marginTop: "0.75rem" }}>
                        <div className="muted">State: {account.readiness.state}</div>
                        <div>{account.readiness.summary}</div>
                        <div className="muted">{account.readiness.detail}</div>
                        {renderOperatorHint(account)}
                        {renderConnectorDescriptor(account)}
                        {account.lastErrorMessage ? <div className="notice">{account.lastErrorMessage}</div> : null}
                        {account.credentialType === "OAUTH_TOKEN_SET" ? (
                          <>
                            <div className="actions">
                              <Button
                                disabled={pending}
                                kind={account.readiness.status === "BLOCKED" ? "primary" : "secondary"}
                                onClick={() => launchEbayOAuth(account.displayName)}
                              >
                                {account.readiness.status === "BLOCKED" ? "Reconnect eBay OAuth" : "Refresh eBay OAuth"}
                              </Button>
                              <Button disabled={pending} kind="secondary" onClick={openImports}>
                                Import inventory
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
                              <div className="muted">These defaults are stored on the eBay account and used when Mollie publishes listings.</div>
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

            {simulatedMarketplacePathsAllowed ? (
              <form className="stack" onSubmit={connectSimulatedEbay}>
                <label className="label">
                  Manual display name
                  <input className="field" name="ebayDisplayName" placeholder="Legacy eBay account" required />
                </label>
                <label className="label">
                  Manual secret reference
                  <input className="field" name="ebaySecretRef" placeholder="secret://ebay/main" required />
                </label>
                <Button disabled={pending} type="submit">
                  Connect manual eBay account
                </Button>
              </form>
            ) : null}
          </Card>

          {renderAutomationCard("DEPOP")}
          {renderAutomationCard("POSHMARK")}
          {renderAutomationCard("WHATNOT")}
          <Card eyebrow="Poshmark Social" title="Closet automation">
            {!poshmarkSocial.data?.connected ? (
              <div className="notice">Connect a Poshmark account before enabling social automation.</div>
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

        <Card eyebrow="Connections" title="Connected marketplace accounts">
          <table className="table">
            <thead>
              <tr>
                <th>Platform</th>
                <th>Display name</th>
                <th>Status</th>
                <th>Auth</th>
                <th>Validation</th>
                <th>Readiness</th>
                <th>Account</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>{account.platform}</td>
                  <td>{account.displayName}</td>
                  <td>
                    <StatusPill status={account.status} />
                  </td>
                  <td>{account.credentialType}</td>
                  <td>{account.validationStatus}</td>
                  <td>
                    {account.readiness ? (
                      <div>
                        <StatusPill status={account.readiness.state} />
                        <div className="muted" style={{ marginTop: "0.35rem" }}>
                          {account.readiness.summary}
                        </div>
                      </div>
                    ) : (
                      <span className="muted">n/a</span>
                    )}
                  </td>
                  <td>
                    <div>{account.credentialMetadata?.username ?? account.credentialMetadata?.accountHandle ?? account.externalAccountId ?? account.secretRef}</div>
                    {account.lastValidatedAt ? <div className="muted">Last validated: {new Date(account.lastValidatedAt).toLocaleString()}</div> : null}
                    {account.lastErrorMessage ? <div className="muted">{account.lastErrorMessage}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <HostedMarketplaceSigninModal
          attemptId={hostedSignInAttempt?.attemptId ?? ""}
          onClose={() => setHostedSignInAttempt(null)}
          onConnected={() => {
            void refresh();
            void poshmarkSocial.refresh();
          }}
          open={Boolean(hostedSignInAttempt)}
          token={auth.token}
          vendor={hostedSignInAttempt?.vendor ?? "POSHMARK"}
        />
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
