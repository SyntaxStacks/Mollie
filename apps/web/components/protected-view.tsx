"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

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

  useEffect(() => {
    if (!auth.hydrated) {
      return;
    }

    if (!auth.token) {
      router.replace("/onboarding");
      return;
    }

    if (requireWorkspace && !auth.workspace) {
      router.replace("/workspace");
    }
  }, [auth.hydrated, auth.token, auth.workspace, requireWorkspace, router]);

  if (!auth.hydrated) {
    return <div className="center-state">Loading session…</div>;
  }

  if (!auth.token) {
    return <div className="center-state">Redirecting to onboarding…</div>;
  }

  if (requireWorkspace && !auth.workspace) {
    return <div className="center-state">Redirecting to workspace setup…</div>;
  }

  return <>{children}</>;
}
