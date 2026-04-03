"use client";

import type { ReactNode } from "react";

export function ActionRail({ children }: { children: ReactNode }) {
  return <div className="action-rail">{children}</div>;
}
