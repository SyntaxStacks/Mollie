"use client";

import Link from "next/link";
import { AlertTriangle, PencilLine, ShoppingBag, Tags, TrendingUp } from "lucide-react";

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
          {auth.token ? <BarcodeImportCard presentation="scan" token={auth.token} /> : null}

          <div className="scan-home-hero">
            <QueueHeader
              count={readyToListCount}
              description="Identify by code when you can, switch to manual/source lookup when you cannot, then prefill the item and push it toward sale."
              title="Identify fast. Fill what matters. Sell sooner."
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
                  <span>See what you saved, what still needs details, and what can move into selling.</span>
                </div>
              </Link>
              <Link className="scan-shortcut-card" href="/inventory?compose=manual">
                <PencilLine size={18} />
                <div>
                  <strong>Manual lookup</strong>
                  <span>Research by title, brand, or source URL when the printed code path fails.</span>
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

          <SectionCard eyebrow="Queue pulse" title="Why scan stays the home screen">
            <div className="scan-pulse-grid">
              <div className="scan-pulse-card">
                <strong>Start with the code in your hand</strong>
                <p>Use the camera when the barcode is available. It stays the fastest path to a usable item record.</p>
              </div>
              <div className="scan-pulse-card">
                <strong>Switch to lookup without losing momentum</strong>
                <p>If the code path is weak, jump to manual/source lookup and borrow the details you trust.</p>
              </div>
              <div className="scan-pulse-card">
                <strong>Save now, sell next</strong>
                <p>Once the item is filled enough to save, the queue and posting flows should take over from there.</p>
              </div>
            </div>
          </SectionCard>
        </section>
      </AppShell>
    </ProtectedView>
  );
}
