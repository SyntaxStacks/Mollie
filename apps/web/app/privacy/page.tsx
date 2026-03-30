import type { Metadata } from "next";

import { PublicDocShell } from "../../components/public-doc-shell";

export const metadata: Metadata = {
  title: "Privacy Policy | Mollie",
  description: "How Mollie collects, uses, and protects operator, workspace, and marketplace data."
};

export default function PrivacyPage() {
  return (
    <PublicDocShell
      eyebrow="Privacy Policy"
      title="Privacy, operator data, and marketplace information"
      summary="This policy explains what Mollie collects during pilot operations, why we collect it, and how operators can request updates or deletion."
    >
      <div className="stack">
        <section className="public-doc-section">
          <h2>Effective date</h2>
          <p>March 29, 2026.</p>
        </section>

        <section className="public-doc-section">
          <h2>What Mollie collects</h2>
          <p>
            Mollie stores the data needed to run reseller operations: operator account details, workspace membership,
            sourced lot data, inventory records, listing drafts, execution logs, audit events, and uploaded photos.
          </p>
          <p>
            When operators connect marketplaces, Mollie may store marketplace account identifiers, encrypted OAuth
            credentials, session references, readiness metadata, and publish artifacts required for support,
            compliance, and retry workflows.
          </p>
        </section>

        <section className="public-doc-section">
          <h2>How Mollie uses data</h2>
          <ul>
            <li>Authenticate operators and manage workspace access.</li>
            <li>Generate inventory insights, drafts, and cross-listing workflows.</li>
            <li>Publish, sync, retry, and audit marketplace actions.</li>
            <li>Store uploaded images and execution artifacts for operator support.</li>
            <li>Improve product reliability, abuse prevention, and pilot support.</li>
          </ul>
        </section>

        <section className="public-doc-section">
          <h2>Sharing and processors</h2>
          <p>
            Mollie uses cloud and infrastructure vendors to operate the service, including hosting, storage, email
            delivery, and marketplace integrations. Mollie does not sell operator or workspace data.
          </p>
          <p>
            Marketplace actions only occur when requested by an operator or when enabled automation runs within a
            workspace&apos;s configured boundaries.
          </p>
        </section>

        <section className="public-doc-section">
          <h2>Retention and deletion</h2>
          <p>
            Pilot data is retained only as long as necessary for workspace operations, support, fraud prevention, and
            legal compliance. Marketplace credential records are disabled when required by provider notifications or
            operator action.
          </p>
        </section>

        <section className="public-doc-section">
          <h2>Requests and contact</h2>
          <p>
            For privacy requests, account questions, or deletion requests, contact{" "}
            <a href="mailto:admin@terapixel.games">admin@terapixel.games</a>.
          </p>
        </section>
      </div>
    </PublicDocShell>
  );
}
