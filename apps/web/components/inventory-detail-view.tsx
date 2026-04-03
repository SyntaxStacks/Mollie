"use client";

import QRCode from "qrcode";
import {
  Camera,
  Copy,
  ExternalLink,
  QrCode,
  RefreshCw,
  Smartphone,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { OperatorHint } from "@reselleros/types";
import { Button } from "@reselleros/ui";

import { currency, formatDate } from "../lib/api";
import {
  getItemLifecycleState,
  getListingReadinessFlags,
  getMarketplaceStatusSummaries,
  getNextActionLabel,
  getProfitEstimate,
  getItemPrimaryImage
} from "../lib/item-lifecycle";
import { ActionRail } from "./action-rail";
import { MarketplaceStatusRow } from "./marketplace-status-row";
import { MissingFieldsPanel } from "./missing-fields-panel";
import { OperatorHintCard } from "./operator-hint-card";
import { ProfitBadge } from "./profit-badge";
import { SectionCard } from "./section-card";
import { StatusPill } from "./status-pill";

export type InventoryDetailRecord = {
  id: string;
  title: string;
  sku: string;
  status: string;
  brand?: string | null;
  category: string;
  condition: string;
  size?: string | null;
  color?: string | null;
  quantity?: number | null;
  costBasis?: number | null;
  priceRecommendation: number | null;
  estimatedResaleMin: number | null;
  estimatedResaleMax: number | null;
  attributesJson?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
  images: Array<{ id: string; url: string; position: number }>;
  listingDrafts: Array<{
    id: string;
    platform: string;
    reviewStatus: string;
    generatedTitle: string;
    generatedPrice: number;
    attributesJson: Record<string, unknown> | null;
  }>;
  platformListings: Array<{ id: string; platform: string; status: string; externalUrl: string | null }>;
  sales: Array<{ id: string; soldPrice: number; soldAt: string }>;
};

export type InventoryPreflightRecord = {
  state: string | null;
  mode: "live" | "simulated";
  ready: boolean;
  summary: string;
  selectedCredentialType: string | null;
  hint?: OperatorHint | null;
  checks: Array<{
    key: string;
    label: string;
    status: string;
    detail: string;
  }>;
};

type InventoryDetailViewProps = {
  item: InventoryDetailRecord;
  pending: boolean;
  submitError: string | null;
  uploadStatus: string | null;
  onAddImage: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteImage: (imageId: string) => void;
  onDeleteItem: () => void;
  onMoveImage: (imageId: string, direction: -1 | 1) => void;
  onGenerateDrafts: () => void;
  onPublishEbay: () => void;
  onPublishDepop: () => void;
  onPublishPoshmark: () => void;
  onPublishWhatnot: () => void;
  onPublishLinked: () => void;
  handoffUrl: string;
  continuityNotice: string | null;
  lastSyncedLabel: string | null;
  ebayPreflight: InventoryPreflightRecord | null;
  ebayPreflightError: string | null;
  ebayDraft: InventoryDetailRecord["listingDrafts"][number] | null;
  ebayDraftForm: {
    generatedTitle: string;
    generatedPrice: string;
    ebayCategoryId: string;
    ebayStoreCategoryId: string;
  };
  onEbayDraftFormChange: (field: "generatedTitle" | "generatedPrice" | "ebayCategoryId" | "ebayStoreCategoryId", value: string) => void;
  onSaveEbayDraft: (event: FormEvent<HTMLFormElement>) => void;
  onApproveEbayDraft: () => void;
  itemForm: {
    title: string;
    brand: string;
    category: string;
    condition: string;
    size: string;
    color: string;
    quantity: string;
    costBasis: string;
    estimatedResaleMin: string;
    estimatedResaleMax: string;
    priceRecommendation: string;
  };
  onFieldChange: (
    field: "title" | "brand" | "category" | "condition" | "size" | "color" | "quantity" | "costBasis" | "estimatedResaleMin" | "estimatedResaleMax" | "priceRecommendation",
    value: string
  ) => void;
  onSaveItemDetails: (event: FormEvent<HTMLFormElement>) => void;
};

function ContinueOnMobileModal({
  open,
  url,
  title,
  onClose
}: {
  open: boolean;
  url: string;
  title: string;
  onClose: () => void;
}) {
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !url) {
      setQrCodeUrl(null);
      return;
    }

    let active = true;
    void QRCode.toDataURL(url, {
      width: 280,
      margin: 1,
      color: {
        dark: "#102218",
        light: "#0000"
      }
    }).then((nextUrl) => {
      if (active) {
        setQrCodeUrl(nextUrl);
      }
    });

    return () => {
      active = false;
    };
  }, [open, url]);

  if (!open) {
    return null;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus("Link copied");
      window.setTimeout(() => setCopyStatus(null), 2_500);
    } catch {
      setCopyStatus("Copy failed");
      window.setTimeout(() => setCopyStatus(null), 2_500);
    }
  }

  return (
    <div className="handoff-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        aria-labelledby="continue-on-mobile-title"
        aria-modal="true"
        className="handoff-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="handoff-modal-header">
          <div>
            <p className="eyebrow">Cross-device handoff</p>
            <h3 id="continue-on-mobile-title">Continue on mobile</h3>
          </div>
          <Button kind="ghost" onClick={onClose}>
            <X size={16} /> Close
          </Button>
        </div>
        <p className="handoff-copy">
          Open this item on your phone to add photos or make quick edits. The same inventory page stays in sync across devices.
        </p>
        <div className="handoff-qr-panel">
          <div className="handoff-qr-shell">
            {qrCodeUrl ? <img alt={`QR code for ${title}`} className="handoff-qr-image" src={qrCodeUrl} /> : <QrCode size={96} />}
          </div>
          <div className="handoff-link-stack">
            <label className="label">
              Canonical item URL
              <input
                aria-label="Canonical inventory item URL"
                className="field"
                data-testid="continue-on-mobile-url"
                readOnly
                value={url}
              />
            </label>
            <div className="actions">
              <Button data-testid="continue-on-mobile-copy" kind="secondary" onClick={copyLink}>
                <Copy size={16} /> Copy link
              </Button>
              <a className="handoff-open-link" href={url} rel="noreferrer" target="_blank">
                <ExternalLink size={16} />
                Open link
              </a>
            </div>
            {copyStatus ? <div className="continuity-note" role="status">{copyStatus}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function getIdentifierValue(item: InventoryDetailRecord) {
  const attributes = item.attributesJson ?? {};
  const candidates = [
    attributes.identifier,
    attributes.barcode,
    attributes.upc,
    attributes.ean,
    attributes.isbn,
    attributes.code128
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return item.sku;
}

function lifecycleTone(state: string) {
  if (state === "ready_to_list" || state === "listed") {
    return "success" as const;
  }

  if (state === "error") {
    return "danger" as const;
  }

  if (state === "listing_in_progress") {
    return "accent" as const;
  }

  return "neutral" as const;
}

export function InventoryDetailView({
  item,
  pending,
  submitError,
  uploadStatus,
  onAddImage,
  onDeleteImage,
  onDeleteItem,
  onMoveImage,
  onGenerateDrafts,
  onPublishEbay,
  onPublishDepop,
  onPublishPoshmark,
  onPublishWhatnot,
  onPublishLinked,
  handoffUrl,
  continuityNotice,
  lastSyncedLabel,
  ebayPreflight,
  ebayPreflightError,
  ebayDraft,
  ebayDraftForm,
  onEbayDraftFormChange,
  onSaveEbayDraft,
  onApproveEbayDraft,
  itemForm,
  onFieldChange,
  onSaveItemDetails
}: InventoryDetailViewProps) {
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const image = getItemPrimaryImage(item);
  const readinessFlags = getListingReadinessFlags(item);
  const marketStatuses = getMarketplaceStatusSummaries(item);
  const lifecycle = getItemLifecycleState(item);
  const profit = getProfitEstimate(item);
  const nextAction = getNextActionLabel(item);
  const identifier = getIdentifierValue(item);

  const historyRows = useMemo(() => {
    const rows: Array<{ id: string; label: string; detail: string; meta: string }> = [];

    for (const sale of item.sales) {
      rows.push({
        id: `sale-${sale.id}`,
        label: "Sold",
        detail: `Sold for ${currency(sale.soldPrice)}`,
        meta: formatDate(sale.soldAt)
      });
    }

    for (const listing of item.platformListings) {
      rows.push({
        id: `listing-${listing.id}`,
        label: `${listing.platform} listing`,
        detail: listing.status.replace(/_/g, " "),
        meta: listing.externalUrl ?? "No marketplace URL saved"
      });
    }

    for (const draft of item.listingDrafts) {
      rows.push({
        id: `draft-${draft.id}`,
        label: `${draft.platform} draft`,
        detail: draft.reviewStatus.replace(/_/g, " "),
        meta: draft.generatedTitle
      });
    }

    return rows;
  }, [item.listingDrafts, item.platformListings, item.sales]);

  return (
    <>
      <section className="detail-page-stack">
        <SectionCard
          action={<StatusPill label={lifecycle.replace(/_/g, " ")} tone={lifecycleTone(lifecycle)} />}
          className="detail-snapshot-card"
          eyebrow="Snapshot"
          title={item.title}
        >
          <div className="detail-snapshot-layout">
            <div className="detail-primary-image-shell">
              {image ? <img alt={item.title} className="detail-primary-image" src={image} /> : <div className="detail-primary-image detail-primary-image-empty">No photo yet</div>}
            </div>

            <div className="detail-snapshot-copy">
              <div className="detail-snapshot-topline">
                <div>
                  <p className="eyebrow">Next action</p>
                  <h2 className="detail-item-title">{nextAction}</h2>
                </div>
                <ProfitBadge value={profit} />
              </div>

              <div className="detail-metric-grid">
                <div className="metric">
                  <span className="muted">Buy cost</span>
                  <strong>{currency(item.costBasis ?? 0)}</strong>
                </div>
                <div className="metric">
                  <span className="muted">Suggested sell</span>
                  <strong>{currency(item.priceRecommendation)}</strong>
                </div>
                <div className="metric">
                  <span className="muted">Resale range</span>
                  <strong>{currency(item.estimatedResaleMin)}-{currency(item.estimatedResaleMax)}</strong>
                </div>
                <div className="metric">
                  <span className="muted">Condition</span>
                  <strong>{item.condition}</strong>
                </div>
              </div>

              {continuityNotice ? (
                <div className="continuity-note" role="status">
                  <RefreshCw size={14} />
                  <span>{continuityNotice}</span>
                </div>
              ) : null}
              {lastSyncedLabel ? <p className="inventory-sync-copy">Continuity refresh active. Last checked {lastSyncedLabel}.</p> : null}
            </div>
          </div>
        </SectionCard>

        <ActionRail>
          <Button disabled={pending} onClick={onGenerateDrafts}>
            Generate drafts
          </Button>
          <Button disabled={pending} kind="secondary" onClick={onPublishLinked}>
            Publish linked accounts
          </Button>
          <Button disabled={pending} kind="secondary" onClick={() => setDeleteConfirmOpen(true)}>
            Delete item
          </Button>
          <Button className="detail-mobile-handoff" data-testid="continue-on-mobile-trigger" kind="secondary" onClick={() => setHandoffOpen(true)}>
            <Smartphone size={16} /> Continue on mobile
          </Button>
        </ActionRail>

        {submitError ? <div className="notice">{submitError}</div> : null}
        {uploadStatus ? <div className="notice success">{uploadStatus}</div> : null}

        <div className="detail-section-grid">
          <SectionCard eyebrow="Identification" title="How Mollie knows this item">
            <div className="detail-meta-list">
              <div className="detail-meta-row">
                <span className="muted">SKU</span>
                <strong>{item.sku}</strong>
              </div>
              <div className="detail-meta-row">
                <span className="muted">Identifier</span>
                <strong>{identifier}</strong>
              </div>
              <div className="detail-meta-row">
                <span className="muted">Brand</span>
                <strong>{item.brand?.trim() || "Not set yet"}</strong>
              </div>
              <div className="detail-meta-row">
                <span className="muted">Category</span>
                <strong>{item.category}</strong>
              </div>
            </div>
          </SectionCard>

          <SectionCard eyebrow="Inventory Info" title="Keep the item sellable">
            <form className="stack" onSubmit={onSaveItemDetails}>
              <MissingFieldsPanel flags={readinessFlags} />
              <div className="scan-import-grid">
                <label className="label">
                  Title
                  <input className="field" required value={itemForm.title} onChange={(event) => onFieldChange("title", event.target.value)} />
                </label>
                <label className="label">
                  Brand
                  <input className="field" value={itemForm.brand} onChange={(event) => onFieldChange("brand", event.target.value)} />
                </label>
                <label className="label">
                  Category
                  <input className="field" required value={itemForm.category} onChange={(event) => onFieldChange("category", event.target.value)} />
                </label>
                <label className="label">
                  Condition
                  <input className="field" required value={itemForm.condition} onChange={(event) => onFieldChange("condition", event.target.value)} />
                </label>
                <label className="label">
                  Size
                  <input className="field" value={itemForm.size} onChange={(event) => onFieldChange("size", event.target.value)} />
                </label>
                <label className="label">
                  Color
                  <input className="field" value={itemForm.color} onChange={(event) => onFieldChange("color", event.target.value)} />
                </label>
                <label className="label">
                  Quantity
                  <input className="field" min="1" type="number" value={itemForm.quantity} onChange={(event) => onFieldChange("quantity", event.target.value)} />
                </label>
                <label className="label">
                  Buy cost
                  <input className="field" min="0" step="0.01" type="number" value={itemForm.costBasis} onChange={(event) => onFieldChange("costBasis", event.target.value)} />
                </label>
                <label className="label">
                  Suggested sell
                  <input className="field" min="0" step="0.01" type="number" value={itemForm.priceRecommendation} onChange={(event) => onFieldChange("priceRecommendation", event.target.value)} />
                </label>
                <label className="label">
                  Resale min
                  <input className="field" min="0" step="0.01" type="number" value={itemForm.estimatedResaleMin} onChange={(event) => onFieldChange("estimatedResaleMin", event.target.value)} />
                </label>
                <label className="label">
                  Resale max
                  <input className="field" min="0" step="0.01" type="number" value={itemForm.estimatedResaleMax} onChange={(event) => onFieldChange("estimatedResaleMax", event.target.value)} />
                </label>
              </div>
              <div className="actions">
                <Button disabled={pending} type="submit">
                  Save item details
                </Button>
              </div>
            </form>
            <form className="stack inventory-image-form" onSubmit={onAddImage}>
              <label className="label">
                Upload image
                <input accept="image/png,image/jpeg,image/webp,image/gif" className="field" name="image" required type="file" />
              </label>
              <label className="label">
                Position
                <input className="field" defaultValue="0" min="0" name="position" type="number" />
              </label>
              <Button data-testid="inventory-upload-submit" disabled={pending} type="submit">
                <Camera size={16} /> {pending ? "Uploading..." : "Upload image"}
              </Button>
            </form>

            <div className="detail-image-list">
              {item.images.length === 0 ? <div className="muted">No images uploaded yet.</div> : null}
              {item.images.map((entry, index) => (
                <div className="detail-image-card" data-image-id={entry.id} key={entry.id}>
                  <img alt={`${item.title} image ${index + 1}`} className="image-upload-preview" src={entry.url} />
                  <div className="stack">
                    <div className="split">
                      <strong>Photo {index + 1}</strong>
                      <span className="muted">Position {entry.position + 1}</span>
                    </div>
                    <div className="actions inventory-image-actions">
                      <Button disabled={pending || index === 0} kind="secondary" onClick={() => onMoveImage(entry.id, -1)} type="button">
                        Move up
                      </Button>
                      <Button disabled={pending || index === item.images.length - 1} kind="secondary" onClick={() => onMoveImage(entry.id, 1)} type="button">
                        Move down
                      </Button>
                      <Button disabled={pending} kind="secondary" onClick={() => onDeleteImage(entry.id)} type="button">
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard eyebrow="Selling Setup" title="Get the item ready to publish">
            <div className="detail-sell-grid">
              <div className="market-observation-card">
                <div className="split">
                  <div>
                    <p className="eyebrow">Marketplace work</p>
                    <strong>Queue and publish</strong>
                  </div>
                  <div className="market-observation-value">{marketStatuses.filter((state) => state.state === "published").length} live</div>
                </div>
                <div className="actions wrap-actions">
                  <Button disabled={pending} kind="secondary" onClick={onPublishEbay} type="button">
                    Publish eBay
                  </Button>
                  <Button disabled={pending} kind="secondary" onClick={onPublishDepop} type="button">
                    Publish Depop
                  </Button>
                  <Button disabled={pending} kind="secondary" onClick={onPublishPoshmark} type="button">
                    Publish Poshmark
                  </Button>
                  <Button disabled={pending} kind="secondary" onClick={onPublishWhatnot} type="button">
                    Publish Whatnot
                  </Button>
                </div>
              </div>

              <div className="market-observation-card">
                <div className="split">
                  <div>
                    <p className="eyebrow">eBay draft</p>
                    <strong>Live listing fields</strong>
                  </div>
                  <div className="market-observation-value">{ebayDraft ? ebayDraft.reviewStatus : "Missing"}</div>
                </div>

                {!ebayDraft ? (
                  <div className="muted">Generate an eBay draft first, then map the live listing category here.</div>
                ) : (
                  <form className="stack" onSubmit={onSaveEbayDraft}>
                    <label className="label">
                      eBay title
                      <input
                        className="field"
                        name="generatedTitle"
                        required
                        value={ebayDraftForm.generatedTitle}
                        onChange={(event) => onEbayDraftFormChange("generatedTitle", event.target.value)}
                      />
                    </label>
                    <label className="label">
                      eBay price
                      <input
                        className="field"
                        min="0"
                        name="generatedPrice"
                        required
                        step="0.01"
                        type="number"
                        value={ebayDraftForm.generatedPrice}
                        onChange={(event) => onEbayDraftFormChange("generatedPrice", event.target.value)}
                      />
                    </label>
                    <label className="label">
                      eBay category ID
                      <input
                        className="field"
                        name="ebayCategoryId"
                        placeholder="15724"
                        value={ebayDraftForm.ebayCategoryId}
                        onChange={(event) => onEbayDraftFormChange("ebayCategoryId", event.target.value)}
                      />
                    </label>
                    <label className="label">
                      eBay store category ID
                      <input
                        className="field"
                        name="ebayStoreCategoryId"
                        placeholder="Optional"
                        value={ebayDraftForm.ebayStoreCategoryId}
                        onChange={(event) => onEbayDraftFormChange("ebayStoreCategoryId", event.target.value)}
                      />
                    </label>
                    <div className="actions">
                      <Button disabled={pending} type="submit">
                        Save eBay draft
                      </Button>
                      {ebayDraft.reviewStatus !== "APPROVED" ? (
                        <Button disabled={pending} kind="secondary" onClick={onApproveEbayDraft} type="button">
                          Approve eBay draft
                        </Button>
                      ) : null}
                    </div>
                  </form>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard
            action={<StatusPill label={ebayPreflight?.state ?? (ebayPreflight?.ready ? "ready" : "blocked")} tone={ebayPreflight?.ready ? "success" : "warning"} />}
            eyebrow="Marketplace Status"
            title="What is live, blocked, or waiting"
          >
            {ebayPreflightError ? <div className="notice">{ebayPreflightError}</div> : null}
            <div className="marketplace-status-stack">
              {marketStatuses.map((state) => (
                <MarketplaceStatusRow
                  key={state.platform}
                  onAction={
                    state.platform === "EBAY"
                      ? onPublishEbay
                      : state.platform === "DEPOP"
                        ? onPublishDepop
                        : state.platform === "POSHMARK"
                          ? onPublishPoshmark
                          : state.platform === "WHATNOT"
                            ? onPublishWhatnot
                            : null
                  }
                  state={state}
                />
              ))}
            </div>

            {ebayPreflight ? (
              <div className="stack">
                <OperatorHintCard hint={ebayPreflight.hint} />
                <div className="notice">{ebayPreflight.summary}</div>
                <div className="inventory-preflight-meta">
                  <span>State: {ebayPreflight.state ?? "none"}</span>
                  <span>Account: {ebayPreflight.selectedCredentialType ?? "none"}</span>
                </div>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard eyebrow="History" title="What happened to this item">
            <div className="activity-list">
              {historyRows.length === 0 ? <div className="muted">No history yet. Scan, draft, publish, and sell activity will show up here.</div> : null}
              {historyRows.map((row) => (
                <div className="activity-row" key={row.id}>
                  <div>
                    <strong>{row.label}</strong>
                    <div className="muted">{row.detail}</div>
                  </div>
                  <div className="muted">{row.meta}</div>
                </div>
              ))}
              <div className="activity-row">
                <div>
                  <strong>Item record</strong>
                  <div className="muted">Created in inventory and ready for progressive enrichment.</div>
                </div>
                <div className="muted">{item.createdAt ? formatDate(item.createdAt) : "Recently created"}</div>
              </div>
            </div>
          </SectionCard>
        </div>
      </section>

      <ContinueOnMobileModal onClose={() => setHandoffOpen(false)} open={handoffOpen} title={item.title} url={handoffUrl} />
      {deleteConfirmOpen ? (
        <div className="handoff-modal-backdrop" role="presentation" onClick={() => setDeleteConfirmOpen(false)}>
          <div
            aria-labelledby="delete-item-title"
            aria-modal="true"
            className="handoff-modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="handoff-modal-header">
              <div>
                <p className="eyebrow">Delete item</p>
                <h3 id="delete-item-title">Remove this item from Mollie</h3>
              </div>
              <Button disabled={pending} kind="ghost" onClick={() => setDeleteConfirmOpen(false)} type="button">
                <X size={16} /> Close
              </Button>
            </div>
            <p className="handoff-copy">
              Delete <strong>{item.title}</strong> and remove its images, drafts, marketplace listings, and sales history from this workspace.
            </p>
            <div className="actions">
              <Button
                disabled={pending}
                kind="secondary"
                onClick={() => setDeleteConfirmOpen(false)}
                type="button"
              >
                Keep item
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  setDeleteConfirmOpen(false);
                  onDeleteItem();
                }}
                type="button"
              >
                Delete permanently
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
