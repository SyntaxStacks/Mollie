"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import { Button } from "@reselleros/ui";

import { currency } from "../lib/api";
import {
  getItemPrimaryImage,
  getLifecycleBucket,
  getMarketplaceStatusSummaries,
  getNextActionLabel,
  getProfitEstimate,
  getListingReadinessFlags,
  humanizeReadinessFlag,
  type InventoryListLikeItem
} from "../lib/item-lifecycle";
import { ProfitBadge } from "./profit-badge";
import { StatusPill } from "./status-pill";

export function ItemCard({
  item,
  href,
  compact = false,
  action
}: {
  item: InventoryListLikeItem;
  href: string;
  compact?: boolean;
  action?: ReactNode;
}) {
  const image = getItemPrimaryImage(item);
  const profit = getProfitEstimate(item);
  const bucket = getLifecycleBucket(item);
  const nextAction = getNextActionLabel(item);
  const flags = getListingReadinessFlags(item);
  const summary = getMarketplaceStatusSummaries(item);
  const listedCount = summary.filter((state) => state.state === "published").length;
  const failedCount = summary.filter((state) => state.state === "failed").length;
  const firstFlag = flags[0] ?? null;

  return (
    <article className={`item-card${compact ? " item-card-compact" : ""}`}>
      <Link className="item-card-image-shell" href={href}>
        {image ? <img alt={item.title} className="item-card-image" src={image} /> : <div className="item-card-image item-card-image-empty">No photo</div>}
      </Link>
      <div className="item-card-body">
        <div className="item-card-topline">
          <div>
            <p className="eyebrow">Next action</p>
            <strong className="item-card-title">
              <Link href={href}>{item.title}</Link>
            </strong>
          </div>
          <StatusPill label={bucket} tone={bucket === "Needs Fix" ? "danger" : bucket === "Ready to List" ? "success" : "neutral"} />
        </div>

        <div className="item-card-meta">
          <span>Buy {currency(item.costBasis ?? 0)}</span>
          <span>Sell {currency(item.priceRecommendation ?? 0)}</span>
          <span>{nextAction}</span>
        </div>

        <div className="item-card-badges">
          <ProfitBadge value={profit} />
          <span className="item-card-market-summary">{listedCount} live</span>
          {failedCount > 0 ? <span className="item-card-blocker"> {failedCount} failed</span> : null}
          {firstFlag ? <span className="item-card-blocker">{humanizeReadinessFlag(firstFlag)}</span> : null}
        </div>

        <div className="item-card-footer">
          <div className="item-card-marketplaces">
            {summary.map((state) => (
              <span className="item-card-market-chip" key={state.platform}>
                {state.platform}: {state.state.replace(/_/g, " ")}
              </span>
            ))}
          </div>
          {action ?? (
            <Link href={href}>
              <Button kind="secondary">Open item</Button>
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
