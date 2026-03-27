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
  const members = useAuthedResource<{
    canManageMembers: boolean;
    members: Array<{
      id: string;
      role: string;
      createdAt: string;
      user: {
        id: string;
        email: string;
        name: string | null;
      };
    }>;
  }>("/api/workspace/members", auth.token, [auth.workspace?.id]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberNotice, setMemberNotice] = useState<string | null>(null);

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

  function addWorkspaceMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    startTransition(async () => {
      const response = await fetch(`${API_BASE_URL}/api/workspace/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify({
          email: memberEmail,
          name: memberName || undefined,
          role: "MEMBER"
        })
      });

      const payload = (await response.json()) as {
        member?: {
          user: {
            email: string;
          };
        };
        error?: string;
      };

      if (!response.ok || !payload.member) {
        setMemberError(payload.error ?? "Could not add workspace member");
        setMemberNotice(null);
        return;
      }

      setMemberError(null);
      setMemberNotice(`Added ${payload.member.user.email}. They can sign in on onboarding to join this workspace.`);
      setMemberEmail("");
      setMemberName("");
      form.reset();
      await members.refresh();
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

        <Card eyebrow="Workspace access" title="Operators">
          <div className="stack">
            <p className="muted">
              Mollie now supports multiple operators per workspace. Add a teammate by email, then have them sign in
              through the normal onboarding code flow.
            </p>

            {members.data?.canManageMembers ? (
              <form className="stack" onSubmit={addWorkspaceMember}>
                <label className="stack">
                  <span>Email</span>
                  <input
                    autoComplete="email"
                    name="member-email"
                    onChange={(event) => setMemberEmail(event.target.value)}
                    placeholder="teammate@example.com"
                    required
                    type="email"
                    value={memberEmail}
                  />
                </label>
                <label className="stack">
                  <span>Name</span>
                  <input
                    name="member-name"
                    onChange={(event) => setMemberName(event.target.value)}
                    placeholder="Optional display name"
                    type="text"
                    value={memberName}
                  />
                </label>
                <div className="actions">
                  <Button disabled={pending || !memberEmail.trim()} type="submit">
                    Add operator
                  </Button>
                </div>
              </form>
            ) : (
              <p className="muted">Only workspace owners can add new operators.</p>
            )}

            {memberError ? <div className="notice">{memberError}</div> : null}
            {memberNotice ? <div className="notice success">{memberNotice}</div> : null}

            <div className="stack">
              {(members.data?.members ?? []).map((member) => (
                <div className="split" key={member.id}>
                  <div>
                    <strong>{member.user.name ?? member.user.email}</strong>
                    <div className="muted">
                      {member.user.email} · {member.role}
                    </div>
                  </div>
                  <span className="muted">{new Date(member.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

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
