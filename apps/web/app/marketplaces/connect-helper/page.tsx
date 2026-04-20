"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import type { AutomationVendor } from "@reselleros/types";

import { AppShell } from "../../../components/app-shell";
import { useAuth } from "../../../components/auth-provider";
import { HostedMarketplaceSigninPage } from "../../../components/hosted-marketplace-signin-modal";
import { ProtectedView } from "../../../components/protected-view";

function ConnectHelperPageContent() {
  const auth = useAuth();
  const searchParams = useSearchParams();
  const vendor = (searchParams.get("vendor") ?? "poshmark").toUpperCase() as AutomationVendor;
  const attemptId = searchParams.get("attemptId") ?? "";

  return (
    <ProtectedView>
      <AppShell title="Hosted Marketplace Sign-In">
        <main className="public-doc-page">
          <HostedMarketplaceSigninPage attemptId={attemptId} token={auth.token} vendor={vendor} />
        </main>
      </AppShell>
    </ProtectedView>
  );
}

export default function ConnectHelperPage() {
  return (
    <Suspense
      fallback={
        <ProtectedView>
          <AppShell title="Hosted Marketplace Sign-In">
            <main className="public-doc-page">
              <div className="center-state">Loading hosted sign-in...</div>
            </main>
          </AppShell>
        </ProtectedView>
      }
    >
      <ConnectHelperPageContent />
    </Suspense>
  );
}
