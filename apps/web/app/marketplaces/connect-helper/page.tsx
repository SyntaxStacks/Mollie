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
  const requiresLocalHelper = vendor === "whatnot";
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

  const defaultSessionLabel = useMemo(() => `Main ${config?.label ?? "marketplace"} account`, [config?.label]);

  const helperCommand = useMemo(() => {
    if (!config || !attemptId || !helperNonce || !token) {
      return null;
    }

    const label = (sessionLabel || defaultSessionLabel).replaceAll("\"", "");

    return [
      "pnpm --filter @reselleros/automation-helper connect --",
      `--vendor ${vendor?.toUpperCase()}`,
      `--attempt-id ${attemptId}`,
      `--helper-nonce ${helperNonce}`,
      `--token ${token}`,
      `--api-base-url ${API_BASE_URL}`,
      `--login-url ${config.loginUrl}`,
      `--session-label "${label}"`
    ].join(" ");
  }, [attemptId, config, defaultSessionLabel, helperNonce, sessionLabel, token, vendor]);

  const desktopCompanionUrl = useMemo(() => {
    if (!config || !attemptId || !helperNonce || !token) {
      return null;
    }

    const params = new URLSearchParams({
      vendor: vendor?.toUpperCase() ?? "",
      attemptId,
      helperNonce,
      token,
      apiBaseUrl: API_BASE_URL,
      loginUrl: config.loginUrl,
      sessionLabel: sessionLabel || defaultSessionLabel
    });

    return `mollie-helper://connect?${params.toString()}`;
  }, [attemptId, config, defaultSessionLabel, helperNonce, sessionLabel, token, vendor]);

  async function copyValue(value: string | null, successMessage: string) {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(successMessage);
      window.setTimeout(() => setCopyStatus(null), 2500);
    } catch {
      setCopyStatus("Could not copy helper details");
      window.setTimeout(() => setCopyStatus(null), 2500);
    }
  }

  function launchDesktopCompanion() {
    if (!desktopCompanionUrl) {
      setError("Mollie could not prepare the desktop companion launch.");
      return;
    }

    setError(null);
    setStatus("Trying to launch the Mollie desktop companion. Finish Whatnot and Google sign-in there, then return here once Mollie confirms the account.");
    window.location.href = desktopCompanionUrl;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!config || !attemptId || !helperNonce || !token) {
      setError("Mollie could not find the secure sign-in context for this popup.");
      return;
    }

    if (requiresLocalHelper) {
      setError("Whatnot should be connected through the desktop companion so Mollie can capture the real browser session after Google sign-in.");
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
          {requiresLocalHelper ? (
            <p className="public-doc-summary">
              For Whatnot, use the Mollie desktop companion. The popup bridge is not reliable enough for Google sign-in and does
              not capture the browser storage state Mollie needs.
            </p>
          ) : null}
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

        {requiresLocalHelper ? (
          <div className="stack">
            <h2>Launch the desktop companion for Whatnot</h2>
            <p className="public-doc-summary">
              Whatnot sign-in, especially with Google, should be completed in the Mollie desktop companion. The companion opens
              a controlled browser, captures the signed-in storage state, and posts it back to Mollie for validation.
            </p>
            <label className="label">
              Account label in Mollie
              <input
                className="field"
                placeholder={defaultSessionLabel}
                value={sessionLabel}
                onChange={(event) => setSessionLabel(event.target.value)}
              />
            </label>
            <ol className="public-doc-list">
              <li>Launch the Mollie desktop companion.</li>
              <li>Finish Google and Whatnot sign-in in the companion browser.</li>
              <li>Let Mollie capture and validate the signed-in Whatnot session.</li>
              <li>Return to Marketplace Accounts after Mollie confirms the account.</li>
            </ol>
            <div className="actions">
              <button className="public-doc-link" onClick={launchDesktopCompanion} type="button">
                Launch desktop companion
              </button>
              <button
                className="public-doc-link"
                onClick={() => copyValue(desktopCompanionUrl, "Desktop companion link copied")}
                type="button"
              >
                Copy companion link
              </button>
            </div>
            <div className="notice success">
              If the companion is already installed, this button should hand the sign-in off without any terminal or pasted command.
            </div>
          </div>
        ) : (
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
        )}
      </section>

      {helperCommand ? (
        <section className="public-doc-card">
          <h2>{requiresLocalHelper ? "Advanced fallback" : "Optional local helper"}</h2>
          <p className="public-doc-summary">
            {requiresLocalHelper
              ? "This command path is for internal testing and support. It should not be the normal operator flow."
              : "If you run the local desktop helper, it can capture browser storage state and post it back to Mollie through the same connect attempt."}
          </p>
          <details className="helper-advanced-details">
            <summary>Show internal helper command</summary>
            <div className="stack" style={{ marginTop: "1rem" }}>
              <label className="label">
                Helper command
                <textarea className="field" readOnly rows={5} value={helperCommand} />
              </label>
              <div className="actions">
                <button
                  className="public-doc-link"
                  onClick={() => copyValue(helperCommand, "Helper command copied")}
                  type="button"
                >
                  Copy helper command
                </button>
              </div>
            </div>
          </details>
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
