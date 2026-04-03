"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Camera, Plus, Search } from "lucide-react";

import { Button } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { ItemCard } from "../../components/item-card";
import { ManualInventoryItemForm } from "../../components/manual-inventory-item-form";
import { ProtectedView } from "../../components/protected-view";
import { QueueHeader } from "../../components/queue-header";
import { SectionCard } from "../../components/section-card";
import { useAuth } from "../../components/auth-provider";
import { useAuthedResource } from "../../lib/api";
import { getLifecycleBucket, type InventoryListLikeItem } from "../../lib/item-lifecycle";

type InventoryItemView = InventoryListLikeItem & {
  sku: string;
  sourceLot: { title: string } | null;
};

const inventoryBuckets = ["Unlisted", "Ready to List", "Listed", "Sold", "Needs Fix"] as const;

export default function InventoryPage() {
  const auth = useAuth();
  const { data, error } = useAuthedResource<{ items: InventoryItemView[] }>("/api/inventory", auth.token);
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<(typeof inventoryBuckets)[number] | "All">("All");
  const [manualAddOpen, setManualAddOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("compose") === "manual") {
      setManualAddOpen(true);
    }
  }, []);

  const items = data?.items ?? [];
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const bucketMatch = bucket === "All" || getLifecycleBucket(item) === bucket;
      const search = query.trim().toLowerCase();
      const searchMatch =
        !search ||
        item.title.toLowerCase().includes(search) ||
        item.sku.toLowerCase().includes(search) ||
        item.category.toLowerCase().includes(search);

      return bucketMatch && searchMatch;
    });
  }, [bucket, items, query]);

  return (
    <ProtectedView>
      <AppShell title="Inventory">
        <section className="page-stack">
          <SectionCard eyebrow="Inventory" title="Photo-first item management">
            <QueueHeader
              count={filteredItems.length}
              description="Find what you scanned, see what is blocked, and move items toward sale without falling back into table-heavy admin work."
              title="Inventory one tap away"
            />

            <div className="inventory-toolbar">
              <label className="inventory-search">
                <Search size={18} />
                <input
                  className="field"
                  placeholder="Search title, SKU, or category"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="inventory-filter-chips">
                <button className={`inventory-filter-chip${bucket === "All" ? " active" : ""}`} onClick={() => setBucket("All")} type="button">
                  All
                </button>
                {inventoryBuckets.map((bucketOption) => (
                  <button
                    className={`inventory-filter-chip${bucket === bucketOption ? " active" : ""}`}
                    key={bucketOption}
                    onClick={() => setBucket(bucketOption)}
                    type="button"
                  >
                    {bucketOption}
                  </button>
                ))}
              </div>
              <Link href="/">
                <Button>
                  <Camera size={16} /> Back to scan
                </Button>
              </Link>
              <Button kind="secondary" onClick={() => setManualAddOpen((current) => !current)} type="button">
                <Plus size={16} /> {manualAddOpen ? "Close manual add" : "Add manually"}
              </Button>
            </div>
          </SectionCard>

          {error ? <div className="notice">{error}</div> : null}
          {auth.token ? <ManualInventoryItemForm onClose={() => setManualAddOpen(false)} open={manualAddOpen} token={auth.token} /> : null}

          <div className="inventory-bucket-grid">
            {inventoryBuckets.map((bucketName) => {
              const bucketItems = filteredItems.filter((item) => getLifecycleBucket(item) === bucketName);
              return (
                <SectionCard
                  action={<span className="inventory-bucket-count">{bucketItems.length}</span>}
                  eyebrow="Bucket"
                  key={bucketName}
                  title={bucketName}
                >
                  <div className="inventory-card-stack">
                    {bucketItems.length === 0 ? <div className="muted">No items in this bucket.</div> : null}
                    {bucketItems.map((item) => (
                      <ItemCard href={`/inventory/${item.id}`} item={item} key={item.id} />
                    ))}
                  </div>
                </SectionCard>
              );
            })}
          </div>
        </section>
      </AppShell>
    </ProtectedView>
  );
}
