"use client";

import QRCode from "qrcode";
import { Camera, Copy, ExternalLink, LayoutTemplate, QrCode, RefreshCw, Sparkles, Smartphone, Truck, X } from "lucide-react";
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
  depopTags: string;
  depopDepartment: string;
  depopProductType: string;
  depopCondition: string;
  depopShippingMode: string;
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
    needsInputReason?: string | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    resultJson?: Record<string, unknown> | null;
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
  onRefreshExtension: () => void;
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

const platformLabels = {
  EBAY: "eBay",
  DEPOP: "Depop",
  POSHMARK: "Poshmark",
  WHATNOT: "Whatnot"
} as const;

const depopDepartmentOptions = [
  "Women",
  "Men",
  "Kids",
  "Home",
  "Other"
] as const;

const depopProductTypeOptions = [
  "Beauty & Personal Care",
  "Jackets",
  "Coats",
  "Tops",
  "Shoes",
  "Bags",
  "Accessories",
  "Home Decor",
  "Other"
] as const;

const depopConditionOptions = [
  "Brand new",
  "Like new",
  "Good",
  "Fair"
] as const;

const depopShippingModeOptions = [
  { value: "DEPOP_SHIPPING", label: "Depop shipping" },
  { value: "OWN_SHIPPING", label: "My own shipping" }
] as const;

