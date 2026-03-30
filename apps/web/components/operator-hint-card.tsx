"use client";

import Link from "next/link";

import type { OperatorHint } from "@reselleros/types";

export function OperatorHintCard({ hint }: { hint: OperatorHint | null | undefined }) {
  if (!hint) {
    return null;
  }

  const severityClass =
    hint.severity === "ERROR"
      ? "marketplace-hint marketplace-hint-error"
      : hint.severity === "SUCCESS"
        ? "marketplace-hint marketplace-hint-success"
        : hint.severity === "INFO"
          ? "marketplace-hint marketplace-hint-info"
          : "marketplace-hint marketplace-hint-warning";

  return (
    <div className={severityClass}>
      <div className="stack" style={{ gap: "0.55rem" }}>
        <div className="split" style={{ alignItems: "flex-start" }}>
          <strong>{hint.title}</strong>
          <span className="execution-inline-code">{hint.severity}</span>
        </div>
        <div>{hint.explanation}</div>
        {hint.featureFamily ? <div className="muted">Feature family: {hint.featureFamily}</div> : null}
        {hint.helpText ? <div className="muted">{hint.helpText}</div> : null}
        {hint.nextActions.length > 0 ? (
          <div className="stack" style={{ gap: "0.4rem" }}>
            <div className="muted">Next steps</div>
            <ul className="marketplace-hint-list">
              {hint.nextActions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {hint.routeTarget ? (
          <div className="actions">
            <Link className="public-doc-link" href={hint.routeTarget}>
              Open recommended screen
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
