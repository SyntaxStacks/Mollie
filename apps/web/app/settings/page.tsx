"use client";

import { useState, useTransition } from "react";

import { Button, Card } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { ProtectedView } from "../../components/protected-view";
import { useAuth } from "../../components/auth-provider";
import { useAuthedResource } from "../../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function SettingsPage() {
  const auth = useAuth();
  const audit = useAuthedResource<{
    logs: Array<{ id: string; action: string; targetType: string; targetId: string; createdAt: string }>;
  }>("/api/audit-logs", auth.token);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleConnectorAutomation(enabled: boolean) {
    startTransition(async () => {
      const response = await fetch(`${API_BASE_URL}/api/workspace/connector-automation`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify({ enabled })
      });

      const payload = (await response.json()) as {
        workspace?: {
          id: string;
          name: string;
          plan: string;
          billingCustomerId: string | null;
          connectorAutomationEnabled?: boolean;
        };
        error?: string;
      };

      if (!response.ok || !payload.workspace) {
        setError(payload.error ?? "Could not update connector automation setting");
        return;
      }

      setError(null);
      await auth.refreshMe();
      await audit.refresh();
    });
  }

  return (
    <ProtectedView>
      <AppShell title="Settings + Billing Skeleton">
        <div className="grid-2">
          <Card eyebrow="Workspace" title={auth.workspace?.name ?? "No workspace"}>
            <div className="stack muted">
              <span>Plan: {auth.workspace?.plan ?? "pilot"}</span>
              <span>Billing customer: {auth.workspace?.billingCustomerId ?? "Provisioned when workspace is created"}</span>
              <span>Authenticated user: {auth.user?.email}</span>
              <span>
                Connector automation: {auth.workspace?.connectorAutomationEnabled === false ? "Disabled" : "Enabled"}
              </span>
            </div>
            <div className="actions" style={{ marginTop: "1rem" }}>
              <Button
                disabled={pending || auth.workspace?.connectorAutomationEnabled === true}
                onClick={() => toggleConnectorAutomation(true)}
              >
                Enable automation
              </Button>
              <Button
                kind="secondary"
                disabled={pending || auth.workspace?.connectorAutomationEnabled === false}
                onClick={() => toggleConnectorAutomation(false)}
              >
                Disable automation
              </Button>
            </div>
            {error ? <div className="notice">{error}</div> : null}
          </Card>

          <Card eyebrow="MVP boundary" title="Billing placeholder">
            <p className="muted">
              Stripe customer bootstrap is provisioned at workspace creation. Subscription management can hang off this
              screen without changing the core inventory and publish workflows.
            </p>
          </Card>
        </div>

        <Card eyebrow="Audit trail" title="Recent audited actions">
          <div className="stack">
            {(audit.data?.logs ?? []).map((log) => (
              <div className="split" key={log.id}>
                <div>
                  <strong>{log.action}</strong>
                  <div className="muted">
                    {log.targetType} · {log.targetId}
                  </div>
                </div>
                <span className="muted">{new Date(log.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Card>
      </AppShell>
    </ProtectedView>
  );
}
