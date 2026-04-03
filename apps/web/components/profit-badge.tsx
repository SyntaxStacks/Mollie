"use client";

import { currency } from "../lib/api";

export function ProfitBadge({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="profit-badge profit-badge-neutral">No profit read yet</span>;
  }

  if (value >= 25) {
    return <span className="profit-badge profit-badge-strong">Profit {currency(value)}</span>;
  }

  if (value > 0) {
    return <span className="profit-badge profit-badge-soft">Profit {currency(value)}</span>;
  }

  return <span className="profit-badge profit-badge-risk">Low margin</span>;
}
