import Link from "next/link";

const legalLinks = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/acceptable-use", label: "Acceptable Use" },
  { href: "/contact", label: "Contact" }
];

export function PublicDocShell({
  eyebrow,
  title,
  summary,
  children
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <main className="public-doc-page">
      <section className="public-doc-hero">
        <div className="public-doc-brand">
          <p className="sidebar-kicker">Mollie.biz</p>
          <h1>{title}</h1>
          <p className="public-doc-summary">{summary}</p>
        </div>
        <div className="public-doc-actions">
          <Link className="public-doc-link" href="/onboarding">
            Operator sign in
          </Link>
          <Link className="public-doc-link" href="/">
            Dashboard
          </Link>
        </div>
      </section>

      <section className="public-doc-card">
        <p className="eyebrow">{eyebrow}</p>
        <div className="public-doc-content">{children}</div>
      </section>

      <footer className="public-doc-footer">
        <div className="public-doc-footer-links">
          {legalLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </div>
        <p className="muted">Mollie is operated by Terapixel Games LLC for pilot reseller workflows.</p>
      </footer>
    </main>
  );
}
