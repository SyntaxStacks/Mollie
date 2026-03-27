"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState, useTransition } from "react";

import { Button, Card, StatusPill } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { ProtectedView } from "../../components/protected-view";
import { useAuth } from "../../components/auth-provider";
import { useAuthedResource } from "../../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function MarketplacesPageContent() {
  const auth = useAuth();
  const searchParams = useSearchParams();
  const { data, refresh, error } = useAuthedResource<{
    accounts: Array<{
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
      } | null;
    }>;
  }>("/api/marketplace-accounts", auth.token);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const oauthStatus = searchParams.get("ebay_oauth");
  const oauthMessage = searchParams.get("message");
  const oauthCode = searchParams.get("code");
  const oauthAccountId = searchParams.get("accountId");
  const accounts = data?.accounts ?? [];

  function renderAutomationAccounts(platform: "DEPOP" | "POSHMARK" | "WHATNOT") {
    const platformAccounts = accounts.filter((account) => account.platform === platform);

    if (platformAccounts.length === 0) {
      return null;
    }

    return (
      <div className="stack" style={{ marginTop: "1rem" }}>
        {platformAccounts.map((account) => (
          <div className="rs-card" key={account.id}>
            <div className="split">
              <div>
                <strong>{account.displayName}</strong>
                <div className="muted">{account.externalAccountId ?? account.secretRef}</div>
              </div>
              {account.readiness ? <StatusPill status={account.readiness.state} /> : <StatusPill status={account.status} />}
            </div>
            {account.readiness ? (
              <div className="stack" style={{ marginTop: "0.75rem" }}>
                <div className="muted">
                  State: {account.readiness.state} | Active mode: {account.readiness.publishMode}
                </div>
                <div>{account.readiness.summary}</div>
                <div className="muted">{account.readiness.detail}</div>
                {account.lastErrorMessage ? <div className="notice">{account.lastErrorMessage}</div> : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  useEffect(() => {
    if (oauthStatus === "connected") {
      void refresh();
    }
  }, [oauthStatus, refresh]);

  function launchEbayOAuth(displayName: string) {
    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/marketplace-accounts/ebay/oauth/start`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            displayName
          })
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

  function connect(platform: "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT") {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);

      startTransition(async () => {
        try {
          const route =
            platform === "EBAY"
              ? "ebay/connect"
              : platform === "DEPOP"
                ? "depop/session"
                : platform === "POSHMARK"
                  ? "poshmark/session"
                  : "whatnot/session";
          const response = await fetch(
            `${API_BASE_URL}/api/marketplace-accounts/${route}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${auth.token}`
              },
              body: JSON.stringify({
                displayName: formData.get(`${platform.toLowerCase()}DisplayName`),
                secretRef: formData.get(`${platform.toLowerCase()}SecretRef`)
              })
            }
          );
          const payload = (await response.json()) as { error?: string };

          if (!response.ok) {
            throw new Error(payload.error ?? "Could not connect account");
          }

          setSubmitError(null);
          await refresh();
          form.reset();
        } catch (caughtError) {
          setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not connect account");
        }
      });
    };
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

          setSubmitError(null);
          await refresh();
        } catch (caughtError) {
          setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not save eBay live defaults");
        }
      });
    };
  }

  return (
    <ProtectedView>
      <AppShell title="Marketplace Accounts">
        {error ? <div className="notice">{error}</div> : null}
        {submitError ? <div className="notice">{submitError}</div> : null}
        {oauthStatus === "connected" ? (
          <div className="notice">
            eBay OAuth connected successfully{oauthAccountId ? ` for account ${oauthAccountId}` : ""}.
          </div>
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
              <Button type="submit" disabled={pending}>
                Start eBay OAuth
              </Button>
            </form>

            <div className="notice">
              OAuth now validates a real eBay account and stores encrypted tokens. Live eBay publish is still gated, so the
              manual secret-ref connector remains available for simulated pilot publish jobs.
            </div>

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
                      {account.ebayState ? <StatusPill status={account.ebayState} /> : account.readiness ? <StatusPill status={account.readiness.status} /> : null}
                    </div>
                    {account.readiness ? (
                      <div className="stack" style={{ marginTop: "0.75rem" }}>
                        <div className="muted">
                          State: {account.readiness.state} | Active mode: {account.readiness.publishMode}
                        </div>
                        <div>{account.readiness.summary}</div>
                        <div className="muted">{account.readiness.detail}</div>
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
                                These defaults are stored on the eBay account and used for live publish before env fallbacks.
                              </div>
                              <div className="actions">
                                <Button disabled={pending} kind="secondary" type="submit">
                                  Save live defaults
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

            <form className="stack" onSubmit={connect("EBAY")}>
              <label className="label">
                Manual display name
                <input className="field" name="ebayDisplayName" placeholder="Simulated eBay account" required />
              </label>
              <label className="label">
                Manual secret reference
                <input className="field" name="ebaySecretRef" placeholder="secret://ebay/main" required />
              </label>
              <Button type="submit" disabled={pending}>
                Connect simulated eBay
              </Button>
            </form>
          </Card>

          <Card eyebrow="Depop" title="Automation connector">
            <form className="stack" onSubmit={connect("DEPOP")}>
              <label className="label">
                Display name
                <input className="field" name="depopDisplayName" placeholder="Main Depop shop" required />
              </label>
              <label className="label">
                Session secret reference
                <input className="field" name="depopSecretRef" placeholder="secret://depop/session" required />
              </label>
              <Button type="submit" disabled={pending}>
                Connect Depop
              </Button>
            </form>
            {renderAutomationAccounts("DEPOP")}
          </Card>

          <Card eyebrow="Poshmark" title="Automation connector">
            <form className="stack" onSubmit={connect("POSHMARK")}>
              <label className="label">
                Display name
                <input className="field" name="poshmarkDisplayName" placeholder="Main Poshmark closet" required />
              </label>
              <label className="label">
                Session secret reference
                <input className="field" name="poshmarkSecretRef" placeholder="secret://poshmark/session" required />
              </label>
              <Button type="submit" disabled={pending}>
                Connect Poshmark
              </Button>
            </form>
            <div className="notice">Poshmark is currently handled through isolated automation, like Depop.</div>
            {renderAutomationAccounts("POSHMARK")}
          </Card>

          <Card eyebrow="Whatnot" title="Automation connector">
            <form className="stack" onSubmit={connect("WHATNOT")}>
              <label className="label">
                Display name
                <input className="field" name="whatnotDisplayName" placeholder="Main Whatnot account" required />
              </label>
              <label className="label">
                Session secret reference
                <input className="field" name="whatnotSecretRef" placeholder="secret://whatnot/session" required />
              </label>
              <Button type="submit" disabled={pending}>
                Connect Whatnot
              </Button>
            </form>
            <div className="notice">Whatnot is currently handled through isolated automation, like Depop.</div>
            {renderAutomationAccounts("WHATNOT")}
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
                          {account.readiness.summary} ({account.readiness.publishMode})
                        </div>
                      </div>
                    ) : (
                      <span className="muted">n/a</span>
                    )}
                  </td>
                  <td>
                    <div>{account.credentialMetadata?.username ?? account.externalAccountId ?? account.secretRef}</div>
                    {account.lastValidatedAt ? (
                      <div className="muted">Last validated: {new Date(account.lastValidatedAt).toLocaleString()}</div>
                    ) : null}
                    {account.lastErrorMessage ? <div className="muted">{account.lastErrorMessage}</div> : null}
                  </td>
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
          <AppShell title="Marketplace Accounts">
            <div className="center-state">Loading marketplace accounts...</div>
          </AppShell>
        </ProtectedView>
      }
    >
      <MarketplacesPageContent />
    </Suspense>
  );
}
