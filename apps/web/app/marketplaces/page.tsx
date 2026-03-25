"use client";

import { FormEvent, useState, useTransition } from "react";

import { Button, Card, StatusPill } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { ProtectedView } from "../../components/protected-view";
import { useAuth } from "../../components/auth-provider";
import { useAuthedResource } from "../../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function MarketplacesPage() {
  const auth = useAuth();
  const { data, refresh, error } = useAuthedResource<{
    accounts: Array<{
      id: string;
      platform: string;
      displayName: string;
      status: string;
      secretRef: string;
      credentialType: string;
      validationStatus: string;
      externalAccountId: string | null;
      credentialMetadata?: { publishMode?: string; username?: string } | null;
      lastValidatedAt?: string | null;
      lastErrorMessage?: string | null;
      readiness?: {
        status: string;
        summary: string;
        detail: string;
      } | null;
    }>;
  }>("/api/marketplace-accounts", auth.token);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  function connect(platform: "EBAY" | "DEPOP") {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);

      startTransition(async () => {
        try {
          const response = await fetch(
            `${API_BASE_URL}/api/marketplace-accounts/${platform === "EBAY" ? "ebay/connect" : "depop/session"}`,
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
          event.currentTarget.reset();
        } catch (caughtError) {
          setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not connect account");
        }
      });
    };
  }

  return (
    <ProtectedView>
      <AppShell title="Marketplace Accounts">
        {error ? <div className="notice">{error}</div> : null}
        {submitError ? <div className="notice">{submitError}</div> : null}
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
              {(data?.accounts ?? [])
                .filter((account) => account.platform === "EBAY")
                .map((account) => (
                  <div className="rs-card" key={account.id}>
                    <div className="split">
                      <div>
                        <strong>{account.displayName}</strong>
                        <div className="muted">{account.credentialMetadata?.username ?? account.externalAccountId ?? account.secretRef}</div>
                      </div>
                      {account.readiness ? <StatusPill status={account.readiness.status} /> : null}
                    </div>
                    {account.readiness ? (
                      <div className="stack" style={{ marginTop: "0.75rem" }}>
                        <div>{account.readiness.summary}</div>
                        <div className="muted">{account.readiness.detail}</div>
                        {account.lastErrorMessage ? <div className="notice">{account.lastErrorMessage}</div> : null}
                        {account.credentialType === "OAUTH_TOKEN_SET" ? (
                          <div className="actions">
                            <Button
                              disabled={pending}
                              kind={account.readiness.status === "BLOCKED" ? "primary" : "secondary"}
                              onClick={() => launchEbayOAuth(account.displayName)}
                            >
                              {account.readiness.status === "BLOCKED" ? "Reconnect eBay OAuth" : "Refresh eBay OAuth"}
                            </Button>
                          </div>
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
              {(data?.accounts ?? []).map((account) => (
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
                        <StatusPill status={account.readiness.status} />
                        <div className="muted" style={{ marginTop: "0.35rem" }}>
                          {account.readiness.summary}
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
