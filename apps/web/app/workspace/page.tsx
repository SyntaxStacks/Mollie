"use client";

import { FormEvent, useState, useTransition } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { Button, Card } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { getWorkspaceSetupRedirect } from "../../components/auth-flow";
import { ProtectedView } from "../../components/protected-view";
import { useAuth } from "../../components/auth-provider";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function WorkspacePage() {
  const auth = useAuth();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextPath = getWorkspaceSetupRedirect(auth.hydrated, Boolean(auth.workspace));

    if (!nextPath) {
      return;
    }

    router.replace(nextPath);
  }, [auth.hydrated, auth.workspace, router]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/workspace`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            name: formData.get("name")
          })
        });
        const payload = (await response.json()) as { workspace?: { id: string; name: string }; error?: string };

        if (!response.ok || !payload.workspace) {
          throw new Error(payload.error ?? "Could not create workspace");
        }

        await auth.refreshMe();
        router.replace("/");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Could not create workspace");
      }
    });
  }

  return (
    <ProtectedView requireWorkspace={false}>
      <AppShell title="Workspace Setup">
        <div className="grid-2">
          <Card eyebrow="Status" title={auth.workspace ? auth.workspace.name : "Create your pilot workspace"}>
            {auth.workspace ? (
              <div className="stack">
                <p className="muted">Plan: {auth.workspace.plan}</p>
                <p className="muted">Billing customer: {auth.workspace.billingCustomerId ?? "provisioned on create"}</p>
              </div>
            ) : (
              <p className="muted">
                One workspace keeps the pilot flow simple. This is where inventory, lots, listings, sales, and logs are
                scoped.
              </p>
            )}
          </Card>

          <Card eyebrow="Create" title="Provision workspace and billing skeleton">
            <form className="stack" onSubmit={handleCreate}>
              <label className="label">
                Workspace name
                <input className="field" defaultValue="Pilot Reseller" name="name" required />
              </label>
              {error ? <div className="notice">{error}</div> : null}
              <Button type="submit" disabled={pending || Boolean(auth.workspace)}>
                {auth.workspace ? "Workspace ready" : pending ? "Creating…" : "Create workspace"}
              </Button>
            </form>
          </Card>
        </div>
      </AppShell>
    </ProtectedView>
  );
}
