"use client";

import { Camera, ExternalLink, ScanBarcode, Search, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";

import type { CatalogLookupResult } from "@reselleros/types";
import { Button, Card } from "@reselleros/ui";

import { OperatorHintCard } from "./operator-hint-card";

type BarcodeImportCardProps = {
  token: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type BarcodeDetectorResultLike = {
  rawValue?: string;
};

type BarcodeDetectorLike = {
  detect(source: ImageBitmapSource): Promise<BarcodeDetectorResultLike[]>;
};

type BarcodeDetectorConstructorLike = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
};

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructorLike;
  }
}

function normalizeImageUrls(value: string) {
  return [...new Set(value.split(/[\r\n,]+/).map((entry) => entry.trim()).filter(Boolean))];
}

function firstSourceUrl(result: CatalogLookupResult | null, market: "AMAZON" | "EBAY") {
  return (
    result?.record?.sourceReferences.find((reference) => reference.market === market)?.url ??
    result?.record?.observations.find((observation) => observation.market === market)?.sourceUrl ??
    null
  );
}

function firstObservedPrice(result: CatalogLookupResult | null, market: "AMAZON" | "EBAY") {
  return result?.record?.observations.find((observation) => observation.market === market)?.price ?? null;
}

export function BarcodeImportCard({ token }: BarcodeImportCardProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [lookupPending, startLookupTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<CatalogLookupResult | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerSupported, setScannerSupported] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("Media");
  const [condition, setCondition] = useState("Good used condition");
  const [costBasis, setCostBasis] = useState("0");
  const [amazonPrice, setAmazonPrice] = useState("");
  const [ebayPrice, setEbayPrice] = useState("");
  const [resaleMin, setResaleMin] = useState("");
  const [resaleMax, setResaleMax] = useState("");
  const [priceRecommendation, setPriceRecommendation] = useState("");
  const [amazonUrl, setAmazonUrl] = useState("");
  const [ebayUrl, setEbayUrl] = useState("");
  const [imageUrls, setImageUrls] = useState("");

  useEffect(() => {
    setScannerSupported(
      typeof window !== "undefined" &&
        typeof window.BarcodeDetector === "function" &&
        typeof navigator !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia)
    );
  }, []);

  useEffect(() => {
    if (!scannerOpen || !scannerSupported || !videoRef.current) {
      return;
    }

    let active = true;
    let stream: MediaStream | null = null;
    let animationFrame = 0;

    async function beginScan() {
      try {
        setScannerError(null);
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: {
              ideal: "environment"
            }
          }
        });

        if (!active || !videoRef.current) {
          return;
        }

        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const BarcodeDetector = window.BarcodeDetector;
        const detector = BarcodeDetector
          ? new BarcodeDetector({
              formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"]
            })
          : null;

        if (!detector) {
          setScannerError("Camera scanning is not supported on this browser. Type or paste the identifier instead.");
          return;
        }

        const scanFrame = async () => {
          if (!active || !videoRef.current) {
            return;
          }

          try {
            const detected = await detector.detect(videoRef.current);
            const code = detected.find((candidate) => candidate.rawValue?.trim())?.rawValue?.trim();

            if (code) {
              setIdentifier(code);
              setScannerOpen(false);
              return;
            }
          } catch {
            setScannerError("Could not read the UPC, EAN, or ISBN yet. Hold the label flatter and closer.");
          }

          animationFrame = window.requestAnimationFrame(scanFrame);
        };

        animationFrame = window.requestAnimationFrame(scanFrame);
      } catch {
        setScannerError("Camera access was denied. You can still type the identifier or use a hardware scanner.");
      }
    }

    void beginScan();

    return () => {
      active = false;
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
    };
  }, [scannerOpen, scannerSupported]);

  function resetForm() {
    setIdentifier("");
    setTitle("");
    setBrand("");
    setCategory("Media");
    setCondition("Good used condition");
    setCostBasis("0");
    setAmazonPrice("");
    setEbayPrice("");
    setResaleMin("");
    setResaleMax("");
    setPriceRecommendation("");
    setAmazonUrl("");
    setEbayUrl("");
    setImageUrls("");
    setSubmitError(null);
    setLookupResult(null);
  }

  async function handleLookup() {
    startLookupTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/catalog/lookup`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            identifier: identifier || undefined
          })
        });
        const payload = (await response.json().catch(() => ({ error: "Identifier research failed" }))) as {
          error?: string;
          result?: CatalogLookupResult;
        };

        if (!response.ok || !payload.result) {
          throw new Error(payload.error ?? "Identifier research failed");
        }

        setLookupResult(payload.result);

        if (payload.result.record) {
          setTitle(payload.result.record.canonicalTitle ?? "");
          setBrand(payload.result.record.brand ?? "");
          setCategory(payload.result.record.category ?? "Media");
          setImageUrls(payload.result.record.imageUrls.join("\n"));

          const amazonObservedPrice = firstObservedPrice(payload.result, "AMAZON");
          const ebayObservedPrice = firstObservedPrice(payload.result, "EBAY");
          const firstObserved = amazonObservedPrice ?? ebayObservedPrice ?? null;

          setAmazonPrice(amazonObservedPrice ? String(amazonObservedPrice) : "");
          setEbayPrice(ebayObservedPrice ? String(ebayObservedPrice) : "");
          setAmazonUrl(firstSourceUrl(payload.result, "AMAZON") ?? "");
          setEbayUrl(firstSourceUrl(payload.result, "EBAY") ?? "");

          if (firstObserved) {
            setPriceRecommendation((current) => current || String(firstObserved));
            setResaleMin((current) => current || String(firstObserved));
            setResaleMax((current) => current || String(firstObserved));
          }
        }
      } catch (caughtError) {
        setLookupResult({
          mode: "INTERNAL",
          normalizedIdentifier: identifier.trim(),
          identifierType: "UNKNOWN",
          cacheStatus: "MISS",
          record: null,
          workspaceObservations: [],
          researchLinks: [],
          hint: {
            title: "Identifier research failed",
            explanation: caughtError instanceof Error ? caughtError.message : "Identifier research failed.",
            severity: "ERROR",
            nextActions: [
              "Retry after checking the UPC, EAN, or ISBN.",
              "Use the research links and continue with manual entry if you still need to create the item."
            ],
            canContinue: true
          }
        });
      }
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        const observations = [
          Number.isFinite(Number(amazonPrice)) && Number(amazonPrice) >= 0
            ? {
                market: "AMAZON",
                label: "Amazon",
                price: Number(amazonPrice),
                sourceUrl: amazonUrl || null,
                note: "Captured by operator during identifier research."
              }
            : null,
          Number.isFinite(Number(ebayPrice)) && Number(ebayPrice) >= 0
            ? {
                market: "EBAY",
                label: "eBay",
                price: Number(ebayPrice),
                sourceUrl: ebayUrl || null,
                note: "Captured by operator during identifier research."
              }
            : null
        ].filter((value): value is NonNullable<typeof value> => Boolean(value));

        if (observations.length === 0) {
          throw new Error("Add at least one observed market price from Amazon or eBay.");
        }

        const primarySourceMarket = amazonUrl ? "AMAZON" : ebayUrl ? "EBAY" : observations[0]?.market ?? "OTHER";
        const primarySourceUrl = amazonUrl || ebayUrl || observations[0]?.sourceUrl || null;
        const referenceUrls = [amazonUrl, ebayUrl].filter(Boolean);
        const recommendationBase = Number(priceRecommendation || observations[0]?.price || 0);

        const response = await fetch(`${API_BASE_URL}/api/inventory/import/barcode`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            identifier,
            identifierType: lookupResult?.identifierType ?? null,
            title,
            brand: brand || null,
            category,
            condition,
            costBasis: Number(costBasis || 0),
            estimatedResaleMin: resaleMin ? Number(resaleMin) : recommendationBase,
            estimatedResaleMax: resaleMax ? Number(resaleMax) : recommendationBase,
            priceRecommendation: recommendationBase,
            primarySourceMarket,
            primarySourceUrl,
            referenceUrls,
            imageUrls: normalizeImageUrls(imageUrls),
            observations
          })
        });
        const payload = (await response.json().catch(() => ({ error: "Could not create item from identifier research" }))) as {
          error?: string;
          item?: { id: string };
        };

        if (!response.ok || !payload.item?.id) {
          throw new Error(payload.error ?? "Could not create item from identifier research");
        }

        resetForm();
        router.push(`/inventory/${payload.item.id}`);
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not create item from identifier research");
      }
    });
  }

  const normalizedImageUrls = normalizeImageUrls(imageUrls);
  const researchLinks = useMemo(() => lookupResult?.researchLinks ?? [], [lookupResult]);

  return (
    <>
      <Card eyebrow="Identifier research" title="Scan, research, and create from UPC, EAN, or ISBN">
        <div className="stack">
          <p className="muted">
            Scan a UPC, EAN, or ISBN, use Google plus marketplace search links to research the item, and create an inventory
            record that strengthens Mollie&apos;s internal identifier catalog for future scans.
          </p>
          <form className="stack" onSubmit={handleSubmit}>
            <div className="scan-import-grid">
              <label className="label">
                UPC / EAN / ISBN
                <div className="scan-field-row">
                  <input
                    className="field"
                    data-testid="barcode-import-barcode"
                    inputMode="numeric"
                    name="identifier"
                    placeholder="Scan or type identifier"
                    required
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                  />
                  {scannerSupported ? (
                    <Button kind="secondary" onClick={() => setScannerOpen(true)} type="button">
                      <ScanBarcode size={16} /> Scan
                    </Button>
                  ) : null}
                </div>
              </label>
              <div className="label">
                Research
                <div className="scan-field-row">
                  <Button
                    data-testid="barcode-import-lookup"
                    disabled={lookupPending || !identifier.trim()}
                    kind="secondary"
                    onClick={handleLookup}
                    type="button"
                  >
                    <Search size={16} /> {lookupPending ? "Loading..." : "Load saved research"}
                  </Button>
                </div>
              </div>
              <label className="label">
                Title
                <input
                  className="field"
                  data-testid="barcode-import-title"
                  name="title"
                  placeholder="Product title"
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="label">
                Brand
                <input
                  className="field"
                  data-testid="barcode-import-brand"
                  name="brand"
                  value={brand}
                  onChange={(event) => setBrand(event.target.value)}
                />
              </label>
              <label className="label">
                Category
                <input
                  className="field"
                  data-testid="barcode-import-category"
                  name="category"
                  required
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                />
              </label>
              <label className="label">
                Condition
                <input
                  className="field"
                  data-testid="barcode-import-condition"
                  name="condition"
                  required
                  value={condition}
                  onChange={(event) => setCondition(event.target.value)}
                />
              </label>
              <label className="label">
                Cost basis
                <input
                  className="field"
                  min="0"
                  name="costBasis"
                  step="0.01"
                  type="number"
                  value={costBasis}
                  onChange={(event) => setCostBasis(event.target.value)}
                />
              </label>
            </div>

            <OperatorHintCard hint={lookupResult?.hint ?? null} />

            {lookupResult ? (
              <div className="market-observation-card">
                <div className="split">
                  <div>
                    <p className="eyebrow">Research status</p>
                    <strong>
                      {lookupResult.identifierType} {lookupResult.cacheStatus.toLowerCase()}
                    </strong>
                  </div>
                  <div className="market-observation-value">{lookupResult.normalizedIdentifier}</div>
                </div>
                {researchLinks.length > 0 ? (
                  <div className="actions wrap-actions">
                    {researchLinks.map((link) => (
                      <a className="secondary-link-button" href={link.url} key={`${link.market}:${link.url}`} rel="noreferrer" target="_blank">
                        <ExternalLink size={16} /> {link.label}
                      </a>
                    ))}
                  </div>
                ) : null}
                <div className="market-observation-summary">
                  <span>{lookupResult.record ? "Saved catalog match available" : "No saved product match yet"}</span>
                  <span>{lookupResult.workspaceObservations.length} workspace observation{lookupResult.workspaceObservations.length === 1 ? "" : "s"}</span>
                </div>
              </div>
            ) : null}

            <div className="market-observation-card" data-testid="research-observation-card">
              <div className="split">
                <div>
                  <p className="eyebrow">Market observations</p>
                  <strong>Compare Amazon and eBay</strong>
                </div>
                <div className="market-observation-value">
                  {lookupResult?.record?.confidenceScore ? `${Math.round(lookupResult.record.confidenceScore * 100)}% confidence` : "Manual research"}
                </div>
              </div>
              <div className="scan-import-grid">
                <label className="label">
                  Amazon observed price
                  <input
                    className="field"
                    data-testid="barcode-import-amazon-price"
                    min="0"
                    name="amazonPrice"
                    step="0.01"
                    type="number"
                    value={amazonPrice}
                    onChange={(event) => setAmazonPrice(event.target.value)}
                  />
                </label>
                <label className="label">
                  Amazon URL
                  <input
                    className="field"
                    name="amazonUrl"
                    placeholder="https://www.amazon.com/..."
                    value={amazonUrl}
                    onChange={(event) => setAmazonUrl(event.target.value)}
                  />
                </label>
                <label className="label">
                  eBay observed price
                  <input
                    className="field"
                    data-testid="barcode-import-ebay-price"
                    min="0"
                    name="ebayPrice"
                    step="0.01"
                    type="number"
                    value={ebayPrice}
                    onChange={(event) => setEbayPrice(event.target.value)}
                  />
                </label>
                <label className="label">
                  eBay URL
                  <input
                    className="field"
                    name="ebayUrl"
                    placeholder="https://www.ebay.com/..."
                    value={ebayUrl}
                    onChange={(event) => setEbayUrl(event.target.value)}
                  />
                </label>
                <label className="label">
                  Price recommendation
                  <input
                    className="field"
                    min="0"
                    name="priceRecommendation"
                    step="0.01"
                    type="number"
                    value={priceRecommendation}
                    onChange={(event) => setPriceRecommendation(event.target.value)}
                  />
                </label>
                <label className="label">
                  Resale min
                  <input
                    className="field"
                    min="0"
                    name="resaleMin"
                    step="0.01"
                    type="number"
                    value={resaleMin}
                    onChange={(event) => setResaleMin(event.target.value)}
                  />
                </label>
                <label className="label">
                  Resale max
                  <input
                    className="field"
                    min="0"
                    name="resaleMax"
                    step="0.01"
                    type="number"
                    value={resaleMax}
                    onChange={(event) => setResaleMax(event.target.value)}
                  />
                </label>
              </div>
              <label className="label">
                Reference image URLs
                <textarea
                  className="field textarea-field"
                  data-testid="barcode-import-image-urls"
                  name="imageUrls"
                  placeholder={"Paste one image URL per line.\nThese URLs become the initial item gallery in v1 and can be replaced later with operator photos."}
                  rows={4}
                  value={imageUrls}
                  onChange={(event) => setImageUrls(event.target.value)}
                />
              </label>
              <div className="scan-import-hint">
                <Sparkles size={16} />
                <span>
                  Save what you confirm here and Mollie will reuse that identifier knowledge the next time someone scans the same item.
                </span>
              </div>
              <div className="market-observation-summary">
                <span>{normalizedImageUrls.length} image URL{normalizedImageUrls.length === 1 ? "" : "s"} ready to attach</span>
                <span>{amazonPrice || ebayPrice ? "Observed pricing captured" : "Add at least one market price"}</span>
              </div>
            </div>

            <div className="actions">
              <Button data-testid="barcode-import-submit" disabled={pending} type="submit">
                <Sparkles size={16} /> {pending ? "Creating from research..." : "Create item from research"}
              </Button>
              <Button disabled={pending} kind="secondary" onClick={resetForm} type="button">
                Reset
              </Button>
            </div>
          </form>
          {submitError ? <div className="notice">{submitError}</div> : null}
        </div>
      </Card>

      {scannerOpen ? (
        <div className="handoff-modal-backdrop" role="presentation" onClick={() => setScannerOpen(false)}>
          <div
            aria-labelledby="barcode-scanner-title"
            aria-modal="true"
            className="handoff-modal barcode-scanner-modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="handoff-modal-header">
              <div>
                <p className="eyebrow">Identifier scan</p>
                <h3 id="barcode-scanner-title">Scan with camera</h3>
              </div>
              <Button kind="ghost" onClick={() => setScannerOpen(false)}>
                <X size={16} /> Close
              </Button>
            </div>
            <p className="handoff-copy">
              Hold the UPC, EAN, or ISBN inside the frame. Mollie will fill the identifier field as soon as it detects a match.
            </p>
            <div className="barcode-scanner-video-shell">
              <video autoPlay className="barcode-scanner-video" muted playsInline ref={videoRef} />
            </div>
            {scannerError ? <div className="notice">{scannerError}</div> : null}
            <div className="scan-import-hint">
              <Camera size={16} />
              <span>If camera scanning is unavailable here, you can still type the identifier or use a hardware scanner.</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