function titleCaseRequirement(requirement: string) {
  return requirement.slice(0, 1).toUpperCase() + requirement.slice(1);
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

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
  onRefreshExtension,
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
  const selectedMarketStatuses = marketStatuses.filter((state) =>
    selectedPlatforms.includes(state.platform as "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT")
  );
  const draftReadyPlatforms = selectedMarketStatuses
    .filter((state) => state.actionKind === "generate_draft")
    .map((state) => state.platform as "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT");
  const postReadyPlatforms = selectedMarketStatuses
    .filter((state) => state.actionKind === "publish_api" || state.actionKind === "publish_extension")
    .map((state) => state.platform as "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT");
  const lifecycle = getItemLifecycleState(item);
  const profit = getProfitEstimate(item);
  const nextAction = getNextActionLabel(item);
  const identifier = getIdentifierValue(item);
  const recentExtensionTasks = item.extensionTasks.slice(0, 4);
  const selectedCount = selectedPlatforms.length;
  const selectedBlockedCount = selectedMarketStatuses.filter((state) => state.missingRequirements.length > 0).length;
  const selectedRequirementCards = selectedMarketStatuses.map((state) => ({
    platform: state.platform as "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT",
    label: platformLabels[state.platform as "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT"],
    required: state.missingRequirements,
    recommended: state.recommendedRequirements
  }));
  const requirementToPlatforms = useMemo(() => {
    const next = new Map<string, string[]>();

    selectedRequirementCards.forEach((card) => {
      card.required.forEach((requirement) => {
        const existing = next.get(requirement) ?? [];
        if (!existing.includes(card.label)) {
          existing.push(card.label);
        }
        next.set(requirement, existing);
      });
    });

    return next;
  }, [selectedRequirementCards]);
  const selectedMissingRequirementSet = useMemo(
    () => new Set(Array.from(requirementToPlatforms.keys())),
    [requirementToPlatforms]
  );

  function fieldIsMissing(...requirements: string[]) {
    return requirements.some((requirement) => selectedMissingRequirementSet.has(requirement));
  }

  function requirementPlatforms(requirements: string[]) {
    return Array.from(
      new Set(
        requirements.flatMap((requirement) => requirementToPlatforms.get(requirement) ?? [])
      )
    );
  }

  function renderRequirementNote(...requirements: string[]) {
    const platforms = requirementPlatforms(requirements);
    if (platforms.length === 0) {
      return null;
    }

    return (
      <div className="listing-field-requirement-note">
        Needed for {platforms.join(", ")}
      </div>
    );
  }

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
              <div className="detail-identity-grid">
                <div className="detail-meta-row"><span className="muted">SKU</span><strong>{item.sku}</strong></div>
                <div className="detail-meta-row"><span className="muted">Identifier</span><strong>{identifier}</strong></div>
                <div className="detail-meta-row"><span className="muted">Category</span><strong>{item.category}</strong></div>
                <div className="detail-meta-row"><span className="muted">Brand</span><strong>{item.brand?.trim() || "Not set yet"}</strong></div>
              </div>
            </div>
          </div>
        </SectionCard>

        {submitError ? <div className="notice">{submitError}</div> : null}
        {uploadStatus ? <div className="notice success">{uploadStatus}</div> : null}
        {aiMessage ? <div className="notice success">{aiMessage}</div> : null}

        <div className="detail-section-grid">
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
                      <strong>One listing record, then post where it is ready</strong>
                    </div>
                    <Button kind="secondary" onClick={() => setTemplatesOpen(true)} type="button">
                      <LayoutTemplate size={16} /> Templates
                    </Button>
                  </div>
                  <MissingFieldsPanel flags={readinessFlags} />
                  <div className="listing-form-section">
                    <div className="listing-form-section-heading">
                      <h3>Selected marketplace requirements</h3>
                      <p className="muted">Choose marketplaces on the left and Mollie will show only the extra requirements those targets care about.</p>
                    </div>
                    {selectedCount === 0 ? (
                      <div className="listing-selection-empty-state">
                        Select one or more marketplaces to reveal their required and recommended fields here.
                      </div>
                    ) : (
                      <div className="listing-requirements-grid">
                        {selectedRequirementCards.map((card) => (
                          <div className="listing-requirement-card" key={card.platform}>
                            <div className="listing-requirement-card-topline">
                              <strong>{card.label}</strong>
                              <StatusPill
                                label={card.required.length > 0 ? "Needs fields" : "Ready from Mollie"}
                                tone={card.required.length > 0 ? "warning" : "success"}
                              />
                            </div>
                            {card.required.length > 0 ? (
                              <div className="listing-requirement-copy">
                                Required now: {card.required.map(titleCaseRequirement).join(", ")}
                              </div>
                            ) : (
                              <div className="listing-requirement-copy">
                                Shared item details already cover this marketplace&apos;s required fields.
                              </div>
                            )}
                            {card.recommended.length > 0 ? (
                              <div className="listing-requirement-hint">
                                Improves results: {card.recommended.map(titleCaseRequirement).join(", ")}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className={cx("listing-form-section", fieldIsMissing("photos") && "listing-form-section-missing")}>
                    <div className="listing-form-section-heading">
                      <h3>Photos</h3>
                      <p className="muted">Add photos here once, then reuse them across marketplace targets.</p>
                      {renderRequirementNote("photos")}
                    </div>
                    <div className="scan-import-grid">
                      <label className={cx("label", fieldIsMissing("photos") && "label-missing")}>
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
                  <div
                    className={cx(
                      "listing-form-section",
                      (fieldIsMissing("title") ||
                        fieldIsMissing("description", "show notes") ||
                        fieldIsMissing("category") ||
                        fieldIsMissing("condition") ||
                        fieldIsMissing("size") ||
                        fieldIsMissing("brand")) &&
                        "listing-form-section-missing"
                    )}
                  >
                    <div className="listing-form-section-heading">
                      <h3>Shared item details</h3>
                      <p className="muted">These fields apply across marketplaces unless you add a platform-specific adjustment below.</p>
                    </div>
                    <div className="scan-import-grid">
                      <label className={cx("label", "listing-ai-field", fieldIsMissing("title") && "label-missing")}>
                        <span className="listing-ai-label-row">
                          Title
                          {aiStatus?.enabled ? (
                            <Button disabled={pending || aiPendingOperation === "title"} kind="ghost" onClick={() => onAiAssist("title")} type="button">
                              <Sparkles size={14} /> {aiPendingOperation === "title" ? "Thinking..." : "Generate with AI"}
                            </Button>
                          ) : null}
                        </span>
                        <input className={cx("field", fieldIsMissing("title") && "field-missing")} required value={itemForm.title} onChange={(event) => onFieldChange("title", event.target.value)} />
                        {renderRequirementNote("title")}
                      </label>
                      <label className={cx("label", fieldIsMissing("brand") && "label-missing")}>
                        Brand
                        <input className={cx("field", fieldIsMissing("brand") && "field-missing")} value={itemForm.brand} onChange={(event) => onFieldChange("brand", event.target.value)} />
                        {renderRequirementNote("brand")}
                      </label>
                      <label className={cx("label", fieldIsMissing("category") && "label-missing")}>
                        Category
                        <input className={cx("field", fieldIsMissing("category") && "field-missing")} required value={itemForm.category} onChange={(event) => onFieldChange("category", event.target.value)} />
                        {renderRequirementNote("category")}
                      </label>
                      <label className={cx("label", fieldIsMissing("condition") && "label-missing")}>
                        Condition
                        <input className={cx("field", fieldIsMissing("condition") && "field-missing")} required value={itemForm.condition} onChange={(event) => onFieldChange("condition", event.target.value)} />
                        {renderRequirementNote("condition")}
                      </label>
                      <label className={cx("label", fieldIsMissing("size") && "label-missing")}>
                        Size
                        <input className={cx("field", fieldIsMissing("size") && "field-missing")} value={itemForm.size} onChange={(event) => onFieldChange("size", event.target.value)} />
                        {renderRequirementNote("size")}
                      </label>
                      <label className="label">
                        Color
                        <input className="field" value={itemForm.color} onChange={(event) => onFieldChange("color", event.target.value)} />
                      </label>
                      <label className="label">
                        Quantity
                        <input className="field" min="1" step="1" type="number" value={itemForm.quantity} onChange={(event) => onFieldChange("quantity", event.target.value)} />
                      </label>
                    </div>
                    <label className={cx("label", "listing-ai-field", fieldIsMissing("description", "show notes") && "label-missing")}>
                      <span className="listing-ai-label-row">
                        Description
                        {aiStatus?.enabled ? (
                          <Button disabled={pending || aiPendingOperation === "description"} kind="ghost" onClick={() => onAiAssist("description")} type="button">
                            <Sparkles size={14} /> {aiPendingOperation === "description" ? "Thinking..." : "Generate with AI"}
                          </Button>
                        ) : null}
                      </span>
                      <textarea className={cx("field", "textarea-field", fieldIsMissing("description", "show notes") && "field-missing")} value={itemForm.description} onChange={(event) => onFieldChange("description", event.target.value)} />
                      {renderRequirementNote("description", "show notes")}
                    </label>
                  </div>

                  <div
                    className={cx(
                      "listing-form-section",
                      (fieldIsMissing("price") || fieldIsMissing("shipping weight") || fieldIsMissing("package size")) &&
                        "listing-form-section-missing"
                    )}
                  >
                    <div className="listing-form-section-heading">
                      <h3>Shipping</h3>
                      <p className="muted">Complete shipping once here so eBay and other structured marketplaces are easier to post.</p>
                    </div>
                    <div className="scan-import-grid">
                      <label className={cx("label", "listing-ai-field", fieldIsMissing("price") && "label-missing")}>
                        <span className="listing-ai-label-row">
                          Base price
                          {aiStatus?.enabled ? (
                            <Button disabled={pending || aiPendingOperation === "price"} kind="ghost" onClick={() => onAiAssist("price")} type="button">
                              <Sparkles size={14} /> {aiPendingOperation === "price" ? "Thinking..." : "Suggest price"}
                            </Button>
                          ) : null}
                        </span>
                        <input className={cx("field", fieldIsMissing("price") && "field-missing")} min="0" step="0.01" type="number" value={itemForm.priceRecommendation} onChange={(event) => onFieldChange("priceRecommendation", event.target.value)} />
                        {renderRequirementNote("price")}
                      </label>
                      <label className="label">
                        Buy cost
                        <input className="field" min="0" step="0.01" type="number" value={itemForm.costBasis} onChange={(event) => onFieldChange("costBasis", event.target.value)} />
                      </label>
                      <label className={cx("label", fieldIsMissing("shipping weight") && "label-missing")}>
                        Shipping weight
                        <div className="scan-field-row">
                          <input className={cx("field", fieldIsMissing("shipping weight") && "field-missing")} min="0" step="0.01" type="number" value={itemForm.shippingWeightValue} onChange={(event) => onFieldChange("shippingWeightValue", event.target.value)} />
                          <select className="field" value={itemForm.shippingWeightUnit} onChange={(event) => onFieldChange("shippingWeightUnit", event.target.value)}>
                            <option value="oz">oz</option><option value="lb">lb</option><option value="g">g</option><option value="kg">kg</option>
                          </select>
                        </div>
                        {renderRequirementNote("shipping weight")}
                      </label>
                      <label className={cx("label", fieldIsMissing("package size") && "label-missing")}>
                        Dimensions
                        <div className="listing-dimension-grid">
                          <input className={cx("field", fieldIsMissing("package size") && "field-missing")} placeholder="L" type="number" value={itemForm.shippingLength} onChange={(event) => onFieldChange("shippingLength", event.target.value)} />
                          <input className={cx("field", fieldIsMissing("package size") && "field-missing")} placeholder="W" type="number" value={itemForm.shippingWidth} onChange={(event) => onFieldChange("shippingWidth", event.target.value)} />
                          <input className={cx("field", fieldIsMissing("package size") && "field-missing")} placeholder="H" type="number" value={itemForm.shippingHeight} onChange={(event) => onFieldChange("shippingHeight", event.target.value)} />
                          <select className="field" value={itemForm.shippingDimensionUnit} onChange={(event) => onFieldChange("shippingDimensionUnit", event.target.value)}>
                            <option value="in">in</option><option value="cm">cm</option>
                          </select>
                        </div>
                        {renderRequirementNote("package size")}
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
                    <label className="checkbox-row">
                      <input checked={itemForm.freeShipping} onChange={(event) => onFieldChange("freeShipping", event.target.checked)} type="checkbox" />
                      <span><Truck size={14} /> Offer free shipping where it helps conversion</span>
                    </label>
                  </div>

                  <div className={cx("listing-form-section", fieldIsMissing("eBay category mapping") && "listing-form-section-missing")}>
                    <div className="listing-form-section-heading">
                      <h3>Platform-specific adjustments</h3>
                      <p className="muted">Base item data stays in charge. These cards only appear for the marketplaces you selected and only change that marketplace.</p>
                    </div>
                    <div className="listing-overrides-callout">
                      <strong>Shared data stays in control.</strong>
                      <span>Base title, description, category, condition, and price apply everywhere unless you override them here.</span>
                    </div>
                    {selectedCount === 0 ? (
                      <div className="listing-selection-empty-state">
                        Select marketplaces on the left to reveal only their override fields here.
                      </div>
                    ) : (
                      <div className="listing-platform-adjustments-grid">
                        {selectedMarketStatuses.map((state) => (
                          <div className="listing-platform-adjustment-card" key={state.platform}>
                            <div className="listing-platform-adjustment-topline">
                              <div>
                                <strong>{platformLabels[state.platform as "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT"]} adjustments</strong>
                                <p className="muted">
                                  {state.platform === "EBAY"
                                    ? "Use an override only if eBay should list differently than the shared item."
                                    : state.platform === "DEPOP"
                                      ? "Depop can use a different price and discovery tags while keeping the shared item intact."
                                      : state.platform === "POSHMARK"
                                        ? "Poshmark usually inherits the shared item, but you can set a different asking price here."
                                        : "Whatnot can inherit the shared item and optionally use a different price."}
                                </p>
                              </div>
                              <StatusPill
                                label={state.missingRequirements.length > 0 ? "Needs setup" : "Using shared data"}
                                tone={state.missingRequirements.length > 0 ? "warning" : "neutral"}
                              />
                            </div>

                            {state.platform === "EBAY" ? (
                              <div className="listing-platform-adjustment-fields">
                                <label className="label">
                                  eBay price override
                                  <input className="field" min="0" step="0.01" type="number" value={itemForm.ebayPrice} onChange={(event) => onFieldChange("ebayPrice", event.target.value)} />
                                </label>
                                <div className={cx("muted", "listing-override-note", fieldIsMissing("eBay category mapping") && "listing-override-note-missing")}>
                                  eBay category mapping and store category stay in <strong>Advanced eBay settings</strong> below.
                                </div>
                                {renderRequirementNote("eBay category mapping")}
                              </div>
                            ) : null}

                            {state.platform === "DEPOP" ? (
                              <div className="listing-platform-adjustment-fields">
                                <label className="label">
                                  Depop department
                                  <select className={cx("field", fieldIsMissing("Depop department") && "field-missing")} value={itemForm.depopDepartment} onChange={(event) => onFieldChange("depopDepartment", event.target.value)}>
                                    <option value="">Select department</option>
                                    {depopDepartmentOptions.map((option) => (
                                      <option key={option} value={option}>{option}</option>
                                    ))}
                                  </select>
                                  {renderRequirementNote("Depop department")}
                                </label>
                                <label className="label">
                                  Depop product type
                                  <select className={cx("field", fieldIsMissing("Depop product type") && "field-missing")} value={itemForm.depopProductType} onChange={(event) => onFieldChange("depopProductType", event.target.value)}>
                                    <option value="">Select product type</option>
                                    {depopProductTypeOptions.map((option) => (
                                      <option key={option} value={option}>{option}</option>
                                    ))}
                                  </select>
                                  {renderRequirementNote("Depop product type")}
                                </label>
                                <label className="label">
                                  Depop condition
                                  <select className="field" value={itemForm.depopCondition} onChange={(event) => onFieldChange("depopCondition", event.target.value)}>
                                    <option value="">Use shared condition</option>
                                    {depopConditionOptions.map((option) => (
                                      <option key={option} value={option}>{option}</option>
                                    ))}
                                  </select>
                                </label>
                                <label className="label">
                                  Depop shipping
                                  <select className={cx("field", fieldIsMissing("Depop shipping") && "field-missing")} value={itemForm.depopShippingMode} onChange={(event) => onFieldChange("depopShippingMode", event.target.value)}>
                                    <option value="">Select shipping</option>
                                    {depopShippingModeOptions.map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                  {renderRequirementNote("Depop shipping")}
                                </label>
                                <label className="label">
                                  Depop price override
                                  <input className="field" min="0" step="0.01" type="number" value={itemForm.depopPrice} onChange={(event) => onFieldChange("depopPrice", event.target.value)} />
                                </label>
                                <label className="label">
                                  Depop discovery tags
                                  <input className="field" placeholder="vintage, streetwear, leather, y2k" value={itemForm.depopTags} onChange={(event) => onFieldChange("depopTags", event.target.value)} />
                                </label>
                                <div className="muted listing-override-note">
                                  Depop uses these tags only for Depop. The shared listing record stays unchanged for other marketplaces.
                                </div>
                              </div>
                            ) : null}

                            {state.platform === "POSHMARK" ? (
                              <div className="listing-platform-adjustment-fields">
                                <label className="label">
                                  Poshmark price override
                                  <input className="field" min="0" step="0.01" type="number" value={itemForm.poshmarkPrice} onChange={(event) => onFieldChange("poshmarkPrice", event.target.value)} />
                                </label>
                              </div>
                            ) : null}

                            {state.platform === "WHATNOT" ? (
                              <div className="listing-platform-adjustment-fields">
                                <label className="label">
                                  Whatnot price override
                                  <input className="field" min="0" step="0.01" type="number" value={itemForm.whatnotPrice} onChange={(event) => onFieldChange("whatnotPrice", event.target.value)} />
                                </label>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="listing-form-footer">
                    <div className="muted listing-form-status">
                      {selectedCount === 0
                        ? "Select at least one marketplace on the left before posting."
                        : draftReadyPlatforms.length === 0 && postReadyPlatforms.length === 0
                          ? selectedBlockedCount > 0
                            ? "Selected marketplaces are still missing required fields. Fill those in Mollie first, then generate or post."
                            : "Selected marketplaces need login, draft review, or browser follow-through before posting."
                          : `${draftReadyPlatforms.length} ready for draft generation and ${postReadyPlatforms.length} ready to post right now.`}
                    </div>
                    <div className="actions">
                      <Button disabled={pending} type="submit">Save listing form</Button>
                      <Button disabled={pending || draftReadyPlatforms.length === 0} kind="secondary" onClick={() => onGenerateDrafts(draftReadyPlatforms)} type="button">Generate drafts for selected</Button>
                      <Button disabled={pending || postReadyPlatforms.length === 0} kind="secondary" onClick={() => onPublishLinked(postReadyPlatforms)} type="button">Post selected</Button>
                    </div>
                  </div>

                  <div className="listing-form-section">
                    <div className="listing-form-section-heading">
                      <h3>Advanced</h3>
                      <p className="muted">Less-used controls and debug detail stay here so the main workflow stays focused.</p>
                    </div>
                    <div className="detail-advanced-stack">
                      <details className={cx("detail-advanced-panel", fieldIsMissing("eBay category mapping") && "detail-advanced-panel-missing")}>
                        <summary>Advanced eBay settings</summary>
                        <div className="detail-advanced-content">
                          {!ebayDraft ? (
                            <div className="muted">Generate an eBay draft first, then adjust advanced eBay-only fields here if needed.</div>
                          ) : (
                            <form className="stack" onSubmit={onSaveEbayDraft}>
                              <label className="label">eBay title<input className="field" name="generatedTitle" required value={ebayDraftForm.generatedTitle} onChange={(event) => onEbayDraftFormChange("generatedTitle", event.target.value)} /></label>
                              <label className="label">eBay price<input className="field" min="0" name="generatedPrice" required step="0.01" type="number" value={ebayDraftForm.generatedPrice} onChange={(event) => onEbayDraftFormChange("generatedPrice", event.target.value)} /></label>
                              <label className="label">eBay category ID<input className="field" name="ebayCategoryId" placeholder="15724" value={ebayDraftForm.ebayCategoryId} onChange={(event) => onEbayDraftFormChange("ebayCategoryId", event.target.value)} /></label>
                              <label className="label">eBay store category ID<input className="field" name="ebayStoreCategoryId" placeholder="Optional" value={ebayDraftForm.ebayStoreCategoryId} onChange={(event) => onEbayDraftFormChange("ebayStoreCategoryId", event.target.value)} /></label>
                              <div className="actions">
                                <Button disabled={pending} type="submit">Save eBay settings</Button>
                                {ebayDraft.reviewStatus !== "APPROVED" ? <Button disabled={pending} kind="secondary" onClick={onApproveEbayDraft} type="button">Approve eBay draft</Button> : null}
                              </div>
                            </form>
                          )}
                          {ebayPreflightError ? <div className="notice">{ebayPreflightError}</div> : null}
                          {ebayPreflight ? (
                            <div className="stack">
                              <OperatorHintCard hint={ebayPreflight.hint} />
                              <div className="notice">{ebayPreflight.summary}</div>
                            </div>
                          ) : null}
                        </div>
                      </details>

                      <details className="detail-advanced-panel">
                        <summary>Automation details</summary>
                        <div className="detail-advanced-content">
                          <div className="inventory-preflight-meta">
                            <span>{extensionConnected ? "Browser automation connected" : extensionInstalled ? "Browser automation detected" : "Browser automation missing"}</span>
                            <span>Pending tasks: {extensionPendingCount}</span>
                          </div>
                          <div className="actions">
                            <Button kind="secondary" onClick={onRefreshExtension} type="button"><RefreshCw size={16} /> Refresh row state</Button>
                          </div>
                          <div className="activity-list">
                            {recentExtensionTasks.length === 0 ? <div className="muted">No recent browser-side work for this item.</div> : null}
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
                      </details>

                      <details className="detail-advanced-panel">
                        <summary>History and item tools</summary>
                        <div className="detail-advanced-content stack">
                          {continuityNotice ? (
                            <div className="muted detail-advanced-note">
                              {continuityNotice}
                              {lastSyncedLabel ? ` Last checked ${lastSyncedLabel}.` : ""}
                            </div>
                          ) : null}
                          <div className="actions">
                            <Button className="detail-mobile-handoff" data-testid="continue-on-mobile-trigger" kind="secondary" onClick={() => setHandoffOpen(true)} type="button">
                              <Smartphone size={16} /> Continue on mobile
                            </Button>
                            <Button disabled={pending} kind="secondary" onClick={() => setDeleteConfirmOpen(true)} type="button">Delete item</Button>
                          </div>
                          <div className="activity-list">
                            {historyRows.length === 0 ? <div className="muted">No history yet. Draft, listing, and sale activity will show up here.</div> : null}
                            {historyRows.map((row) => (
                              <div className="activity-row" key={row.id}>
                                <div>
                                  <strong>{row.label}</strong>
                                  <div className="muted">{row.detail}</div>
                                </div>
                                <div className="muted">{row.meta}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </details>
                    </div>
                  </div>
                  </form>
                </div>
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
