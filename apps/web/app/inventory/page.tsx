"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, useTransition } from "react";
import {
  ChevronDown,
  Download,
  ExternalLink,
  PencilLine,
  Plus,
  ScanBarcode,
  Search,
  SlidersHorizontal,
  Trash2
} from "lucide-react";

import { Button } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { InventoryScanModal } from "../../components/inventory-scan-modal";
import { ItemCard } from "../../components/item-card";
import { ProtectedView } from "../../components/protected-view";
import { StatusPill } from "../../components/status-pill";
import { useAuth } from "../../components/auth-provider";
import { currency, useAuthedResource } from "../../lib/api";
import { getLifecycleBucket, type InventoryListLikeItem } from "../../lib/item-lifecycle";

type InventoryItemView = InventoryListLikeItem & {
  sku: string;
  sourceLot: { title: string } | null;
};

type SortKey = "createdAt" | "title" | "priceRecommendation" | "sku" | "origin" | "sold";
type SortDirection = "asc" | "desc";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const inventoryBuckets = ["All", "Unlisted", "Ready to List", "Listed", "Sold", "Needs Fix"] as const;
const marketplaceOptions = ["ALL", "EBAY", "DEPOP", "POSHMARK", "WHATNOT"] as const;

function buildInventoryHref(params: URLSearchParams) {
  const query = params.toString();
  return query ? `/inventory?${query}` : "/inventory";
}

function originLabel(item: InventoryItemView) {
  return String(item.attributesJson?.importSource ?? "MANUAL_ENTRY").replace(/_/g, " ");
}

function listedPlatforms(item: InventoryItemView) {
  return [
    ...new Set([
      ...(item.platformListings ?? []).map((listing) => listing.platform),
      ...(item.listingDrafts ?? []).map((draft) => draft.platform)
    ])
  ];
}

