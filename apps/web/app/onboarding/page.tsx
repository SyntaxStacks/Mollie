"use client";

import { FormEvent, useState, useTransition } from "react";

import { Button, Card } from "@reselleros/ui";

import { ProtectedView } from "../../components/protected-view";
import { useAuth } from "../../components/auth-provider";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function OnboardingPage() {
  const auth = useAuth();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: formData.get("email"),
            name: formData.get("name")
          })
        });
        const payload = (await response.json()) as {
          token: string;
          user: { id: string; email: string };
          workspace: { id: string; name: string; plan: string; billingCustomerId: string | null } | null;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not sign in");
        }

        auth.login(payload);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Could not sign in");
      }
    });
  }

  return (
    <ProtectedView requireWorkspace={false}>
      <div className="center-state" style={{ padding: "2rem" }}>
        <div className="grid-2" style={{ maxWidth: 1100, width: "100%" }}>
          <Card eyebrow="MVP Promise" title="Buy smarter, list faster, track profit automatically.">
            <p className="muted">
              This onboarding flow is intentionally lean for pilot users. Sign in with an email, create one workspace,
              then connect marketplace accounts and start importing lots.
            </p>
            <div className="stack muted">
              <span>Mac.bid manual URL ingestion</span>
              <span>AI valuation and listing generation</span>
              <span>Queued publish actions with execution logs</span>
            </div>
          </Card>

          <Card eyebrow="Access" title="Create your operator session">
            <form className="stack" onSubmit={handleSubmit}>
              <label className="label">
                Name
                <input className="field" name="name" placeholder="Pilot reseller" required />
              </label>
              <label className="label">
                Email
                <input className="field" name="email" placeholder="you@example.com" required type="email" />
              </label>
              {error ? <div className="notice">{error}</div> : null}
              <Button type="submit" disabled={pending}>
                {pending ? "Signing in…" : "Start MVP setup"}
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </ProtectedView>
  );
}
