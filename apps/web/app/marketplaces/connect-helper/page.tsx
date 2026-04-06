"use client";

import Link from "next/link";

export default function ConnectHelperPage() {
  return (
    <main className="public-doc-page">
      <section className="public-doc-card">
        <p className="eyebrow">Browser extension flow</p>
        <h1>Marketplace sign-in moved into the browser extension.</h1>
        <p className="public-doc-summary">
          Open the marketplace in another browser tab, finish login there, and then return to Mollie to click recheck login.
          Mollie now saves marketplace accounts from the browser extension instead of the old helper page.
        </p>
        <div className="actions">
          <Link className="public-doc-link" href="/marketplaces">
            Back to marketplaces
          </Link>
        </div>
      </section>
    </main>
  );
}
