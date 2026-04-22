"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

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

function platformLabel(platform: MarketplaceStatusSummary["platform"]) {
  switch (platform) {
    case "EBAY":
      return "eBay";
    case "DEPOP":
      return "Depop";
    case "POSHMARK":
      return "Poshmark";
    case "WHATNOT":
      return "Whatnot";
    default:
      return platform;
  }
}

function collapsedSummary(state: MarketplaceStatusSummary) {
  if (state.state === "published" || state.state === "sold") {
    return "Live listing";
  }

  if (state.state === "draft") {
    return "Draft ready";
  }

  if (state.state === "queued" || state.state === "publishing") {
    return "Work in progress";
  }

  if (state.blocker || state.missingRequirements.length > 0) {
    return "Select to view setup";
  }

  return "Select to configure";
}

function normalizeRequirementCopy(value: string) {
  return value.trim().toLowerCase().replace(/^missing:\s*/, "").replace(/^missing\s+/, "").replace(/[.\s]+$/g, "");
}

export function MarketplaceStatusRow({
  state,
  selectable = false,
  selected = false,
  onToggle,
  onAction,
  onSecondaryAction,
  onRequirementSelect
}: {
  state: MarketplaceStatusSummary;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: ((checked: boolean) => void) | null;
  onAction?: (() => void) | null;
  onSecondaryAction?: (() => void) | null;
  onRequirementSelect?: ((requirement: string) => void) | null;
}) {
  const expanded = !selectable || selected;
  const interactive = Boolean(selectable && onToggle);
  const missingRequirementsCopy = state.missingRequirements.join(", ");
  const blockerDuplicatesMissingRequirements =
    state.missingRequirements.length > 0 &&
    state.blocker !== null &&
    normalizeRequirementCopy(state.blocker) === normalizeRequirementCopy(missingRequirementsCopy);

  function handleSelect() {
    if (interactive && !selected) {
      onToggle?.(true);
    }
  }

  return (
    <div
      className={`marketplace-status-row marketplace-status-row-rich marketplace-status-row-selectable${selected ? " marketplace-status-row-selected" : ""}${expanded ? " marketplace-status-row-expanded" : " marketplace-status-row-collapsed"}${interactive ? " marketplace-status-row-clickable" : ""}`}
      onClick={interactive ? handleSelect : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleSelect();
              }
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <div className="marketplace-status-main">
        <div className="marketplace-status-topline">
          <div className="marketplace-status-topline-main">
            {selectable ? (
              <button
                aria-checked={selected}
                className="marketplace-selection-toggle"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle?.(!selected);
                }}
                role="checkbox"
                type="button"
              >
                <span />
              </button>
            ) : null}
            <div className="marketplace-title-stack">
              <strong>{platformLabel(state.platform)}</strong>
              {!expanded ? <span className="marketplace-collapsed-summary">{collapsedSummary(state)}</span> : null}
            </div>
          </div>
          <StatusPill label={state.state.replace(/_/g, " ")} tone={toneForState(state.state)} />
        </div>
        {expanded ? (
          <>
            <div className="marketplace-status-copy">{state.summary}</div>
            {state.blocker ? (
              <div className="marketplace-blocker-inline">
                <AlertTriangle size={14} />
                <span>{state.blocker}</span>
              </div>
            ) : null}
            {state.missingRequirements.length > 0 && !blockerDuplicatesMissingRequirements ? (
              <div className="marketplace-missing-inline">
                Missing:{" "}
                {state.missingRequirements.map((requirement, index) => (
                  <span key={requirement}>
                    <button
                      className="marketplace-requirement-link"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRequirementSelect?.(requirement);
                      }}
                      type="button"
                    >
                      {requirement}
                    </button>
                    {index < state.missingRequirements.length - 1 ? ", " : null}
                  </span>
                ))}
              </div>
            ) : null}
            {state.missingRequirements.length === 0 && state.recommendedRequirements.length > 0 ? (
              <div className="marketplace-missing-inline muted">
                Improves results: {state.recommendedRequirements.join(", ")}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {expanded ? (
        <div className="marketplace-status-actions">
          {onSecondaryAction && state.secondaryActionLabel ? (
            <Button kind="ghost" onClick={(event) => {
              event.stopPropagation();
              onSecondaryAction();
            }}>
              <RefreshCw size={14} /> {state.secondaryActionLabel}
            </Button>
          ) : null}
          {onAction ? (
            <Button onClick={(event) => {
              event.stopPropagation();
              onAction();
            }}>
              {state.actionLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
