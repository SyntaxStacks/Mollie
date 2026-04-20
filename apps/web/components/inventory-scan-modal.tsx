"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@reselleros/ui";

import { BarcodeImportCard } from "./barcode-import-card";

export function InventoryScanModal({
  token,
  open,
  onClose
}: {
  token: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  if (!open) {
    return null;
  }

  return (
    <div className="handoff-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        aria-label="Inventory scan"
        aria-modal="true"
        className="handoff-modal scan-intake-modal inventory-scan-modal-shell"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="inventory-scan-modal-header">
          <Button
            aria-label="Close scan modal"
            className="inventory-scan-modal-close"
            kind="ghost"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </Button>
        </div>

        <div className="scan-intake-modal-body inventory-scan-modal-body">
          <BarcodeImportCard autoOpenCameraOnMount presentation="scan-minimal" token={token} />
        </div>

        <div className="inventory-scan-modal-actions">
          <Button
            className="inventory-scan-modal-manual"
            kind="secondary"
            onClick={() => {
              onClose();
              router.push("/inventory/create");
            }}
            type="button"
          >
            Manual creation
          </Button>
        </div>
      </div>
    </div>
  );
}
