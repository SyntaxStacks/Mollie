"use client";

import Link from "next/link";
import { AlertTriangle, ShoppingBag, Tags, TrendingUp } from "lucide-react";

import { AppShell } from "../components/app-shell";
import { BarcodeImportCard } from "../components/barcode-import-card";
import { ProtectedView } from "../components/protected-view";
import { SectionCard } from "../components/section-card";
import { useAuth } from "../components/auth-provider";
import { QueueHeader } from "../components/queue-header";
import { useAuthedResource } from "../lib/api";
import { getItemLifecycleState } from "../lib/item-lifecycle";

type ScanInventoryItem = {
  id: string;
  title: string;
  category: string;
  condition: string;
  costBasis: number | null;
  priceRecommendation: number | null;
  status: string | null;
  attributesJson: Record<string, unknown> | null;
  images: Array<{ id: string; url: string; position: number }>;
  listingDrafts: Array<{ id: string; platform: string; reviewStatus: string }>;
  platformListings: Array<{ id: string; platform: string; status: string | null }>;
  sales: Array<{ id: string; soldPrice: number; soldAt: string }>;
};

type ExecutionLogSummary = {
  id: string;
  status: string;
};

export default function ScanPage() {
  const auth = useAuth();
  const inventory = useAuthedResource<{ items: ScanInventoryItem[] }>("/api/inventory", auth.token);
  const failedPosts = useAuthedResource<{ logs: ExecutionLogSummary[] }>("/api/execution-logs?status=FAILED", auth.token);
  const sales = useAuthedResource<{ sales: Array<{ id: string; soldAt: string }> }>("/api/sales", auth.token);

  const items = inventory.data?.items ?? [];
  const readyToListCount = items.filter((item) => getItemLifecycleState(item) === "ready_to_list").length;
  const failedPostCount = failedPosts.data?.logs.length ?? 0;
  const listedCount = items.filter((item) => getItemLifecycleState(item) === "listed").length;
  const soldTodayCount =
    sales.data?.sales.filter((sale) => {
      const soldDate = new Date(sale.soldAt);
      const now = new Date();
      return soldDate.toDateString() === now.toDateString();
    }).length ?? 0;

  return (
    <ProtectedView>
      <AppShell chrome="immersive" title="Scan">
        <section className="scan-home">
          <div className="scan-home-hero">
            <QueueHeader
              count={readyToListCount}
              description="Scan fast, confirm the match, and keep intake moving without getting buried in admin work."
              title="Camera-first intake"
            />

            <div className="scan-productivity-strip">
              <div className="scan-productivity-card">
                <span>Ready to list</span>
                <strong>{readyToListCount}</strong>
              </div>
              <div className="scan-productivity-card">
                <span>Failed posts</span>
                <strong>{failedPostCount}</strong>
              </div>
              <div className="scan-productivity-card">
                <span>Listed now</span>
                <strong>{listedCount}</strong>
              </div>
              <div className="scan-productivity-card">
                <span>Sold today</span>
                <strong>{soldTodayCount}</strong>
              </div>
            </div>

            <div className="scan-shortcuts">
              <Link className="scan-shortcut-card" href="/inventory">
                <ShoppingBag size={18} />
                <div>
                  <strong>Inventory</strong>
                  <span>One tap to manage what you just saved.</span>
                </div>
              </Link>
              <Link className="scan-shortcut-card" href="/sell">
                <Tags size={18} />
                <div>
                  <strong>Sell queue</strong>
                  <span>See what is ready to list or blocked.</span>
                </div>
              </Link>
              <Link className="scan-shortcut-card" href="/activity">
                <TrendingUp size={18} />
                <div>
                  <strong>Activity</strong>
                  <span>Watch scans, listings, failures, and sold events.</span>
                </div>
              </Link>
              <Link className="scan-shortcut-card" href="/marketplaces">
                <AlertTriangle size={18} />
                <div>
                  <strong>Accounts</strong>
                  <span>Reconnect marketplace accounts before the queue backs up.</span>
                </div>
              </Link>
            </div>
          </div>

          {auth.token ? <BarcodeImportCard presentation="scan" token={auth.token} /> : null}

          <SectionCard eyebrow="Queue pulse" title="Why scan stays the home screen">
            <div className="scan-pulse-grid">
              <div className="scan-pulse-card">
                <strong>Keep intake moving</strong>
                <p>Missing details can wait. Use scan to capture the opportunity first.</p>
              </div>
              <div className="scan-pulse-card">
                <strong>Inventory is one tap away</strong>
                <p>Every accepted scan becomes a manageable item, not a lost note.</p>
              </div>
              <div className="scan-pulse-card">
                <strong>Sell is a queue</strong>
                <p>Drafts, blockers, and retries belong in Sell, not in the intake flow.</p>
              </div>
            </div>
          </SectionCard>
        </section>
      </AppShell>
    </ProtectedView>
  );
}
