"use client";

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

export default function InventoryCreatePage() {
  const auth = useAuth();
  const inventory = useAuthedResource<{ items: ExistingInventoryItem[] }>("/api/inventory", auth.token);

  return (
    <ProtectedView>
      <AppShell title="Create">
        {inventory.error ? <div className="notice">{inventory.error}</div> : null}
        {auth.token ? <InventoryCreateWorkspace existingItems={inventory.data?.items ?? []} token={auth.token} /> : null}
      </AppShell>
    </ProtectedView>
  );
}
