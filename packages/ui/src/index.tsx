import type { ButtonHTMLAttributes, ReactNode } from "react";

import clsx from "clsx";

type CardProps = {
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Card({ title, eyebrow, action, children, className }: CardProps) {
  return (
    <section className={clsx("rs-card", className)}>
      {(title || eyebrow || action) && (
        <header className="rs-card-header">
          <div className="rs-card-heading">
            {eyebrow ? <p className="rs-eyebrow">{eyebrow}</p> : null}
            {title ? <h3>{title}</h3> : null}
          </div>
          {action ? <div>{action}</div> : null}
        </header>
      )}
      <div className="rs-card-content">{children}</div>
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  kind?: "primary" | "secondary" | "ghost";
};

export function Button({ children, type = "button", kind = "primary", className, ...props }: ButtonProps) {
  return (
    <button className={clsx("rs-button", `rs-button-${kind}`, className)} type={type} {...props}>
      {children}
    </button>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <span className="rs-pill">{status.replace(/_/g, " ")}</span>;
}

export const sharedStyles = `
.rs-card {
  position: relative;
  border: 2px solid var(--foreground, #000);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(245, 245, 245, 0.7)),
    repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0, 0, 0, 0.03) 1px, rgba(0, 0, 0, 0.03) 2px);
  padding: 1.5rem;
}

.rs-card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 6px;
  background: var(--foreground, #000);
}

.rs-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
  padding-top: 0.55rem;
}

.rs-card-heading {
  display: grid;
  gap: 0.3rem;
}

.rs-card-content {
  display: grid;
  gap: 1rem;
}

.rs-eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 0.72rem;
  color: var(--muted-foreground, #525252);
  margin: 0 0 0.35rem;
  font-family: var(--font-mono, "JetBrains Mono"), monospace;
}

.rs-card h3 {
  margin: 0;
  font-family: var(--font-display, "Playfair Display"), Georgia, serif;
  font-size: clamp(1.6rem, 3vw, 2.4rem);
  line-height: 0.98;
  letter-spacing: -0.04em;
}

.rs-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  min-height: 46px;
  border: 2px solid var(--foreground, #000);
  padding: 0.85rem 1.2rem;
  font-family: var(--font-mono, "JetBrains Mono"), monospace;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  background: transparent;
  color: var(--foreground, #000);
  cursor: pointer;
  transition:
    background-color 100ms linear,
    color 100ms linear,
    border-color 100ms linear;
}

.rs-button:focus-visible {
  outline: 3px solid var(--foreground, #000);
  outline-offset: 3px;
}

.rs-button-primary {
  color: var(--background, #fff);
  background: var(--foreground, #000);
}

.rs-button-secondary {
  color: var(--foreground, #000);
  background: transparent;
}

.rs-button-ghost {
  color: var(--foreground, #000);
  background: transparent;
  border-color: transparent;
  padding-inline: 0;
}

.rs-button-primary:hover,
.rs-button-primary:focus-visible,
.rs-button-secondary:hover,
.rs-button-secondary:focus-visible {
  background: var(--background, #fff);
  color: var(--foreground, #000);
}

.rs-button-secondary:hover,
.rs-button-secondary:focus-visible {
  background: var(--foreground, #000);
  color: var(--background, #fff);
}

.rs-button-ghost:hover,
.rs-button-ghost:focus-visible {
  text-decoration: underline;
  text-underline-offset: 0.24em;
}

.rs-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--foreground, #000);
  background: var(--background, #fff);
  color: var(--foreground, #000);
  font-family: var(--font-mono, "JetBrains Mono"), monospace;
  font-size: 0.74rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}
`;
