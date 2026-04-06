"use client";

import { AlertTriangle, Plug2, RefreshCw, Store } from "lucide-react";

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

function toneForConnection(tone: MarketplaceStatusSummary["connectionTone"]) {
  return tone;
}

export function MarketplaceStatusRow({
  state,
  selectable = false,
  selected = false,
  onToggle,
  onAction,
  onSecondaryAction
}: {
  state: MarketplaceStatusSummary;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: ((checked: boolean) => void) | null;
  onAction?: (() => void) | null;
  onSecondaryAction?: (() => void) | null;
}) {
  return (
    <div className={`marketplace-status-row marketplace-status-row-rich${selected ? " marketplace-status-row-selected" : ""}`}>
      <div className="marketplace-status-main">
        <div className="marketplace-status-topline">
          <div className="marketplace-status-topline-main">
            {selectable ? (
              <label className="marketplace-selection-toggle">
                <input checked={selected} onChange={(event) => onToggle?.(event.target.checked)} type="checkbox" />
                <span />
              </label>
            ) : null}
            <strong>{state.platform}</strong>
          </div>
          <StatusPill label={state.state.replace(/_/g, " ")} tone={toneForState(state.state)} />
        </div>
        <div className="marketplace-status-copy">{state.summary}</div>
        <div className="marketplace-status-meta">
          <span className="marketplace-meta-pill">
            <Store size={13} />
            {state.executionMode}
          </span>
          <StatusPill label={state.connectionSummary} tone={toneForConnection(state.connectionTone)} />
          {state.extensionRequired ? (
            <span className="marketplace-meta-pill">
              <Plug2 size={13} />
              {state.extensionSummary}
            </span>
          ) : null}
        </div>
        {state.blocker ? (
          <div className="marketplace-blocker-inline">
            <AlertTriangle size={14} />
            <span>{state.blocker}</span>
          </div>
        ) : null}
        {state.missingRequirements.length > 0 ? (
          <div className="marketplace-missing-inline">
            Missing: {state.missingRequirements.join(", ")}
          </div>
        ) : null}
      </div>
      <div className="marketplace-status-actions">
        {onSecondaryAction && state.secondaryActionLabel ? (
          <Button kind="ghost" onClick={onSecondaryAction}>
            <RefreshCw size={14} /> {state.secondaryActionLabel}
          </Button>
        ) : null}
        {onAction ? (
          <Button kind="secondary" onClick={onAction}>
            {state.actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
