"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Package, TrendingUp } from "lucide-react";

import { AppShell } from "../../components/app-shell";
import { ProtectedView } from "../../components/protected-view";
import { QueueHeader } from "../../components/queue-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { useAuth } from "../../components/auth-provider";
import { formatDate, useAuthedResource } from "../../lib/api";
import { getItemLifecycleState, type InventoryListLikeItem } from "../../lib/item-lifecycle";

type ActivityExecutionLog = {
  id: string;
  jobName: string;
  status: string;
  createdAt: string;
  inventoryItemId: string | null;
  inventoryItemTitle: string | null;
  hint?: { title: string; explanation: string } | null;
};

type ActivitySale = {
  id: string;
  soldAt: string;
  soldPrice: number;
  inventoryItem: { title: string };
};

type ActivityInventory = InventoryListLikeItem & { id: string; sku: string };

export default function ActivityPage() {
  const auth = useAuth();
  const logs = useAuthedResource<{ logs: ActivityExecutionLog[] }>("/api/execution-logs", auth.token);
  const sales = useAuthedResource<{ sales: ActivitySale[] }>("/api/sales", auth.token);
  const inventory = useAuthedResource<{ items: ActivityInventory[] }>("/api/inventory", auth.token);

  const recentScans = (inventory.data?.items ?? []).slice(0, 5);
  const recentFailures = (logs.data?.logs ?? []).filter((log) => log.status === "FAILED").slice(0, 5);
  const recentPublishes = (logs.data?.logs ?? []).filter((log) => log.status === "SUCCEEDED").slice(0, 5);
  const recentSales = (sales.data?.sales ?? []).slice(0, 5);
  const readyToListCount = (inventory.data?.items ?? []).filter((item) => getItemLifecycleState(item) === "ready_to_list").length;

  return (
    <ProtectedView>
      <AppShell title="Activity">
        <section className="page-stack">
          <SectionCard eyebrow="Activity" title="Operational feed">
            <QueueHeader
              count={recentScans.length + recentPublishes.length + recentFailures.length + recentSales.length}
              description="Use the feed to spot what moved, what stalled, and which next action will turn saved inventory into listed inventory."
              title="Recent movement"
            />
            <div className="activity-summary-grid">
              <div className="activity-summary-card">
                <div className="activity-summary-topline">
                  <Package size={16} />
                  <span>Scanned recently</span>
                </div>
                <strong>{recentScans.length}</strong>
                <p>Fresh inventory waiting for review or selling setup.</p>
              </div>
              <div className="activity-summary-card">
                <div className="activity-summary-topline">
                  <CheckCircle2 size={16} />
                  <span>Ready to list</span>
                </div>
                <strong>{readyToListCount}</strong>
                <p>Items that are close enough to move into posting work now.</p>
              </div>
              <div className="activity-summary-card">
                <div className="activity-summary-topline">
                  <AlertTriangle size={16} />
                  <span>Failures</span>
                </div>
                <strong>{recentFailures.length}</strong>
                <p>Marketplace or sync work that needs review before it backs up.</p>
              </div>
              <div className="activity-summary-card">
                <div className="activity-summary-topline">
                  <TrendingUp size={16} />
                  <span>Sold</span>
                </div>
                <strong>{recentSales.length}</strong>
                <p>Recent wins that confirm the workflow is converting.</p>
              </div>
            </div>
          </SectionCard>

          <div className="activity-grid">
            <SectionCard eyebrow="Recent scans" title="What just came in">
              <div className="activity-list">
                {recentScans.map((item) => (
                  <Link className="activity-row" href={`/inventory/${item.id}`} key={item.id}>
                    <div>
                      <strong>{item.title}</strong>
                      <div className="muted">{item.sku}</div>
                    </div>
                    <StatusPill
                      label={getItemLifecycleState(item).replace(/_/g, " ")}
                      tone={getItemLifecycleState(item) === "ready_to_list" ? "success" : "neutral"}
                    />
                  </Link>
                ))}
              </div>
            </SectionCard>

            <SectionCard eyebrow="Published listings" title="What moved live">
              <div className="activity-list">
                {recentPublishes.length === 0 ? <div className="muted">No recent publishes yet.</div> : null}
                {recentPublishes.map((log) => (
                  <Link className="activity-row" href="/executions" key={log.id}>
                    <div>
                      <strong>{log.inventoryItemTitle ?? log.jobName}</strong>
                      <div className="muted">{formatDate(log.createdAt)}</div>
                    </div>
                    <StatusPill label="published" tone="success" />
                  </Link>
                ))}
              </div>
            </SectionCard>

            <SectionCard eyebrow="Failures" title="What needs a retry">
              <div className="activity-list">
                {recentFailures.length === 0 ? <div className="muted">No failed posts right now.</div> : null}
                {recentFailures.map((log) => (
                  <Link className="activity-row" href="/executions" key={log.id}>
                    <div>
                      <strong>{log.inventoryItemTitle ?? log.jobName}</strong>
                      <div className="muted">{log.hint?.explanation ?? "Review the execution detail and retry if safe."}</div>
                    </div>
                    <StatusPill label="failed" tone="danger" />
                  </Link>
                ))}
              </div>
            </SectionCard>

            <SectionCard eyebrow="Sold events" title="What closed">
              <div className="activity-list">
                {recentSales.length === 0 ? <div className="muted">No sold events recorded yet.</div> : null}
                {recentSales.map((sale) => (
                  <Link className="activity-row" href="/sales" key={sale.id}>
                    <div>
                      <strong>{sale.inventoryItem.title}</strong>
                      <div className="muted">{formatDate(sale.soldAt)}</div>
                    </div>
                    <StatusPill label="sold" tone="accent" />
                  </Link>
                ))}
              </div>
            </SectionCard>
          </div>

          <SectionCard eyebrow="Next actions" title="Suggested moves">
            <div className="scan-pulse-grid">
              <Link className="scan-shortcut-card" href="/sell">
                <div>
                  <strong>Work the sell queue</strong>
                  <span>Publish ready items and retry failed marketplace actions.</span>
                </div>
              </Link>
              <Link className="scan-shortcut-card" href="/inventory">
                <div>
                  <strong>Fix inventory blockers</strong>
                  <span>Add photos, titles, or prices where items still need details.</span>
                </div>
              </Link>
              <Link className="scan-shortcut-card" href="/marketplaces">
                <div>
                  <strong>Check accounts</strong>
                  <span>Reconnect marketplace accounts before they block more queue work.</span>
                </div>
              </Link>
            </div>
          </SectionCard>
        </section>
      </AppShell>
    </ProtectedView>
  );
}
