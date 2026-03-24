"use client";

import { useParams } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

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
      images: Array<{ id: string; url: string }>;
      listingDrafts: Array<{ id: string; platform: string; reviewStatus: string }>;
      platformListings: Array<{ id: string; platform: string; status: string; externalUrl: string | null }>;
      sales: Array<{ id: string; soldPrice: number; soldAt: string }>;
    };
  }>(`/api/inventory/${params.id}`, auth.token, [params.id]);

  async function addImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/inventory/${params.id}/images`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            url: formData.get("url"),
            position: Number(formData.get("position") || 0)
          })
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not add image");
        }

        event.currentTarget.reset();
        setSubmitError(null);
        await refresh();
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not add image");
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
      await refresh();
    });
  }

  return (
    <ProtectedView>
      <AppShell title="Inventory Detail">
        {error ? <div className="notice">{error}</div> : null}
        {!data ? (
          <div className="center-state">Loading inventory item…</div>
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
                    Image URL
                    <input className="field" name="url" placeholder="https://..." required />
                  </label>
                  <label className="label">
                    Position
                    <input className="field" min="0" name="position" type="number" defaultValue="0" />
                  </label>
                  <Button type="submit" disabled={pending}>
                    Add image
                  </Button>
                </form>
                <div className="stack" style={{ marginTop: "1rem" }}>
                  {data.item.images.map((image) => (
                    <span className="muted" key={image.id}>
                      {image.url}
                    </span>
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
          </>
        )}
      </AppShell>
    </ProtectedView>
  );
}