function labelsForItem(item: InventoryItemView) {
  return Array.isArray(item.attributesJson?.labels)
    ? item.attributesJson.labels.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function compareValues(a: string | number, b: string | number, direction: SortDirection) {
  if (typeof a === "number" && typeof b === "number") {
    return direction === "asc" ? a - b : b - a;
  }

  return direction === "asc" ? String(a).localeCompare(String(b)) : String(b).localeCompare(String(a));
}

function bucketTone(bucket: (typeof inventoryBuckets)[number]) {
  if (bucket === "Needs Fix") {
    return "danger" as const;
  }

  if (bucket === "Ready to List" || bucket === "Listed" || bucket === "Sold") {
    return "success" as const;
  }

  return "neutral" as const;
}

function platformLabel(platform: (typeof marketplaceOptions)[number] | string) {
  switch (platform) {
    case "EBAY":
      return "eBay";
    case "DEPOP":
      return "Depop";
    case "POSHMARK":
      return "Poshmark";
    case "WHATNOT":
      return "Whatnot";
    default:
      return platform;
  }
}

function InventoryPageContent() {
  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data, error, refresh } = useAuthedResource<{ items: InventoryItemView[] }>("/api/inventory", auth.token);
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<(typeof inventoryBuckets)[number]>("All");
  const [originFilter, setOriginFilter] = useState("ALL");
  const [marketplaceFilter, setMarketplaceFilter] = useState<(typeof marketplaceOptions)[number]>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function updateInventoryLocation(mutator: (params: URLSearchParams) => void) {
    const nextParams = new URLSearchParams(searchParams.toString());
    mutator(nextParams);
    router.replace(buildInventoryHref(nextParams));
  }

  function openScanModal() {
    setScanModalOpen(true);
    updateInventoryLocation((params) => {
      params.set("scan", "barcode");
    });
  }

  function closeScanModal() {
    setScanModalOpen(false);
    updateInventoryLocation((params) => {
      params.delete("scan");
    });
  }

  useEffect(() => {
    if (searchParams.get("compose") === "manual") {
      router.replace("/inventory/create");
      return;
    }

    const requestedScan = searchParams.get("scan");
    setScanModalOpen(Boolean(requestedScan));

    const requestedBucket = searchParams.get("bucket");
    if (requestedBucket && inventoryBuckets.includes(requestedBucket as (typeof inventoryBuckets)[number])) {
      setBucket(requestedBucket as (typeof inventoryBuckets)[number]);
      setFiltersOpen(true);
    }
  }, [router, searchParams]);

  const items = data?.items ?? [];
  const originOptions = useMemo(() => ["ALL", ...new Set(items.map(originLabel))], [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return [...items]
      .filter((item) => {
        const itemBucket = getLifecycleBucket(item);
        const searchMatch =
          !normalizedQuery ||
          item.title.toLowerCase().includes(normalizedQuery) ||
          item.sku.toLowerCase().includes(normalizedQuery) ||
          item.category.toLowerCase().includes(normalizedQuery) ||
          originLabel(item).toLowerCase().includes(normalizedQuery);
        const bucketMatch = bucket === "All" || itemBucket === bucket;
        const originMatch = originFilter === "ALL" || originLabel(item) === originFilter;
        const marketplaceMatch = marketplaceFilter === "ALL" || listedPlatforms(item).includes(marketplaceFilter);

        return searchMatch && bucketMatch && originMatch && marketplaceMatch;
      })
      .sort((left, right) => {
        switch (sortKey) {
          case "title":
            return compareValues(left.title, right.title, sortDirection);
          case "priceRecommendation":
            return compareValues(left.priceRecommendation ?? 0, right.priceRecommendation ?? 0, sortDirection);
          case "sku":
            return compareValues(left.sku, right.sku, sortDirection);
          case "origin":
            return compareValues(originLabel(left), originLabel(right), sortDirection);
          case "sold":
            return compareValues(left.sales?.length ?? 0, right.sales?.length ?? 0, sortDirection);
          default:
            return compareValues(new Date(left.createdAt ?? 0).getTime(), new Date(right.createdAt ?? 0).getTime(), sortDirection);
        }
      });
  }, [bucket, items, marketplaceFilter, originFilter, query, sortDirection, sortKey]);

  const allVisibleSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedItemIds.includes(item.id));
  const bucketCounts = useMemo(
    () =>
      inventoryBuckets.map((bucketName) => ({
        bucket: bucketName,
        count:
          bucketName === "All"
            ? items.length
            : items.filter((item) => getLifecycleBucket(item) === bucketName).length
      })),
    [items]
  );

  const hasActiveFilters =
    query.trim().length > 0 || bucket !== "All" || originFilter !== "ALL" || marketplaceFilter !== "ALL";

  const activeFilterCount =
    (bucket !== "All" ? 1 : 0) +
    (originFilter !== "ALL" ? 1 : 0) +
    (marketplaceFilter !== "ALL" ? 1 : 0);

  async function runPost(path: string, successMessage: string) {
    startTransition(async () => {
      try {
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
      } catch {
        setActionMessage("Action failed");
      }
    });
  }

  async function deleteItem(itemId: string, title: string) {
    if (!window.confirm(`Delete ${title}? This removes the item record, images, drafts, listings, and sales history for this workspace.`)) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/inventory/${itemId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "Content-Type": "application/json"
          }
        });
        const payload = (await response.json().catch(() => ({ error: "Delete failed" }))) as { error?: string };

        if (!response.ok) {
          setActionMessage(payload.error ?? "Delete failed");
          return;
        }

        setSelectedItemIds((current) => current.filter((entry) => entry !== itemId));
        setActionMessage(`Deleted ${title}.`);
        await refresh();
      } catch {
        setActionMessage("Delete failed");
      }
    });
  }

  async function bulkPostSelected() {
    const selected = items.filter((item) => selectedItemIds.includes(item.id));

    if (selected.length === 0) {
      setActionMessage("Select at least one item first.");
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

        setSelectedItemIds([]);
        setActionMessage(`Queued publish for ${selected.length} items.`);
        await refresh();
      } catch {
        setActionMessage("Could not queue bulk post.");
      }
    });
  }

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === "title" || nextKey === "origin" || nextKey === "sku" ? "asc" : "desc");
  }

  function sortLabel(key: SortKey) {
    if (sortKey !== key) {
      return "";
    }

    return sortDirection === "asc" ? " ASC" : " DESC";
  }

  function resetFilters() {
    setQuery("");
    setBucket("All");
    setOriginFilter("ALL");
    setMarketplaceFilter("ALL");
  }

  return (
    <ProtectedView>
      <AppShell title="Inventory">
        <section className="inventory-listings-page">
          <div className="inventory-listings-header">
            <div className="inventory-listings-titleblock">
              <p className="eyebrow">Inventory</p>
              <h2>My listings</h2>
              <p className="muted">
                Work inventory like an active listings queue: trim the set fast, bulk-act on what is ready, and open any
                item into the listing workspace.
              </p>
            </div>
            <div className="inventory-listings-bulk-actions">
              <Button kind="secondary" onClick={() => setActionMessage("Bulk delist is not live yet.")} type="button">
                Bulk delist
              </Button>
              <Button disabled={pending || selectedItemIds.length === 0} onClick={() => void bulkPostSelected()} type="button">
                {pending ? "Working..." : "Bulk post"}
              </Button>
            </div>
          </div>

          {error ? <div className="notice">{error}</div> : null}
          {actionMessage ? <div className="notice success">{actionMessage}</div> : null}

          <div className="inventory-listings-filter-bar">
            <label className="inventory-listings-search">
              <Search size={18} />
              <input
                className="field"
                placeholder="Search a listing"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            <label className="label">
              Origin
              <select className="field" value={originFilter} onChange={(event) => setOriginFilter(event.target.value)}>
                {originOptions.map((option) => (
                  <option key={option} value={option}>
                    {option === "ALL" ? "All" : option}
                  </option>
                ))}
              </select>
            </label>

            <label className="label">
              Listed on
              <select
                className="field"
                value={marketplaceFilter}
                onChange={(event) => setMarketplaceFilter(event.target.value as (typeof marketplaceOptions)[number])}
              >
                <option value="ALL">All</option>
                <option value="EBAY">eBay</option>
                <option value="DEPOP">Depop</option>
                <option value="POSHMARK">Poshmark</option>
                <option value="WHATNOT">Whatnot</option>
              </select>
            </label>

            <Button
              className={`inventory-listings-filter-toggle${filtersOpen ? " active" : ""}`}
              kind="secondary"
              onClick={() => setFiltersOpen((current) => !current)}
              type="button"
            >
              <SlidersHorizontal size={16} />
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              <ChevronDown className={`app-settings-chevron${filtersOpen ? " open" : ""}`} size={16} />
            </Button>
          </div>

          {filtersOpen ? (
            <div className="inventory-listings-filter-panel">
              <div className="inventory-listings-filter-panel-header">
                <div>
                  <p className="eyebrow">Quick filters</p>
                  <strong>Use lifecycle status to cut the queue down before you work the table.</strong>
                </div>
                <div className="actions">
                  <Button kind="ghost" onClick={resetFilters} type="button">
                    Reset filters
                  </Button>
                </div>
              </div>

              <div className="inventory-listings-bucket-row">
                {bucketCounts.map((entry) => (
                  <button
                    className={`inventory-listings-bucket-chip${bucket === entry.bucket ? " active" : ""}`}
                    key={entry.bucket}
                    onClick={() => setBucket(entry.bucket)}
                    type="button"
                  >
                    <span>{entry.bucket}</span>
                    <strong>{entry.count}</strong>
                  </button>
                ))}
              </div>

              <div className="inventory-listings-filter-summary">
                <div className="muted">
                  {hasActiveFilters
                    ? `Showing ${filteredItems.length} items after applying the current search and filter set.`
                    : `No quick filters applied. Showing all ${items.length} items in this workspace.`}
                </div>
                <div className="inventory-listings-active-filter-pills">
                  {bucket !== "All" ? <StatusPill label={bucket} tone={bucketTone(bucket)} /> : null}
                  {originFilter !== "ALL" ? <StatusPill label={originFilter} tone="neutral" /> : null}
                  {marketplaceFilter !== "ALL" ? <StatusPill label={platformLabel(marketplaceFilter)} tone="neutral" /> : null}
                </div>
              </div>
            </div>
          ) : null}

          <div className="inventory-listings-results-bar">
            <div className="inventory-listings-results-copy">
              <strong>
                {selectedItemIds.length > 0 ? `${selectedItemIds.length} selected` : `${filteredItems.length} matching items`}
              </strong>
              <span className="muted">
                Sorted by {sortKey === "createdAt" ? "created date" : sortKey === "priceRecommendation" ? "price" : sortKey}{" "}
                {sortDirection === "asc" ? "ascending" : "descending"}.
              </span>
            </div>
            <div className="inventory-listings-results-actions">
              <Link href="/inventory/create">
                <Button kind="secondary" type="button">
                  <Plus size={16} /> New item
                </Button>
              </Link>
              <Button kind="secondary" onClick={openScanModal} type="button">
                <ScanBarcode size={16} /> Scan code
              </Button>
              <Link href="/imports">
                <Button kind="secondary" type="button">
                  <Download size={16} /> Upload multiple
                </Button>
              </Link>
              <Button kind="secondary" onClick={() => setActionMessage("Export to CSV is not live yet.")} type="button">
                Export to CSV
              </Button>
            </div>
          </div>

          <div className="listing-table-shell inventory-listings-table-shell">
            <table className="table inventory-listings-table">
              <thead>
                <tr>
                  <th>
                    <input
                      aria-label="Select all visible inventory"
                      checked={allVisibleSelected}
                      onChange={(event) =>
                        setSelectedItemIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, ...filteredItems.map((item) => item.id)])]
                            : current.filter((id) => !filteredItems.some((item) => item.id === id))
                        )
                      }
                      type="checkbox"
                    />
                  </th>
                  <th />
                  <th>
                    <button className="inventory-sort-button" onClick={() => toggleSort("sku")} type="button">
                      SKU{sortLabel("sku")}
                    </button>
                  </th>
                  <th>
                    <button className="inventory-sort-button" onClick={() => toggleSort("title")} type="button">
                      Title{sortLabel("title")}
                    </button>
                  </th>
                  <th>
                    <button className="inventory-sort-button" onClick={() => toggleSort("priceRecommendation")} type="button">
                      Price{sortLabel("priceRecommendation")}
                    </button>
                  </th>
                  <th>
                    <button className="inventory-sort-button" onClick={() => toggleSort("createdAt")} type="button">
                      Created{sortLabel("createdAt")}
                    </button>
                  </th>
                  <th>
                    <button className="inventory-sort-button" onClick={() => toggleSort("origin")} type="button">
                      Origin{sortLabel("origin")}
                    </button>
                  </th>
                  <th>Listed on</th>
                  <th>
                    <button className="inventory-sort-button" onClick={() => toggleSort("sold")} type="button">
                      Sold{sortLabel("sold")}
                    </button>
                  </th>
                  <th>Labels</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const image = item.images?.[0]?.url ?? null;
                  const labels = labelsForItem(item);
                  const platforms = listedPlatforms(item);
                  const itemBucket = getLifecycleBucket(item);

                  return (
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
                      <td>
                        <div className="inventory-table-item-cell">
                          {image ? (
                            <img alt={item.title} className="inventory-table-thumb" src={image} />
                          ) : (
                            <div className="inventory-table-thumb inventory-table-thumb-empty">No photo</div>
                          )}
                        </div>
                      </td>
                      <td>{item.sku}</td>
                      <td>
                        <div className="inventory-table-title-cell">
                          <Link href={`/inventory/${item.id}`}>{item.title}</Link>
                          <div className="inventory-table-title-meta">
                            <span className="muted">{item.category}</span>
                            <StatusPill label={itemBucket} tone={bucketTone(itemBucket)} />
                          </div>
                        </div>
                      </td>
                      <td>{currency(item.priceRecommendation)}</td>
                      <td>{item.createdAt ? new Date(item.createdAt).toLocaleString() : "n/a"}</td>
                      <td>{originLabel(item)}</td>
                      <td>
                        <div className="inventory-table-pill-row">
                          {platforms.length > 0 ? (
                            platforms.map((platform) => (
                              <span className="inventory-table-market-chip" key={platform}>
                                {platformLabel(platform)}
                              </span>
                            ))
                          ) : (
                            <span className="muted">Not listed</span>
                          )}
                        </div>
                      </td>
                      <td>{item.sales?.length ? "Sold" : "Available"}</td>
                      <td>
                        <div className="inventory-table-pill-row">
                          {labels.length > 0 ? (
                            labels.map((label) => (
                              <span className="inventory-table-label-chip" key={label}>
                                {label}
                              </span>
                            ))
                          ) : (
                            <span className="muted">None</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="inventory-row-actions">
                          <Link className="inventory-row-action" href={`/inventory/${item.id}`}>
                            <PencilLine size={14} /> Edit
                          </Link>
                          <button
                            className="inventory-row-action"
                            onClick={() => void runPost(`/api/inventory/${item.id}/publish-linked`, `Queued publish for ${item.title}.`)}
                            type="button"
                          >
                            <ExternalLink size={14} /> Post
                          </button>
                          <button className="inventory-row-action danger" onClick={() => void deleteItem(item.id, item.title)} type="button">
                            <Trash2 size={14} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredItems.length === 0 ? (
                  <tr>
                    <td className="muted inventory-listings-empty-row" colSpan={11}>
                      No inventory matches this filter set. Clear a filter, create a new item, or scan another product.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="inventory-dashboard-mobile-list inventory-listings-mobile-list">
            {filteredItems.map((item) => (
              <ItemCard href={`/inventory/${item.id}`} item={item} key={item.id} />
            ))}
            {filteredItems.length === 0 ? <div className="muted">No items match this filter set.</div> : null}
          </div>
        </section>

        {auth.token ? (
          <InventoryScanModal onClose={closeScanModal} open={scanModalOpen} token={auth.token} />
        ) : null}
      </AppShell>
    </ProtectedView>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<div className="center-state">Loading inventory...</div>}>
      <InventoryPageContent />
    </Suspense>
  );
}
