"use client";

import { Camera, Link2, ScanBarcode, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { Button, Card } from "@reselleros/ui";

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

export function BarcodeImportCard({ token }: BarcodeImportCardProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerSupported, setScannerSupported] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [barcode, setBarcode] = useState("");
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("Media");
  const [condition, setCondition] = useState("Good used condition");
  const [costBasis, setCostBasis] = useState("0");
  const [observedPrice, setObservedPrice] = useState("");
  const [resaleMin, setResaleMin] = useState("");
  const [resaleMax, setResaleMax] = useState("");
  const [priceRecommendation, setPriceRecommendation] = useState("");
  const [amazonUrl, setAmazonUrl] = useState("");
  const [amazonAsin, setAmazonAsin] = useState("");
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
          setScannerError("Camera scanning is not supported on this browser. Type or paste the barcode instead.");
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
              setBarcode(code);
              setScannerOpen(false);
              return;
            }
          } catch {
            setScannerError("Could not read a barcode from the camera yet. Hold the barcode flatter and closer.");
          }

          animationFrame = window.requestAnimationFrame(scanFrame);
        };

        animationFrame = window.requestAnimationFrame(scanFrame);
      } catch {
        setScannerError("Camera access was denied. You can still type the barcode or use a hardware scanner.");
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
    setBarcode("");
    setTitle("");
    setBrand("");
    setCategory("Media");
    setCondition("Good used condition");
    setCostBasis("0");
    setObservedPrice("");
    setResaleMin("");
    setResaleMax("");
    setPriceRecommendation("");
    setAmazonUrl("");
    setAmazonAsin("");
    setImageUrls("");
    setSubmitError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        const numericObservedPrice = Number(observedPrice);

        if (!Number.isFinite(numericObservedPrice) || numericObservedPrice < 0) {
          throw new Error("Enter the Amazon price you observed for this item.");
        }

        const response = await fetch(`${API_BASE_URL}/api/inventory/import/barcode`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            barcode,
            sourceMarket: "AMAZON",
            title,
            brand: brand || null,
            category,
            condition,
            costBasis: Number(costBasis || 0),
            estimatedResaleMin: resaleMin ? Number(resaleMin) : numericObservedPrice,
            estimatedResaleMax: resaleMax ? Number(resaleMax) : numericObservedPrice,
            priceRecommendation: priceRecommendation ? Number(priceRecommendation) : numericObservedPrice,
            amazonUrl: amazonUrl || null,
            amazonAsin: amazonAsin || null,
            imageUrls: normalizeImageUrls(imageUrls),
            observations: [
              {
                market: "AMAZON",
                label: "Amazon",
                price: numericObservedPrice,
                sourceUrl: amazonUrl || null,
                note: "Captured by operator from Amazon while importing from a barcode scan."
              }
            ]
          })
        });
        const payload = (await response.json().catch(() => ({ error: "Could not create item from barcode import" }))) as {
          error?: string;
          item?: { id: string };
        };

        if (!response.ok || !payload.item?.id) {
          throw new Error(payload.error ?? "Could not create item from barcode import");
        }

        resetForm();
        router.push(`/inventory/${payload.item.id}`);
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not create item from barcode import");
      }
    });
  }

  const normalizedImageUrls = normalizeImageUrls(imageUrls);
  const observedPriceNumber = Number(observedPrice);

  return (
    <>
      <Card eyebrow="Barcode import" title="Scan, compare, and create from Amazon">
        <div className="stack">
          <p className="muted">
            Scan the barcode, capture the Amazon price you see, and create an inventory item with the Amazon image URLs
            attached. This first slice is Amazon-first and keeps the import shape ready for more markets later.
          </p>
          <form className="stack" onSubmit={handleSubmit}>
            <div className="scan-import-grid">
              <label className="label">
                Barcode
                <div className="scan-field-row">
                  <input
                    className="field"
                    data-testid="barcode-import-barcode"
                    inputMode="numeric"
                    name="barcode"
                    placeholder="Scan or type UPC / EAN"
                    required
                    value={barcode}
                    onChange={(event) => setBarcode(event.target.value)}
                  />
                  {scannerSupported ? (
                    <Button kind="secondary" onClick={() => setScannerOpen(true)} type="button">
                      <ScanBarcode size={16} /> Scan
                    </Button>
                  ) : null}
                </div>
              </label>
              <label className="label">
                Title
                <input
                  className="field"
                  data-testid="barcode-import-title"
                  name="title"
                  placeholder="Imported item title"
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="label">
                Brand
                <input className="field" name="brand" value={brand} onChange={(event) => setBrand(event.target.value)} />
              </label>
              <label className="label">
                Category
                <input className="field" name="category" required value={category} onChange={(event) => setCategory(event.target.value)} />
              </label>
              <label className="label">
                Condition
                <input
                  className="field"
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

            <div className="market-observation-card" data-testid="amazon-observation-card">
              <div className="split">
                <div>
                  <p className="eyebrow">Observed market</p>
                  <strong>Amazon</strong>
                </div>
                <div className="market-observation-value">
                  {Number.isFinite(observedPriceNumber) && observedPriceNumber >= 0 ? `$${observedPriceNumber.toFixed(2)}` : "Add price"}
                </div>
              </div>
              <div className="scan-import-grid">
                <label className="label">
                  Amazon observed price
                  <input
                    className="field"
                    data-testid="barcode-import-amazon-price"
                    min="0"
                    name="observedPrice"
                    required
                    step="0.01"
                    type="number"
                    value={observedPrice}
                    onChange={(event) => setObservedPrice(event.target.value)}
                  />
                </label>
                <label className="label">
                  Amazon product URL
                  <input
                    className="field"
                    name="amazonUrl"
                    placeholder="https://www.amazon.com/dp/..."
                    value={amazonUrl}
                    onChange={(event) => setAmazonUrl(event.target.value)}
                  />
                </label>
                <label className="label">
                  Amazon ASIN
                  <input
                    className="field"
                    name="amazonAsin"
                    placeholder="Optional if the URL already contains it"
                    value={amazonAsin}
                    onChange={(event) => setAmazonAsin(event.target.value)}
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
                Amazon image URLs
                <textarea
                  className="field textarea-field"
                  data-testid="barcode-import-image-urls"
                  name="imageUrls"
                  placeholder={"Paste one Amazon image URL per line.\nThese URLs will be attached to the new inventory item as imported images."}
                  rows={4}
                  value={imageUrls}
                  onChange={(event) => setImageUrls(event.target.value)}
                />
              </label>
              <div className="scan-import-hint">
                <Link2 size={16} />
                <span>
                  Imported image URLs are attached to the created item immediately. For now, Amazon product details are captured
                  from operator input instead of automated public scraping.
                </span>
              </div>
              <div className="market-observation-summary">
                <span>{normalizedImageUrls.length} image URL{normalizedImageUrls.length === 1 ? "" : "s"} ready to attach</span>
                <span>{amazonUrl ? "Amazon link included" : "Amazon link optional"}</span>
              </div>
            </div>

            <div className="actions">
              <Button data-testid="barcode-import-submit" disabled={pending} type="submit">
                <Sparkles size={16} /> {pending ? "Creating from scan..." : "Create item from scan"}
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
                <p className="eyebrow">Barcode scan</p>
                <h3 id="barcode-scanner-title">Scan with camera</h3>
              </div>
              <Button kind="ghost" onClick={() => setScannerOpen(false)}>
                <X size={16} /> Close
              </Button>
            </div>
            <p className="handoff-copy">
              Hold the item barcode inside the frame. Mollie will fill the barcode field as soon as it detects a code.
            </p>
            <div className="barcode-scanner-video-shell">
              <video autoPlay className="barcode-scanner-video" muted playsInline ref={videoRef} />
            </div>
            {scannerError ? <div className="notice">{scannerError}</div> : null}
            <div className="scan-import-hint">
              <Camera size={16} />
              <span>If camera scanning is unavailable here, you can still type the barcode or use a hardware scanner.</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
