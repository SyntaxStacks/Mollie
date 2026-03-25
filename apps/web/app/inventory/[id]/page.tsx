"use client";

import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState, useTransition } from "react";

import { Button, Card, StatusPill } from "@reselleros/ui";

import { AppShell } from "../../../components/app-shell";
import { ProtectedView } from "../../../components/protected-view";
import { useAuth } from "../../../components/auth-provider";
import { currency, useAuthedResource } from "../../../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function InventoryDetailPage() {
  const auth = useAuth();
  const params = useParams<{ id: string }>();
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [ebayDraftForm, setEbayDraftForm] = useState({
    generatedTitle: "",
    generatedPrice: "",
    ebayCategoryId: "",
    ebayStoreCategoryId: ""
  });
  const { data, error, refresh } = useAuthedResource<{
    item: {
      id: string;
      title: string;
      sku: string;
      status: string;
      category: string;
      condition: string;
      priceRecommendation: number | null;
      estimatedResaleMin: number | null;
      estimatedResaleMax: number | null;
      images: Array<{ id: string; url: string; position: number }>;
      listingDrafts: Array<{
        id: string;
        platform: string;
        reviewStatus: string;
        generatedTitle: string;
        generatedPrice: number;
        attributesJson: Record<string, unknown> | null;
      }>;
      platformListings: Array<{ id: string; platform: string; status: string; externalUrl: string | null }>;
      sales: Array<{ id: string; soldPrice: number; soldAt: string }>;
    };
  }>(`/api/inventory/${params.id}`, auth.token, [params.id]);
  const ebayPreflight = useAuthedResource<{
    preflight: {
      state: string | null;
      mode: "live" | "simulated";
      ready: boolean;
      summary: string;
      selectedCredentialType: string | null;
      checks: Array<{
        key: string;
        label: string;
        status: string;
        detail: string;
      }>;
    };
  }>(`/api/inventory/${params.id}/preflight/ebay`, auth.token, [params.id]);
  const ebayDraft =
    data?.item.listingDrafts.find((draft) => draft.platform === "EBAY" && draft.reviewStatus === "APPROVED") ??
    data?.item.listingDrafts.find((draft) => draft.platform === "EBAY") ??
    null;
  const ebayDraftAttributes = (ebayDraft?.attributesJson ?? {}) as Record<string, unknown>;

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
        {ebayPreflight.error ? <div className="notice">{ebayPreflight.error}</div> : null}
        {!data ? (
          <div className="center-state">Loading inventory item...</div>
        ) : (
          <>
            <Card eyebrow={data.item.sku} title={data.item.title} action={<StatusPill status={data.item.status} />}>
              <div className="grid-4">
                <div className="metric">
                  <span className="muted">Recommended price</span>
                  <strong>{currency(data.item.priceRecommendation)}</strong>
                </div>
                <div className="metric">
                  <span className="muted">Resale range</span>
                  <strong>
                    {currency(data.item.estimatedResaleMin)}-{currency(data.item.estimatedResaleMax)}
                  </strong>
                </div>
                <div className="metric">
                  <span className="muted">Category</span>
                  <strong>{data.item.category}</strong>
                </div>
                <div className="metric">
                  <span className="muted">Condition</span>
                  <strong>{data.item.condition}</strong>
                </div>
              </div>
              <div className="actions">
                <Button
                  disabled={pending}
                  onClick={() =>
                    void runMutation(`/api/inventory/${data.item.id}/generate-drafts`, {
                      platforms: ["EBAY", "DEPOP"]
                    })
                  }
                >
                  Generate drafts
                </Button>
                <Button disabled={pending} kind="secondary" onClick={() => void runMutation(`/api/inventory/${data.item.id}/publish/ebay`)}>
                  Publish eBay
                </Button>
                <Button disabled={pending} kind="secondary" onClick={() => void runMutation(`/api/inventory/${data.item.id}/publish/depop`)}>
                  Publish Depop
                </Button>
              </div>
            </Card>

            <div className="grid-2">
              <Card eyebrow="Images" title="Image gallery">
                <form className="stack" onSubmit={addImage}>
                  <label className="label">
                    Upload image
                    <input accept="image/png,image/jpeg,image/webp,image/gif" className="field" name="image" required type="file" />
                  </label>
                  <label className="label">
                    Position
                    <input className="field" min="0" name="position" type="number" defaultValue="0" />
                  </label>
                  <Button type="submit" disabled={pending}>
                    {pending ? "Uploading..." : "Upload image"}
                  </Button>
                </form>
                {uploadStatus ? <div className="notice execution-notice-success" style={{ marginTop: "1rem" }}>{uploadStatus}</div> : null}
                <div className="stack" style={{ marginTop: "1rem" }}>
                  {data.item.images.length === 0 ? <div className="muted">No images uploaded yet.</div> : null}
                  {data.item.images.map((image, index) => (
                    <div className="image-upload-row" data-image-id={image.id} key={image.id}>
                      <img alt={`${data.item.title} image`} className="image-upload-preview" src={image.url} />
                      <div className="stack">
                        <strong>Image {index + 1}</strong>
                        <span className="muted">{image.url}</span>
                        <div className="actions">
                          <Button
                            disabled={pending || index === 0}
                            kind="secondary"
                            onClick={() => moveImage(image.id, -1)}
                            type="button"
                          >
                            Move up
                          </Button>
                          <Button
                            disabled={pending || index === data.item.images.length - 1}
                            kind="secondary"
                            onClick={() => moveImage(image.id, 1)}
                            type="button"
                          >
                            Move down
                          </Button>
                          <Button disabled={pending} kind="secondary" onClick={() => void deleteImage(image.id)} type="button">
                            Delete image
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card eyebrow="Drafts and listings" title="Review readiness">
                {submitError ? <div className="notice">{submitError}</div> : null}
                <div className="stack">
                  {data.item.listingDrafts.map((draft) => (
                    <div className="split" key={draft.id}>
                      <span>{draft.platform} draft</span>
                      <StatusPill status={draft.reviewStatus} />
                    </div>
                  ))}
                  {data.item.platformListings.map((listing) => (
                    <div className="split" key={listing.id}>
                      <span>{listing.platform} listing</span>
                      <StatusPill status={listing.status} />
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card eyebrow="eBay draft" title="Live listing fields">
              {!ebayDraft ? (
                <div className="muted">Generate an eBay draft first, then map the live listing category here.</div>
              ) : (
                <form className="stack" onSubmit={saveEbayDraft}>
                  <label className="label">
                    eBay title
                    <input
                      className="field"
                      name="generatedTitle"
                      required
                      value={ebayDraftForm.generatedTitle}
                      onChange={(event) =>
                        setEbayDraftForm((current) => ({ ...current, generatedTitle: event.target.value }))
                      }
                    />
                  </label>
                  <label className="label">
                    eBay price
                    <input
                      className="field"
                      min="0"
                      name="generatedPrice"
                      required
                      step="0.01"
                      type="number"
                      value={ebayDraftForm.generatedPrice}
                      onChange={(event) =>
                        setEbayDraftForm((current) => ({ ...current, generatedPrice: event.target.value }))
                      }
                    />
                  </label>
                  <label className="label">
                    eBay category ID
                    <input
                      className="field"
                      name="ebayCategoryId"
                      placeholder="15724"
                      value={ebayDraftForm.ebayCategoryId}
                      onChange={(event) =>
                        setEbayDraftForm((current) => ({ ...current, ebayCategoryId: event.target.value }))
                      }
                    />
                  </label>
                  <label className="label">
                    eBay store category ID
                    <input
                      className="field"
                      name="ebayStoreCategoryId"
                      placeholder="Optional"
                      value={ebayDraftForm.ebayStoreCategoryId}
                      onChange={(event) =>
                        setEbayDraftForm((current) => ({ ...current, ebayStoreCategoryId: event.target.value }))
                      }
                    />
                  </label>
                  <div className="muted">
                    Save the category mapping here before live eBay publish. The preflight card below updates after each save.
                  </div>
                  <div className="actions">
                    <Button disabled={pending} type="submit">
                      Save eBay draft
                    </Button>
                    {ebayDraft.reviewStatus !== "APPROVED" ? (
                      <Button
                        disabled={pending}
                        kind="secondary"
                        onClick={() => void runMutation(`/api/drafts/${ebayDraft.id}/approve`)}
                        type="button"
                      >
                        Approve eBay draft
                      </Button>
                    ) : null}
                  </div>
                </form>
              )}
            </Card>

            <Card
              eyebrow={ebayPreflight.data?.preflight.state ?? (ebayPreflight.data?.preflight.mode === "live" ? "Live eBay" : "Simulated eBay")}
              title="eBay publish preflight"
              action={
                ebayPreflight.data?.preflight ? (
                  <StatusPill status={ebayPreflight.data.preflight.state ?? (ebayPreflight.data.preflight.ready ? "READY" : "BLOCKED")} />
                ) : null
              }
            >
              {!ebayPreflight.data ? (
                <div className="muted">Checking eBay readiness...</div>
              ) : (
                <div className="stack">
                  <div className="notice">{ebayPreflight.data.preflight.summary}</div>
                  <div className="muted">
                    eBay state: {ebayPreflight.data.preflight.state ?? "none"} | Account mode:{" "}
                    {ebayPreflight.data.preflight.selectedCredentialType ?? "none"} | Publish mode: {ebayPreflight.data.preflight.mode}
                  </div>
                  {ebayPreflight.data.preflight.checks.map((check) => (
                    <div className="split" key={check.key}>
                      <div>
                        <strong>{check.label}</strong>
                        <div className="muted">{check.detail}</div>
                      </div>
                      <StatusPill status={check.status} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </AppShell>
    </ProtectedView>
  );
}
