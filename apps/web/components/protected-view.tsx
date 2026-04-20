"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { evaluateProtectedView } from "./auth-flow";
import { useAuth } from "./auth-provider";

function ProtectedViewContent({
  children,
  requireWorkspace = true
}: {
  children: React.ReactNode;
  requireWorkspace?: boolean;
}) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const decision = evaluateProtectedView({
    hydrated: auth.hydrated,
    token: auth.token,
    hasWorkspace: Boolean(auth.workspace),
    pathname,
    search: searchParams.toString() ? `?${searchParams.toString()}` : "",
    requireWorkspace
  });

  useEffect(() => {
    if (decision.kind !== "redirect") {
      return;
    }

    router.replace(decision.location);
  }, [decision, router]);

  if (decision.kind === "loading" || decision.kind === "redirect") {
    return <div className="center-state">{decision.message}</div>;
  }

  return <>{children}</>;
}

export function ProtectedView(props: { children: React.ReactNode; requireWorkspace?: boolean }) {
  return (
    <Suspense fallback={<div className="center-state">Loading workspace...</div>}>
      <ProtectedViewContent {...props} />
    </Suspense>
  );
}
