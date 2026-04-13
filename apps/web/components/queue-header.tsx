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
      <div className="queue-header-copy">
        <p className="eyebrow">Queue</p>
        <div aria-hidden="true" className="queue-header-rule">
          <span className="queue-header-rule-square" />
          <span className="queue-header-rule-line" />
        </div>
        <h3>{title}</h3>
        <p className="queue-header-description">{description}</p>
      </div>
      <div aria-label={`${count} items in queue`} className="queue-header-count">
        <strong>{count}</strong>
        <span>items</span>
      </div>
    </div>
  );
}
