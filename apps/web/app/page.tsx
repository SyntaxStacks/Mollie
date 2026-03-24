"use client";

import Link from "next/link";

import { Card, StatusPill } from "@reselleros/ui";

import { AppShell } from "../components/app-shell";
import { ProtectedView } from "../components/protected-view";
import { useAuth } from "../components/auth-provider";
import { currency, useAuthedResource } from "../lib/api";

export default function DashboardPage() {
  const auth = useAuth();
  const { data, loading, error } = useAuthedResource<{
    summary: {
      inventoryCount: number;
      listedCount: number;
      soldCount: number;
      pendingDrafts: number;
      totalRevenue: number;
      totalMargin: number;
    };
    inventory: Array<{ id: string; title: string; status: string; priceRecommendation: number | null }>;
    lots: Array<{ id: string; title: string; status: string; recommendedMaxBid: number | null }>;
  }>("/api/analytics/pnl", auth.token);

  return (
    <ProtectedView>
      <AppShell title="Pilot Dashboard">
        {error ? <div className="notice">{error}</div> : null}
        <div className="hero-grid">
          <Card eyebrow="Overview" title="Operator snapshot">
            {loading || !data ? (
              <p className="muted">Loading dashboard metrics…</p>
            ) : (
              <div className="grid-4">
                <div className="metric">
                  <span className="muted">Inventory</span>
                  <strong>{data.summary.inventoryCount}</strong>
                </div>
                <div className="metric">
                  <span className="muted">Listed</span>
                  <strong>{data.summary.listedCount}</strong>
                </div>
                <div className="metric">
                  <span className="muted">Pending drafts</span>
                  <strong>{data.summary.pendingDrafts}</strong>
                </div>
                <div className="metric">
                  <span className="muted">Margin captured</span>
                  <strong>{currency(data.summary.totalMargin)}</strong>
                </div>
              </div>
            )}
          </Card>

          <Card eyebrow="Runbook" title="MVP operating order">
            <div className="stack muted">
              <span>1. Ingest Mac.bid lots and review max bid guidance.</span>
              <span>2. Convert viable lots into canonical inventory items.</span>
              <span>3. Generate drafts, approve, then publish to eBay and Depop.</span>
              <span>4. Watch execution logs and record sold outcomes for P&L.</span>
            </div>
          </Card>
        </div>

        <div className="grid-2">
          <Card eyebrow="Recent inventory" title="Newest items" action={<Link href="/inventory">Open inventory</Link>}>
            <div className="stack">
              {(data?.inventory ?? []).slice(0, 5).map((item) => (
                <div className="split" key={item.id}>
                  <div>
                    <Link href={`/inventory/${item.id}`}>{item.title}</Link>
                    <div className="muted">{currency(item.priceRecommendation)}</div>
                  </div>
                  <StatusPill status={item.status} />
                </div>
              ))}
            </div>
          </Card>

          <Card eyebrow="Lot queue" title="Source lots" action={<Link href="/lots">Open lots</Link>}>
            <div className="stack">
              {(data?.lots ?? []).slice(0, 5).map((lot) => (
                <div className="split" key={lot.id}>
                  <div>
                    <Link href={`/lots/${lot.id}`}>{lot.title}</Link>
                    <div className="muted">Max bid {currency(lot.recommendedMaxBid)}</div>
                  </div>
                  <StatusPill status={lot.status} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </AppShell>
    </ProtectedView>
  );
}
