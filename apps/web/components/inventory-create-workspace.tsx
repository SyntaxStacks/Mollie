"use client";

import Link from "next/link";
import { ArrowLeft, Camera, ExternalLink, Plus, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";

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

function formatCurrencyInput(value: string) {
  const parsed = Number(value || 0);

  if (!Number.isFinite(parsed)) {
    return "$0";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: parsed % 1 === 0 ? 0 : 2
  }).format(parsed);
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
  const marketplaceRailRef = useRef<HTMLElement | null>(null);
  const detailEditorMainRef = useRef<HTMLDivElement | null>(null);
  const detailSidebarRef = useRef<HTMLDivElement | null>(null);

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

  const workingTitle = title.trim() || "New inventory item";
  const sourceMode = lookupQuery.trim() || sourceUrl.trim() ? "Manual lookup" : "Manual entry";
  const nextStep = title.trim() ? "Create item and move into listing work" : "Name the item and capture the shared facts";
  const duplicateSummary =
    duplicateMatches.length === 0
      ? "No likely duplicates"
      : `${duplicateMatches.length} possible duplicate${duplicateMatches.length === 1 ? "" : "s"}`;
  const resaleRangeLabel = `${formatCurrencyInput(estimatedResaleMin)}-${formatCurrencyInput(estimatedResaleMax)}`;

  useEffect(() => {
    const columns = [marketplaceRailRef.current, detailEditorMainRef.current, detailSidebarRef.current];
    for (const column of columns) {
      if (column) {
        column.scrollTop = 0;
      }
    }
  }, []);

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
    <section className="inventory-create-page detail-page-stack detail-editor-page">
      <div className="detail-editor-header">
        <div className="detail-editor-titleblock">
          <p className="eyebrow">Listing workspace</p>
          <h2 className="detail-editor-title">{workingTitle}</h2>
          <p className="muted">
            Start the item in the same workspace shape you use later: intake on the left, shared listing in the center,
            and snapshot context on the right.
          </p>
        </div>
        <div className="detail-editor-header-actions">
          <Link href="/inventory">
            <Button kind="ghost" type="button">Inventory</Button>
          </Link>
          <Link href="/inventory?scan=barcode">
            <Button kind="secondary" type="button">
              <Camera size={16} /> Scan instead
            </Button>
          </Link>
        </div>
      </div>

      {error ? <div className="notice">{error}</div> : null}

      <div className="detail-editor-workspace">
        <div className="listing-workbench-layout detail-editor-layout">
          <aside className="listing-marketplace-rail inventory-create-intake-rail" ref={marketplaceRailRef}>
            <div className="listing-rail-summary">
              <div className="listing-rail-summary-copy">
                <p className="eyebrow">Create path</p>
                <strong>{sourceMode === "Manual lookup" ? "Researching before save" : "Create the shared item first"}</strong>
                <p className="muted listing-rail-helper">
                  This page now mirrors item detail so the same left-center-right workflow carries from intake into listing.
                </p>
              </div>
              <Link href="/inventory">
                <Button kind="ghost" type="button">
                  <ArrowLeft size={16} /> Back
                </Button>
              </Link>
            </div>

            <div className="inventory-create-rail-stack">
              <section className="inventory-create-mode-card inventory-create-mode-card-active">
                <div className="inventory-create-mode-header">
                  <Search size={18} />
                  <div>
                    <strong>Manual/source lookup</strong>
                    <p className="muted">
                      Research the item, keep only the facts you trust, and start the shared record without leaving the workspace.
                    </p>
                  </div>
                </div>
              </section>

              <section className="inventory-create-mode-card">
                <div className="inventory-create-mode-header">
                  <Camera size={18} />
                  <div>
                    <strong>Start from scan</strong>
                    <p className="muted">Use scan when you have a barcode and want the fastest route into inventory.</p>
                  </div>
                </div>
                <Link className="secondary-link-button" href="/inventory?scan=barcode">
                  <Camera size={16} /> Open scanner
                </Link>
              </section>

              <section className="inventory-create-mode-card">
                <div className="inventory-create-mode-header">
                  <Sparkles size={18} />
                  <div>
                    <strong>Enrich after save</strong>
                    <p className="muted">
                      Photos, marketplace setup, and posting controls all open in the same workspace right after creation.
                    </p>
                  </div>
                </div>
              </section>
            </div>
          </aside>

          <div className="detail-editor-main" ref={detailEditorMainRef}>
            <div className="listing-form-section listing-photo-panel">
              <div className="listing-form-section-heading listing-photo-section-heading">
                <div className="listing-photo-section-heading-copy">
                  <h3>Photos</h3>
                  <p className="muted">Start from scan now or create the item first and upload, reorder, and review images on the item page.</p>
                </div>
                <Link href="/inventory?scan=barcode">
                  <Button kind="secondary" type="button">
                    <Camera size={16} /> Scan with camera
                  </Button>
                </Link>
              </div>
              <div className="inventory-create-photo-dropzone">
                <Plus size={28} />
                <strong>No photos attached yet</strong>
                <p className="muted">The item detail page will handle photo upload, sorting, cover selection, and cleanup after save.</p>
              </div>
            </div>

            <form className="stack" id="inventory-create-form" onSubmit={handleSubmit}>
              <SourceSearchPanel
                description="Search for the product in another tab, paste the strongest source URL you find, and use those details as editable prefills rather than automatic truth."
                query={lookupQuery}
                sourceUrl={sourceUrl}
                title="Manual/source lookup"
                onQueryChange={setLookupQuery}
                onSourceUrlChange={setSourceUrl}
              />

              <section className="listing-form-section">
                <div className="listing-form-section-heading">
                  <h3>Shared item details</h3>
                  <p className="muted">Capture the core listing facts once so the item page starts from a clean shared record.</p>
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
                    <textarea
                      className="field textarea-field"
                      placeholder="Shared listing copy, measurements, flaws, or source notes you want to keep with the item."
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </label>
                </div>
              </section>

              <section className="listing-form-section">
                <div className="listing-form-section-heading">
                  <h3>Price and notes</h3>
                  <p className="muted">Save enough pricing and operator context that the next screen can move directly into listing work.</p>
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
                    <textarea
                      className="field textarea-field"
                      placeholder="Condition callouts, sourcing notes, cleaning tasks, or anything the team should know before listing."
                      value={internalNote}
                      onChange={(event) => setInternalNote(event.target.value)}
                    />
                  </label>
                </div>
              </section>
            </form>
          </div>

          <aside className="detail-editor-sidebar" ref={detailSidebarRef}>
            <div className="detail-editor-sidebar-card">
              <div className="detail-editor-sidebar-card-topline">
                <div>
                  <p className="eyebrow">Snapshot</p>
                  <strong className="detail-editor-sidebar-title">{nextStep}</strong>
                </div>
              </div>
              <div className="detail-editor-sidebar-metrics">
                <div className="metric"><span className="muted">Buy cost</span><strong>{formatCurrencyInput(costBasis)}</strong></div>
                <div className="metric"><span className="muted">Suggested sell</span><strong>{formatCurrencyInput(priceRecommendation)}</strong></div>
                <div className="metric"><span className="muted">Resale range</span><strong>{resaleRangeLabel}</strong></div>
                <div className="metric"><span className="muted">Condition</span><strong>{condition}</strong></div>
              </div>
              <div className="detail-editor-sidebar-facts">
                <div className="detail-meta-row"><span className="muted">SKU</span><strong>Generated after save</strong></div>
                <div className="detail-meta-row"><span className="muted">Identifier</span><strong>{identifier.trim() || "Not set yet"}</strong></div>
                <div className="detail-meta-row"><span className="muted">Category</span><strong>{category}</strong></div>
                <div className="detail-meta-row"><span className="muted">Brand</span><strong>{brand.trim() || "Not set yet"}</strong></div>
              </div>
            </div>

            <div className="detail-editor-sidebar-card">
              <div className="listing-form-section-heading">
                <h3>Research and duplicate check</h3>
                <p className="muted">Keep the strongest source close and make sure you are not creating the same inventory twice.</p>
              </div>
              <div className="detail-editor-sidebar-facts">
                <div className="detail-meta-row"><span className="muted">Source mode</span><strong>{sourceMode}</strong></div>
                <div className="detail-meta-row"><span className="muted">Duplicate check</span><strong>{duplicateSummary}</strong></div>
              </div>
              {sourceUrl.trim() ? (
                <a className="secondary-link-button" href={sourceUrl.trim()} rel="noreferrer" target="_blank">
                  <ExternalLink size={16} /> Open source page
                </a>
              ) : (
                <div className="muted">Paste a source URL to keep the best external reference attached to this item.</div>
              )}
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
            </div>

            <div className="detail-editor-sidebar-card">
              <div className="listing-form-section-heading">
                <h3>Operator checklist</h3>
                <p className="muted">Keep the first save lean, then let the full item workspace take over.</p>
              </div>
              <div className="inventory-create-checklist">
                <div className="inventory-create-checklist-item">
                  <strong>1. Capture the shared item</strong>
                  <span>Name it, set category and condition, then save the record once.</span>
                </div>
                <div className="inventory-create-checklist-item">
                  <strong>2. Add photos after save</strong>
                  <span>Upload, reorder, and manage images in the item detail workspace.</span>
                </div>
                <div className="inventory-create-checklist-item">
                  <strong>3. Choose marketplaces deliberately</strong>
                  <span>Use the item page to review blockers, pricing, and posting actions after the record exists.</span>
                </div>
              </div>
            </div>
          </aside>
        </div>

        <ActionRail>
          <div className="detail-editor-action-rail inventory-create-action-rail">
            <Button kind="secondary" onClick={() => router.push("/inventory")} type="button">
              <ArrowLeft size={16} /> Back to listings
            </Button>
            <div className="detail-editor-action-rail-buttons">
              <Link href="/inventory?scan=barcode">
                <Button kind="secondary" type="button">
                  <Camera size={16} /> Scan instead
                </Button>
              </Link>
              <Button data-testid="manual-inventory-create" disabled={pending} form="inventory-create-form" type="submit">
                <Plus size={16} /> {pending ? "Creating..." : "Create item"}
              </Button>
            </div>
          </div>
        </ActionRail>
      </div>
    </section>
  );
}
