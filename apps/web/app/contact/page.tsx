import type { Metadata } from "next";

import { PublicDocShell } from "../../components/public-doc-shell";

export const metadata: Metadata = {
  title: "Contact | Mollie",
  description: "How operators and partners can contact Mollie during the pilot phase."
};

export default function ContactPage() {
  return (
    <PublicDocShell
      eyebrow="Contact"
      title="Support, privacy, and pilot contact information"
      summary="Mollie is still in pilot, so support is direct. Use the channels below for onboarding help, policy questions, or marketplace integration issues."
    >
      <div className="stack">
        <section className="public-doc-section">
          <h2>Primary contact</h2>
          <p>
            Email <a href="mailto:admin@terapixel.games">admin@terapixel.games</a> for pilot support, privacy
            requests, marketplace issues, and operator access questions.
          </p>
        </section>

        <section className="public-doc-section">
          <h2>What to include</h2>
          <ul>
            <li>Your workspace name.</li>
            <li>The inventory item or listing involved, if any.</li>
            <li>The marketplace and timestamp of the issue.</li>
            <li>Any execution correlation ID or screenshot that helps reproduce the problem.</li>
          </ul>
        </section>

        <section className="public-doc-section">
          <h2>Operational note</h2>
          <p>
            Pilot users should still rely on in-app execution logs, audit trails, and workspace settings first. Direct
            email support is best used for onboarding, compliance, and incident follow-up.
          </p>
        </section>
      </div>
    </PublicDocShell>
  );
}
