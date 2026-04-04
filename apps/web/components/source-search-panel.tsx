"use client";

import { ExternalLink, Search, Sparkles } from "lucide-react";

type SourceSearchPanelProps = {
  query: string;
  onQueryChange: (value: string) => void;
  sourceUrl: string;
  onSourceUrlChange: (value: string) => void;
  title?: string;
  description?: string;
};

function buildSearchUrl(baseUrl: string, query: string) {
  return `${baseUrl}${encodeURIComponent(query.trim())}`;
}

export function SourceSearchPanel({
  query,
  onQueryChange,
  sourceUrl,
  onSourceUrlChange,
  title = "Manual/source lookup",
  description = "Use a title, brand, or model phrase to open product-centric searches. Paste the best source URL you find, then use it to prefill the item."
}: SourceSearchPanelProps) {
  const trimmedQuery = query.trim();
  const googleShoppingUrl = trimmedQuery ? buildSearchUrl("https://www.google.com/search?tbm=shop&q=", trimmedQuery) : null;
  const amazonUrl = trimmedQuery ? buildSearchUrl("https://www.amazon.com/s?k=", trimmedQuery) : null;
  const ebayUrl = trimmedQuery ? buildSearchUrl("https://www.ebay.com/sch/i.html?_nkw=", trimmedQuery) : null;

  return (
    <section className="source-search-panel">
      <div className="source-search-header">
        <div>
          <p className="eyebrow">Manual lookup</p>
          <h3>{title}</h3>
        </div>
        <div className="source-search-badge">
          <Sparkles size={16} />
          Prefill only
        </div>
      </div>

      <p className="source-search-copy">{description}</p>

      <div className="source-search-grid">
        <label className="label">
          Lookup phrase
          <div className="source-search-field">
            <Search size={16} />
            <input
              className="field"
              placeholder="Brand, title, model, or a product phrase"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </div>
        </label>

        <label className="label">
          Source URL
          <input
            className="field"
            placeholder="Paste the best Amazon, eBay, or product URL you find"
            value={sourceUrl}
            onChange={(event) => onSourceUrlChange(event.target.value)}
          />
        </label>
      </div>

      <div className="source-search-links">
        {googleShoppingUrl ? (
          <a className="secondary-link-button" href={googleShoppingUrl} rel="noreferrer" target="_blank">
            <ExternalLink size={16} /> Google Shopping
          </a>
        ) : null}
        {amazonUrl ? (
          <a className="secondary-link-button" href={amazonUrl} rel="noreferrer" target="_blank">
            <ExternalLink size={16} /> Amazon
          </a>
        ) : null}
        {ebayUrl ? (
          <a className="secondary-link-button" href={ebayUrl} rel="noreferrer" target="_blank">
            <ExternalLink size={16} /> eBay
          </a>
        ) : null}
        {sourceUrl.trim() ? (
          <a className="secondary-link-button" href={sourceUrl.trim()} rel="noreferrer" target="_blank">
            <ExternalLink size={16} /> Open pasted source
          </a>
        ) : null}
      </div>
    </section>
  );
}
