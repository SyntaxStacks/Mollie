"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, Clock3, AlertTriangle, Sparkles } from "lucide-react";

import { Button } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { DesktopExtensionStatusCard } from "../../components/desktop-extension-status-card";
import { ItemCard } from "../../components/item-card";
import { MarketplaceStatusRow } from "../../components/marketplace-status-row";
import { MissingFieldsPanel } from "../../components/missing-fields-panel";
import { ProtectedView } from "../../components/protected-view";
import { QueueHeader } from "../../components/queue-header";
import { SectionCard } from "../../components/section-card";
import { useAuth } from "../../components/auth-provider";
import { useDesktopExtension } from "../../components/use-desktop-extension";
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

type ExtensionStatusResponse = {
  tasks: Array<{ id: string; state: string }>;
};

function queueHeadline(queue: (typeof sellQueues)[number]) {
  switch (queue) {
    case "Ready to List":
      return "These items are close enough to make money now.";
    case "Drafts":
      return "Drafts exist. Review and push them toward publish.";
    case "Publishing":
      return "These items are already moving through marketplace work.";
    case "Listed":
      return "Live items that now need monitoring, not more prep.";
    case "Failed":
      return "Something broke. Fix the blocker and retry deliberately.";
    default:
      return "These items need a little more setup before they can sell.";
  }
}

function queuePrimaryAction(queue: (typeof sellQueues)[number]) {
  switch (queue) {
    case "Ready to List":
      return "Push live";
    case "Drafts":
      return "Review drafts";
    case "Publishing":
      return "Watch progress";
    case "Listed":
      return "Check listings";
    case "Failed":
      return "Retry safely";
    default:
      return "Fill the gaps";
  }
}

export default function SellPage() {
  const auth = useAuth();
  const { data, error, refresh } = useAuthedResource<{ items: SellItem[] }>("/api/inventory", auth.token);
  const extensionStatus = useAuthedResource<ExtensionStatusResponse>("/api/extension/status", auth.token);
  const extension = useDesktopExtension();
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
  const activeGroup = grouped.find((entry) => entry.queue === activeQueue);

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
          <DesktopExtensionStatusCard
            connected={extension.connected}
            installed={extension.installed}
            loading={extension.loading}
            onRefresh={() => {
              void extension.refresh();
              void extensionStatus.refresh();
            }}
            pendingTasks={extensionStatus.data?.tasks.filter((task) => task.state === "QUEUED" || task.state === "RUNNING").length ?? 0}
          />

          <SectionCard eyebrow="Sell queue" title="Queue-based selling">
            <QueueHeader
              count={activeGroup?.items.length ?? 0}
              description="Work the queue, not the integrations. Pull from what is ready, fix only the blockers that matter, and keep items moving toward published."
              title={activeQueue}
            />
            <div className="sell-queue-summary-grid">
              {grouped.map((entry) => {
                const Icon =
                  entry.queue === "Ready to List"
                    ? CheckCircle2
                    : entry.queue === "Publishing"
                      ? Clock3
                      : entry.queue === "Failed"
                        ? AlertTriangle
                        : Sparkles;

                return (
                  <button
                    className={`sell-queue-summary-card${activeQueue === entry.queue ? " active" : ""}`}
                    key={entry.queue}
                    onClick={() => setActiveQueue(entry.queue)}
                    type="button"
                  >
                    <div className="sell-queue-summary-topline">
                      <Icon size={16} />
                      <span>{entry.queue}</span>
                    </div>
                    <strong>{entry.items.length}</strong>
                    <p>{queuePrimaryAction(entry.queue)}</p>
                  </button>
                );
              })}
            </div>
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

          {activeGroup ? (
            <SectionCard eyebrow="Queue focus" title={queuePrimaryAction(activeGroup.queue)}>
              <p className="muted">{queueHeadline(activeGroup.queue)}</p>
            </SectionCard>
          ) : null}

          {(activeGroup?.items ?? []).map((item) => {
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

          {(activeGroup?.items.length ?? 0) === 0 ? (
            <SectionCard eyebrow="Queue empty" title="Nothing here right now">
              <p className="muted">This queue is clear. Scan more items, use manual lookup for dead-end barcodes, or move inventory forward from another queue.</p>
            </SectionCard>
          ) : null}
        </section>
      </AppShell>
    </ProtectedView>
  );
}
