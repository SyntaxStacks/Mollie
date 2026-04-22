"use client";

import Link from "next/link";
import { ArrowLeft, Camera, ExternalLink, Plus, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";

import { Button } from "@reselleros/ui";
import type { ProductLookupCandidate } from "@reselleros/types";

import { clearScanCreateDraft, readScanCreateDraft, type ScanCreateDraft } from "../lib/scan-create-draft";
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
  scanDraftId?: string | null;
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

function sourceMarketForUrl(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (!normalized) {
    return "OTHER" as const;
  }

  if (normalized.includes("amazon.")) {
    return "AMAZON" as const;
  }

  if (normalized.includes("ebay.")) {
    return "EBAY" as const;
  }

  return "OTHER" as const;
}

function primarySourceMarketForCandidate(candidate: ProductLookupCandidate | null) {
  if (!candidate) {
    return "OTHER" as const;
  }

  return candidate.provider === "AMAZON_ENRICHMENT" ? "AMAZON" : "OTHER";
}

function uniqueTrimmedValues(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))];
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toValidUrl(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";

  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function validUrlList(values: Array<string | null | undefined>) {
  return uniqueTrimmedValues(values)
    .map((value) => toValidUrl(value))
    .filter((value): value is string => Boolean(value));
}

export function InventoryCreateWorkspace({ token, existingItems, scanDraftId }: InventoryCreateWorkspaceProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scanDraftError, setScanDraftError] = useState<string | null>(null);
  const [scanDraft, setScanDraft] = useState<ScanCreateDraft | null>(null);
  const [selectedScanCandidateId, setSelectedScanCandidateId] = useState("");
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

  function applyScanDraftToForm(draft: ScanCreateDraft, candidateId?: string | null) {
    const candidate =
      draft.candidates.find((entry) => entry.id === candidateId) ??
      draft.candidates.find((entry) => entry.id === draft.selectedCandidateId) ??
      draft.candidates[0] ??
      null;
    const sourceUrlValue =
      candidate?.productUrl?.trim() ||
      draft.manualSourceUrl.trim() ||
      draft.amazonUrl.trim() ||
      draft.ebayUrl.trim();

    setIdentifier(draft.barcode || candidate?.barcode || "");
    setTitle(candidate?.title?.trim() || draft.title.trim() || "");
    setBrand(candidate?.brand?.trim() || draft.brand.trim() || "");
    setLookupQuery(draft.lookupQuery.trim() || candidate?.title?.trim() || draft.title.trim() || "");
    setSourceUrl(sourceUrlValue);
    setCategory(candidate?.category?.trim() || draft.category.trim() || "General Merchandise");
    setCondition(draft.condition.trim() || "Good used condition");
    setSize(candidate?.size?.trim() || candidate?.model?.trim() || draft.size.trim() || "");
    setColor(candidate?.color?.trim() || draft.color.trim() || "");
    setQuantity("1");
    setCostBasis(draft.costBasis || "0");
    setEstimatedResaleMin("");
    setEstimatedResaleMax("");
    setPriceRecommendation(draft.priceRecommendation || "");
    setDescription(draft.description || "");
  }

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
  const activeScanCandidate = useMemo(
    () =>
      scanDraft?.candidates.find((candidate) => candidate.id === selectedScanCandidateId) ??
      scanDraft?.candidates.find((candidate) => candidate.id === scanDraft.selectedCandidateId) ??
      scanDraft?.candidates[0] ??
      null,
    [scanDraft, selectedScanCandidateId]
  );
  const scanSourceImages = useMemo(() => {
    if (activeScanCandidate?.imageUrls.length) {
      return activeScanCandidate.imageUrls;
    }

    return scanDraft?.imageUrls ?? [];
  }, [activeScanCandidate, scanDraft]);
  const createActionLabel = scanDraft?.generateDrafts ? "Create item and queue drafts" : "Create item";

  const workingTitle = title.trim() || "New inventory item";
  const sourceMode = scanDraft ? "Scan prefill" : lookupQuery.trim() || sourceUrl.trim() ? "Manual lookup" : "Manual entry";
  const nextStep = scanDraft
    ? "Review the scan prefill, pick the best match, then create the item"
    : title.trim()
      ? "Create item and move into listing work"
      : "Name the item and capture the shared facts";
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

  useEffect(() => {
    if (!scanDraftId) {
      setScanDraft(null);
      setScanDraftError(null);
      setSelectedScanCandidateId("");
      return;
    }

    const storedDraft = readScanCreateDraft(scanDraftId);

    if (!storedDraft) {
      setScanDraft(null);
      setSelectedScanCandidateId("");
      setScanDraftError("The scan prefill expired. Start a new scan to continue from barcode lookup.");
      return;
    }

    const initialCandidateId = storedDraft.selectedCandidateId ?? storedDraft.candidates[0]?.id ?? "";
    setScanDraft(storedDraft);
    setScanDraftError(null);
    setSelectedScanCandidateId(initialCandidateId);
    applyScanDraftToForm(storedDraft, initialCandidateId);
  }, [scanDraftId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        const parsedLabels = splitCsv(labels);
        const trimmedSourceUrl = sourceUrl.trim();
        const trimmedLookupQuery = lookupQuery.trim();
        const currentScanDraft = scanDraft;
        const normalizedScanIdentifier = normalizeIdentifier(identifier || scanDraft?.barcode || activeScanCandidate?.barcode || "");
        const useScanImport = Boolean(currentScanDraft && normalizedScanIdentifier);
        const scanPrimarySourceUrl = toValidUrl(
          trimmedSourceUrl ||
            activeScanCandidate?.productUrl ||
            currentScanDraft?.manualSourceUrl ||
            currentScanDraft?.amazonUrl ||
            currentScanDraft?.ebayUrl ||
            null
        );
        const payloadBase = {
          title: title.trim(),
          brand: brand.trim() || null,
          category: category.trim(),
          condition: condition.trim(),
          size: size.trim() || null,
          color: color.trim() || null,
          quantity: Math.max(1, Number(quantity || 1)),
          costBasis: Number(costBasis || 0),
          estimatedResaleMin: parseOptionalNumber(estimatedResaleMin),
          estimatedResaleMax: parseOptionalNumber(estimatedResaleMax),
          priceRecommendation: parseOptionalNumber(priceRecommendation),
          description: description.trim() || null,
          labels: parsedLabels,
          internalNote: internalNote.trim() || null
        };

        const response = useScanImport && currentScanDraft
          ? await fetch(`${API_BASE_URL}/api/inventory/import/barcode`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
              },
              body: JSON.stringify({
                identifier: normalizedScanIdentifier,
                barcode: normalizedScanIdentifier,
                identifierType: activeScanCandidate?.identifierType ?? currentScanDraft.identifierType ?? null,
                intakeDecision: currentScanDraft.intakeDecision,
                ...payloadBase,
                primarySourceMarket:
                  primarySourceMarketForCandidate(activeScanCandidate) !== "OTHER"
                    ? primarySourceMarketForCandidate(activeScanCandidate)
                    : sourceMarketForUrl(trimmedSourceUrl || currentScanDraft.amazonUrl || currentScanDraft.ebayUrl),
                primarySourceUrl: scanPrimarySourceUrl,
                referenceUrls: validUrlList([
                  trimmedSourceUrl,
                  currentScanDraft.manualSourceUrl,
                  currentScanDraft.amazonUrl,
                  currentScanDraft.ebayUrl,
                  activeScanCandidate?.productUrl
                ]),
                imageUrls: validUrlList([
                  ...(activeScanCandidate?.imageUrls ?? []),
                  ...(currentScanDraft.imageUrls ?? [])
                ]),
                observations: [
                  currentScanDraft.amazonPrice
                    ? {
                        market: "AMAZON",
                        label: "Amazon",
                        price: Number(currentScanDraft.amazonPrice),
                        sourceUrl: toValidUrl(currentScanDraft.amazonUrl),
                        note: "Captured during scan to identify."
                      }
                    : null,
                  currentScanDraft.ebayPrice
                    ? {
                        market: "EBAY",
                        label: "eBay",
                        price: Number(currentScanDraft.ebayPrice),
                        sourceUrl: toValidUrl(currentScanDraft.ebayUrl),
                        note: "Captured during scan to identify."
                      }
                    : null
                ].filter((value): value is NonNullable<typeof value> => Boolean(value)),
                acceptedCandidate: activeScanCandidate,
                generateDrafts: currentScanDraft.generateDrafts,
                draftPlatforms: ["EBAY", "DEPOP", "POSHMARK", "WHATNOT"]
              })
            })
          : await fetch(`${API_BASE_URL}/api/inventory`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
              },
              body: JSON.stringify({
                ...payloadBase,
                attributes: {
                  importSource: scanDraft ? "SCAN_PREFILL" : trimmedLookupQuery || trimmedSourceUrl ? "MANUAL_LOOKUP" : "MANUAL_ENTRY",
                  ...(scanDraft
                    ? {
                        intakeDecision: scanDraft.intakeDecision,
                        scanDraftId: scanDraft.id,
                        selectedCandidate: activeScanCandidate,
                        identifierType: activeScanCandidate?.identifierType ?? scanDraft.identifierType ?? null
                      }
                    : {}),
                  ...(trimmedLookupQuery
                    ? {
                        sourceQuery: trimmedLookupQuery
                      }
                    : {}),
                  ...(trimmedSourceUrl
                    ? {
                        primarySourceUrl: trimmedSourceUrl,
                        referenceUrls: validUrlList([trimmedSourceUrl])
                      }
                    : {}),
                  ...(identifier.trim()
                    ? {
                        identifier: normalizeIdentifier(identifier)
                      }
                    : {}),
                  ...(payloadBase.description
                    ? {
                        description: payloadBase.description
                      }
                    : {}),
                  ...(parsedLabels.length > 0
                    ? {
                        labels: parsedLabels
                      }
                    : {}),
                  ...(payloadBase.internalNote
                    ? {
                        internalNote: payloadBase.internalNote
                      }
                    : {})
                }
              })
            });
        const payload = (await response.json()) as { error?: string; item?: { id: string }; draftsQueued?: boolean };

        if (!response.ok || !payload.item?.id) {
          throw new Error(payload.error ?? "Could not create this inventory item");
        }

        if (scanDraftId) {
          clearScanCreateDraft(scanDraftId);
        }

        router.push(payload.draftsQueued ? `/drafts?fromScan=${payload.item.id}` : `/inventory/${payload.item.id}`);
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
        {scanDraftError ? <div className="notice warning">{scanDraftError}</div> : null}

        <div className="detail-editor-workspace">
        <div className="listing-workbench-layout detail-editor-layout">
          <aside className="listing-marketplace-rail inventory-create-intake-rail" ref={marketplaceRailRef}>
            <div className="listing-rail-summary">
              <div className="listing-rail-summary-copy">
                <p className="eyebrow">Create path</p>
                <strong>
                  {scanDraft
                    ? "Scan found a starting point"
                    : sourceMode === "Manual lookup"
                      ? "Researching before save"
                      : "Create the shared item first"}
                </strong>
                <p className="muted listing-rail-helper">
                  {scanDraft
                    ? "Review the scan prefill here, switch matches if needed, and keep the same workspace shape you will use after save."
                    : "This page now mirrors item detail so the same left-center-right workflow carries from intake into listing."}
                </p>
              </div>
              <Link href="/inventory">
                <Button kind="ghost" type="button">
                  <ArrowLeft size={16} /> Back
                </Button>
              </Link>
            </div>

            <div className="inventory-create-rail-stack">
              {scanDraft ? (
                <section className="inventory-create-mode-card inventory-create-mode-card-active">
                  <div className="inventory-create-mode-header">
                    <Sparkles size={18} />
                    <div>
                      <strong>Scan prefill is loaded</strong>
                      <p className="muted">
                        {scanDraft.barcode
                          ? `Barcode ${scanDraft.barcode} brought in ${scanDraft.candidates.length || 1} suggested match${scanDraft.candidates.length === 1 ? "" : "es"}.`
                          : "The scanner handed this item off with prefilled source data."}
                      </p>
                    </div>
                  </div>
                </section>
              ) : null}

              <section className="inventory-create-mode-card inventory-create-mode-card-active">
                <div className="inventory-create-mode-header">
                  <Search size={18} />
                  <div>
                    <strong>{scanDraft ? "Editable source details" : "Manual/source lookup"}</strong>
                    <p className="muted">
                      {scanDraft
                        ? "The scan filled these fields first. Keep what is right, replace what is wrong, and save only the details you trust."
                        : "Research the item, keep only the facts you trust, and start the shared record without leaving the workspace."}
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
            {scanDraft ? (
              <section className="listing-form-section inventory-create-scan-prefill-card">
                <div className="listing-form-section-heading">
                  <div>
                    <p className="eyebrow">Scan prefill</p>
                    <h3>Start from the best match, then edit freely</h3>
                    <p className="muted">
                      The scan already populated the form below. If the lookup returned multiple matches, switch the source here and Mollie will refresh the prefill.
                    </p>
                  </div>
                </div>
                <div className="inventory-create-scan-prefill-grid">
                  {scanDraft.candidates.length > 1 ? (
                    <label className="label inventory-create-grid-span-2">
                      Match to use
                      <select
                        className="field"
                        value={selectedScanCandidateId}
                        onChange={(event) => {
                          setSelectedScanCandidateId(event.target.value);
                          if (scanDraft) {
                            applyScanDraftToForm(scanDraft, event.target.value);
                          }
                        }}
                      >
                        {scanDraft.candidates.map((candidate, index) => (
                          <option key={candidate.id} value={candidate.id}>
                            Match {index + 1}: {candidate.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : activeScanCandidate ? (
                    <div className="inventory-create-scan-prefill-meta inventory-create-grid-span-2">
                      <span className="muted">Using match</span>
                      <strong>{activeScanCandidate.title}</strong>
                    </div>
                  ) : null}
                  <div className="inventory-create-scan-prefill-meta">
                    <span className="muted">Barcode</span>
                    <strong>{scanDraft.barcode || "Manual scan result"}</strong>
                  </div>
                  <div className="inventory-create-scan-prefill-meta">
                    <span className="muted">Source</span>
                    <strong>{activeScanCandidate?.provider ?? "Manual review"}</strong>
                  </div>
                  <div className="inventory-create-scan-prefill-meta">
                    <span className="muted">Confidence</span>
                    <strong>
                      {activeScanCandidate
                        ? `${Math.round(activeScanCandidate.confidenceScore * 100)}% ${activeScanCandidate.confidenceState.toLowerCase()}`
                        : "Operator controlled"}
                    </strong>
                  </div>
                  <div className="inventory-create-scan-prefill-meta">
                    <span className="muted">Intent</span>
                    <strong>{scanDraft.intakeDecision.replaceAll("_", " ")}</strong>
                  </div>
                </div>
                {activeScanCandidate?.productUrl || sourceUrl.trim() ? (
                  <a
                    className="secondary-link-button"
                    href={activeScanCandidate?.productUrl ?? sourceUrl.trim()}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink size={16} /> Open source page
                  </a>
                ) : null}
              </section>
            ) : null}

            <div className="listing-form-section listing-photo-panel">
              <div className="listing-form-section-heading listing-photo-section-heading">
                <div className="listing-photo-section-heading-copy">
                  <h3>Photos</h3>
                  <p className="muted">
                    {scanSourceImages.length > 0
                      ? "These source images came from the scan result and will attach to the item when you save."
                      : "Start from scan now or create the item first and upload, reorder, and review images on the item page."}
                  </p>
                </div>
                <Link href="/inventory?scan=barcode">
                  <Button kind="secondary" type="button">
                    <Camera size={16} /> Scan with camera
                  </Button>
                </Link>
              </div>
              {scanSourceImages.length > 0 ? (
                <div className="inventory-create-scan-photo-grid">
                  {scanSourceImages.slice(0, 5).map((imageUrl, index) => (
                    <div className={`inventory-create-scan-photo-card${index === 0 ? " inventory-create-scan-photo-card-cover" : ""}`} key={imageUrl}>
                      <img alt={`${workingTitle} source ${index + 1}`} src={imageUrl} />
                      {index === 0 ? <span className="inventory-create-scan-photo-badge">Source preview</span> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="inventory-create-photo-dropzone">
                  <Plus size={28} />
                  <strong>No photos attached yet</strong>
                  <p className="muted">The item detail page will handle photo upload, sorting, cover selection, and cleanup after save.</p>
                </div>
              )}
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
                {scanDraft ? (
                  <div className="detail-meta-row"><span className="muted">Scan matches</span><strong>{Math.max(scanDraft.candidates.length, 1)}</strong></div>
                ) : null}
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
                <Plus size={16} /> {pending ? "Creating..." : createActionLabel}
              </Button>
            </div>
          </div>
        </ActionRail>
      </div>
    </section>
  );
}
