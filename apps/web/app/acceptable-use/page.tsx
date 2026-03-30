import type { Metadata } from "next";

import { PublicDocShell } from "../../components/public-doc-shell";

export const metadata: Metadata = {
  title: "Acceptable Use | Mollie",
  description: "The acceptable use expectations for operators using Mollie during the pilot phase."
};

export default function AcceptableUsePage() {
  return (
    <PublicDocShell
      eyebrow="Acceptable Use"
      title="How operators are expected to use Mollie"
      summary="Mollie is built for legitimate reseller operations. This page defines the abuse, fraud, and unsafe automation patterns that are not allowed."
    >
      <div className="stack">
        <section className="public-doc-section">
          <h2>Allowed use</h2>
          <p>
            Use Mollie to manage legitimate sourcing, inventory preparation, listing workflows, operator collaboration,
            and marketplace publishing for accounts you control or have permission to operate.
          </p>
        </section>

        <section className="public-doc-section">
          <h2>Not allowed</h2>
          <ul>
            <li>Fraudulent listings, deceptive photos, or counterfeit goods.</li>
            <li>Using accounts, credentials, or marketplaces without authorization.</li>
            <li>Attempting to bypass provider policies, safety controls, or account restrictions.</li>
            <li>Abuse of automation that creates spam, scraping, or operational harm.</li>
            <li>Uploading malware, unlawful content, or data you do not have the right to process.</li>
          </ul>
        </section>

        <section className="public-doc-section">
          <h2>Automation limits</h2>
          <p>
            Automation-class marketplaces in Mollie may be slowed, blocked, or disabled when account health, workspace
            controls, or provider compliance requirements demand it.
          </p>
        </section>

        <section className="public-doc-section">
          <h2>Enforcement</h2>
          <p>
            Mollie may disable features, suspend workspaces, or terminate operator access to protect marketplaces,
            workspace owners, and the integrity of the pilot.
          </p>
        </section>
      </div>
    </PublicDocShell>
  );
}
