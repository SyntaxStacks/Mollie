"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { AppShell } from "../../../components/app-shell";
import { ProtectedView } from "../../../components/protected-view";
import { useAuth } from "../../../components/auth-provider";
import { InventoryCreateWorkspace } from "../../../components/inventory-create-workspace";
import { useAuthedResource } from "../../../lib/api";

type ExistingInventoryItem = {
  id: string;
  title: string;
  sku?: string;
  attributesJson?: Record<string, unknown> | null;
};

function InventoryCreatePageContent() {
  const auth = useAuth();
  const searchParams = useSearchParams();
  const inventory = useAuthedResource<{ items: ExistingInventoryItem[] }>("/api/inventory", auth.token);
  const scanDraftId = searchParams.get("scanDraft");

  return (
    <ProtectedView>
      <AppShell title="Create">
        {inventory.error ? <div className="notice">{inventory.error}</div> : null}
        {auth.token ? (
          <InventoryCreateWorkspace existingItems={inventory.data?.items ?? []} scanDraftId={scanDraftId} token={auth.token} />
        ) : null}
      </AppShell>
    </ProtectedView>
  );
}

export default function InventoryCreatePage() {
  return (
    <Suspense fallback={null}>
      <InventoryCreatePageContent />
    </Suspense>
  );
}
