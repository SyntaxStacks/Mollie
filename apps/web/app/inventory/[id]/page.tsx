"use client";

import { useParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";

import { AppShell } from "../../../components/app-shell";
import {
  InventoryDetailView,
  type InventoryDetailRecord,
  type InventoryPreflightRecord
} from "../../../components/inventory-detail-view";
import { ProtectedView } from "../../../components/protected-view";
import { useAuth } from "../../../components/auth-provider";
import { useCrossDeviceContinuity } from "../../../components/use-cross-device-continuity";
import { useAuthedResource } from "../../../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type InventoryItemResponse = {
  item: InventoryDetailRecord;
};

type EbayPreflightResponse = {
  preflight: InventoryPreflightRecord;
};

export default function InventoryDetailPage() {
  const auth = useAuth();
  const params = useParams<{ id: string }>();
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [handoffUrl, setHandoffUrl] = useState("");
  const [ebayDraftForm, setEbayDraftForm] = useState({
    generatedTitle: "",
    generatedPrice: "",
    ebayCategoryId: "",
    ebayStoreCategoryId: ""
  });
  const { data, error, refresh } = useAuthedResource<InventoryItemResponse>(`/api/inventory/${params.id}`, auth.token, [params.id]);
  const ebayPreflight = useAuthedResource<EbayPreflightResponse>(`/api/inventory/${params.id}/preflight/ebay`, auth.token, [params.id]);
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
            onEbayDraftFormChange={(field, value) =>
              setEbayDraftForm((current) => ({
                ...current,
                [field]: value
              }))
            }
            onGenerateDrafts={() =>
              void runMutation(`/api/inventory/${data.item.id}/generate-drafts`, {
                platforms: ["EBAY", "DEPOP", "POSHMARK", "WHATNOT"]
              })
            }
            onMoveImage={(imageId, direction) => moveImage(imageId, direction)}
            onPublishDepop={() => void runMutation(`/api/inventory/${data.item.id}/publish/depop`)}
            onPublishEbay={() => void runMutation(`/api/inventory/${data.item.id}/publish/ebay`)}
            onPublishPoshmark={() => void runMutation(`/api/inventory/${data.item.id}/publish/poshmark`)}
            onSaveEbayDraft={saveEbayDraft}
            onPublishWhatnot={() => void runMutation(`/api/inventory/${data.item.id}/publish/whatnot`)}
            pending={pending}
            submitError={submitError}
            uploadStatus={uploadStatus}
          />
        )}
      </AppShell>
    </ProtectedView>
  );
}
