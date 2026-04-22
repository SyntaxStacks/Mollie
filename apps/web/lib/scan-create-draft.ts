import type { ProductLookupCandidate, ProductLookupResult } from "@reselleros/types";

export type ScanCreateDecision = "ADD" | "HOLD" | "LIST_LATER" | "POST_NOW";

export type ScanCreateDraft = {
  id: string;
  createdAt: string;
  barcode: string;
  identifierType: ProductLookupResult["identifierType"] | ProductLookupCandidate["identifierType"] | null;
  entryMode: "CODE" | "MANUAL";
  intakeDecision: ScanCreateDecision;
  generateDrafts: boolean;
  lookupQuery: string;
  manualSourceUrl: string;
  title: string;
  brand: string;
  category: string;
  condition: string;
  size: string;
  color: string;
  costBasis: string;
  priceRecommendation: string;
  description: string;
  amazonPrice: string;
  amazonUrl: string;
  ebayPrice: string;
  ebayUrl: string;
  imageUrls: string[];
  candidates: ProductLookupCandidate[];
  selectedCandidateId: string | null;
};

const SCAN_CREATE_DRAFT_PREFIX = "mollie.scan-create-draft.";

function storageKey(draftId: string) {
  return `${SCAN_CREATE_DRAFT_PREFIX}${draftId}`;
}

export function createScanCreateDraftId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `scan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function writeScanCreateDraft(draft: ScanCreateDraft) {
  if (typeof window === "undefined") {
    return false;
  }

  window.sessionStorage.setItem(storageKey(draft.id), JSON.stringify(draft));
  return true;
}

export function readScanCreateDraft(draftId: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.sessionStorage.getItem(storageKey(draftId));

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as ScanCreateDraft;
  } catch {
    window.sessionStorage.removeItem(storageKey(draftId));
    return null;
  }
}

export function clearScanCreateDraft(draftId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(storageKey(draftId));
}
