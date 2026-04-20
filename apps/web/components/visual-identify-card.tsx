"use client";

import { Camera, ExternalLink, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ChangeEvent, type FormEvent } from "react";

import type { VisualProductCandidate, VisualProductLookupResult } from "@reselleros/types";
import { Button, Card } from "@reselleros/ui";

import { OperatorHintCard } from "./operator-hint-card";
import { ScanResultSheet } from "./scan-result-sheet";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function buildSearchUrl(query: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
}

export function VisualIdentifyCard({
  token,
  presentation = "embedded"
}: {
  token: string;
  presentation?: "embedded" | "scan";
}) {
  const router = useRouter();
  const [lookupPending, startLookupTransition] = useTransition();
  const [submitPending, startSubmitTransition] = useTransition();
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [lookupResult, setLookupResult] = useState<VisualProductLookupResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("General Merchandise");
  const [condition, setCondition] = useState("Good used condition");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [costBasis, setCostBasis] = useState("0");
  const [priceRecommendation, setPriceRecommendation] = useState("");
  const [generateDrafts, setGenerateDrafts] = useState(false);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [photoFile]);

  function resetForm() {
    setPhotoFile(null);
    setNotes("");
    setLookupResult(null);
    setSubmitError(null);
    setTitle("");
    setBrand("");
    setCategory("General Merchandise");
    setCondition("Good used condition");
    setSize("");
    setColor("");
    setCostBasis("0");
    setPriceRecommendation("");
    setGenerateDrafts(false);
  }

  function applyCandidate(candidate: VisualProductCandidate) {
    setTitle(candidate.title);
    setBrand(candidate.brand ?? "");
    setCategory(candidate.category ?? "General Merchandise");
    setCondition(candidate.condition ?? "Good used condition");
    setSize(candidate.size ?? candidate.model ?? "");
    setColor(candidate.color ?? "");
    setPriceRecommendation(
      typeof candidate.priceSuggestion === "number" && Number.isFinite(candidate.priceSuggestion)
        ? String(candidate.priceSuggestion)
        : ""
    );
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setPhotoFile(file);
    setLookupResult(null);
    setSubmitError(null);
  }

  async function identifyFromPhoto() {
    if (!photoFile) {
      setSubmitError("Choose a product photo first.");
      return;
    }

    startLookupTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("image", photoFile);
        if (notes.trim()) {
          formData.append("notes", notes.trim());
        }

        const response = await fetch(`${API_BASE_URL}/api/product-lookup/vision`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`
          },
          body: formData
        });
        const payload = (await response.json().catch(() => ({ error: "Could not identify this photo." }))) as {
          error?: string;
          result?: VisualProductLookupResult;
        };

        if (!response.ok || !payload.result) {
          throw new Error(payload.error ?? "Could not identify this photo.");
        }

        setLookupResult(payload.result);
        setSubmitError(null);

        if (payload.result.candidate) {
          applyCandidate(payload.result.candidate);
        } else if (notes.trim() && !title.trim()) {
          setTitle(notes.trim());
        }
      } catch (caughtError) {
        setLookupResult(null);
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not identify this photo.");
      }
    });
  }

  async function uploadPhoto(itemId: string) {
    if (!photoFile) {
      return;
    }

    const formData = new FormData();
    formData.append("image", photoFile);
    formData.append("position", "0");

    const response = await fetch(`${API_BASE_URL}/api/inventory/${itemId}/images/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    });
    const payload = (await response.json().catch(() => ({ error: "Could not upload the product photo." }))) as {
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Could not upload the product photo.");
    }
  }

  async function queueDrafts(itemId: string) {
    if (!generateDrafts) {
      return;
    }

    const response = await fetch(`${API_BASE_URL}/api/inventory/${itemId}/generate-drafts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        platforms: ["EBAY", "DEPOP", "POSHMARK", "WHATNOT"]
      })
    });
    const payload = (await response.json().catch(() => ({ error: "Could not queue marketplace drafts." }))) as {
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Could not queue marketplace drafts.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startSubmitTransition(async () => {
      try {
        const candidate = lookupResult?.candidate ?? null;
        const response = await fetch(`${API_BASE_URL}/api/inventory`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            title: title.trim(),
            brand: brand.trim() || null,
            category: category.trim(),
            condition: condition.trim(),
            size: size.trim() || null,
            color: color.trim() || null,
            quantity: 1,
            costBasis: Number(costBasis || 0),
            priceRecommendation: priceRecommendation.trim() ? Number(priceRecommendation) : null,
            estimatedResaleMin: null,
            estimatedResaleMax: null,
            attributes: {
              importSource: candidate ? "VISION_LOOKUP" : "PHOTO_MANUAL",
              ...(notes.trim()
                ? {
                    sourceQuery: notes.trim()
                  }
                : {}),
              ...(candidate
                ? {
                    visualLookup: {
                      provider: candidate.provider,
                      confidenceScore: candidate.confidenceScore,
                      confidenceState: candidate.confidenceState,
                      matchRationale: candidate.matchRationale,
                      researchQueries: candidate.researchQueries,
                      model: candidate.model ?? null
                    }
                  }
                : {})
            }
          })
        });
        const payload = (await response.json().catch(() => ({ error: "Could not create this inventory item." }))) as {
          error?: string;
          item?: { id: string };
        };

        if (!response.ok || !payload.item?.id) {
          throw new Error(payload.error ?? "Could not create this inventory item.");
        }

        await uploadPhoto(payload.item.id);
        await queueDrafts(payload.item.id);

        resetForm();
        router.push(generateDrafts ? `/drafts?fromScan=${payload.item.id}` : `/inventory/${payload.item.id}`);
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not create this inventory item.");
      }
    });
  }

  const candidate = lookupResult?.candidate ?? null;
  const researchLinks = useMemo(
    () =>
      (candidate?.researchQueries ?? []).map((query) => ({
        query,
        url: buildSearchUrl(query)
      })),
    [candidate?.researchQueries]
  );
  const scanMode = presentation === "scan";
  const resultSheetOpen = scanMode && (Boolean(lookupResult) || Boolean(submitError));
  const canSubmit = Boolean(photoFile) && Boolean(title.trim()) && Boolean(category.trim()) && Boolean(condition.trim());
  const editor = (
    <>
      {lookupResult?.hint ? <OperatorHintCard hint={lookupResult.hint} /> : null}
      {submitError ? <div className="notice">{submitError}</div> : null}

      {candidate ? (
        <div className="market-observation-card">
          <div className="split">
            <div>
              <p className="eyebrow">Photo identification</p>
              <strong>{candidate.title}</strong>
            </div>
            <div className="market-observation-value">{candidate.confidenceState}</div>
          </div>
          <div className="scan-import-hint">
            <Sparkles size={16} />
            <span>
              Mollie used computer vision to suggest the item details from your photo. Review the fields below before saving.
            </span>
          </div>
          {candidate.matchRationale.length > 0 ? (
            <ul className="marketplace-hint-list">
              {candidate.matchRationale.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          {researchLinks.length > 0 ? (
            <div className="actions wrap-actions">
              {researchLinks.map((entry) => (
                <a className="secondary-link-button" href={entry.url} key={entry.query} rel="noreferrer" target="_blank">
                  <Search size={16} /> {entry.query}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <form className="stack" onSubmit={handleSubmit}>
        <div className="scan-import-grid">
          <label className="label">
            Title
            <input className="field" required value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="label">
            Brand
            <input className="field" value={brand} onChange={(event) => setBrand(event.target.value)} />
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
            Model or size
            <input className="field" value={size} onChange={(event) => setSize(event.target.value)} />
          </label>
          <label className="label">
            Color
            <input className="field" value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
          <label className="label">
            Cost basis
            <input className="field" min="0" step="0.01" type="number" value={costBasis} onChange={(event) => setCostBasis(event.target.value)} />
          </label>
          <label className="label">
            Price recommendation
            <input
              className="field"
              min="0"
              step="0.01"
              type="number"
              value={priceRecommendation}
              onChange={(event) => setPriceRecommendation(event.target.value)}
            />
          </label>
        </div>

        <label className="checkbox-row">
          <input checked={generateDrafts} onChange={(event) => setGenerateDrafts(event.target.checked)} type="checkbox" />
          <span>Also queue marketplace drafts after creating the item</span>
        </label>

        <div className="actions">
          <Button disabled={submitPending || !canSubmit} type="submit">
            <Sparkles size={16} /> {submitPending ? "Saving..." : generateDrafts ? "Create item and queue drafts" : "Create item"}
          </Button>
          <Button disabled={submitPending} kind="secondary" onClick={resetForm} type="button">
            Reset
          </Button>
        </div>
      </form>
    </>
  );

  return (
    <>
      <Card eyebrow={scanMode ? "Photo intake" : "Identify from photo"} title="Use computer vision when the item has no barcode">
        <div className="stack">
          <p className="muted">
            Take or upload one clear product photo. Mollie will use AI image analysis to suggest the item, then keep everything editable before you save it.
          </p>

          <label className="label">
            Take or upload a product photo
            <input
              accept="image/*"
              capture="environment"
              className="field"
              onChange={handleFileChange}
              type="file"
            />
          </label>

          {photoPreviewUrl ? <img alt="Product preview" className="image-upload-preview" src={photoPreviewUrl} /> : null}

          <label className="label">
            What do you already know?
            <textarea
              className="field textarea-field"
              placeholder="Optional notes, brand guesses, category hints, or what the camera missed."
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>

          <div className="actions wrap-actions">
            <Button disabled={lookupPending || !photoFile} onClick={() => void identifyFromPhoto()} type="button">
              <Camera size={16} /> {lookupPending ? "Analyzing photo..." : "Identify from photo"}
            </Button>
            {photoPreviewUrl ? (
              <a className="secondary-link-button" href={photoPreviewUrl} rel="noreferrer" target="_blank">
                <ExternalLink size={16} /> Open preview
              </a>
            ) : null}
            {candidate ? (
              <a
                className="secondary-link-button"
                href={buildSearchUrl(candidate.title)}
                rel="noreferrer"
                target="_blank"
              >
                <Search size={16} /> Research suggestion
              </a>
            ) : null}
          </div>

          {!scanMode ? editor : null}
        </div>
      </Card>

      {scanMode ? (
        <ScanResultSheet
          open={resultSheetOpen}
          subtitle={candidate ? `${candidate.confidenceState} confidence` : "Manual follow-up"}
          title={candidate?.title ?? "Photo intake review"}
        >
          {editor}
        </ScanResultSheet>
      ) : null}
    </>
  );
}
