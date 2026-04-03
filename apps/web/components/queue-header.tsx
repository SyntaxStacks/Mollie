"use client";

export function QueueHeader({
  title,
  count,
  description
}: {
  title: string;
  count: number;
  description: string;
}) {
  return (
    <div className="queue-header">
      <div>
        <p className="eyebrow">Queue</p>
        <h3>{title}</h3>
        <p className="queue-header-copy">{description}</p>
      </div>
      <div className="queue-header-count">{count}</div>
    </div>
  );
}
