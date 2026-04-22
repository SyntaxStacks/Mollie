"use client";

import { useState, useTransition } from "react";

import { Button, Card, StatusPill } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { ProtectedView } from "../../components/protected-view";
import { useAuth } from "../../components/auth-provider";
import { currency, useAuthedResource } from "../../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function DraftsPage() {
  const auth = useAuth();
  const inventory = useAuthedResource<{
    items: Array<{
      id: string;
      title: string;
      listingDrafts: Array<{
        id: string;
        platform: string;
        generatedTitle: string;
        generatedPrice: number;
        reviewStatus: string;
      }>;
    }>;
  }>("/api/inventory", auth.token);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function approve(draftId: string) {
    startTransition(async () => {
      const response = await fetch(`${API_BASE_URL}/api/drafts/${draftId}/approve`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`
        }
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? "Could not approve draft");
        return;
      }

      setError(null);
      await inventory.refresh();
    });
  }

  return (
    <ProtectedView>
      <AppShell title="Drafts">
        {error ? <div className="notice">{error}</div> : null}
        <Card eyebrow="Drafts" title="Generated listings waiting for approval">
          <div className="stack">
            {(inventory.data?.items ?? []).flatMap((item) =>
              item.listingDrafts.map((draft) => (
                <div className="rs-card" key={draft.id}>
                  <div className="split">
                    <div>
                      <strong>{draft.generatedTitle}</strong>
                      <div className="muted">
                        {item.title} · {draft.platform} · {currency(draft.generatedPrice)}
                      </div>
                    </div>
                    <StatusPill status={draft.reviewStatus} />
                  </div>
                  <div className="actions" style={{ marginTop: "1rem" }}>
                    <Button disabled={pending || draft.reviewStatus === "APPROVED"} onClick={() => void approve(draft.id)}>
                      Approve draft
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </AppShell>
    </ProtectedView>
  );
}
