"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  Download,
  Factory,
  Plus,
  ScanBarcode,
  Settings,
  ShoppingBag,
  Store
} from "lucide-react";

import { Button } from "@reselleros/ui";

import { useAuth } from "./auth-provider";

const utilityNavItems = [
  { href: "/marketplaces", label: "Marketplaces", icon: Store },
  { href: "/imports", label: "Imports", icon: Download },
  { href: "/workspace", label: "Workspace", icon: Factory },
  { href: "/settings", label: "Settings", icon: Settings }
] as const;

const primaryNavItems = [
  { href: "/inventory", label: "Inventory", icon: ShoppingBag }
] as const;

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`) || pathname.startsWith(`${href}?`);
}

export function AppShell({
  title,
  children,
  chrome = "standard"
}: {
  title: string;
  children: React.ReactNode;
  chrome?: "standard" | "immersive";
}) {
  const pathname = usePathname();
  const auth = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!settingsMenuRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div className={`app-shell${chrome === "immersive" ? " app-shell-immersive" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="app-topbar">
        <div className="app-brand-block">
          <Link className="app-brand-lockup" href="/inventory">
            <span aria-hidden="true" className="app-brand-mark" />
            <div>
              <p className="sidebar-kicker">Resale workflow</p>
              <h1>Mollie</h1>
            </div>
          </Link>
          <div className="app-topbar-meta">
            <span className="app-topbar-context">{title}</span>
            <span>{auth.workspace?.name ?? "No workspace"}</span>
          </div>
        </div>

        <div className="app-topbar-actions">
          <nav className="app-header-shortcuts" aria-label="Primary">
            {primaryNavItems.map((item) => {
              const Icon = item.icon;
              const active = isActivePath(pathname, item.href);

              return (
                <Link className={`app-utility-link${active ? " active" : ""}`} href={item.href} key={item.href}>
                  <Icon size={16} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="app-header-shortcuts">
            <Link href="/inventory?scan=barcode">
              <Button kind="secondary" type="button">
                <ScanBarcode size={16} /> Scan
              </Button>
            </Link>
            <Link href="/inventory/create">
              <Button type="button">
                <Plus size={16} /> Create
              </Button>
            </Link>
            <Link href="/imports">
              <Button kind="secondary" type="button">
                <Download size={16} /> Import
              </Button>
            </Link>
          </div>
          <div className="app-settings-menu" ref={settingsMenuRef}>
            <button
              aria-expanded={settingsOpen}
              aria-haspopup="menu"
              className={`app-utility-link app-settings-toggle${settingsOpen ? " active" : ""}`}
              onClick={() => setSettingsOpen((current) => !current)}
              type="button"
            >
              <Settings size={16} />
              <span>Settings</span>
              <ChevronDown className={`app-settings-chevron${settingsOpen ? " open" : ""}`} size={16} />
            </button>

            {settingsOpen ? (
              <div className="app-settings-dropdown" role="menu">
                <nav className="app-settings-links" aria-label="Settings navigation">
                  {utilityNavItems.map((item) => {
                    const Icon = item.icon;
                    const active = pathname.startsWith(item.href);
                    return (
                      <Link
                        className={`app-settings-link${active ? " active" : ""}`}
                        href={item.href}
                        key={item.href}
                        onClick={() => setSettingsOpen(false)}
                        role="menuitem"
                      >
                        <Icon size={16} />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </nav>
                <div className="app-settings-footer">
                  <Button
                    className="app-settings-signout"
                    kind="ghost"
                    onClick={() => {
                      setSettingsOpen(false);
                      auth.logout();
                    }}
                    type="button"
                  >
                    Sign out
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="app-main" id="main-content">
        {children}
      </main>
    </div>
  );
}
