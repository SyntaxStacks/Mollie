"use client";

import { Camera, ScanBarcode, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@reselleros/ui";

import { BarcodeImportCard } from "./barcode-import-card";
import { VisualIdentifyCard } from "./visual-identify-card";

type ScanModalMode = "barcode" | "photo";

export function InventoryScanModal({
  token,
  open,
  initialMode = "barcode",
  onClose
}: {
  token: string;
  open: boolean;
  initialMode?: ScanModalMode;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<ScanModalMode>(initialMode);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
    }
  }, [initialMode, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="handoff-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        aria-labelledby="inventory-scan-modal-title"
        aria-modal="true"
        className="handoff-modal scan-intake-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="handoff-modal-header">
          <div>
            <p className="eyebrow">Inventory intake</p>
            <h3 id="inventory-scan-modal-title">Scan item into inventory</h3>
          </div>
          <Button kind="ghost" onClick={onClose} type="button">
            <X size={16} /> Close
          </Button>
        </div>

        <p className="handoff-copy">
          Keep scan inside inventory. Use barcode lookup when a printed code exists, or switch to computer vision when the
          item has no barcode.
        </p>

        <div className="intake-path-switch" role="tablist" aria-label="Inventory scan mode">
          <button
            aria-selected={mode === "barcode"}
            className={`intake-path-button${mode === "barcode" ? " active" : ""}`}
            onClick={() => setMode("barcode")}
            role="tab"
            type="button"
          >
            <ScanBarcode size={16} />
            <span>Identify by code</span>
          </button>
          <button
            aria-selected={mode === "photo"}
            className={`intake-path-button${mode === "photo" ? " active" : ""}`}
            onClick={() => setMode("photo")}
            role="tab"
            type="button"
          >
            <Camera size={16} />
            <span>Identify by photo</span>
          </button>
        </div>

        <div className="scan-intake-modal-body">
          {mode === "barcode" ? (
            <BarcodeImportCard autoOpenCameraOnMount presentation="scan" token={token} />
          ) : (
            <VisualIdentifyCard presentation="scan" token={token} />
          )}
        </div>
      </div>
    </div>
  );
}
