"use client";

import Link from "next/link";
import { FormEvent, useState, useTransition } from "react";

import { Button, Card, StatusPill } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { ProtectedView } from "../../components/protected-view";
import { useAuth } from "../../components/auth-provider";
import { currency, useAuthedResource } from "../../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function LotsPage() {
  const auth = useAuth();
  const { data, error, refresh } = useAuthedResource<{
    lots: Array<{
      id: string;
      title: string;
      status: string;
      sourceUrl: string;
      recommendedMaxBid: number | null;
      estimatedResaleMin: number | null;
      estimatedResaleMax: number | null;
    }>;
  }>("/api/source-lots", auth.token);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/source-lots/macbid`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            url: formData.get("url"),
            titleHint: formData.get("titleHint")
          })
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not import lot");
        }

        setSubmitError(null);
        event.currentTarget.reset();
        await refresh();
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not import lot");
      }
    });
  }

  return (
    <ProtectedView>
      <AppShell title="Mac.bid Source Lots">
        <div className="grid-2">
          <Card eyebrow="Ingest" title="Add a Mac.bid lot URL">
            <form className="stack" onSubmit={handleImport}>
              <label className="label">
                Lot URL
                <input className="field" name="url" placeholder="https://www.mac.bid/..." required />
              </label>
              <label className="label">
                Optional title hint
                <input className="field" name="titleHint" placeholder="Sealed Nike sneakers lot" />
              </label>
              {submitError ? <div className="notice">{submitError}</div> : null}
              <Button type="submit" disabled={pending}>
                {pending ? "Importing…" : "Import lot"}
              </Button>
            </form>
          </Card>

          <Card eyebrow="Rule" title="MVP sourcing posture">
            <p className="muted">
              The lot flow is human-in-the-loop. Import the lot, inspect valuation, then convert only viable lots into
              inventory. No autonomous bidding is enabled in MVP.
            </p>
          </Card>
        </div>

        <Card eyebrow="Queue" title="Imported lots">
          {error ? <div className="notice">{error}</div> : null}
          <table className="table">
            <thead>
              <tr>
                <th>Lot</th>
                <th>Status</th>
                <th>Resale range</th>
                <th>Max bid</th>
              </tr>
            </thead>
            <tbody>
              {(data?.lots ?? []).map((lot) => (
                <tr key={lot.id}>
                  <td>
                    <Link href={`/lots/${lot.id}`}>{lot.title}</Link>
                    <div className="muted">{lot.sourceUrl}</div>
                  </td>
                  <td>
                    <StatusPill status={lot.status} />
                  </td>
                  <td>
                    {currency(lot.estimatedResaleMin)} to {currency(lot.estimatedResaleMax)}
                  </td>
                  <td>{currency(lot.recommendedMaxBid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </AppShell>
    </ProtectedView>
  );
}
