"use client";

import { Plug2, RefreshCw } from "lucide-react";

import { Button } from "@reselleros/ui";

import { SectionCard } from "./section-card";
import { StatusPill } from "./status-pill";

export function DesktopExtensionStatusCard({
  installed,
  connected,
  loading,
  pendingTasks,
  onRefresh
}: {
  installed: boolean;
  connected: boolean;
  loading: boolean;
  pendingTasks: number;
  onRefresh: () => void;
}) {
  const title = loading
    ? "Checking browser extension"
    : installed
      ? connected
        ? "Browser extension connected"
        : "Browser extension needs reconnect"
      : "Browser extension not installed";

  const detail = installed
    ? connected
      ? "Mollie can hand off marketplace work through this browser extension."
      : "The extension was detected, but this page has not synced its Mollie session yet."
    : "Install the Mollie browser extension to import marketplace listings and accept Mollie handoff jobs.";

  return (
    <SectionCard eyebrow="Browser extension" title={title}>
      <div className="extension-status-card">
        <div className="extension-status-copy">
          <div className="extension-task-title">
            <Plug2 size={14} />
            <StatusPill
              label={connected ? "Connected" : installed ? "Detected" : "Missing"}
              tone={connected ? "success" : installed ? "warning" : "neutral"}
            />
          </div>
          <p className="muted">{detail}</p>
          <p className="muted">Pending extension tasks: {pendingTasks}</p>
        </div>
        <Button kind="secondary" onClick={onRefresh}>
          <RefreshCw size={16} /> Refresh
        </Button>
      </div>
    </SectionCard>
  );
}
