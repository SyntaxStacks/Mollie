"use client";

import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";

import type { AiStatusResponse, MarketplaceCapabilitySummary, Platform, UniversalListing } from "@reselleros/types";
import { AppShell } from "../../../components/app-shell";
import {
  InventoryDetailView,
  type InventoryItemFormState,
  type InventoryDetailRecord,
  type InventoryPreflightRecord
} from "../../../components/inventory-detail-view";
import { ProtectedView } from "../../../components/protected-view";
import { useAuth } from "../../../components/auth-provider";
import { useBrowserExtension } from "../../../components/use-browser-extension";
import { useCrossDeviceContinuity } from "../../../components/use-cross-device-continuity";
import { useAuthedResource } from "../../../lib/api";
import { handoffExtensionTask } from "../../../lib/extension-bridge";
import type { MarketplaceAccountLike, MarketplaceActionKind } from "../../../lib/item-lifecycle";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type InventoryItemResponse = {
  item: InventoryDetailRecord;
};

type EbayPreflightResponse = {
  preflight: InventoryPreflightRecord;
};

type ExtensionStatusResponse = {
  capabilitySummary: MarketplaceCapabilitySummary[];
  tasks: Array<{
    id: string;
    inventoryItemId?: string | null;
    platform: string;
    action: string;
    state: string;
  }>;
};

type MarketplaceAccountsResponse = {
  accounts: MarketplaceAccountLike[];
};

