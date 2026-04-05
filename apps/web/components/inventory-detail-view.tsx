"use client";

import QRCode from "qrcode";
import { Camera, Copy, ExternalLink, LayoutTemplate, Plug2, QrCode, RefreshCw, Sparkles, Smartphone, Truck, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { AiStatusResponse, MarketplaceCapabilitySummary, OperatorHint } from "@reselleros/types";
import { Button } from "@reselleros/ui";

import { currency, formatDate } from "../lib/api";
import {
  getItemLifecycleState,
  getItemPrimaryImage,
  getListingReadinessFlags,
  getMarketplaceStatusSummaries,
  getNextActionLabel,
  getProfitEstimate,
  type MarketplaceAccountLike,
  type MarketplaceActionKind
} from "../lib/item-lifecycle";
import { ActionRail } from "./action-rail";
import { MarketplaceStatusRow } from "./marketplace-status-row";
import { MissingFieldsPanel } from "./missing-fields-panel";
import { OperatorHintCard } from "./operator-hint-card";
import { ProfitBadge } from "./profit-badge";
import { SectionCard } from "./section-card";
import { StatusPill } from "./status-pill";

export type InventoryItemFormState = {
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
  description: string;
  tags: string;
  labels: string;
  shippingWeightValue: string;
  shippingWeightUnit: string;
  shippingLength: string;
  shippingWidth: string;
  shippingHeight: string;
  shippingDimensionUnit: string;
  freeShipping: boolean;
  ebayPrice: string;
  depopPrice: string;
  poshmarkPrice: string;
  whatnotPrice: string;
};

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
  extensionTasks: Array<{
    id: string;
    platform: string;
    action: string;
    state: string;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    createdAt?: string;
    updatedAt?: string;
  }>;
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
  onGenerateDrafts: (platforms: Array<"EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT">) => void;
  onPublishLinked: (platforms: Array<"EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT">) => void;
  onOpenMarketplaces: () => void;
  onMarketplaceAction: (platform: string, action: MarketplaceActionKind) => void;
  onMarketplaceSecondaryAction: (platform: string, action: MarketplaceActionKind) => void;
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
  itemForm: InventoryItemFormState;
  onFieldChange: (field: keyof InventoryItemFormState, value: string | boolean) => void;
  onSaveItemDetails: (event: FormEvent<HTMLFormElement>) => void;
  extensionInstalled: boolean;
  extensionConnected: boolean;
  extensionPendingCount: number;
  extensionLoading: boolean;
  onRefreshExtension: () => void;
  onSendToExtension: () => void;
  extensionActionStatus: string | null;
  marketplaceAccounts: MarketplaceAccountLike[];
  extensionCapabilities: MarketplaceCapabilitySummary[];
  selectedPlatforms: Array<"EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT">;
  onTogglePlatform: (platform: "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT", checked: boolean) => void;
  aiStatus: AiStatusResponse | null;
  aiMessage: string | null;
  aiPendingOperation: "title" | "description" | "price" | null;
  onAiAssist: (operation: "title" | "description" | "price") => void;
};

const templates = [
  { id: "apparel", name: "Apparel quick start", description: "Sizes, condition, and closet-ready defaults.", values: { category: "Apparel", condition: "Good used condition", shippingWeightUnit: "oz", shippingDimensionUnit: "in" } },
  { id: "beauty", name: "Beauty / consumables", description: "Shorter shipping profile and cleaner description defaults.", values: { category: "Beauty & Personal Care", condition: "New", shippingWeightUnit: "oz" } },
  { id: "hardgoods", name: "Hardgoods resale", description: "General merchandise with shipping details in focus.", values: { category: "General Merchandise", condition: "Good used condition", shippingWeightUnit: "lb", shippingDimensionUnit: "in" } }
] as const;

