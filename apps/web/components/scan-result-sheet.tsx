"use client";

import type { ReactNode } from "react";

export function ScanResultSheet({
  open,
  title,
  subtitle,
  children
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  if (!open) {
    return null;
  }

  return (
    <section className="scan-result-sheet">
      <div className="scan-result-sheet-handle" />
      <div className="scan-result-sheet-header">
        <div>
          <p className="eyebrow">Scan result</p>
          <h3>{title}</h3>
        </div>
        {subtitle ? <div className="scan-result-sheet-subtitle">{subtitle}</div> : null}
      </div>
      <div className="scan-result-sheet-body">{children}</div>
    </section>
  );
}
