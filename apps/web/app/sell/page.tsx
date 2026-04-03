"use client";

import { useMemo, useState, useTransition } from "react";

import { Button } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { ItemCard } from "../../components/item-card";
import { MarketplaceStatusRow } from "../../components/marketplace-status-row";
import { MissingFieldsPanel } from "../../components/missing-fields-panel";
import { ProtectedView } from "../../components/protected-view";
import { QueueHeader } from "../../components/queue-header";
import { SectionCard } from "../../components/section-card";
import { useAuth } from "../../components/auth-provider";
import { useAuthedResource } from "../../lib/api";
import {
  getListingReadinessFlags,
  getMarketplaceStatusSummaries,
  getSellQueue,
  type InventoryListLikeItem
} from "../../lib/item-lifecycle";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const sellQueues = ["Ready to List", "Drafts", "Publishing", "Listed", "Failed", "Needs Details"] as const;

type SellItem = InventoryListLikeItem & { sku: string };

export default function SellPage() {
  const auth = useAuth();
  const { data, error, refresh } = useAuthedResource<{ items: SellItem[] }>("/api/inventory", auth.token);
  const [activeQueue, setActiveQueue] = useState<(typeof sellQueues)[number]>("Ready to List");
  const [pending, startTransition] = useTransition();
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const items = data?.items ?? [];

  const grouped = useMemo(() => {
    return sellQueues.map((queue) => ({
      queue,
      items: items.filter((item) => getSellQueue(item) === queue)
    }));
  }, [items]);

  async function runPost(path: string, successMessage: string) {
    startTransition(async () => {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json"
        }
      });

      const payload = (await response.json().catch(() => ({ error: "Action failed" }))) as { error?: string };

      if (!response.ok) {
        setActionMessage(payload.error ?? "Action failed");
        return;
      }

      setActionMessage(successMessage);
      await refresh();
    });
  }

  return (
    <ProtectedView>
      <AppShell title="Sell">
        <section className="page-stack">
          <SectionCard eyebrow="Sell queue" title="Queue-based selling">
            <QueueHeader
              count={grouped.find((entry) => entry.queue === activeQueue)?.items.length ?? 0}
              description="Work the queue, not the integrations. Every row should tell you what is ready, what is blocked, and what to do next."
              title={activeQueue}
            />
            <div className="inventory-filter-chips">
              {sellQueues.map((queue) => (
                <button
                  className={`inventory-filter-chip${activeQueue === queue ? " active" : ""}`}
                  key={queue}
                  onClick={() => setActiveQueue(queue)}
                  type="button"
                >
                  {queue}
                </button>
              ))}
            </div>
          </SectionCard>

          {error ? <div className="notice">{error}</div> : null}
          {actionMessage ? <div className="notice success">{actionMessage}</div> : null}

          {(grouped.find((entry) => entry.queue === activeQueue)?.items ?? []).map((item) => {
            const readinessFlags = getListingReadinessFlags(item);
            const marketStatuses = getMarketplaceStatusSummaries(item);

            return (
              <SectionCard eyebrow="Sell candidate" key={item.id} title={item.title}>
                <div className="sell-item-layout">
                  <ItemCard
                    compact
                    href={`/inventory/${item.id}`}
                    item={item}
                    action={
                      <Button kind="secondary" onClick={() => void runPost(`/api/inventory/${item.id}/publish-linked`, "Queued linked publish.")}>
                        {pending ? "Working..." : "Publish linked"}
                      </Button>
                    }
                  />
                  <MissingFieldsPanel flags={readinessFlags} />
                  <div className="marketplace-status-stack">
                    {marketStatuses.map((state) => (
                      <MarketplaceStatusRow
                        key={`${item.id}-${state.platform}`}
                        onAction={
                          state.platform === "EBAY"
                            ? () => void runPost(`/api/inventory/${item.id}/publish/ebay`, "Queued eBay publish.")
                            : state.platform === "DEPOP"
                              ? () => void runPost(`/api/inventory/${item.id}/publish/depop`, "Queued Depop publish.")
                              : state.platform === "POSHMARK"
                                ? () => void runPost(`/api/inventory/${item.id}/publish/poshmark`, "Queued Poshmark publish.")
                                : state.platform === "WHATNOT"
                                  ? () => void runPost(`/api/inventory/${item.id}/publish/whatnot`, "Queued Whatnot publish.")
                                  : null
                        }
                        state={state}
                      />
                    ))}
                  </div>
                </div>
              </SectionCard>
            );
          })}

          {(grouped.find((entry) => entry.queue === activeQueue)?.items.length ?? 0) === 0 ? (
            <SectionCard eyebrow="Queue empty" title="Nothing here right now">
              <p className="muted">This queue is clear. Scan more items or move inventory forward from another queue.</p>
            </SectionCard>
          ) : null}
        </section>
      </AppShell>
    </ProtectedView>
  );
}
