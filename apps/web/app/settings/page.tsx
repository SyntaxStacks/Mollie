"use client";

import { Card } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { ProtectedView } from "../../components/protected-view";
import { useAuth } from "../../components/auth-provider";
import { useAuthedResource } from "../../lib/api";

export default function SettingsPage() {
  const auth = useAuth();
  const audit = useAuthedResource<{
    logs: Array<{ id: string; action: string; targetType: string; targetId: string; createdAt: string }>;
  }>("/api/audit-logs", auth.token);

  return (
    <ProtectedView>
      <AppShell title="Settings + Billing Skeleton">
        <div className="grid-2">
          <Card eyebrow="Workspace" title={auth.workspace?.name ?? "No workspace"}>
            <div className="stack muted">
              <span>Plan: {auth.workspace?.plan ?? "pilot"}</span>
              <span>Billing customer: {auth.workspace?.billingCustomerId ?? "Provisioned when workspace is created"}</span>
              <span>Authenticated user: {auth.user?.email}</span>
            </div>
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
