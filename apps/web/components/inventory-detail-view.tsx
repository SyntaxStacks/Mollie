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
import { useEffect, useState, type FormEvent } from "react";

import type { OperatorHint } from "@reselleros/types";
import { Button, Card, StatusPill } from "@reselleros/ui";

import { currency } from "../lib/api";
import { OperatorHintCard } from "./operator-hint-card";

export type InventoryDetailRecord = {
  id: string;
  title: string;
  sku: string;
  status: string;
  category: string;
  condition: string;
  priceRecommendation: number | null;
  estimatedResaleMin: number | null;
  estimatedResaleMax: number | null;
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

function InventoryHeroCard({
  item,
  pending,
  lastSyncedLabel,
  continuityNotice,
  onGenerateDrafts,
  onPublishEbay,
  onPublishDepop,
  onPublishPoshmark,
  onPublishWhatnot,
  onPublishLinked,
  onOpenHandoff
}: {
  item: InventoryDetailRecord;
  pending: boolean;
  lastSyncedLabel: string | null;
  continuityNotice: string | null;
  onGenerateDrafts: () => void;
  onPublishEbay: () => void;
  onPublishDepop: () => void;
  onPublishPoshmark: () => void;
  onPublishWhatnot: () => void;
  onPublishLinked: () => void;
  onOpenHandoff: () => void;
}) {
  return (
    <Card
      action={<StatusPill status={item.status} />}
      className="inventory-summary-card"
      eyebrow={item.sku}
      title={item.title}
    >
      <div className="inventory-hero-strip">
        <div className="inventory-device-note">
          <Smartphone size={16} />
          <span>Desktop is the control surface. Mobile is the fastest way to capture photos.</span>
        </div>
        <Button className="inventory-handoff-button" data-testid="continue-on-mobile-trigger" kind="secondary" onClick={onOpenHandoff}>
          <Smartphone size={16} /> Continue on mobile
        </Button>
      </div>
      {continuityNotice ? (
        <div className="continuity-note" role="status">
          <RefreshCw size={14} />
          <span>{continuityNotice}</span>
        </div>
      ) : null}
      {lastSyncedLabel ? <p className="inventory-sync-copy">Continuity refresh active. Last checked {lastSyncedLabel}.</p> : null}
      <div className="inventory-meta-grid">
        <div className="metric">
          <span className="muted">Recommended price</span>
          <strong>{currency(item.priceRecommendation)}</strong>
        </div>
        <div className="metric">
          <span className="muted">Resale range</span>
          <strong>
            {currency(item.estimatedResaleMin)}-{currency(item.estimatedResaleMax)}
          </strong>
        </div>
        <div className="metric">
          <span className="muted">Category</span>
          <strong>{item.category}</strong>
        </div>
        <div className="metric">
          <span className="muted">Condition</span>
          <strong>{item.condition}</strong>
        </div>
      </div>
      <div className="actions inventory-primary-actions">
        <Button disabled={pending} onClick={onGenerateDrafts}>
          Generate drafts
        </Button>
        <Button disabled={pending} kind="secondary" onClick={onPublishLinked}>
          Publish linked accounts
        </Button>
        <Button disabled={pending} kind="secondary" onClick={onPublishEbay}>
          Publish eBay
        </Button>
        <Button disabled={pending} kind="secondary" onClick={onPublishDepop}>
          Publish Depop
        </Button>
        <Button disabled={pending} kind="secondary" onClick={onPublishPoshmark}>
          Publish Poshmark
        </Button>
        <Button disabled={pending} kind="secondary" onClick={onPublishWhatnot}>
          Publish Whatnot
        </Button>
      </div>
    </Card>
  );
}

function InventoryImagesCard({
  item,
  pending,
  uploadStatus,
  submitError,
  onAddImage,
  onDeleteImage,
  onMoveImage
}: {
  item: InventoryDetailRecord;
  pending: boolean;
  uploadStatus: string | null;
  submitError: string | null;
  onAddImage: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteImage: (imageId: string) => void;
  onMoveImage: (imageId: string, direction: -1 | 1) => void;
}) {
  return (
    <Card
      className="inventory-images-card"
      eyebrow="Mobile capture surface"
      title="Photo capture"
    >
      <p className="inventory-section-copy">
        Upload, reorder, or delete photos here. The same item page works on desktop and phone.
      </p>
      <form className="stack inventory-image-form" onSubmit={onAddImage}>
        <label className="label">
          Upload image
          <input accept="image/png,image/jpeg,image/webp,image/gif" className="field" name="image" required type="file" />
        </label>
        <label className="label">
          Position
          <input className="field" defaultValue="0" min="0" name="position" type="number" />
        </label>
        <Button data-testid="inventory-upload-submit" type="submit" disabled={pending}>
          <Camera size={16} /> {pending ? "Uploading..." : "Upload image"}
        </Button>
      </form>
      {uploadStatus ? <div className="notice execution-notice-success inventory-inline-notice">{uploadStatus}</div> : null}
      {submitError ? <div className="notice inventory-inline-notice">{submitError}</div> : null}
      <div className="stack inventory-image-list">
        {item.images.length === 0 ? <div className="muted">No images uploaded yet.</div> : null}
        {item.images.map((image, index) => (
          <div className="image-upload-row inventory-image-card" data-image-id={image.id} key={image.id}>
            <img alt={`${item.title} image`} className="image-upload-preview" src={image.url} />
            <div className="stack">
              <div className="split">
                <strong>Image {index + 1}</strong>
                <span className="muted">Position {image.position + 1}</span>
              </div>
              <span className="muted inventory-image-url">{image.url}</span>
              <div className="actions inventory-image-actions">
                <Button
                  disabled={pending || index === 0}
                  kind="secondary"
                  onClick={() => onMoveImage(image.id, -1)}
                  type="button"
                >
                  Move up
                </Button>
                <Button
                  disabled={pending || index === item.images.length - 1}
                  kind="secondary"
                  onClick={() => onMoveImage(image.id, 1)}
                  type="button"
                >
                  Move down
                </Button>
                <Button disabled={pending} kind="secondary" onClick={() => onDeleteImage(image.id)} type="button">
                  Delete image
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function InventoryReadinessCard({
  item,
  submitError
}: {
  item: InventoryDetailRecord;
  submitError: string | null;
}) {
  return (
    <Card eyebrow="Drafts and listings" title="Review readiness">
      {submitError ? <div className="notice">{submitError}</div> : null}
      <div className="stack">
        {item.listingDrafts.map((draft) => (
          <div className="split" key={draft.id}>
            <span>{draft.platform} draft</span>
            <StatusPill status={draft.reviewStatus} />
          </div>
        ))}
        {item.platformListings.map((listing) => (
          <div className="split" key={listing.id}>
            <span>{listing.platform} listing</span>
            <StatusPill status={listing.status} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function EbayDraftCard({
  ebayDraft,
  ebayDraftForm,
  pending,
  onSaveEbayDraft,
  onApproveEbayDraft,
  onEbayDraftFormChange
}: {
  ebayDraft: InventoryDetailRecord["listingDrafts"][number] | null;
  ebayDraftForm: {
    generatedTitle: string;
    generatedPrice: string;
    ebayCategoryId: string;
    ebayStoreCategoryId: string;
  };
  pending: boolean;
  onSaveEbayDraft: (event: FormEvent<HTMLFormElement>) => void;
  onApproveEbayDraft: () => void;
  onEbayDraftFormChange: (field: "generatedTitle" | "generatedPrice" | "ebayCategoryId" | "ebayStoreCategoryId", value: string) => void;
}) {
  return (
    <Card eyebrow="eBay draft" title="Live listing fields">
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
          <div className="muted">
            Save the category mapping here before live eBay publish. The preflight card updates after each save.
          </div>
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
    </Card>
  );
}

function EbayPreflightCard({
  preflight,
  error
}: {
  preflight: InventoryPreflightRecord | null;
  error: string | null;
}) {
  return (
    <Card
      action={preflight ? <StatusPill status={preflight.state ?? (preflight.ready ? "READY" : "BLOCKED")} /> : null}
      eyebrow={preflight?.state ?? (preflight?.mode === "live" ? "Live eBay" : "Simulated eBay")}
      title="Publish readiness"
    >
      {error ? <div className="notice">{error}</div> : null}
      {!preflight ? (
        <div className="muted">Checking eBay readiness...</div>
      ) : (
        <div className="stack">
          <OperatorHintCard hint={preflight.hint} />
          <div className="notice">{preflight.summary}</div>
          <div className="inventory-preflight-meta">
            <span>State: {preflight.state ?? "none"}</span>
            <span>Account: {preflight.selectedCredentialType ?? "none"}</span>
            <span>Mode: {preflight.mode}</span>
          </div>
          {preflight.checks.map((check) => (
            <div className="split inventory-preflight-check" key={check.key}>
              <div>
                <strong>{check.label}</strong>
                <div className="muted">{check.detail}</div>
              </div>
              <StatusPill status={check.status} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function InventoryDetailView({
  item,
  pending,
  submitError,
  uploadStatus,
  onAddImage,
  onDeleteImage,
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
  onApproveEbayDraft
}: InventoryDetailViewProps) {
  const [handoffOpen, setHandoffOpen] = useState(false);

  const summaryCard = (
    <InventoryHeroCard
      continuityNotice={continuityNotice}
      item={item}
      lastSyncedLabel={lastSyncedLabel}
      onGenerateDrafts={onGenerateDrafts}
      onOpenHandoff={() => setHandoffOpen(true)}
            onPublishDepop={onPublishDepop}
            onPublishEbay={onPublishEbay}
            onPublishLinked={onPublishLinked}
            onPublishPoshmark={onPublishPoshmark}
            onPublishWhatnot={onPublishWhatnot}
      pending={pending}
    />
  );

  const imagesCard = (
    <InventoryImagesCard
      item={item}
      onAddImage={onAddImage}
      onDeleteImage={onDeleteImage}
      onMoveImage={onMoveImage}
      pending={pending}
      submitError={submitError}
      uploadStatus={uploadStatus}
    />
  );

  const readinessCard = <InventoryReadinessCard item={item} submitError={submitError} />;
  const draftCard = (
    <EbayDraftCard
      ebayDraft={ebayDraft}
      ebayDraftForm={ebayDraftForm}
      onApproveEbayDraft={onApproveEbayDraft}
      onEbayDraftFormChange={onEbayDraftFormChange}
      onSaveEbayDraft={onSaveEbayDraft}
      pending={pending}
    />
  );
  const preflightCard = <EbayPreflightCard error={ebayPreflightError} preflight={ebayPreflight} />;

  return (
    <>
      <div className="inventory-detail-shell">
        <section className="inventory-section inventory-section-summary">{summaryCard}</section>
        <section className="inventory-section inventory-section-images">{imagesCard}</section>
        <section className="inventory-section inventory-section-readiness">{readinessCard}</section>
        <section className="inventory-section inventory-section-draft">{draftCard}</section>
        <section className="inventory-section inventory-section-preflight">{preflightCard}</section>
      </div>
      <ContinueOnMobileModal onClose={() => setHandoffOpen(false)} open={handoffOpen} title={item.title} url={handoffUrl} />
    </>
  );
}
