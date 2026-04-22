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
        setError(payload.error ?? "Could not update automation status");
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
        setMemberError(payload.error ?? "Could not add operator");
        setMemberNotice(null);
        return;
      }

      setMemberError(null);
      setMemberNotice(`Added ${payload.member.user.email}. They can sign in through the normal onboarding flow.`);
      setMemberEmail("");
      setMemberName("");
      form.reset();
      await members.refresh();
      await audit.refresh();
    });
  }

  return (
    <ProtectedView>
      <AppShell title="Settings">
        <div className="grid-2">
          <Card eyebrow="Workspace" title={auth.workspace?.name ?? "No workspace"}>
            <div className="stack muted">
              <span>Plan: {auth.workspace?.plan ?? "pilot"}</span>
              <span>Owner session: {auth.user?.email}</span>
              <span>Billing customer: {auth.workspace?.billingCustomerId ?? "Created with the workspace"}</span>
              <span>Automation: {auth.workspace?.connectorAutomationEnabled === false ? "Paused" : "Live"}</span>
            </div>
          </Card>

          <Card eyebrow="Automation" title="Background posting">
            <p className="muted">
              Marketplace posting, queueing, and session checks now run through Mollie. Use this control only when you
              need to pause automation across the whole workspace.
            </p>
            <div className="actions" style={{ marginTop: "1rem" }}>
              <Button
                disabled={pending || auth.workspace?.connectorAutomationEnabled === true}
                onClick={() => toggleConnectorAutomation(true)}
              >
                Turn automation on
              </Button>
              <Button
                kind="secondary"
                disabled={pending || auth.workspace?.connectorAutomationEnabled === false}
                onClick={() => toggleConnectorAutomation(false)}
              >
                Pause automation
              </Button>
            </div>
            {error ? <div className="notice">{error}</div> : null}
          </Card>

          <Card eyebrow="Plan" title="Billing and access">
            <p className="muted">
              Keep this page focused on who can access Mollie and whether background automation should stay active.
              Billing setup is attached to the workspace at creation time.
            </p>
          </Card>
        </div>

        <Card eyebrow="Workspace access" title="Operators">
          <div className="stack">
            <p className="muted">
              Add teammates by email so they can work inside the same inventory, marketplaces, and activity feed.
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

        <Card eyebrow="Audit trail" title="Recent activity">
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
