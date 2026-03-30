"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Boxes, Tags, Receipt, ShoppingBag, ScrollText, Settings, Store, Factory } from "lucide-react";

import { Button } from "@reselleros/ui";

import { useAuth } from "./auth-provider";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/workspace", label: "Workspace", icon: Factory },
  { href: "/marketplaces", label: "Accounts", icon: Store },
  { href: "/lots", label: "Source Lots", icon: Boxes },
  { href: "/inventory", label: "Inventory", icon: ShoppingBag },
  { href: "/drafts", label: "Drafts", icon: Tags },
  { href: "/executions", label: "Executions", icon: ScrollText },
  { href: "/sales", label: "Sales", icon: Receipt },
  { href: "/settings", label: "Settings", icon: Settings }
];

const legalLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/acceptable-use", label: "Acceptable use" },
  { href: "/contact", label: "Contact" }
];

export function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const auth = useAuth();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div>
          <p className="sidebar-kicker">ResellerOS MVP</p>
          <h1>Mollie</h1>
          <p className="sidebar-copy">Buy smarter. List faster. Keep every automation visible.</p>
        </div>

        <nav className="nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link className={`nav-item ${active ? "active" : ""}`} href={item.href} key={item.href}>
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="workspace-chip">
          <strong>{auth.workspace?.name ?? "No workspace"}</strong>
          <span>{auth.user?.email}</span>
        </div>

        <div className="sidebar-legal">
          {legalLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </div>
      </aside>

      <main className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">Operator Console</p>
            <h2>{title}</h2>
          </div>
          <Button kind="ghost" onClick={auth.logout}>
            Sign out
          </Button>
        </header>
        {children}
      </main>
    </div>
  );
}
