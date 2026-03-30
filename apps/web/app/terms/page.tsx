import type { Metadata } from "next";

import { PublicDocShell } from "../../components/public-doc-shell";

export const metadata: Metadata = {
  title: "Terms of Service | Mollie",
  description: "The pilot operating terms for Mollie operator workspaces."
};

export default function TermsPage() {
  return (
    <PublicDocShell
      eyebrow="Terms of Service"
      title="Pilot terms for operators and workspace owners"
      summary="These terms govern use of Mollie during the current pilot phase and explain the responsibilities of workspace owners and invited operators."
    >
      <div className="stack">
        <section className="public-doc-section">
          <h2>Effective date</h2>
          <p>March 29, 2026.</p>
        </section>

        <section className="public-doc-section">
          <h2>Pilot service</h2>
          <p>
            Mollie is a pilot-stage reseller operations platform for sourcing, inventory management, listing
            preparation, and cross-listing workflows. Features may change as pilot feedback is incorporated.
          </p>
        </section>

        <section className="public-doc-section">
          <h2>Workspace responsibility</h2>
          <p>
            Workspace owners are responsible for the operators they invite, the marketplace accounts they connect, and
            the inventory and listing data they submit through Mollie.
          </p>
        </section>

        <section className="public-doc-section">
          <h2>Marketplace use</h2>
          <p>
            Operators must only connect marketplace accounts they are authorized to use. Mollie may disable or block
            integrations when a provider signals compliance, credential, or policy issues.
          </p>
        </section>

        <section className="public-doc-section">
          <h2>No guarantee of uptime or resale outcome</h2>
          <p>
            Mollie is provided on a pilot basis. Listing success, sale outcomes, and marketplace acceptance are not
            guaranteed. Operators remain responsible for reviewing pricing, condition, category, and policy details
            before publishing.
          </p>
        </section>

        <section className="public-doc-section">
          <h2>Termination</h2>
          <p>
            Mollie may suspend or terminate access for policy abuse, fraud, unsafe automation behavior, or marketplace
            compliance reasons. Operators may stop using the service at any time.
          </p>
        </section>

        <section className="public-doc-section">
          <h2>Contact</h2>
          <p>
            Questions about these terms can be sent to <a href="mailto:admin@terapixel.games">admin@terapixel.games</a>.
          </p>
        </section>
      </div>
    </PublicDocShell>
  );
}
