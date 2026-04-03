"use client";

import type { ReactNode } from "react";

import { Card } from "@reselleros/ui";

export function SectionCard({
  title,
  eyebrow,
  action,
  children,
  className
}: {
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card action={action} className={`section-card${className ? ` ${className}` : ""}`} eyebrow={eyebrow} title={title}>
      {children}
    </Card>
  );
}
