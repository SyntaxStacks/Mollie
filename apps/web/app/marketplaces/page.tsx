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
    accounts: Array<{ id: string; platform: string; displayName: string; status: string; secretRef: string }>;
  }>("/api/marketplace-accounts", auth.token);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

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
            <form className="stack" onSubmit={connect("EBAY")}>
              <label className="label">
                Display name
                <input className="field" name="ebayDisplayName" placeholder="Main eBay account" required />
              </label>
              <label className="label">
                Secret reference
                <input className="field" name="ebaySecretRef" placeholder="secret://ebay/main" required />
              </label>
              <Button type="submit" disabled={pending}>
                Connect eBay
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
                <th>Secret ref</th>
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
                  <td>{account.secretRef}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </AppShell>
    </ProtectedView>
  );
}
