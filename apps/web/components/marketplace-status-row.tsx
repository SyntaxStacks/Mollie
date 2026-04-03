"use client";

import { Button } from "@reselleros/ui";

import { StatusPill } from "./status-pill";

import type { MarketplaceStatusSummary } from "../lib/item-lifecycle";

function toneForState(state: MarketplaceStatusSummary["state"]) {
  switch (state) {
    case "published":
    case "sold":
      return "success";
    case "failed":
      return "danger";
    case "queued":
    case "publishing":
      return "accent";
    case "draft":
      return "warning";
    default:
      return "neutral";
  }
}

export function MarketplaceStatusRow({
  state,
  onAction
}: {
  state: MarketplaceStatusSummary;
  onAction?: (() => void) | null;
}) {
  return (
    <div className="marketplace-status-row">
      <div className="marketplace-status-main">
        <strong>{state.platform}</strong>
        <div className="marketplace-status-copy">{state.summary}</div>
        {state.missingRequirements.length > 0 ? (
          <div className="marketplace-missing-inline">
            Missing: {state.missingRequirements.join(", ")}
          </div>
        ) : null}
      </div>
      <div className="marketplace-status-actions">
        <StatusPill label={state.state.replace(/_/g, " ")} tone={toneForState(state.state)} />
        {onAction ? (
          <Button kind="secondary" onClick={onAction}>
            {state.actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
