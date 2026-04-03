"use client";

export function StatusPill({
  label,
  tone = "neutral"
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  return <span className={`app-status-pill app-status-pill-${tone}`}>{label}</span>;
}