function ContinueOnMobileModal({ open, url, title, onClose }: { open: boolean; url: string; title: string; onClose: () => void }) {
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !url) {
      setQrCodeUrl(null);
      return;
    }
    let active = true;
    void QRCode.toDataURL(url, { width: 280, margin: 1, color: { dark: "#102218", light: "#0000" } }).then((nextUrl) => {
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
      <div aria-labelledby="continue-on-mobile-title" aria-modal="true" className="handoff-modal" role="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="handoff-modal-header">
          <div>
            <p className="eyebrow">Cross-device handoff</p>
            <h3 id="continue-on-mobile-title">Continue on mobile</h3>
          </div>
          <Button kind="ghost" onClick={onClose}>
            <X size={16} /> Close
          </Button>
        </div>
        <p className="handoff-copy">Open this item on your phone to add photos or make quick edits. The same inventory page stays in sync across devices.</p>
        <div className="handoff-qr-panel">
          <div className="handoff-qr-shell">{qrCodeUrl ? <img alt={`QR code for ${title}`} className="handoff-qr-image" src={qrCodeUrl} /> : <QrCode size={96} />}</div>
          <div className="handoff-link-stack">
            <label className="label">
              Canonical item URL
              <input aria-label="Canonical inventory item URL" className="field" data-testid="continue-on-mobile-url" readOnly value={url} />
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
  const candidates = [attributes.identifier, attributes.barcode, attributes.upc, attributes.ean, attributes.isbn, attributes.code128];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return item.sku;
}

function lifecycleTone(state: string) {
  if (state === "ready_to_list" || state === "listed") return "success" as const;
  if (state === "error") return "danger" as const;
  if (state === "listing_in_progress") return "accent" as const;
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
  onPublishLinked,
  onOpenMarketplaces,
  onMarketplaceAction,
  onMarketplaceSecondaryAction,
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
  onSaveItemDetails,
  extensionInstalled,
  extensionConnected,
  extensionPendingCount,
  extensionLoading,
  onRefreshExtension,
  onSendToExtension,
  extensionActionStatus,
  marketplaceAccounts,
  extensionCapabilities,
  selectedPlatforms,
  onTogglePlatform,
  aiStatus,
  aiMessage,
  aiPendingOperation,
  onAiAssist
}: InventoryDetailViewProps) {
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const image = getItemPrimaryImage(item);
  const readinessFlags = getListingReadinessFlags(item);
  const marketStatuses = getMarketplaceStatusSummaries(item, {
    marketplaceAccounts,
    capabilitySummary: extensionCapabilities,
    extensionInstalled,
    extensionConnected
  });
  const lifecycle = getItemLifecycleState(item);
  const profit = getProfitEstimate(item);
  const nextAction = getNextActionLabel(item);
  const identifier = getIdentifierValue(item);
  const recentExtensionTasks = item.extensionTasks.slice(0, 4);
  const selectedCount = selectedPlatforms.length;

  const historyRows = useMemo(() => {
    const rows: Array<{ id: string; label: string; detail: string; meta: string }> = [];
    for (const sale of item.sales) {
      rows.push({ id: `sale-${sale.id}`, label: "Sold", detail: `Sold for ${currency(sale.soldPrice)}`, meta: formatDate(sale.soldAt) });
    }
    for (const listing of item.platformListings) {
      rows.push({ id: `listing-${listing.id}`, label: `${listing.platform} listing`, detail: listing.status.replace(/_/g, " "), meta: listing.externalUrl ?? "No marketplace URL saved" });
    }
    for (const draft of item.listingDrafts) {
      rows.push({ id: `draft-${draft.id}`, label: `${draft.platform} draft`, detail: draft.reviewStatus.replace(/_/g, " "), meta: draft.generatedTitle });
    }
    return rows;
  }, [item.listingDrafts, item.platformListings, item.sales]);

  return (
    <>
      <section className="detail-page-stack">
        <SectionCard action={<StatusPill label={lifecycle.replace(/_/g, " ")} tone={lifecycleTone(lifecycle)} />} className="detail-snapshot-card" eyebrow="Snapshot" title={item.title}>
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
                <div className="metric"><span className="muted">Buy cost</span><strong>{currency(item.costBasis ?? 0)}</strong></div>
                <div className="metric"><span className="muted">Suggested sell</span><strong>{currency(item.priceRecommendation)}</strong></div>
                <div className="metric"><span className="muted">Resale range</span><strong>{currency(item.estimatedResaleMin)}-{currency(item.estimatedResaleMax)}</strong></div>
                <div className="metric"><span className="muted">Condition</span><strong>{item.condition}</strong></div>
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
          <Button disabled={pending || selectedCount === 0} onClick={() => onGenerateDrafts(selectedPlatforms)}>Generate drafts</Button>
          <Button disabled={pending || selectedCount === 0} kind="secondary" onClick={() => onPublishLinked(selectedPlatforms)}>Post selected</Button>
          <Button disabled={pending} kind="secondary" onClick={() => setDeleteConfirmOpen(true)}>Delete item</Button>
          <Button className="detail-mobile-handoff" data-testid="continue-on-mobile-trigger" kind="secondary" onClick={() => setHandoffOpen(true)}>
            <Smartphone size={16} /> Continue on mobile
          </Button>
        </ActionRail>

        {submitError ? <div className="notice">{submitError}</div> : null}
        {uploadStatus ? <div className="notice success">{uploadStatus}</div> : null}
        {aiMessage ? <div className="notice success">{aiMessage}</div> : null}

        <div className="detail-section-grid">
          <SectionCard eyebrow="Identification" title="How Mollie knows this item">
            <div className="detail-meta-list">
              <div className="detail-meta-row"><span className="muted">SKU</span><strong>{item.sku}</strong></div>
              <div className="detail-meta-row"><span className="muted">Identifier</span><strong>{identifier}</strong></div>
              <div className="detail-meta-row"><span className="muted">Brand</span><strong>{item.brand?.trim() || "Not set yet"}</strong></div>
              <div className="detail-meta-row"><span className="muted">Category</span><strong>{item.category}</strong></div>
            </div>
          </SectionCard>

          <SectionCard eyebrow="Listing workspace" title="Choose marketplaces first, then fill one listing form">
            <div className="listing-workbench-layout">
              <aside className="listing-marketplace-rail">
                <div className="listing-rail-summary">
                  <div>
                    <p className="eyebrow">Marketplace targets</p>
                    <strong>{selectedCount} selected</strong>
                  </div>
                  <Button kind="ghost" onClick={onOpenMarketplaces} type="button">Review accounts</Button>
                </div>
                <div className="marketplace-status-stack">
                  {marketStatuses.map((state) => (
                    <MarketplaceStatusRow
                      key={state.platform}
                      selectable
                      selected={selectedPlatforms.includes(state.platform as "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT")}
                      onToggle={(checked) => onTogglePlatform(state.platform as "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT", checked)}
                      onAction={state.actionKind === "unavailable" ? null : () => onMarketplaceAction(state.platform, state.actionKind)}
                      onSecondaryAction={state.secondaryActionKind ? () => onMarketplaceSecondaryAction(state.platform, state.secondaryActionKind ?? "unavailable") : null}
                      state={state}
                    />
                  ))}
                </div>
              </aside>

              <div className="listing-universal-form">
                <div className="stack">
                  <div className="listing-form-toolbar">
                    <div>
                      <p className="eyebrow">Universal listing form</p>
                      <strong>One canonical listing record for every selected marketplace</strong>
                    </div>
                    <Button kind="secondary" onClick={() => setTemplatesOpen(true)} type="button">
                      <LayoutTemplate size={16} /> Templates
                    </Button>
                  </div>
                  <MissingFieldsPanel flags={readinessFlags} />
                  <div className="listing-form-section">
                    <div className="listing-form-section-heading">
                      <h3>Photos</h3>
                      <p className="muted">Add photos here once, then reuse them across marketplace targets.</p>
                    </div>
                    <div className="scan-import-grid">
                      <label className="label">
                        Upload image
                        <input accept="image/png,image/jpeg,image/webp,image/gif" className="field" name="image" required type="file" />
                      </label>
                      <label className="label">
                        Position
                        <input className="field" defaultValue="0" min="0" name="position" type="number" />
                      </label>
                    </div>
                    <form className="stack inventory-image-form" onSubmit={onAddImage}>
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
                              <Button disabled={pending || index === 0} kind="secondary" onClick={() => onMoveImage(entry.id, -1)} type="button">Move up</Button>
                              <Button disabled={pending || index === item.images.length - 1} kind="secondary" onClick={() => onMoveImage(entry.id, 1)} type="button">Move down</Button>
                              <Button disabled={pending} kind="secondary" onClick={() => onDeleteImage(entry.id)} type="button">Delete</Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <form className="stack" onSubmit={onSaveItemDetails}>
                  <div className="listing-form-section">
                    <div className="listing-form-section-heading">
                      <h3>Core listing data</h3>
                      <p className="muted">Scanner and source results can prefill this, but the operator stays in control.</p>
                    </div>
                    <div className="scan-import-grid">
                      <label className="label listing-ai-field">
                        <span className="listing-ai-label-row">
                          Title
                          {aiStatus?.enabled ? (
                            <Button disabled={pending || aiPendingOperation === "title"} kind="ghost" onClick={() => onAiAssist("title")} type="button">
                              <Sparkles size={14} /> {aiPendingOperation === "title" ? "Thinking..." : "Generate with AI"}
                            </Button>
                          ) : null}
                        </span>
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
                        Tags
                        <input className="field" placeholder="comma, separated, search terms" value={itemForm.tags} onChange={(event) => onFieldChange("tags", event.target.value)} />
                      </label>
                      <label className="label">
                        Labels
                        <input className="field" placeholder="draft, clearance, seasonal" value={itemForm.labels} onChange={(event) => onFieldChange("labels", event.target.value)} />
                      </label>
                    </div>
                    <label className="label listing-ai-field">
                      <span className="listing-ai-label-row">
                        Description
                        {aiStatus?.enabled ? (
                          <Button disabled={pending || aiPendingOperation === "description"} kind="ghost" onClick={() => onAiAssist("description")} type="button">
                            <Sparkles size={14} /> {aiPendingOperation === "description" ? "Thinking..." : "Generate with AI"}
                          </Button>
                        ) : null}
                      </span>
                      <textarea className="field textarea-field" value={itemForm.description} onChange={(event) => onFieldChange("description", event.target.value)} />
                    </label>
                  </div>

                  <div className="listing-form-section">
                    <div className="listing-form-section-heading">
                      <h3>Pricing and shipping</h3>
                      <p className="muted">Set one base price, then override per marketplace only where it matters.</p>
                    </div>
                    <div className="scan-import-grid">
                      <label className="label listing-ai-field">
                        <span className="listing-ai-label-row">
                          Suggested sell
                          {aiStatus?.enabled ? (
                            <Button disabled={pending || aiPendingOperation === "price"} kind="ghost" onClick={() => onAiAssist("price")} type="button">
                              <Sparkles size={14} /> {aiPendingOperation === "price" ? "Thinking..." : "Suggest price"}
                            </Button>
                          ) : null}
                        </span>
                        <input className="field" min="0" step="0.01" type="number" value={itemForm.priceRecommendation} onChange={(event) => onFieldChange("priceRecommendation", event.target.value)} />
                      </label>
                      <label className="label">
                        Buy cost
                        <input className="field" min="0" step="0.01" type="number" value={itemForm.costBasis} onChange={(event) => onFieldChange("costBasis", event.target.value)} />
                      </label>
                      <label className="label">
                        Resale min
                        <input className="field" min="0" step="0.01" type="number" value={itemForm.estimatedResaleMin} onChange={(event) => onFieldChange("estimatedResaleMin", event.target.value)} />
                      </label>
                      <label className="label">
                        Resale max
                        <input className="field" min="0" step="0.01" type="number" value={itemForm.estimatedResaleMax} onChange={(event) => onFieldChange("estimatedResaleMax", event.target.value)} />
                      </label>
                      <label className="label">
                        Shipping weight
                        <div className="scan-field-row">
                          <input className="field" min="0" step="0.01" type="number" value={itemForm.shippingWeightValue} onChange={(event) => onFieldChange("shippingWeightValue", event.target.value)} />
                          <select className="field" value={itemForm.shippingWeightUnit} onChange={(event) => onFieldChange("shippingWeightUnit", event.target.value)}>
                            <option value="oz">oz</option><option value="lb">lb</option><option value="g">g</option><option value="kg">kg</option>
                          </select>
                        </div>
                      </label>
                      <label className="label">
                        Dimensions
                        <div className="listing-dimension-grid">
                          <input className="field" placeholder="L" type="number" value={itemForm.shippingLength} onChange={(event) => onFieldChange("shippingLength", event.target.value)} />
                          <input className="field" placeholder="W" type="number" value={itemForm.shippingWidth} onChange={(event) => onFieldChange("shippingWidth", event.target.value)} />
                          <input className="field" placeholder="H" type="number" value={itemForm.shippingHeight} onChange={(event) => onFieldChange("shippingHeight", event.target.value)} />
                          <select className="field" value={itemForm.shippingDimensionUnit} onChange={(event) => onFieldChange("shippingDimensionUnit", event.target.value)}>
                            <option value="in">in</option><option value="cm">cm</option>
                          </select>
                        </div>
                      </label>
                    </div>
                    <label className="checkbox-row">
                      <input checked={itemForm.freeShipping} onChange={(event) => onFieldChange("freeShipping", event.target.checked)} type="checkbox" />
                      <span><Truck size={14} /> Offer free shipping where it helps conversion</span>
                    </label>
                    <div className="listing-price-override-grid">
                      <label className="label"><span>eBay price</span><input className="field" min="0" step="0.01" type="number" value={itemForm.ebayPrice} onChange={(event) => onFieldChange("ebayPrice", event.target.value)} /></label>
                      <label className="label"><span>Depop price</span><input className="field" min="0" step="0.01" type="number" value={itemForm.depopPrice} onChange={(event) => onFieldChange("depopPrice", event.target.value)} /></label>
                      <label className="label"><span>Poshmark price</span><input className="field" min="0" step="0.01" type="number" value={itemForm.poshmarkPrice} onChange={(event) => onFieldChange("poshmarkPrice", event.target.value)} /></label>
                      <label className="label"><span>Whatnot price</span><input className="field" min="0" step="0.01" type="number" value={itemForm.whatnotPrice} onChange={(event) => onFieldChange("whatnotPrice", event.target.value)} /></label>
                    </div>
                  </div>

                  <div className="listing-form-footer">
                    <div className="muted">
                      {aiStatus?.enabled ? `AI active via ${aiStatus.provider}. ${aiStatus.remainingDailyQuota}/${aiStatus.dailyQuota} requests remaining today.` : "AI suggestions are not enabled in this environment."}
                    </div>
                    <div className="actions">
                      <Button disabled={pending} type="submit">Save listing form</Button>
                      <Button disabled={pending || selectedCount === 0} kind="secondary" onClick={() => onGenerateDrafts(selectedPlatforms)} type="button">Generate drafts for selected</Button>
                      <Button disabled={pending || selectedCount === 0} kind="secondary" onClick={() => onPublishLinked(selectedPlatforms)} type="button">Post selected</Button>
                    </div>
                  </div>
                  </form>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard eyebrow="Marketplace draft controls" title="Live marketplace details where they matter">
            <div className="detail-sell-grid">
              <div className="market-observation-card">
                <div className="split">
                  <div>
                    <p className="eyebrow">eBay draft</p>
                    <strong>Keep the live eBay listing field-ready</strong>
                  </div>
                  <div className="market-observation-value">{ebayDraft ? ebayDraft.reviewStatus : "Missing"}</div>
                </div>
                {!ebayDraft ? (
                  <div className="muted">Generate an eBay draft first, then map the live listing category here.</div>
                ) : (
                  <form className="stack" onSubmit={onSaveEbayDraft}>
                    <label className="label">eBay title<input className="field" name="generatedTitle" required value={ebayDraftForm.generatedTitle} onChange={(event) => onEbayDraftFormChange("generatedTitle", event.target.value)} /></label>
                    <label className="label">eBay price<input className="field" min="0" name="generatedPrice" required step="0.01" type="number" value={ebayDraftForm.generatedPrice} onChange={(event) => onEbayDraftFormChange("generatedPrice", event.target.value)} /></label>
                    <label className="label">eBay category ID<input className="field" name="ebayCategoryId" placeholder="15724" value={ebayDraftForm.ebayCategoryId} onChange={(event) => onEbayDraftFormChange("ebayCategoryId", event.target.value)} /></label>
                    <label className="label">eBay store category ID<input className="field" name="ebayStoreCategoryId" placeholder="Optional" value={ebayDraftForm.ebayStoreCategoryId} onChange={(event) => onEbayDraftFormChange("ebayStoreCategoryId", event.target.value)} /></label>
                    <div className="actions">
                      <Button disabled={pending} type="submit">Save eBay draft</Button>
                      {ebayDraft.reviewStatus !== "APPROVED" ? <Button disabled={pending} kind="secondary" onClick={onApproveEbayDraft} type="button">Approve eBay draft</Button> : null}
                    </div>
                  </form>
                )}
              </div>

              <div className="market-observation-card">
                <div className="split">
                  <div>
                    <p className="eyebrow">Row refresh</p>
                    <strong>Check marketplace state without leaving the form</strong>
                  </div>
                  <Button kind="secondary" onClick={onRefreshExtension} type="button"><RefreshCw size={16} /> Check again</Button>
                </div>
                {ebayPreflightError ? <div className="notice">{ebayPreflightError}</div> : null}
                {ebayPreflight ? (
                  <div className="stack">
                    <OperatorHintCard hint={ebayPreflight.hint} />
                    <div className="notice">{ebayPreflight.summary}</div>
                    <div className="inventory-preflight-meta">
                      <span>State: {ebayPreflight.state ?? "none"}</span>
                      <span>Account: {ebayPreflight.selectedCredentialType ?? "none"}</span>
                    </div>
                  </div>
                ) : (
                  <div className="muted">Marketplace row status updates live from account readiness, extension state, and marketplace tasks.</div>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard
            action={<StatusPill label={extensionConnected ? "connected" : extensionInstalled ? "detected" : "missing"} tone={extensionConnected ? "success" : extensionInstalled ? "warning" : "neutral"} />}
            eyebrow="Browser Extension"
            title="Browser execution stays visible but secondary"
          >
            <div className="extension-task-card">
              <div className="extension-task-header">
                <div>
                  <strong className="extension-task-title"><Plug2 size={16} /> Mollie browser extension</strong>
                  <p className="muted">
                    {extensionConnected
                      ? "Connected. Use it when a marketplace row requires browser-side work."
                      : extensionInstalled
                        ? "Installed, but this page needs to refresh the Mollie session bridge."
                        : "Install the Mollie browser extension to import listings and complete extension-required marketplace actions."}
                  </p>
                </div>
                <div className="actions">
                  <Button kind="secondary" onClick={onRefreshExtension} type="button"><RefreshCw size={16} /> Refresh</Button>
                  <Button disabled={!extensionConnected || pending} onClick={onSendToExtension} type="button">Open in extension</Button>
                </div>
              </div>
              <div className="inventory-preflight-meta">
                <span>Pending tasks: {extensionPendingCount}</span>
                <span>{extensionLoading ? "Checking extension..." : extensionConnected ? "Ready for handoff" : "Not ready for handoff"}</span>
              </div>
              {extensionActionStatus ? <div className="notice">{extensionActionStatus}</div> : null}
              <div className="activity-list">
                {recentExtensionTasks.length === 0 ? <div className="muted">No extension work yet. Use the browser extension to import a listing or accept marketplace-side tasks.</div> : null}
                {recentExtensionTasks.map((task) => (
                  <div className="activity-row" key={task.id}>
                    <div>
                      <strong>{task.platform} {task.action.replace(/_/g, " ").toLowerCase()}</strong>
                      <div className="muted">{task.lastErrorMessage ?? `Task state: ${task.state.toLowerCase()}`}</div>
                    </div>
                    <div className="muted">{task.updatedAt ? formatDate(task.updatedAt) : "Recently updated"}</div>
                  </div>
                ))}
              </div>
            </div>
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

      {templatesOpen ? (
        <div className="handoff-modal-backdrop" role="presentation" onClick={() => setTemplatesOpen(false)}>
          <div aria-labelledby="listing-templates-title" aria-modal="true" className="handoff-modal listing-template-modal" role="dialog" onClick={(event) => event.stopPropagation()}>
            <div className="handoff-modal-header">
              <div>
                <p className="eyebrow">Templates</p>
                <h3 id="listing-templates-title">Prefill the universal listing form</h3>
              </div>
              <Button kind="ghost" onClick={() => setTemplatesOpen(false)} type="button"><X size={16} /> Close</Button>
            </div>
            <div className="listing-template-grid">
              {templates.map((template) => (
                <button
                  className="listing-template-card"
                  key={template.id}
                  onClick={() => {
                    Object.entries(template.values).forEach(([field, value]) => onFieldChange(field as keyof InventoryItemFormState, value));
                    setTemplatesOpen(false);
                  }}
                  type="button"
                >
                  <div>
                    <strong>{template.name}</strong>
                    <p className="muted">{template.description}</p>
                  </div>
                  <LayoutTemplate size={18} />
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {deleteConfirmOpen ? (
        <div className="handoff-modal-backdrop" role="presentation" onClick={() => setDeleteConfirmOpen(false)}>
          <div aria-labelledby="delete-item-title" aria-modal="true" className="handoff-modal" role="dialog" onClick={(event) => event.stopPropagation()}>
            <div className="handoff-modal-header">
              <div>
                <p className="eyebrow">Delete item</p>
                <h3 id="delete-item-title">Remove this item from Mollie</h3>
              </div>
              <Button disabled={pending} kind="ghost" onClick={() => setDeleteConfirmOpen(false)} type="button"><X size={16} /> Close</Button>
            </div>
            <p className="handoff-copy">Delete <strong>{item.title}</strong> and remove its images, drafts, marketplace listings, and sales history from this workspace.</p>
            <div className="actions">
              <Button disabled={pending} kind="secondary" onClick={() => setDeleteConfirmOpen(false)} type="button">Keep item</Button>
              <Button disabled={pending} onClick={() => { setDeleteConfirmOpen(false); onDeleteItem(); }} type="button">Delete permanently</Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
