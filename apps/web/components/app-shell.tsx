"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ChevronDown,
  Camera,
  Download,
  Factory,
  Settings,
  ShoppingBag,
  Store,
  Tags
} from "lucide-react";

import { Button } from "@reselleros/ui";

import { useAuth } from "./auth-provider";

const primaryNavItems = [
  { href: "/", label: "Scan", icon: Camera, match: (pathname: string) => pathname === "/" || pathname.startsWith("/scan") },
  { href: "/inventory", label: "Inventory", icon: ShoppingBag, match: (pathname: string) => pathname.startsWith("/inventory") },
  { href: "/sell", label: "Sell", icon: Tags, match: (pathname: string) => pathname.startsWith("/sell") || pathname.startsWith("/drafts") },
  { href: "/activity", label: "Activity", icon: Activity, match: (pathname: string) => pathname.startsWith("/activity") || pathname.startsWith("/executions") || pathname.startsWith("/sales") }
] as const;

const utilityNavItems = [
  { href: "/marketplaces", label: "Marketplaces", icon: Store },
  { href: "/imports", label: "Imports", icon: Download },
  { href: "/workspace", label: "Workspace", icon: Factory },
  { href: "/settings", label: "Settings", icon: Settings }
] as const;

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
  const activePrimary = primaryNavItems.find((item) => item.match(pathname))?.href ?? "/";
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
      <header className="app-topbar">
        <div className="app-brand-block">
          <p className="sidebar-kicker">Resale operating system</p>
          <h1>Mollie</h1>
          <div className="app-topbar-meta">
            <span>{title}</span>
            <span>{auth.workspace?.name ?? "No workspace"}</span>
          </div>
        </div>

        <div className="app-topbar-actions">
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

      <nav aria-label="Primary" className="primary-tab-nav">
        {primaryNavItems.map((item) => {
          const Icon = item.icon;
          const active = activePrimary === item.href;
          return (
            <Link className={`primary-tab-link${active ? " active" : ""}`} href={item.href} key={item.href}>
              <Icon size={18} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <main className="app-main">{children}</main>

      <nav aria-label="Primary mobile" className="mobile-tab-bar">
        {primaryNavItems.map((item) => {
          const Icon = item.icon;
          const active = activePrimary === item.href;
          return (
            <Link className={`mobile-tab-link${active ? " active" : ""}`} href={item.href} key={item.href}>
              <Icon size={18} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
