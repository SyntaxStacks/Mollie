"use client";

import { useParams } from "next/navigation";
import { useTransition } from "react";

import { Button, Card, StatusPill } from "@reselleros/ui";

import { AppShell } from "../../../components/app-shell";
import { ProtectedView } from "../../../components/protected-view";
import { useAuth } from "../../../components/auth-provider";
import { currency, useAuthedResource } from "../../../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function LotDetailPage() {
  const auth = useAuth();
  const params = useParams<{ id: string }>();
  const [pending, startTransition] = useTransition();
  const { data, error, refresh } = useAuthedResource<{
    lot: {
      id: string;
      title: string;
      status: string;
      sourceUrl: string;
      estimatedResaleMin: number | null;
      estimatedResaleMax: number | null;
      recommendedMaxBid: number | null;
      confidenceScore: number | null;
      riskScore: number | null;
      analysisSummary: string | null;
      analysisRationaleJson: string[] | null;
      inventoryItems: Array<{ id: string; title: string; status: string }>;
    };
  }>(`/api/source-lots/${params.id}`, auth.token, [params.id]);

  async function runAction(path: string) {
    startTransition(async () => {
      await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`
        }
      });
      await refresh();
    });
  }

  return (
    <ProtectedView>
      <AppShell title="Lot Detail">
        {error ? <div className="notice">{error}</div> : null}
        {!data ? (
          <div className="center-state">Loading lot…</div>
        ) : (
          <>
            <Card eyebrow="Mac.bid lot" title={data.lot.title} action={<StatusPill status={data.lot.status} />}>
              <div className="grid-4">
                <div className="metric">
                  <span className="muted">Resale low</span>
                  <strong>{currency(data.lot.estimatedResaleMin)}</strong>
                </div>
                <div className="metric">
                  <span className="muted">Resale high</span>
                  <strong>{currency(data.lot.estimatedResaleMax)}</strong>
                </div>
                <div className="metric">
                  <span className="muted">Max bid</span>
                  <strong>{currency(data.lot.recommendedMaxBid)}</strong>
                </div>
                <div className="metric">
                  <span className="muted">Confidence / risk</span>
                  <strong>
                    {data.lot.confidenceScore ?? 0}/{data.lot.riskScore ?? 0}
                  </strong>
                </div>
              </div>
              <p className="muted">{data.lot.analysisSummary ?? "Analysis pending. Queue a regeneration if needed."}</p>
              <div className="actions">
                <Button disabled={pending} onClick={() => void runAction(`/api/source-lots/${data.lot.id}/analyze`)}>
                  Regenerate analysis
                </Button>
                <Button
                  disabled={pending}
                  kind="secondary"
                  onClick={() => void runAction(`/api/source-lots/${data.lot.id}/create-inventory`)}
                >
                  Create inventory from lot
                </Button>
              </div>
            </Card>

            <div className="grid-2">
              <Card eyebrow="Rationale" title="Why this bid ceiling">
                <div className="stack muted">
                  {(data.lot.analysisRationaleJson ?? []).map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
              </Card>

              <Card eyebrow="Derived inventory" title="Items created from this lot">
                <div className="stack">
                  {data.lot.inventoryItems.length === 0 ? (
                    <p className="muted">No inventory items created yet.</p>
                  ) : (
                    data.lot.inventoryItems.map((item) => (
                      <div className="split" key={item.id}>
                        <span>{item.title}</span>
                        <StatusPill status={item.status} />
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>
          </>
        )}
      </AppShell>
    </ProtectedView>
  );
}
