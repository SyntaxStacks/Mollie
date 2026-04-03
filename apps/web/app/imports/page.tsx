"use client";

import { FormEvent, useState, useTransition } from "react";

import type { InventoryImportCandidate } from "@reselleros/types";
import { Button, Card, StatusPill } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { ProtectedView } from "../../components/protected-view";
import { useAuth } from "../../components/auth-provider";
import { formatDate, useAuthedResource } from "../../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const importPlatforms = ["EBAY", "DEPOP", "POSHMARK", "WHATNOT", "NIFTY", "CROSSLIST"] as const;

export default function ImportsPage() {
  const auth = useAuth();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InventoryImportCandidate | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewPlatform, setPreviewPlatform] = useState<(typeof importPlatforms)[number]>("CROSSLIST");
  const [accountPlatform, setAccountPlatform] = useState<(typeof importPlatforms)[number]>("EBAY");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [csvPlatform, setCsvPlatform] = useState<(typeof importPlatforms)[number]>("CROSSLIST");
  const [generateDrafts, setGenerateDrafts] = useState(false);
  const runs = useAuthedResource<{
    runs: Array<{
      id: string;
      sourceKind: string;
      sourcePlatform: string;
      status: string;
      progressCount: number;
      appliedCount: number;
      failedCount: number;
      lastErrorMessage?: string | null;
      createdAt: string;
      marketplaceAccount?: {
        id: string;
        displayName: string;
      } | null;
      items: Array<{
        id: string;
        status: string;
        matchedInventoryItemId?: string | null;
        normalizedCandidate?: InventoryImportCandidate | null;
        lastErrorMessage?: string | null;
      }>;
    }>;
  }>("/api/imports", auth.token);
  const accounts = useAuthedResource<{
    accounts: Array<{
      id: string;
      platform: string;
      displayName: string;
      status: string;
    }>;
  }>("/api/marketplace-accounts", auth.token);

  const visibleAccounts = (accounts.data?.accounts ?? []).filter((account) => account.platform === accountPlatform);

  async function startAccountImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/imports/account`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            sourcePlatform: accountPlatform,
            marketplaceAccountId: selectedAccountId || null,
            limit: 25
          })
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not start linked-account import.");
        }

        setError(null);
        await runs.refresh();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Could not start linked-account import.");
      }
    });
  }

  async function previewUrlImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/imports/url/preview`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            sourcePlatform: previewPlatform,
            url: previewUrl
          })
        });
        const payload = (await response.json()) as { error?: string; candidate?: InventoryImportCandidate };

        if (!response.ok || !payload.candidate) {
          throw new Error(payload.error ?? "Could not preview this URL.");
        }

        setPreview(payload.candidate);
        setError(null);
      } catch (caughtError) {
        setPreview(null);
        setError(caughtError instanceof Error ? caughtError.message : "Could not preview this URL.");
      }
    });
  }

  async function applyPreview() {
    if (!preview) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/imports/url/apply`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            sourcePlatform: previewPlatform,
            url: previewUrl,
            candidate: preview,
            generateDrafts,
            draftPlatforms: generateDrafts ? ["EBAY", "DEPOP", "POSHMARK", "WHATNOT"] : []
          })
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not create inventory from this URL.");
        }

        setError(null);
        setPreview(null);
        setPreviewUrl("");
        await runs.refresh();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Could not create inventory from this URL.");
      }
    });
  }

  async function uploadCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("sourcePlatform", csvPlatform);

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/imports/csv`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token}`
          },
          body: formData
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not import CSV.");
        }

        setError(null);
        form.reset();
        await runs.refresh();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Could not import CSV.");
      }
    });
  }

  return (
    <ProtectedView>
      <AppShell title="Imports">
        {error ? <div className="notice">{error}</div> : null}

        <div className="grid-2">
          <Card eyebrow="Linked account import" title="Pull inventory from a connected account">
            <form className="form-grid" onSubmit={startAccountImport}>
              <label className="label">
                Source platform
                <select className="field" value={accountPlatform} onChange={(event) => {
                  setAccountPlatform(event.target.value as (typeof importPlatforms)[number]);
                  setSelectedAccountId("");
                }}>
                  {importPlatforms.map((platform) => (
                    <option key={platform} value={platform}>
                      {platform}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label">
                Linked account
                <select className="field" value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)}>
                  <option value="">No linked account selected</option>
                  {visibleAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.displayName} ({account.status})
                    </option>
                  ))}
                </select>
              </label>
              <div className="actions">
                <Button disabled={pending} type="submit">
                  {pending ? "Starting..." : "Start linked import"}
                </Button>
              </div>
            </form>
          </Card>

          <Card eyebrow="CSV import" title="Import an export file">
            <form className="form-grid" onSubmit={uploadCsv}>
              <label className="label">
                Export source
                <select className="field" value={csvPlatform} onChange={(event) => setCsvPlatform(event.target.value as (typeof importPlatforms)[number])}>
                  {importPlatforms.map((platform) => (
                    <option key={platform} value={platform}>
                      {platform}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label">
                CSV file
                <input accept=".csv,text/csv" className="field" name="file" required type="file" />
              </label>
              <div className="actions">
                <Button disabled={pending} type="submit">
                  {pending ? "Importing..." : "Import CSV"}
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <Card eyebrow="Public competitor URL" title="Preview and apply a listing page">
          <form className="form-grid" onSubmit={previewUrlImport}>
            <label className="label">
              Source platform
              <select className="field" value={previewPlatform} onChange={(event) => setPreviewPlatform(event.target.value as (typeof importPlatforms)[number])}>
                {importPlatforms.map((platform) => (
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Listing URL
              <input className="field" required type="url" value={previewUrl} onChange={(event) => setPreviewUrl(event.target.value)} />
            </label>
            <div className="actions">
              <Button disabled={pending} type="submit">
                {pending ? "Previewing..." : "Preview listing"}
              </Button>
            </div>
          </form>

          {preview ? (
            <div className="stack" style={{ marginTop: "1rem" }}>
              <div className="split">
                <strong>{preview.title}</strong>
                <StatusPill status="PREVIEWED" />
              </div>
              <div className="muted">
                {preview.brand ?? "Unknown brand"} · {preview.category}
              </div>
              {preview.imageUrls[0] ? <img alt={preview.title} className="image-upload-preview" src={preview.imageUrls[0]} /> : null}
              <label className="checkbox-row">
                <input checked={generateDrafts} type="checkbox" onChange={(event) => setGenerateDrafts(event.target.checked)} />
                Queue marketplace drafts after creating inventory
              </label>
              <div className="actions">
                <Button disabled={pending} onClick={applyPreview}>
                  {pending ? "Creating..." : "Create inventory from preview"}
                </Button>
              </div>
            </div>
          ) : null}
        </Card>

        <Card eyebrow="Run history" title="Recent imports">
          <div className="stack">
            {(runs.data?.runs ?? []).map((run) => (
              <div className="connect-prompt-card" key={run.id}>
                <div className="split">
                  <strong>{run.sourcePlatform} · {run.sourceKind}</strong>
                  <StatusPill status={run.status} />
                </div>
                <div className="muted">
                  Started {formatDate(run.createdAt)}
                  {run.marketplaceAccount ? ` · ${run.marketplaceAccount.displayName}` : ""}
                </div>
                <div className="muted">
                  Applied {run.appliedCount} · Failed {run.failedCount} · Processed {run.progressCount}
                </div>
                {run.lastErrorMessage ? <div className="notice">{run.lastErrorMessage}</div> : null}
              </div>
            ))}
            {(runs.data?.runs ?? []).length === 0 ? <div className="muted">No import runs yet.</div> : null}
          </div>
        </Card>
      </AppShell>
    </ProtectedView>
  );
}
