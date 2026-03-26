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
          <div>
            {eyebrow ? <p className="rs-eyebrow">{eyebrow}</p> : null}
            {title ? <h3>{title}</h3> : null}
          </div>
          {action ? <div>{action}</div> : null}
        </header>
      )}
      <div>{children}</div>
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
  border: 1px solid rgba(15, 23, 42, 0.09);
  border-radius: 20px;
  background: rgba(255,255,255,0.82);
  box-shadow: 0 20px 40px rgba(148, 163, 184, 0.18);
  padding: 1.25rem;
}

.rs-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.rs-eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 0.72rem;
  color: #475569;
  margin: 0 0 0.35rem;
}

.rs-button {
  border: 0;
  border-radius: 999px;
  padding: 0.7rem 1rem;
  font-weight: 700;
  cursor: pointer;
}

.rs-button-primary {
  color: white;
  background: linear-gradient(135deg, #0f766e, #155e75);
}

.rs-button-secondary {
  color: #0f172a;
  background: #e2e8f0;
}

.rs-button-ghost {
  color: #0f172a;
  background: transparent;
  border: 1px solid rgba(15, 23, 42, 0.12);
}

.rs-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.35rem 0.7rem;
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
`;
