"use client";

import { Camera, CheckCircle2, ExternalLink, ScanBarcode, Search, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";

import type { ProductLookupCandidate, ProductLookupResult } from "@reselleros/types";
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

function providerLabel(provider: ProductLookupCandidate["provider"]) {
  switch (provider) {
    case "AMAZON_ENRICHMENT":
      return "Amazon enriched";
    case "INTERNAL_CATALOG":
      return "Mollie catalog";
    default:
      return "Simulated";
  }
}

function primarySourceMarketForCandidate(candidate: ProductLookupCandidate | null) {
  if (!candidate) {
    return "OTHER" as const;
  }

  return candidate.provider === "AMAZON_ENRICHMENT" ? "AMAZON" : "OTHER";
}

export function BarcodeImportCard({ token }: BarcodeImportCardProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [lookupPending, startLookupTransition] = useTransition();
  const [lookupResult, setLookupResult] = useState<ProductLookupResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerSupported, setScannerSupported] = useState(false);
  const [liveScannerReady, setLiveScannerReady] = useState(true);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scannerStatus, setScannerStatus] = useState("Point the barcode at the guide.");
  const [capturePending, setCapturePending] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<ProductLookupCandidate | null>(null);
  const [manualEntryEnabled, setManualEntryEnabled] = useState(false);
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("General Merchandise");
  const [condition, setCondition] = useState("Good used condition");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [costBasis, setCostBasis] = useState("0");
  const [priceRecommendation, setPriceRecommendation] = useState("");
  const [amazonPrice, setAmazonPrice] = useState("");
  const [amazonUrl, setAmazonUrl] = useState("");
  const [ebayPrice, setEbayPrice] = useState("");
  const [ebayUrl, setEbayUrl] = useState("");
  const [imageUrls, setImageUrls] = useState("");
  const [generateDrafts, setGenerateDrafts] = useState(false);

  useEffect(() => {
    const hasWindow = typeof window !== "undefined";
    setScannerSupported(hasWindow);
  }, []);

  useEffect(() => {
    if (!scannerOpen || !liveScannerReady || !videoRef.current) {
      return;
    }

    let active = true;
    let animationFrame = 0;
    let scannerControls: { stop: () => void } | null = null;
    let stream: MediaStream | null = null;

    async function beginScan() {
      try {
        setScannerError(null);
        setScannerStatus("Point the barcode at the guide.");
        setLiveScannerReady(true);
        const previewElement = videoRef.current;

        if (!previewElement) {
          return;
        }

        const BarcodeDetector = window.BarcodeDetector;

        if (BarcodeDetector) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: {
                ideal: "environment"
              }
            }
          });

          if (!active) {
            return;
          }

          previewElement.srcObject = stream;
          await previewElement.play();

          const detector = new BarcodeDetector({
            formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"]
          });

          const scanFrame = async () => {
            if (!active) {
              return;
            }

            try {
              const detected = await detector.detect(previewElement);
              const code = detected.find((candidate) => candidate.rawValue?.trim())?.rawValue?.trim();

              if (code) {
                handleBarcodeDetected(code);
                return;
              }
            } catch {
              setScannerError("Could not read the barcode yet. Hold the label flatter and closer.");
            }

            animationFrame = window.requestAnimationFrame(scanFrame);
          };

          animationFrame = window.requestAnimationFrame(scanFrame);
          return;
        }

        const [{ BrowserMultiFormatReader }, { NotFoundException, ChecksumException, FormatException }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library")
        ]);
        const reader = new BrowserMultiFormatReader();

        scannerControls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: {
                ideal: "environment"
              }
            }
          },
          previewElement,
          (result, error) => {
            if (!active) {
              return;
            }

            if (result) {
              setScannerError(null);
              handleBarcodeDetected(result.getText().trim());
              scannerControls?.stop();
              return;
            }

            if (error && !(error instanceof NotFoundException) && !(error instanceof ChecksumException) && !(error instanceof FormatException)) {
              setScannerError("Camera opened, but the barcode still could not be read. Try better light or use the photo fallback.");
            }
          }
        );
      } catch {
        setLiveScannerReady(false);
        setScannerError("We couldn't start the live camera preview here. Use the photo fallback below or type the barcode manually.");
      }
    }

    void beginScan();

    return () => {
      active = false;
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (scannerControls) {
        scannerControls.stop();
      }
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
    };
  }, [scannerOpen, liveScannerReady]);

  async function decodeCapturedBarcode(file: File) {
    const BarcodeDetector = window.BarcodeDetector;

    if (BarcodeDetector) {
      const image = await createImageBitmap(file);
      try {
        const detector = new BarcodeDetector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"]
        });
        const detected = await detector.detect(image);
        const code = detected.find((candidate) => candidate.rawValue?.trim())?.rawValue?.trim();

        if (code) {
          return code;
        }
      } finally {
        image.close();
      }
    }

    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const reader = new BrowserMultiFormatReader();
    const objectUrl = URL.createObjectURL(file);

    try {
      const result = await reader.decodeFromImageUrl(objectUrl);
      const code = result.getText().trim();

      if (code) {
        return code;
      }
    } finally {
      URL.revokeObjectURL(objectUrl);
    }

    throw new Error("We could not read a barcode from that photo. Try again with the barcode flatter and better lit.");
  }

  function runLookup(barcodeValue: string) {
    startLookupTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/product-lookup/barcode`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            barcode: barcodeValue
          })
        });
        const payload = (await response.json().catch(() => ({ error: "Could not identify this barcode." }))) as {
          error?: string;
          result?: ProductLookupResult;
        };

        if (!response.ok || !payload.result) {
          throw new Error(payload.error ?? "Could not identify this barcode.");
        }

        setLookupResult(payload.result);
        setLookupError(null);
        setSelectedCandidate(null);
        setManualEntryEnabled(payload.result.candidates.length === 0);
      } catch (caughtError) {
        setLookupResult(null);
        setSelectedCandidate(null);
        setManualEntryEnabled(true);
        setLookupError(caughtError instanceof Error ? caughtError.message : "Could not identify this barcode.");
      }
    });
  }

  function handleBarcodeDetected(detectedCode: string) {
    const normalizedCode = detectedCode.trim();

    if (!normalizedCode) {
      return;
    }

    setBarcode(normalizedCode);
    setScannerStatus(`Barcode found: ${normalizedCode}. Looking up product...`);
    setScannerError(null);
    setScannerOpen(false);
    runLookup(normalizedCode);
  }

  async function decodeBarcodeFromCanvas(canvas: HTMLCanvasElement) {
    const BarcodeDetector = window.BarcodeDetector;

    if (BarcodeDetector) {
      const detector = new BarcodeDetector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"]
      });
      const detected = await detector.detect(canvas);
      const code = detected.find((candidate) => candidate.rawValue?.trim())?.rawValue?.trim();

      if (code) {
        return code;
      }
    }

    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const reader = new BrowserMultiFormatReader();
    const result = reader.decodeFromCanvas(canvas);
    const code = result.getText().trim();

    if (code) {
      return code;
    }

    throw new Error("We could not read the barcode from that camera frame. Try again with the barcode larger in the frame.");
  }

  async function handleCaptureFrame() {
    const previewElement = videoRef.current;

    if (!previewElement || !previewElement.videoWidth || !previewElement.videoHeight) {
      setScannerError("Camera preview is not ready yet. Give it a second, then try capture again.");
      return;
    }

    setCapturePending(true);
    setScannerError(null);
    setScannerStatus("Capturing frame and checking the barcode...");

    try {
      const canvas = document.createElement("canvas");
      canvas.width = previewElement.videoWidth;
      canvas.height = previewElement.videoHeight;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Could not capture a frame from the camera.");
      }

      context.drawImage(previewElement, 0, 0, canvas.width, canvas.height);
      const detectedCode = await decodeBarcodeFromCanvas(canvas);
      handleBarcodeDetected(detectedCode);
    } catch (caughtError) {
      setScannerError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not read the barcode from that camera frame."
      );
      setScannerStatus("Point the barcode at the guide.");
    } finally {
      setCapturePending(false);
    }
  }

  async function handleCameraCapture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      setScannerError(null);
      setScannerStatus("Processing barcode photo...");
      const detectedCode = await decodeCapturedBarcode(file);
      handleBarcodeDetected(detectedCode);
    } catch (caughtError) {
      setScannerError(caughtError instanceof Error ? caughtError.message : "Could not read that barcode photo.");
      setScannerStatus("Point the barcode at the guide.");
    }
  }

  function openCamera() {
    setScannerError(null);
    setScannerStatus("Point the barcode at the guide.");
    setLiveScannerReady(true);
    setScannerOpen(true);
  }

  function resetForm() {
    setBarcode("");
    setLookupResult(null);
    setLookupError(null);
    setSubmitError(null);
    setSelectedCandidate(null);
    setManualEntryEnabled(false);
    setTitle("");
    setBrand("");
    setCategory("General Merchandise");
    setCondition("Good used condition");
    setSize("");
    setColor("");
    setCostBasis("0");
    setPriceRecommendation("");
    setAmazonPrice("");
    setAmazonUrl("");
    setEbayPrice("");
    setEbayUrl("");
    setImageUrls("");
    setGenerateDrafts(false);
  }

  function applyCandidate(candidate: ProductLookupCandidate) {
    setSelectedCandidate(candidate);
    setManualEntryEnabled(true);
    setLookupError(null);
    setTitle(candidate.title);
    setBrand(candidate.brand ?? "");
    setCategory(candidate.category ?? "General Merchandise");
    setSize(candidate.size ?? candidate.model ?? "");
    setColor(candidate.color ?? "");
    setAmazonUrl(candidate.productUrl ?? "");
    setImageUrls(candidate.imageUrls.join("\n"));
  }

  function enableManualEntry() {
    setSelectedCandidate(null);
    setManualEntryEnabled(true);
    if (!title) {
      setTitle("");
    }
  }

  function handleLookup() {
    runLookup(barcode);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        const observations = [
          amazonPrice
            ? {
                market: "AMAZON",
                label: "Amazon",
                price: Number(amazonPrice),
                sourceUrl: amazonUrl || null,
                note: "Captured during Scan to identify."
              }
            : null,
          ebayPrice
            ? {
                market: "EBAY",
                label: "eBay",
                price: Number(ebayPrice),
                sourceUrl: ebayUrl || null,
                note: "Captured during Scan to identify."
              }
            : null
        ].filter((value): value is NonNullable<typeof value> => Boolean(value));

        const normalizedImageUrls = normalizeImageUrls(imageUrls);
        const primarySourceUrl = amazonUrl || selectedCandidate?.productUrl || ebayUrl || null;
        const response = await fetch(`${API_BASE_URL}/api/inventory/import/barcode`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            identifier: barcode,
            identifierType: lookupResult?.identifierType ?? selectedCandidate?.identifierType ?? null,
            title,
            brand: brand || null,
            category,
            condition,
            size: size || null,
            color: color || null,
            costBasis: Number(costBasis || 0),
            priceRecommendation: priceRecommendation ? Number(priceRecommendation) : null,
            primarySourceMarket: primarySourceMarketForCandidate(selectedCandidate),
            primarySourceUrl,
            referenceUrls: [amazonUrl, ebayUrl, selectedCandidate?.productUrl].filter(
              (value, index, array): value is string => Boolean(value) && array.indexOf(value) === index
            ),
            imageUrls: normalizedImageUrls,
            observations,
            acceptedCandidate: selectedCandidate,
            generateDrafts,
            draftPlatforms: ["EBAY", "DEPOP", "POSHMARK", "WHATNOT"]
          })
        });
        const payload = (await response.json().catch(() => ({ error: "Could not create inventory from this match." }))) as {
          error?: string;
          item?: { id: string };
          draftsQueued?: boolean;
        };

        if (!response.ok || !payload.item?.id) {
          throw new Error(payload.error ?? "Could not create inventory from this match.");
        }

        const createdItemId = payload.item.id;
        resetForm();
        router.push(payload.draftsQueued ? `/drafts?fromScan=${createdItemId}` : `/inventory/${createdItemId}`);
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not create inventory from this match.");
      }
    });
  }

  const canSubmit = manualEntryEnabled && Boolean(barcode.trim()) && Boolean(title.trim()) && Boolean(category.trim()) && Boolean(condition.trim());
  const topHint = lookupResult?.hint ?? (lookupError
    ? {
        title: "Could not identify this barcode",
        explanation: lookupError,
        severity: "ERROR" as const,
        nextActions: [
          "Retry after checking the barcode.",
          "Continue with manual entry if you still need to create the item."
        ],
        canContinue: true
      }
    : null);
  const productUrlLinks = useMemo(
    () => lookupResult?.candidates.filter((candidate) => candidate.productUrl).slice(0, 3) ?? [],
    [lookupResult]
  );

  return (
    <>
      <Card eyebrow="Scan to identify" title="Scan a barcode, review the match, then create inventory">
        <div className="stack">
          <p className="muted">
            Scan a UPC, EAN, or ISBN, review candidate matches, and confirm the one that best matches the item in your hand.
            Mollie prefills inventory fields only after you accept the match or switch to manual entry.
          </p>

          <div className="scan-import-grid">
            <label className="label">
              Barcode
              <div className="scan-field-row">
                <input
                  className="field"
                  data-testid="scan-identify-barcode"
                  inputMode="numeric"
                  placeholder="Scan or type barcode"
                  required
                  value={barcode}
                  onChange={(event) => setBarcode(event.target.value)}
                />
                {scannerSupported ? (
                  <Button data-testid="scan-identify-open-camera" kind="secondary" onClick={openCamera} type="button">
                    <ScanBarcode size={16} /> Open camera
                  </Button>
                ) : null}
              </div>
            </label>
            <div className="label">
              Identify
              <div className="scan-field-row">
                <Button
                  data-testid="scan-identify-submit"
                  disabled={lookupPending || !barcode.trim()}
                  kind="secondary"
                  onClick={handleLookup}
                  type="button"
                >
                  <Search size={16} /> {lookupPending ? "Identifying..." : "Find product match"}
                </Button>
              </div>
            </div>
          </div>

          <OperatorHintCard hint={topHint} />
          {scannerError && !scannerOpen ? <div className="notice">{scannerError}</div> : null}

          {lookupResult ? (
            <div className="stack">
              <div className="market-observation-card">
                <div className="split">
                  <div>
                    <p className="eyebrow">Lookup summary</p>
                    <strong>{lookupResult.identifierType} scan</strong>
                  </div>
                  <div className="market-observation-value">{lookupResult.providerSummary.simulated ? "Simulated provider" : "Live provider"}</div>
                </div>
                <div className="market-observation-summary">
                  <span>{lookupResult.candidates.length} candidate{lookupResult.candidates.length === 1 ? "" : "s"} found</span>
                  <span>{lookupResult.recommendedNextAction}</span>
                </div>
                {productUrlLinks.length > 0 ? (
                  <div className="actions wrap-actions">
                    {productUrlLinks.map((candidate) => (
                      <a className="secondary-link-button" href={candidate.productUrl ?? "#"} key={candidate.id} rel="noreferrer" target="_blank">
                        <ExternalLink size={16} /> Open {providerLabel(candidate.provider)}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>

              {lookupResult.candidates.length > 0 ? (
                <div className="lookup-candidate-grid">
                  {lookupResult.candidates.map((candidate, index) => (
                    <section
                      className={`lookup-candidate-card${selectedCandidate?.id === candidate.id ? " lookup-candidate-card-selected" : ""}`}
                      data-testid={`scan-identify-candidate-${index}`}
                      key={candidate.id}
                    >
                      {candidate.primaryImageUrl ? (
                        <img alt={candidate.title} className="lookup-candidate-image" src={candidate.primaryImageUrl} />
                      ) : (
                        <div className="lookup-candidate-image lookup-candidate-image-empty">No image</div>
                      )}
                      <div className="stack" style={{ gap: "0.65rem" }}>
                        <div className="split" style={{ alignItems: "flex-start" }}>
                          <div>
                            <strong>{candidate.title}</strong>
                            <div className="muted">
                              {candidate.brand ?? "Unknown brand"} · {candidate.category ?? "Unsorted"}
                            </div>
                          </div>
                          <div className="stack" style={{ gap: "0.35rem", alignItems: "flex-end" }}>
                            <span className="execution-inline-code">{providerLabel(candidate.provider)}</span>
                            <span className={`lookup-confidence-pill lookup-confidence-${candidate.confidenceState.toLowerCase()}`}>
                              {candidate.confidenceState} {Math.round(candidate.confidenceScore * 100)}%
                            </span>
                          </div>
                        </div>

                        <OperatorHintCard hint={candidate.hint} />

                        {candidate.matchRationale.length > 0 ? (
                          <ul className="marketplace-hint-list">
                            {candidate.matchRationale.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        ) : null}

                        <div className="muted">
                          {candidate.asin ? `ASIN ${candidate.asin}` : "No ASIN available"}{candidate.model ? ` · Model ${candidate.model}` : ""}
                        </div>

                        <div className="actions wrap-actions">
                          <Button
                            data-testid={`scan-identify-accept-${index}`}
                            onClick={() => applyCandidate(candidate)}
                            type="button"
                          >
                            <CheckCircle2 size={16} /> Accept and edit
                          </Button>
                          {candidate.productUrl ? (
                            <a className="secondary-link-button" href={candidate.productUrl} rel="noreferrer" target="_blank">
                              <ExternalLink size={16} /> Review source
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}

              <div className="actions">
                <Button kind="secondary" onClick={enableManualEntry} type="button">
                  Continue with manual entry
                </Button>
              </div>
            </div>
          ) : null}

          {manualEntryEnabled ? (
            <form className="stack" onSubmit={handleSubmit}>
              {selectedCandidate ? (
                <div className="market-observation-card">
                  <div className="split">
                    <div>
                      <p className="eyebrow">Accepted match</p>
                      <strong>{selectedCandidate.title}</strong>
                    </div>
                    <div className="market-observation-value">{selectedCandidate.confidenceState}</div>
                  </div>
                  <div className="scan-import-hint">
                    <Sparkles size={16} />
                    <span>
                      Review the prefilled fields below. Mollie will not create the inventory item until you save.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="market-observation-card">
                  <div className="split">
                    <div>
                      <p className="eyebrow">Manual fallback</p>
                      <strong>Enter the item details yourself</strong>
                    </div>
                    <div className="market-observation-value">Operator controlled</div>
                  </div>
                  <div className="scan-import-hint">
                    <Sparkles size={16} />
                    <span>No candidate will be applied automatically. Use manual entry if none of the matches look reliable.</span>
                  </div>
                </div>
              )}

              <div className="scan-import-grid">
                <label className="label">
                  Title
                  <input
                    className="field"
                    data-testid="scan-identify-title"
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
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
                    <input
                      className="field"
                      data-testid="scan-identify-condition"
                      required
                      value={condition}
                      onChange={(event) => setCondition(event.target.value)}
                    />
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
                  <input className="field" min="0" step="0.01" type="number" value={priceRecommendation} onChange={(event) => setPriceRecommendation(event.target.value)} />
                </label>
                  <label className="label">
                    Amazon price
                    <input
                      className="field"
                      data-testid="scan-identify-amazon-price"
                      min="0"
                      step="0.01"
                      type="number"
                      value={amazonPrice}
                      onChange={(event) => setAmazonPrice(event.target.value)}
                    />
                  </label>
                <label className="label">
                  Amazon product URL
                  <input className="field" value={amazonUrl} onChange={(event) => setAmazonUrl(event.target.value)} />
                </label>
                  <label className="label">
                    eBay price
                    <input
                      className="field"
                      data-testid="scan-identify-ebay-price"
                      min="0"
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
                      data-testid="scan-identify-ebay-url"
                      value={ebayUrl}
                      onChange={(event) => setEbayUrl(event.target.value)}
                    />
                  </label>
              </div>

              <label className="label">
                Image URLs
                <textarea
                  className="field textarea-field"
                  data-testid="scan-identify-image-urls"
                  placeholder={"Paste one image URL per line.\nSource images are okay for the first pass and can be replaced later with operator photos."}
                  rows={4}
                  value={imageUrls}
                  onChange={(event) => setImageUrls(event.target.value)}
                />
              </label>

              <label className="checkbox-row">
                <input
                  checked={generateDrafts}
                  data-testid="scan-identify-generate-drafts"
                  onChange={(event) => setGenerateDrafts(event.target.checked)}
                  type="checkbox"
                />
                <span>Also queue marketplace drafts after creating the item</span>
              </label>

              <div className="actions">
                <Button data-testid="scan-identify-create" disabled={pending || !canSubmit} type="submit">
                  <Sparkles size={16} /> {pending ? "Saving..." : generateDrafts ? "Create item and queue drafts" : "Create item"}
                </Button>
                <Button disabled={pending} kind="secondary" onClick={resetForm} type="button">
                  Reset
                </Button>
              </div>
            </form>
          ) : null}

          {submitError ? <div className="notice">{submitError}</div> : null}
        </div>
      </Card>

      <input
        accept="image/*"
        capture="environment"
        hidden
        onChange={handleCameraCapture}
        ref={cameraInputRef}
        type="file"
      />

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
                <p className="eyebrow">Scan to identify</p>
                <h3 id="barcode-scanner-title">Scan with camera</h3>
              </div>
              <Button kind="ghost" onClick={() => setScannerOpen(false)}>
                <X size={16} /> Close
              </Button>
            </div>
            <p className="handoff-copy">
              Hold the barcode inside the frame. Mollie will search as soon as it reads a UPC, EAN, or ISBN.
            </p>
            {liveScannerReady ? (
              <div className="barcode-scanner-video-shell">
                <video autoPlay className="barcode-scanner-video" muted playsInline ref={videoRef} />
                <div className="barcode-scanner-overlay" aria-hidden="true">
                  <div className="barcode-scanner-guide" />
                </div>
              </div>
            ) : (
              <div className="barcode-scanner-video-shell barcode-scanner-video-shell-static">
                <div className="barcode-scanner-static-copy">
                  <Camera size={20} />
                  <span>This browser is using the photo-based scanner fallback. Use the button below to capture a barcode photo.</span>
                </div>
              </div>
            )}
            <div className="barcode-scanner-status">
              {lookupPending
                ? "Barcode found. Looking up product..."
                : liveScannerReady
                  ? scannerStatus
                  : "Live camera preview is unavailable here. Use the photo capture fallback below."}
            </div>
            {scannerError ? <div className="notice">{scannerError}</div> : null}
            <div className="actions">
              {liveScannerReady ? (
                <Button disabled={capturePending} onClick={handleCaptureFrame} type="button">
                  <Camera size={16} /> {capturePending ? "Capturing..." : "Capture barcode"}
                </Button>
              ) : null}
              <Button kind="secondary" onClick={() => cameraInputRef.current?.click()} type="button">
                <Camera size={16} /> Take barcode photo instead
              </Button>
            </div>
            <div className="scan-import-hint">
              <Camera size={16} />
              <span>If live scanning struggles on this device, take a barcode photo instead, or type the barcode manually.</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
