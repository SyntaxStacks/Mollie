"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useMemo, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const vendorConfig = {
  depop: {
    label: "Depop",
    loginUrl: "https://www.depop.com/login/"
  },
  poshmark: {
    label: "Poshmark",
    loginUrl: "https://poshmark.com/login"
  },
  whatnot: {
    label: "Whatnot",
    loginUrl: "https://www.whatnot.com/login"
  }
} as const;

function HelperContent() {
  const searchParams = useSearchParams();
  const vendor = searchParams.get("vendor") as keyof typeof vendorConfig | null;
  const attemptId = searchParams.get("attemptId");
  const helperNonce = searchParams.get("helperNonce");
  const config = vendor ? vendorConfig[vendor] : null;
  const [accountHandle, setAccountHandle] = useState("");
  const [externalAccountId, setExternalAccountId] = useState("");
  const [sessionLabel, setSessionLabel] = useState("");
  const [challengeRequired, setChallengeRequired] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const token = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }

    return window.localStorage.getItem("reselleros.token");
  }, []);

  const helperCommand = useMemo(() => {
    if (!config || !attemptId || !helperNonce || !token) {
      return null;
    }

    return [
      "pnpm --filter @reselleros/automation-helper connect --",
      `--vendor ${vendor?.toUpperCase()}`,
      `--attempt-id ${attemptId}`,
      `--helper-nonce ${helperNonce}`,
      `--token ${token}`,
      `--api-base-url ${API_BASE_URL}`,
      `--login-url ${config.loginUrl}`,
      `--account-handle <vendor-handle>`,
      "--session-label \"Main account\""
    ].join(" ");
  }, [attemptId, config, helperNonce, token, vendor]);

  async function copyHelperCommand() {
    if (!helperCommand) {
      return;
    }

    try {
      await navigator.clipboard.writeText(helperCommand);
      setCopyStatus("Helper command copied");
      window.setTimeout(() => setCopyStatus(null), 2500);
    } catch {
      setCopyStatus("Could not copy helper command");
      window.setTimeout(() => setCopyStatus(null), 2500);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!config || !attemptId || !helperNonce || !token) {
      setError("Mollie could not find the secure sign-in context for this popup.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/marketplace-accounts/${vendor?.toUpperCase()}/connect/${attemptId}/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          helperNonce,
          accountHandle,
          externalAccountId: externalAccountId || null,
          sessionLabel: sessionLabel || null,
          captureMode: "WEB_POPUP_HELPER",
          challengeRequired
        })
      });
      const payload = (await response.json().catch(() => ({ error: "Could not complete secure sign-in." }))) as {
        error?: string;
        attempt?: { state?: string };
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not complete secure sign-in.");
      }

      const nextState = payload.attempt?.state ?? "UNKNOWN";
      const nextStatus =
        nextState === "AWAITING_2FA"
          ? `Return to Mollie and enter the ${config.label} verification code.`
          : nextState === "CONNECTED"
            ? `${config.label} is connected. You can close this window.`
            : `${config.label} sign-in moved to ${nextState}.`;

      setStatus(nextStatus);

      window.opener?.postMessage(
        {
          type: "reselleros-vendor-connect",
          attemptId,
          state: nextState
        },
        window.location.origin
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not complete secure sign-in.");
    } finally {
      setPending(false);
    }
  }

  if (!config || !attemptId || !helperNonce) {
    return (
      <main className="public-doc-page">
        <section className="public-doc-card">
          <h1>Secure sign-in link is incomplete.</h1>
          <p className="public-doc-summary">Go back to Marketplace Accounts and restart the connect flow.</p>
        </section>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="public-doc-page">
        <section className="public-doc-card">
          <h1>Finish this on the same signed-in device.</h1>
          <p className="public-doc-summary">
            Mollie could not find your operator session in this popup. Reopen the secure sign-in flow from Marketplace Accounts.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="public-doc-page">
      <section className="public-doc-hero">
        <div className="public-doc-brand">
          <p className="eyebrow">Secure sign-in bridge</p>
          <h1>Connect {config.label}</h1>
          <p className="public-doc-summary">
            Open the vendor login page, finish sign-in, then confirm the account details here so Mollie can validate and store the
            workspace session artifact.
          </p>
        </div>
        <div className="public-doc-actions">
          <a className="public-doc-link" href={config.loginUrl} rel="noreferrer" target="_blank">
            Open {config.label} sign-in
          </a>
          <Link className="public-doc-link" href="/marketplaces">
            Back to Mollie
          </Link>
        </div>
      </section>

      <section className="public-doc-card">
        {error ? <div className="notice">{error}</div> : null}
        {status ? <div className="notice success">{status}</div> : null}

        <form className="stack" onSubmit={submit}>
          <label className="label">
            Vendor account handle
            <input
              className="field"
              placeholder={`Your ${config.label} username or shop handle`}
              required
              value={accountHandle}
              onChange={(event) => setAccountHandle(event.target.value)}
            />
          </label>
          <label className="label">
            External account ID
            <input
              className="field"
              placeholder="Optional stable vendor ID"
              value={externalAccountId}
              onChange={(event) => setExternalAccountId(event.target.value)}
            />
          </label>
          <label className="label">
            Session label in Mollie
            <input
              className="field"
              placeholder={`Main ${config.label} account`}
              value={sessionLabel}
              onChange={(event) => setSessionLabel(event.target.value)}
            />
          </label>
          <label className="checkbox-row">
            <input checked={challengeRequired} type="checkbox" onChange={(event) => setChallengeRequired(event.target.checked)} />
            The vendor asked for a verification code after sign-in.
          </label>
          <div className="actions">
            <button className="public-doc-link" disabled={pending} type="submit">
              {pending ? "Capturing session..." : "I finished vendor sign-in"}
            </button>
          </div>
        </form>
      </section>

      {helperCommand ? (
        <section className="public-doc-card">
          <h2>Optional local helper</h2>
          <p className="public-doc-summary">
            If you run the local desktop helper, it can capture browser storage state and post it back to Mollie through the same connect attempt.
          </p>
          <label className="label">
            Helper command
            <textarea className="field" readOnly rows={5} value={helperCommand} />
          </label>
          <div className="actions">
            <button className="public-doc-link" onClick={copyHelperCommand} type="button">
              Copy helper command
            </button>
          </div>
          {copyStatus ? <div className="notice success">{copyStatus}</div> : null}
        </section>
      ) : null}
    </main>
  );
}

export default function ConnectHelperPage() {
  return (
    <Suspense fallback={<main className="public-doc-page"><section className="public-doc-card">Loading secure sign-in bridge...</section></main>}>
      <HelperContent />
    </Suspense>
  );
}
