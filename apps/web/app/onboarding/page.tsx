"use client";

import { FormEvent, useState, useTransition } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { Button, Card } from "@reselleros/ui";

import { ProtectedView } from "../../components/protected-view";
import { getPostLoginPath } from "../../components/auth-flow";
import { useAuth } from "../../components/auth-provider";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function OnboardingPage() {
  const auth = useAuth();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<{
    email: string;
    expiresAt: string;
    devCode: string | null;
    deliveryMethod: "email" | "inline";
  } | null>(null);

  useEffect(() => {
    if (!auth.hydrated || !auth.token) {
      return;
    }

    router.replace(getPostLoginPath(Boolean(auth.workspace)));
  }, [auth.hydrated, auth.token, auth.workspace, router]);

  async function handleRequestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/request-code`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: String(formData.get("email") ?? "").trim(),
            name: String(formData.get("name") ?? "").trim()
          })
        });
        const payload = (await response.json()) as {
          email: string;
          expiresAt: string;
          devCode: string | null;
          deliveryMethod: "email" | "inline";
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not request login code");
        }

        setChallenge({
          email: payload.email,
          expiresAt: payload.expiresAt,
          devCode: payload.devCode,
          deliveryMethod: payload.deliveryMethod
        });
        setError(null);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Could not request login code");
      }
    });
  }

  async function handleVerifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const code = String(formData.get("code") ?? "").trim();

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/verify-code`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: challenge?.email,
            code
          })
        });
        const payload = (await response.json()) as {
          token: string;
          user: { id: string; email: string };
          workspace: { id: string; name: string; plan: string; billingCustomerId: string | null } | null;
          workspaces?: Array<{ id: string; name: string; plan: string; billingCustomerId: string | null }>;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not verify login code");
        }

        auth.login(payload);
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : "Could not verify login code";

        if (/invalid login code/i.test(message) || /no active login code/i.test(message)) {
          setError("That code is no longer valid. Use the most recent email code or start over to request a fresh one.");
          return;
        }

        setError(message);
      }
    });
  }

  return (
    <ProtectedView requireWorkspace={false}>
      <div className="center-state" style={{ padding: "2rem" }}>
        <div className="grid-2" style={{ maxWidth: 1100, width: "100%" }}>
          <Card eyebrow="MVP Promise" title="Buy smarter, list faster, track profit automatically.">
            <p className="muted">
              This onboarding flow is intentionally lean for pilot users. Request a login code, verify it, create one
              workspace, then connect marketplace accounts and start importing lots.
            </p>
            <div className="stack muted">
              <span>Mac.bid manual URL ingestion</span>
              <span>AI valuation and listing generation</span>
              <span>Queued publish actions with execution logs</span>
            </div>
          </Card>

          <Card eyebrow="Access" title="Create your operator session">
            {!challenge ? (
              <form className="stack" onSubmit={handleRequestCode}>
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
                  {pending ? "Requesting code..." : "Send login code"}
                </Button>
              </form>
            ) : (
              <form className="stack" onSubmit={handleVerifyCode}>
                <div className="notice">
                  {challenge.deliveryMethod === "email" ? "Login code emailed to " : "Login code issued for "}{" "}
                  <strong>{challenge.email}</strong>. It expires at{" "}
                  {new Date(challenge.expiresAt).toLocaleTimeString()}.
                </div>
                {challenge.deliveryMethod === "email" ? (
                  <div className="notice">Check your inbox and spam folder for the 6-digit code. Only the most recent email code will work.</div>
                ) : null}
                {challenge.devCode ? (
                  <div className="notice">
                    Development code: <strong>{challenge.devCode}</strong>
                  </div>
                ) : null}
                <label className="label">
                  6-digit code
                  <input className="field" inputMode="numeric" maxLength={6} name="code" placeholder="123456" required />
                </label>
                {error ? <div className="notice">{error}</div> : null}
                <div className="actions">
                  <Button type="submit" disabled={pending}>
                    {pending ? "Verifying..." : "Verify and continue"}
                  </Button>
                  <Button kind="ghost" type="button" onClick={() => setChallenge(null)}>
                    Start over
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </div>
      </div>
    </ProtectedView>
  );
}