export default function InventoryDetailPage() {
  const auth = useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [extensionActionStatus, setExtensionActionStatus] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState<InventoryItemFormState>({
    title: "",
    brand: "",
    category: "",
    condition: "",
    size: "",
    color: "",
    quantity: "1",
    costBasis: "0",
    estimatedResaleMin: "",
    estimatedResaleMax: "",
    priceRecommendation: "",
    description: "",
    tags: "",
    labels: "",
    shippingWeightValue: "",
    shippingWeightUnit: "oz",
    shippingLength: "",
    shippingWidth: "",
    shippingHeight: "",
    shippingDimensionUnit: "in",
    freeShipping: false,
    ebayPrice: "",
    depopPrice: "",
    poshmarkPrice: "",
    whatnotPrice: ""
  });
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(["EBAY"]);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [aiPendingOperation, setAiPendingOperation] = useState<"title" | "description" | "price" | null>(null);
  const [handoffUrl, setHandoffUrl] = useState("");
  const [ebayDraftForm, setEbayDraftForm] = useState({
    generatedTitle: "",
    generatedPrice: "",
    ebayCategoryId: "",
    ebayStoreCategoryId: ""
  });
  const { data, error, refresh } = useAuthedResource<InventoryItemResponse>(`/api/inventory/${params.id}`, auth.token, [params.id]);
  const ebayPreflight = useAuthedResource<EbayPreflightResponse>(`/api/inventory/${params.id}/preflight/ebay`, auth.token, [params.id]);
  const extensionStatus = useAuthedResource<ExtensionStatusResponse>("/api/extension/status", auth.token);
  const marketplaceAccounts = useAuthedResource<MarketplaceAccountsResponse>("/api/marketplace-accounts", auth.token);
  const aiStatus = useAuthedResource<AiStatusResponse>("/api/ai/status", auth.token);
  const extension = useBrowserExtension();
  const ebayDraft =
    data?.item.listingDrafts.find((draft) => draft.platform === "EBAY" && draft.reviewStatus === "APPROVED") ??
    data?.item.listingDrafts.find((draft) => draft.platform === "EBAY") ??
    null;
  const ebayDraftAttributes = (ebayDraft?.attributesJson ?? {}) as Record<string, unknown>;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setHandoffUrl(new URL(`/inventory/${params.id}`, window.location.origin).toString());
  }, [params.id]);

  useEffect(() => {
    if (!ebayDraft) {
      setEbayDraftForm({
        generatedTitle: "",
        generatedPrice: "",
        ebayCategoryId: "",
        ebayStoreCategoryId: ""
      });
      return;
    }

    setEbayDraftForm({
      generatedTitle: ebayDraft.generatedTitle ?? "",
      generatedPrice: String(ebayDraft.generatedPrice ?? ""),
      ebayCategoryId: String(ebayDraftAttributes.ebayCategoryId ?? ""),
      ebayStoreCategoryId: String(ebayDraftAttributes.ebayStoreCategoryId ?? "")
    });
  }, [
    ebayDraft?.id,
    ebayDraft?.generatedTitle,
    ebayDraft?.generatedPrice,
    ebayDraftAttributes.ebayCategoryId,
    ebayDraftAttributes.ebayStoreCategoryId
  ]);

  useEffect(() => {
    if (!data?.item) {
      return;
    }

    setItemForm({
      title: data.item.title ?? "",
      brand: data.item.brand ?? "",
      category: data.item.category ?? "",
      condition: data.item.condition ?? "",
      size: data.item.size ?? "",
      color: data.item.color ?? "",
      quantity: String(data.item.quantity ?? 1),
      costBasis: String(data.item.costBasis ?? 0),
      estimatedResaleMin: data.item.estimatedResaleMin == null ? "" : String(data.item.estimatedResaleMin),
      estimatedResaleMax: data.item.estimatedResaleMax == null ? "" : String(data.item.estimatedResaleMax),
      priceRecommendation: data.item.priceRecommendation == null ? "" : String(data.item.priceRecommendation),
      description: typeof data.item.attributesJson?.description === "string" ? data.item.attributesJson.description : "",
      tags: Array.isArray(data.item.attributesJson?.tags) ? data.item.attributesJson.tags.join(", ") : "",
      labels: Array.isArray(data.item.attributesJson?.labels) ? data.item.attributesJson.labels.join(", ") : "",
      shippingWeightValue:
        typeof data.item.attributesJson?.shippingWeightValue === "number" || typeof data.item.attributesJson?.shippingWeightValue === "string"
          ? String(data.item.attributesJson.shippingWeightValue)
          : "",
      shippingWeightUnit:
        typeof data.item.attributesJson?.shippingWeightUnit === "string" ? data.item.attributesJson.shippingWeightUnit : "oz",
      shippingLength:
        typeof data.item.attributesJson?.shippingLength === "number" || typeof data.item.attributesJson?.shippingLength === "string"
          ? String(data.item.attributesJson.shippingLength)
          : "",
      shippingWidth:
        typeof data.item.attributesJson?.shippingWidth === "number" || typeof data.item.attributesJson?.shippingWidth === "string"
          ? String(data.item.attributesJson.shippingWidth)
          : "",
      shippingHeight:
        typeof data.item.attributesJson?.shippingHeight === "number" || typeof data.item.attributesJson?.shippingHeight === "string"
          ? String(data.item.attributesJson.shippingHeight)
          : "",
      shippingDimensionUnit:
        typeof data.item.attributesJson?.shippingDimensionUnit === "string" ? data.item.attributesJson.shippingDimensionUnit : "in",
      freeShipping: data.item.attributesJson?.freeShipping === true,
      ebayPrice:
        typeof data.item.attributesJson?.marketplacePriceOverrides === "object" &&
        data.item.attributesJson?.marketplacePriceOverrides &&
        typeof (data.item.attributesJson.marketplacePriceOverrides as Record<string, unknown>).EBAY === "number"
          ? String((data.item.attributesJson.marketplacePriceOverrides as Record<string, number>).EBAY)
          : "",
      depopPrice:
        typeof data.item.attributesJson?.marketplacePriceOverrides === "object" &&
        data.item.attributesJson?.marketplacePriceOverrides &&
        typeof (data.item.attributesJson.marketplacePriceOverrides as Record<string, unknown>).DEPOP === "number"
          ? String((data.item.attributesJson.marketplacePriceOverrides as Record<string, number>).DEPOP)
          : "",
      poshmarkPrice:
        typeof data.item.attributesJson?.marketplacePriceOverrides === "object" &&
        data.item.attributesJson?.marketplacePriceOverrides &&
        typeof (data.item.attributesJson.marketplacePriceOverrides as Record<string, unknown>).POSHMARK === "number"
          ? String((data.item.attributesJson.marketplacePriceOverrides as Record<string, number>).POSHMARK)
          : "",
      whatnotPrice:
        typeof data.item.attributesJson?.marketplacePriceOverrides === "object" &&
        data.item.attributesJson?.marketplacePriceOverrides &&
        typeof (data.item.attributesJson.marketplacePriceOverrides as Record<string, unknown>).WHATNOT === "number"
          ? String((data.item.attributesJson.marketplacePriceOverrides as Record<string, number>).WHATNOT)
          : ""
    });
  }, [data?.item]);

  useEffect(() => {
    const connectedPlatforms = (marketplaceAccounts.data?.accounts ?? [])
      .filter((account) => account.status === "CONNECTED")
      .map((account) => account.platform as Platform);

    if (connectedPlatforms.length > 0) {
      setSelectedPlatforms((current) => (current.length > 0 ? current.filter((platform) => connectedPlatforms.includes(platform)) : connectedPlatforms));
      return;
    }

    setSelectedPlatforms((current) => (current.length > 0 ? current : ["EBAY"]));
  }, [marketplaceAccounts.data?.accounts]);

  const continuityFingerprint = useMemo(() => {
    if (!data?.item) {
      return null;
    }

    return JSON.stringify({
      images: data.item.images.map((image) => ({
        id: image.id,
        url: image.url,
        position: image.position
      })),
      drafts: data.item.listingDrafts.map((draft) => ({
        id: draft.id,
        reviewStatus: draft.reviewStatus,
        generatedTitle: draft.generatedTitle,
        generatedPrice: draft.generatedPrice,
        attributesJson: draft.attributesJson
      })),
      listings: data.item.platformListings.map((listing) => ({
        id: listing.id,
        status: listing.status,
        externalUrl: listing.externalUrl
      })),
      preflight: ebayPreflight.data?.preflight ?? null
    });
  }, [data?.item, ebayPreflight.data?.preflight]);

  const continuity = useCrossDeviceContinuity({
    enabled: Boolean(auth.token && params.id),
    fingerprint: continuityFingerprint,
    refresh: async () => {
      await Promise.all([refresh(), ebayPreflight.refresh()]);
    }
  });

  async function addImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/inventory/${params.id}/images/upload`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token}`
          },
          body: formData
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not upload image");
        }

        form.reset();
        setSubmitError(null);
        setUploadStatus("Image uploaded");
        await Promise.all([refresh(), ebayPreflight.refresh()]);
      } catch (caughtError) {
        setUploadStatus(null);
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not upload image");
      }
    });
  }

  async function deleteImage(imageId: string) {
    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/inventory/${params.id}/images/${imageId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${auth.token}`
          }
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not delete image");
        }

        setSubmitError(null);
        setUploadStatus("Image deleted");
        await Promise.all([refresh(), ebayPreflight.refresh()]);
      } catch (caughtError) {
        setUploadStatus(null);
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not delete image");
      }
    });
  }

  async function reorderImages(imageIds: string[], successMessage: string) {
    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/inventory/${params.id}/images/reorder`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({ imageIds })
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not reorder images");
        }

        setSubmitError(null);
        setUploadStatus(successMessage);
        await Promise.all([refresh(), ebayPreflight.refresh()]);
      } catch (caughtError) {
        setUploadStatus(null);
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not reorder images");
      }
    });
  }

  function moveImage(imageId: string, direction: -1 | 1) {
    const images = data?.item.images ?? [];
    const currentIndex = images.findIndex((image) => image.id === imageId);
    const nextIndex = currentIndex + direction;

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= images.length) {
      return;
    }

    const nextOrder = [...images];
    const [image] = nextOrder.splice(currentIndex, 1);

    if (!image) {
      return;
    }

    nextOrder.splice(nextIndex, 0, image);

    void reorderImages(
      nextOrder.map((candidate) => candidate.id),
      direction < 0 ? "Image moved up" : "Image moved down"
    );
  }

  async function saveEbayDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!ebayDraft) {
      setSubmitError("Generate an eBay draft before saving eBay listing fields.");
      return;
    }

    startTransition(async () => {
      try {
        const attributes = { ...ebayDraftAttributes };
        const trimmedCategoryId = ebayDraftForm.ebayCategoryId.trim();
        const trimmedStoreCategoryId = ebayDraftForm.ebayStoreCategoryId.trim();

        if (trimmedCategoryId) {
          attributes.ebayCategoryId = trimmedCategoryId;
        } else {
          delete attributes.ebayCategoryId;
        }

        if (trimmedStoreCategoryId) {
          attributes.ebayStoreCategoryId = trimmedStoreCategoryId;
        } else {
          delete attributes.ebayStoreCategoryId;
        }

        const generatedPrice = Number(ebayDraftForm.generatedPrice);

        if (!Number.isFinite(generatedPrice) || generatedPrice < 0) {
          throw new Error("Enter a valid eBay price.");
        }

        const response = await fetch(`${API_BASE_URL}/api/drafts/${ebayDraft.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            generatedTitle: ebayDraftForm.generatedTitle.trim(),
            generatedPrice,
            attributes
          })
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not save eBay draft");
        }

        setSubmitError(null);
        await Promise.all([refresh(), ebayPreflight.refresh()]);
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not save eBay draft");
      }
    });
  }

  async function runMutation(path: string, body?: unknown) {
    startTransition(async () => {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: body ? JSON.stringify(body) : undefined
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setSubmitError(payload.error ?? "Action failed");
        return;
      }

      setSubmitError(null);
      await Promise.all([refresh(), ebayPreflight.refresh()]);
    });
  }

  function buildUniversalListing(): UniversalListing | null {
    if (!data?.item) {
      return null;
    }

    const normalizeCsv = (value: string) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    const attributes = data.item.attributesJson ?? {};
    const marketplaceOverrides: UniversalListing["marketplaceOverrides"] = {};
    const priceOverrides = {
      EBAY: itemForm.ebayPrice.trim() ? Number(itemForm.ebayPrice) : undefined,
      DEPOP: itemForm.depopPrice.trim() ? Number(itemForm.depopPrice) : undefined,
      POSHMARK: itemForm.poshmarkPrice.trim() ? Number(itemForm.poshmarkPrice) : undefined,
      WHATNOT: itemForm.whatnotPrice.trim() ? Number(itemForm.whatnotPrice) : undefined
    };

    (Object.entries(priceOverrides) as Array<[Platform, number | undefined]>).forEach(([platform, value]) => {
      if (typeof value === "number" && Number.isFinite(value)) {
        marketplaceOverrides[platform] = {
          price: value,
          attributes: {}
        };
      }
    });

    return {
      inventoryItemId: data.item.id,
      sku: data.item.sku,
      title: itemForm.title.trim(),
      description: itemForm.description.trim(),
      category: itemForm.category.trim(),
      brand: itemForm.brand.trim() || null,
      condition: itemForm.condition.trim(),
      price: itemForm.priceRecommendation.trim() ? Number(itemForm.priceRecommendation) : null,
      quantity: Math.max(1, Number(itemForm.quantity || 1)),
      size: itemForm.size.trim() || null,
      color: itemForm.color.trim() || null,
      tags: normalizeCsv(itemForm.tags),
      labels: normalizeCsv(itemForm.labels),
      freeShipping: itemForm.freeShipping,
      dimensions:
        itemForm.shippingLength.trim() || itemForm.shippingWidth.trim() || itemForm.shippingHeight.trim()
          ? {
              length: itemForm.shippingLength.trim() ? Number(itemForm.shippingLength) : null,
              width: itemForm.shippingWidth.trim() ? Number(itemForm.shippingWidth) : null,
              height: itemForm.shippingHeight.trim() ? Number(itemForm.shippingHeight) : null,
              unit: itemForm.shippingDimensionUnit as "in" | "cm"
            }
          : null,
      weight: itemForm.shippingWeightValue.trim()
        ? {
            value: Number(itemForm.shippingWeightValue),
            unit: itemForm.shippingWeightUnit as "oz" | "lb" | "g" | "kg"
          }
        : null,
      photos: data.item.images.map((image, index) => ({
        url: image.url,
        kind: index === 0 ? ("PRIMARY" as const) : ("GALLERY" as const),
        alt: itemForm.title.trim()
      })),
      marketplaceOverrides,
      metadata: {
        ...attributes,
        selectedPlatforms,
        sourceAttributes: attributes.sourceAttributes ?? null
      }
    };
  }

  async function runAiAssist(operation: "title" | "description" | "price") {
    const listing = buildUniversalListing();

    if (!listing) {
      return;
    }

    setAiPendingOperation(operation);
    setAiMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/listing-assist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify({
          operation,
          platform: selectedPlatforms[0] ?? "EBAY",
          item: listing
        })
      });
      const payload = (await response.json()) as { error?: string; suggestion?: string | number | null; message?: string | null };

      if (!response.ok) {
        throw new Error(payload.error ?? "AI suggestion failed");
      }

      if (operation === "title" && typeof payload.suggestion === "string") {
        const suggestion = payload.suggestion;
        setItemForm((current) => ({ ...current, title: suggestion }));
      } else if (operation === "description" && typeof payload.suggestion === "string") {
        const suggestion = payload.suggestion;
        setItemForm((current) => ({ ...current, description: suggestion }));
      } else if (operation === "price" && typeof payload.suggestion === "number") {
        const suggestion = payload.suggestion;
        setItemForm((current) => ({ ...current, priceRecommendation: String(suggestion) }));
      }

      setAiMessage(payload.message ?? "AI suggestion applied.");
      await aiStatus.refresh();
    } catch (caughtError) {
      setAiMessage(caughtError instanceof Error ? caughtError.message : "AI suggestion failed");
    } finally {
      setAiPendingOperation(null);
    }
  }

  async function sendToExtension() {
    if (!auth.token || !auth.workspace) {
      return;
    }

    const workspaceId = auth.workspace.id;

    if (!extension.connected) {
      setExtensionActionStatus("Refresh the browser extension connection first.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/extension/tasks/handoff`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
            "x-workspace-id": workspaceId
          },
          body: JSON.stringify({
            inventoryItemId: params.id,
            platform: "EBAY",
            action: "PREPARE_DRAFT"
          })
        });
        const payload = (await response.json().catch(() => ({ error: "Could not create extension handoff" }))) as {
          error?: string;
          task?: { id: string; platform: string; action: string };
          listing?: Record<string, unknown>;
        };

        if (!response.ok || !payload.task || !payload.listing) {
          throw new Error(payload.error ?? "Could not create extension handoff");
        }

        const handoff = await handoffExtensionTask({
          taskId: payload.task.id,
          platform: payload.task.platform,
          action: payload.task.action,
          listing: payload.listing
        });

        if (!handoff.ok) {
          throw new Error(handoff.error ?? "Extension did not accept the task");
        }

        setExtensionActionStatus("Queued in the browser extension.");
        await Promise.all([refresh(), extensionStatus.refresh()]);
      } catch (caughtError) {
        setExtensionActionStatus(caughtError instanceof Error ? caughtError.message : "Could not send item to extension");
      }
    });
  }

  function handleMarketplaceAction(platform: string, action: MarketplaceActionKind) {
    if (action === "open_listing") {
      const listing = data?.item.platformListings.find((entry) => entry.platform === platform);

      if (listing?.externalUrl) {
        window.open(listing.externalUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }

    if (action === "review_sale" || action === "watch") {
      return;
    }

    if (action === "connect_account") {
      router.push("/marketplaces");
      return;
    }

    if (action === "check_again") {
      void Promise.all([refresh(), ebayPreflight.refresh(), extensionStatus.refresh(), marketplaceAccounts.refresh()]);
      return;
    }

    if (action === "check_extension") {
      void Promise.all([extension.refresh(), extensionStatus.refresh(), marketplaceAccounts.refresh(), refresh(), ebayPreflight.refresh()]);
      return;
    }

    if (action === "open_extension") {
      void sendToExtension();
      return;
    }

    if (action === "fix_details") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (action === "publish_api" || action === "retry") {
      if (platform === "EBAY") {
        void runMutation(`/api/inventory/${data?.item.id}/publish/ebay`);
      } else if (platform === "DEPOP") {
        void runMutation(`/api/inventory/${data?.item.id}/publish/depop`);
      } else if (platform === "POSHMARK") {
        void runMutation(`/api/inventory/${data?.item.id}/publish/poshmark`);
      } else if (platform === "WHATNOT") {
        void runMutation(`/api/inventory/${data?.item.id}/publish/whatnot`);
      }
      return;
    }

    if (action === "generate_draft") {
      void runMutation(`/api/inventory/${data?.item.id}/generate-drafts`, {
        platforms: [platform]
      });
    }
  }

  function handleMarketplaceSecondaryAction(platform: string, action: MarketplaceActionKind) {
    if (action === "connect_account") {
      router.push("/marketplaces");
      return;
    }

    if (action === "check_extension") {
      void extension.refresh();
      void extensionStatus.refresh();
      return;
    }

    if (action === "open_extension") {
      void sendToExtension();
      return;
    }

    handleMarketplaceAction(platform, action);
  }

  async function saveItemDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/inventory/${params.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
      title: itemForm.title.trim(),
      brand: itemForm.brand.trim() || null,
      category: itemForm.category.trim(),
      condition: itemForm.condition.trim(),
            size: itemForm.size.trim() || null,
            color: itemForm.color.trim() || null,
            quantity: Math.max(1, Number(itemForm.quantity || 1)),
            costBasis: Number(itemForm.costBasis || 0),
            estimatedResaleMin: itemForm.estimatedResaleMin.trim() ? Number(itemForm.estimatedResaleMin) : null,
            estimatedResaleMax: itemForm.estimatedResaleMax.trim() ? Number(itemForm.estimatedResaleMax) : null,
            priceRecommendation: itemForm.priceRecommendation.trim() ? Number(itemForm.priceRecommendation) : null,
            attributes: {
              ...(data?.item.attributesJson ?? {}),
              description: itemForm.description.trim(),
              tags: itemForm.tags
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean),
              labels: itemForm.labels
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean),
              shippingWeightValue: itemForm.shippingWeightValue.trim() ? Number(itemForm.shippingWeightValue) : null,
              shippingWeightUnit: itemForm.shippingWeightUnit,
              shippingLength: itemForm.shippingLength.trim() ? Number(itemForm.shippingLength) : null,
              shippingWidth: itemForm.shippingWidth.trim() ? Number(itemForm.shippingWidth) : null,
              shippingHeight: itemForm.shippingHeight.trim() ? Number(itemForm.shippingHeight) : null,
              shippingDimensionUnit: itemForm.shippingDimensionUnit,
              freeShipping: itemForm.freeShipping,
              marketplacePriceOverrides: {
                ...(typeof data?.item.attributesJson?.marketplacePriceOverrides === "object" &&
                data?.item.attributesJson?.marketplacePriceOverrides
                  ? (data.item.attributesJson.marketplacePriceOverrides as Record<string, unknown>)
                  : {}),
                ...(itemForm.ebayPrice.trim() ? { EBAY: Number(itemForm.ebayPrice) } : {}),
                ...(itemForm.depopPrice.trim() ? { DEPOP: Number(itemForm.depopPrice) } : {}),
                ...(itemForm.poshmarkPrice.trim() ? { POSHMARK: Number(itemForm.poshmarkPrice) } : {}),
                ...(itemForm.whatnotPrice.trim() ? { WHATNOT: Number(itemForm.whatnotPrice) } : {})
              }
            }
          })
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not save item details");
        }

        setSubmitError(null);
        setUploadStatus("Item details saved");
        await Promise.all([refresh(), ebayPreflight.refresh()]);
      } catch (caughtError) {
        setUploadStatus(null);
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not save item details");
      }
    });
  }

  async function deleteItem() {
    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/inventory/${params.id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${auth.token}`
          }
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not delete this inventory item");
        }

        router.push("/inventory");
      } catch (caughtError) {
        setUploadStatus(null);
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not delete this inventory item");
      }
    });
  }

  return (
    <ProtectedView>
      <AppShell title="Inventory Detail">
        {error ? <div className="notice">{error}</div> : null}
        {!data ? (
          <div className="center-state">Loading inventory item...</div>
        ) : (
          <InventoryDetailView
            continuityNotice={continuity.continuityNotice}
            ebayDraft={ebayDraft}
            ebayDraftForm={ebayDraftForm}
            ebayPreflight={ebayPreflight.data?.preflight ?? null}
            ebayPreflightError={ebayPreflight.error}
            handoffUrl={handoffUrl}
            item={data.item}
            lastSyncedLabel={continuity.lastSyncedLabel}
            onAddImage={addImage}
            onApproveEbayDraft={() => void runMutation(`/api/drafts/${ebayDraft?.id}/approve`)}
            onDeleteImage={(imageId) => void deleteImage(imageId)}
            onDeleteItem={() => void deleteItem()}
            onEbayDraftFormChange={(field, value) =>
              setEbayDraftForm((current) => ({
                ...current,
                [field]: value
              }))
            }
            onFieldChange={(field, value) =>
              setItemForm((current) => ({
                ...current,
                [field]: value
              }))
            }
            aiMessage={aiMessage}
            aiPendingOperation={aiPendingOperation}
            aiStatus={aiStatus.data ?? null}
            onAiAssist={(operation) => void runAiAssist(operation)}
            onGenerateDrafts={(platforms) =>
              void runMutation(`/api/inventory/${data.item.id}/generate-drafts`, {
                platforms
              })
            }
            extensionCapabilities={extensionStatus.data?.capabilitySummary ?? []}
            onMoveImage={(imageId, direction) => moveImage(imageId, direction)}
            onPublishLinked={(platforms) => void runMutation(`/api/inventory/${data.item.id}/publish-linked`, { platforms })}
            onSaveEbayDraft={saveEbayDraft}
            onSaveItemDetails={saveItemDetails}
            extensionActionStatus={extensionActionStatus}
            extensionConnected={extension.connected}
            extensionInstalled={extension.installed}
            extensionLoading={extension.loading}
            extensionPendingCount={extensionStatus.data?.tasks.filter((task) => task.state === "QUEUED" || task.state === "RUNNING").length ?? 0}
            marketplaceAccounts={marketplaceAccounts.data?.accounts ?? []}
            onMarketplaceAction={handleMarketplaceAction}
            onMarketplaceSecondaryAction={handleMarketplaceSecondaryAction}
            onOpenMarketplaces={() => router.push("/marketplaces")}
            onRefreshExtension={() => {
              void extension.refresh();
              void extensionStatus.refresh();
            }}
            onSendToExtension={() => void sendToExtension()}
            itemForm={itemForm}
            selectedPlatforms={selectedPlatforms}
            onTogglePlatform={(platform, checked) =>
              setSelectedPlatforms((current) =>
                checked ? [...new Set([...current, platform])] : current.filter((entry) => entry !== platform)
              )
            }
            pending={pending}
            submitError={submitError}
            uploadStatus={uploadStatus}
          />
        )}
      </AppShell>
    </ProtectedView>
  );
}
