"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, Clock3, AlertTriangle, Sparkles } from "lucide-react";

import type { MarketplaceCapabilitySummary, Platform } from "@reselleros/types";
import { Button } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { BrowserExtensionStatusCard } from "../../components/browser-extension-status-card";
import { ItemCard } from "../../components/item-card";
import { MarketplaceStatusRow } from "../../components/marketplace-status-row";
import { MissingFieldsPanel } from "../../components/missing-fields-panel";
import { ProtectedView } from "../../components/protected-view";
import { QueueHeader } from "../../components/queue-header";
import { SectionCard } from "../../components/section-card";
import { useAuth } from "../../components/auth-provider";
import { useBrowserExtension } from "../../components/use-browser-extension";
import { currency, useAuthedResource } from "../../lib/api";
import {
  getListingReadinessFlags,
  getMarketplaceStatusSummaries,
  getSellQueue,
  type InventoryListLikeItem,
  type MarketplaceAccountLike,
  type MarketplaceActionKind
} from "../../lib/item-lifecycle";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const sellQueues = ["Ready to List", "Drafts", "Publishing", "Listed", "Failed", "Needs Details"] as const;

type SellItem = InventoryListLikeItem & { sku: string };

type ExtensionStatusResponse = {
  capabilitySummary: MarketplaceCapabilitySummary[];
  tasks: Array<{ id: string; state: string }>;
};

