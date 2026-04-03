"use client";

import { humanizeReadinessFlag, type ListingReadinessFlag } from "../lib/item-lifecycle";

export function MissingFieldsPanel({ flags }: { flags: ListingReadinessFlag[] }) {
  if (flags.length === 0) {
    return <div className="missing-fields-panel missing-fields-panel-ready">No blockers right now.</div>;
  }

  return (
    <div className="missing-fields-panel">
      <p className="eyebrow">Needs attention</p>
      <div className="missing-fields-list">
        {flags.map((flag) => (
          <span className="missing-field-chip" key={flag}>
            {humanizeReadinessFlag(flag)}
          </span>
        ))}
      </div>
    </div>
  );
}
