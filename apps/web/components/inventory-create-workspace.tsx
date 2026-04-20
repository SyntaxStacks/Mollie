"use client";

import Link from "next/link";
import { ArrowLeft, Camera, ExternalLink, Plus, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent } from "react";

import { Button } from "@reselleros/ui";

import { ActionRail } from "./action-rail";
import { SourceSearchPanel } from "./source-search-panel";

type ExistingInventoryItem = {
  id: string;
  title: string;
  sku?: string;
  attributesJson?: Record<string, unknown> | null;
};

type InventoryCreateWorkspaceProps = {
  token: string;
  existingItems: ExistingInventoryItem[];
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function normalizeIdentifier(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9X]/g, "");
}

function normalizeTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function InventoryCreateWorkspace({ token, existingItems }: InventoryCreateWorkspaceProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [lookupQuery, setLookupQuery] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [category, setCategory] = useState("General Merchandise");
  const [condition, setCondition] = useState("Good used condition");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [costBasis, setCostBasis] = useState("0");
  const [estimatedResaleMin, setEstimatedResaleMin] = useState("");
  const [estimatedResaleMax, setEstimatedResaleMax] = useState("");
  const [priceRecommendation, setPriceRecommendation] = useState("");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState("");
  const [internalNote, setInternalNote] = useState("");

  const duplicateMatches = useMemo(() => {
    const normalizedIdentifier = normalizeIdentifier(identifier);
    const normalizedTitle = normalizeTitle(title);

    return existingItems
      .filter((item) => {
        const itemIdentifier = typeof item.attributesJson?.identifier === "string" ? normalizeIdentifier(item.attributesJson.identifier) : "";
        const itemTitle = normalizeTitle(item.title);
        const identifierMatch = Boolean(normalizedIdentifier && itemIdentifier && normalizedIdentifier === itemIdentifier);
        const titleMatch =
          Boolean(normalizedTitle) &&
          normalizedTitle.length >= 6 &&
          (itemTitle.includes(normalizedTitle) || normalizedTitle.includes(itemTitle));

        return identifierMatch || titleMatch;
      })
      .slice(0, 3);
  }, [existingItems, identifier, title]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        const parsedLabels = splitCsv(labels);
        const trimmedSourceUrl = sourceUrl.trim();
        const trimmedLookupQuery = lookupQuery.trim();
        const response = await fetch(`${API_BASE_URL}/api/inventory`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            title: title.trim(),
            brand: brand.trim() || null,
            category: category.trim(),
            condition: condition.trim(),
            size: size.trim() || null,
            color: color.trim() || null,
            quantity: Math.max(1, Number(quantity || 1)),
            costBasis: Number(costBasis || 0),
            estimatedResaleMin: estimatedResaleMin.trim() ? Number(estimatedResaleMin) : null,
            estimatedResaleMax: estimatedResaleMax.trim() ? Number(estimatedResaleMax) : null,
            priceRecommendation: priceRecommendation.trim() ? Number(priceRecommendation) : null,
            attributes: {
              importSource: trimmedLookupQuery || trimmedSourceUrl ? "MANUAL_LOOKUP" : "MANUAL_ENTRY",
              ...(trimmedLookupQuery
                ? {
                    sourceQuery: trimmedLookupQuery
                  }
                : {}),
              ...(trimmedSourceUrl
                ? {
                    primarySourceUrl: trimmedSourceUrl,
                    referenceUrls: [trimmedSourceUrl]
                  }
                : {}),
              ...(identifier.trim()
                ? {
                    identifier: normalizeIdentifier(identifier)
                  }
                : {}),
              ...(description.trim()
                ? {
                    description: description.trim()
                  }
                : {}),
              ...(parsedLabels.length > 0
                ? {
                    labels: parsedLabels
                  }
                : {}),
              ...(internalNote.trim()
                ? {
                    internalNote: internalNote.trim()
                  }
                : {})
            }
          })
        });
        const payload = (await response.json()) as { error?: string; item?: { id: string } };

        if (!response.ok || !payload.item?.id) {
          throw new Error(payload.error ?? "Could not create this inventory item");
        }

        router.push(`/inventory/${payload.item.id}`);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Could not create this inventory item");
      }
    });
  }

  return (
    <div className="inventory-create-page">
      <section className="inventory-create-hero">
        <div className="inventory-create-hero-copy">
          <p className="eyebrow">Create inventory</p>
          <h2>Build the item record once, then finish the listing where it sells.</h2>
          <p className="muted">
            Use manual or source lookup here, or jump to scan when you have a barcode and want the fastest path into Mollie.
          </p>
        </div>
        <div className="inventory-create-hero-actions">
          <Link href="/inventory">
            <Button kind="ghost" type="button">
              <ArrowLeft size={16} /> Back to inventory
            </Button>
          </Link>
          <Link href="/inventory?scan=barcode">
            <Button type="button">
              <Camera size={16} /> Scan item instead
            </Button>
          </Link>
        </div>
      </section>

      <div className="inventory-create-layout">
        <aside className="inventory-create-sidebar inventory-create-intake-rail">
          <section className="inventory-create-panel inventory-create-mode-card">
            <div className="inventory-create-mode-header">
              <Camera size={18} />
              <div>
                <strong>Start from scan</strong>
                <p className="muted">Use the camera when the item has a code, or when you want photos and price signals before saving.</p>
              </div>
            </div>
            <Link className="secondary-link-button" href="/inventory?scan=barcode">
              <Camera size={16} /> Open scanner
            </Link>
          </section>

          <section className="inventory-create-panel inventory-create-mode-card inventory-create-mode-card-active">
            <div className="inventory-create-mode-header">
              <Search size={18} />
              <div>
                <strong>Manual and source lookup</strong>
                <p className="muted">Research the item, prefill what you trust, then create the inventory record without leaving the workflow.</p>
              </div>
            </div>
          </section>

          <section className="inventory-create-panel inventory-create-mode-card">
            <div className="inventory-create-mode-header">
              <Sparkles size={18} />
              <div>
                <strong>Create now, enrich later</strong>
                <p className="muted">Mollie does not need the perfect listing yet. Save the item, then add photos and marketplace detail on the item page.</p>
              </div>
            </div>
          </section>
        </aside>

        <form className="inventory-create-form" onSubmit={handleSubmit}>
          <section className="inventory-create-panel inventory-create-photo-panel">
            <div className="inventory-create-section-heading">
              <div>
                <p className="eyebrow">Photos</p>
                <h3>Add images after save or start from scan now</h3>
              </div>
              <Link className="secondary-link-button" href="/inventory?scan=barcode">
                <Camera size={16} /> Scan with camera
              </Link>
            </div>
            <div className="inventory-create-photo-dropzone">
              <Plus size={28} />
              <strong>No photos attached yet</strong>
              <p className="muted">The item detail page supports image upload and ordering. This screen focuses on getting the record created fast.</p>
            </div>
          </section>

          <SourceSearchPanel
            description="Search for the product in another tab, paste the strongest source URL you find, and use those details as editable prefills rather than automatic truth."
            query={lookupQuery}
            sourceUrl={sourceUrl}
            title="Manual/source lookup"
            onQueryChange={setLookupQuery}
            onSourceUrlChange={setSourceUrl}
          />

          <section className="inventory-create-panel">
            <div className="inventory-create-section-heading">
              <div>
                <p className="eyebrow">Core item</p>
                <h3>Capture the shared listing details once</h3>
              </div>
            </div>
            <div className="inventory-create-grid">
              <label className="label inventory-create-grid-span-2">
                Title
                <input className="field" required value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="label">
                Brand
                <input className="field" value={brand} onChange={(event) => setBrand(event.target.value)} />
              </label>
              <label className="label">
                Identifier
                <input className="field" placeholder="Optional UPC, EAN, or store code" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
              </label>
              <label className="label">
                Category
                <input className="field" required value={category} onChange={(event) => setCategory(event.target.value)} />
              </label>
              <label className="label">
                Condition
                <input className="field" required value={condition} onChange={(event) => setCondition(event.target.value)} />
              </label>
              <label className="label">
                Size
                <input className="field" value={size} onChange={(event) => setSize(event.target.value)} />
              </label>
              <label className="label">
                Color
                <input className="field" value={color} onChange={(event) => setColor(event.target.value)} />
              </label>
              <label className="label">
                Quantity
                <input className="field" min="1" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
              </label>
              <label className="label inventory-create-grid-span-2">
                Description
                <textarea className="field textarea-field" placeholder="Shared listing copy, measurements, flaws, or source notes you want to keep with the item." value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
            </div>
          </section>

          <section className="inventory-create-panel">
            <div className="inventory-create-section-heading">
              <div>
                <p className="eyebrow">Pricing and notes</p>
                <h3>Save enough context to move directly into sell work</h3>
              </div>
            </div>
            <div className="inventory-create-grid">
              <label className="label">
                Cost of goods
                <input className="field" min="0" step="0.01" type="number" value={costBasis} onChange={(event) => setCostBasis(event.target.value)} />
              </label>
              <label className="label">
                Suggested sell
                <input className="field" min="0" step="0.01" type="number" value={priceRecommendation} onChange={(event) => setPriceRecommendation(event.target.value)} />
              </label>
              <label className="label">
                Resale min
                <input className="field" min="0" step="0.01" type="number" value={estimatedResaleMin} onChange={(event) => setEstimatedResaleMin(event.target.value)} />
              </label>
              <label className="label">
                Resale max
                <input className="field" min="0" step="0.01" type="number" value={estimatedResaleMax} onChange={(event) => setEstimatedResaleMax(event.target.value)} />
              </label>
              <label className="label">
                Labels
                <input className="field" placeholder="summer, shoes, priority" value={labels} onChange={(event) => setLabels(event.target.value)} />
              </label>
              <label className="label inventory-create-grid-span-2">
                Internal note
                <textarea className="field textarea-field" placeholder="Condition callouts, sourcing notes, cleaning tasks, or anything the team should know before listing." value={internalNote} onChange={(event) => setInternalNote(event.target.value)} />
              </label>
            </div>
          </section>

          {error ? <div className="notice">{error}</div> : null}

          <ActionRail>
            <div className="inventory-create-action-rail">
              <div className="muted">
                Creating this item opens the full item workspace so you can add photos, select marketplaces, and keep editing.
              </div>
              <div className="actions">
                <Link href="/inventory?scan=barcode">
                  <Button kind="secondary" type="button">
                    <Camera size={16} /> Scan instead
                  </Button>
                </Link>
                <Button data-testid="manual-inventory-create" disabled={pending} type="submit">
                  <Plus size={16} /> {pending ? "Creating..." : "Create item"}
                </Button>
              </div>
            </div>
          </ActionRail>
        </form>

        <aside className="inventory-create-sidebar">
          <section className="inventory-create-panel">
            <p className="eyebrow">Record status</p>
            <div className="inventory-create-sidebar-stack">
              <div className="inventory-create-stat">
                <span className="muted">SKU</span>
                <strong>Generated after save</strong>
              </div>
              <div className="inventory-create-stat">
                <span className="muted">Source mode</span>
                <strong>{lookupQuery.trim() || sourceUrl.trim() ? "Manual lookup" : "Manual entry"}</strong>
              </div>
              <div className="inventory-create-stat">
                <span className="muted">Next step</span>
                <strong>Add photos and choose marketplaces</strong>
              </div>
            </div>
          </section>

          <section className="inventory-create-panel">
            <p className="eyebrow">Operator checklist</p>
            <div className="inventory-create-checklist">
              <div className="inventory-create-checklist-item">
                <strong>1. Create the shared item</strong>
                <span>Capture the inventory facts once so the listing workspace starts from one source of truth.</span>
              </div>
              <div className="inventory-create-checklist-item">
                <strong>2. Add photos after save</strong>
                <span>Upload, reorder, and manage images on the item page once the record exists.</span>
              </div>
              <div className="inventory-create-checklist-item">
                <strong>3. Publish deliberately</strong>
                <span>Use the sell workspace on the item page to pick marketplaces and post only when blockers are clear.</span>
              </div>
            </div>
          </section>

          <section className="inventory-create-panel">
            <div className="inventory-create-section-heading">
              <div>
                <p className="eyebrow">Source links</p>
                <h3>Keep outside research close</h3>
              </div>
            </div>
            <div className="inventory-create-sidebar-stack">
              {sourceUrl.trim() ? (
                <a className="secondary-link-button" href={sourceUrl.trim()} rel="noreferrer" target="_blank">
                  <ExternalLink size={16} /> Open source page
                </a>
              ) : (
                <div className="muted">Paste a source URL to keep the reference attached to this item.</div>
              )}
            </div>
          </section>

          <section className="inventory-create-panel">
            <div className="inventory-create-section-heading">
              <div>
                <p className="eyebrow">Duplicate check</p>
                <h3>Avoid double-listing the same inventory</h3>
              </div>
            </div>
            {duplicateMatches.length === 0 ? <div className="muted">No likely duplicates yet. Mollie will compare the title and identifier as you type.</div> : null}
            {duplicateMatches.length > 0 ? (
              <div className="notice warning">
                <strong>Possible duplicate</strong>
                <ul className="marketplace-hint-list">
                  {duplicateMatches.map((item) => (
                    <li key={item.id}>
                      <Link href={`/inventory/${item.id}`}>{item.title}</Link>
                      {typeof item.attributesJson?.identifier === "string" ? ` - ${item.attributesJson.identifier}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