type MarketplaceAccountsResponse = {
  accounts: MarketplaceAccountLike[];
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
  const marketplaceAccounts = useAuthedResource<MarketplaceAccountsResponse>("/api/marketplace-accounts", auth.token);
  const extension = useBrowserExtension();
  const [activeQueue, setActiveQueue] = useState<(typeof sellQueues)[number]>("Ready to List");
  const [pending, startTransition] = useTransition();
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState<"ALL" | Platform>("ALL");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
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

  async function runPostWithBody(path: string, successMessage: string, body: Record<string, unknown>) {
    startTransition(async () => {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
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

  async function bulkPostSelected() {
    const selected = items.filter((item) => selectedItemIds.includes(item.id));

    if (selected.length === 0) {
      setActionMessage("Select at least one listing first.");
      return;
    }

    startTransition(async () => {
      try {
        await Promise.all(
          selected.map((item) =>
            fetch(`${API_BASE_URL}/api/inventory/${item.id}/publish-linked`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${auth.token}`,
                "Content-Type": "application/json"
              }
            })
          )
        );
        setActionMessage(`Queued publish for ${selected.length} listings.`);
        setSelectedItemIds([]);
        await refresh();
      } catch {
        setActionMessage("Could not queue bulk post.");
      }
    });
  }

  function handleMarketplaceAction(itemId: string, platform: string, action: MarketplaceActionKind) {
    if (action === "connect_account") {
      window.location.assign("/marketplaces");
      return;
    }

    if (action === "check_extension") {
      void extension.refresh();
      void extensionStatus.refresh();
      void marketplaceAccounts.refresh();
      void refresh();
      return;
    }

    if (action === "check_again") {
      void extension.refresh();
      void extensionStatus.refresh();
      void marketplaceAccounts.refresh();
      void refresh();
      return;
    }

    if (action === "publish_api" || action === "retry") {
      if (platform === "EBAY") {
        void runPost(`/api/inventory/${itemId}/publish/ebay`, "Queued eBay publish.");
      } else if (platform === "DEPOP") {
        void runPost(`/api/inventory/${itemId}/publish/depop`, "Queued Depop publish.");
      } else if (platform === "POSHMARK") {
        void runPost(`/api/inventory/${itemId}/publish/poshmark`, "Queued Poshmark publish.");
      } else if (platform === "WHATNOT") {
        void runPost(`/api/inventory/${itemId}/publish/whatnot`, "Queued Whatnot publish.");
      }
      return;
    }

    if (action === "generate_draft") {
      void runPostWithBody(`/api/inventory/${itemId}/generate-drafts`, "Queued marketplace draft generation.", {
        platforms: [platform]
      });
      return;
    }

    if (action === "open_extension") {
      window.location.assign(`/inventory/${itemId}`);
      return;
    }
  }

  const filteredListings = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return items.filter((item) => {
      const matchesQuery =
        !normalizedQuery ||
        item.title.toLowerCase().includes(normalizedQuery) ||
        item.sku.toLowerCase().includes(normalizedQuery) ||
        String(item.attributesJson?.importSource ?? "").toLowerCase().includes(normalizedQuery);
      const matchesPlatform =
        platformFilter === "ALL" ||
        item.platformListings?.some((listing) => listing.platform === platformFilter) ||
        item.listingDrafts?.some((draft) => draft.platform === platformFilter);

      return matchesQuery && matchesPlatform;
    });
  }, [items, platformFilter, searchQuery]);

  return (
    <ProtectedView>
      <AppShell title="Sell">
        <section className="page-stack">
          <BrowserExtensionStatusCard
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

          <SectionCard eyebrow="My listings" title="Desktop listing management">
            <div className="listing-management-toolbar">
              <div className="scan-import-grid">
                <label className="label">
                  Search
                  <input className="field inventory-search" placeholder="Search SKU, title, or origin" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
                </label>
                <label className="label">
                  Marketplace
                  <select className="field" value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value as "ALL" | Platform)}>
                    <option value="ALL">All marketplaces</option>
                    <option value="EBAY">eBay</option>
                    <option value="DEPOP">Depop</option>
                    <option value="POSHMARK">Poshmark</option>
                    <option value="WHATNOT">Whatnot</option>
                  </select>
                </label>
              </div>
              <div className="actions">
                <Button kind="secondary" onClick={() => window.location.assign("/inventory?compose=manual")}>Create</Button>
                <Button kind="secondary" onClick={() => window.location.assign("/imports")}>Import</Button>
                <Button disabled={pending || selectedItemIds.length === 0} onClick={() => void bulkPostSelected()}>{pending ? "Working..." : "Bulk post"}</Button>
                <Button kind="secondary" onClick={() => setActionMessage("Bulk delist is not live yet.")}>Bulk delist</Button>
              </div>
            </div>
            <div className="listing-table-shell">
              <table className="table">
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>SKU</th>
                    <th>Title</th>
                    <th>Price</th>
                    <th>Created</th>
                    <th>Origin</th>
                    <th>Listed on</th>
                    <th>Sold</th>
                    <th>Labels</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredListings.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <input
                          checked={selectedItemIds.includes(item.id)}
                          onChange={(event) =>
                            setSelectedItemIds((current) =>
                              event.target.checked ? [...new Set([...current, item.id])] : current.filter((entry) => entry !== item.id)
                            )
                          }
                          type="checkbox"
                        />
                      </td>
                      <td>{item.sku}</td>
                      <td><a href={`/inventory/${item.id}`}>{item.title}</a></td>
                      <td>{currency(item.priceRecommendation)}</td>
                      <td>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "n/a"}</td>
                      <td>{String(item.attributesJson?.importSource ?? "MANUAL_ENTRY").replace(/_/g, " ")}</td>
                      <td>{item.platformListings?.map((listing) => listing.platform).join(", ") || "Not listed"}</td>
                      <td>{item.sales?.length ? "Sold" : "Available"}</td>
                      <td>{Array.isArray(item.attributesJson?.labels) ? item.attributesJson.labels.join(", ") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {activeGroup ? (
            <SectionCard eyebrow="Queue focus" title={queuePrimaryAction(activeGroup.queue)}>
              <p className="muted">{queueHeadline(activeGroup.queue)}</p>
            </SectionCard>
          ) : null}

          {(activeGroup?.items ?? []).map((item) => {
            const readinessFlags = getListingReadinessFlags(item);
            const marketStatuses = getMarketplaceStatusSummaries(item, {
              marketplaceAccounts: marketplaceAccounts.data?.accounts ?? [],
              capabilitySummary: extensionStatus.data?.capabilitySummary ?? [],
              extensionInstalled: extension.installed,
              extensionConnected: extension.connected
            });

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
                        onAction={state.actionKind === "unavailable" ? null : () => handleMarketplaceAction(item.id, state.platform, state.actionKind)}
                        onSecondaryAction={
                          state.secondaryActionKind
                            ? () => handleMarketplaceAction(item.id, state.platform, state.secondaryActionKind ?? "unavailable")
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
