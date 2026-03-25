"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { evaluateProtectedView } from "./auth-flow";
import { useAuth } from "./auth-provider";

export function ProtectedView({
  children,
  requireWorkspace = true
}: {
  children: React.ReactNode;
  requireWorkspace?: boolean;
}) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const decision = evaluateProtectedView({
    hydrated: auth.hydrated,
    token: auth.token,
    hasWorkspace: Boolean(auth.workspace),
    pathname,
    requireWorkspace
  });

  useEffect(() => {
    if (decision.kind !== "redirect") {
      return;
    }

    router.replace(decision.location);
    window.setTimeout(() => {
      if (window.location.pathname !== decision.location) {
        window.location.replace(decision.location);
      }
    }, 150);
  }, [decision, router]);

  if (decision.kind === "loading" || decision.kind === "redirect") {
    return <div className="center-state">{decision.message}</div>;
  }

  return <>{children}</>;
}
