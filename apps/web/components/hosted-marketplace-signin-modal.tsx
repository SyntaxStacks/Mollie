"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";

import type { AutomationVendor } from "@reselleros/types";
import { Button } from "@reselleros/ui";

import { useAuthedResource } from "../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type AttemptResponse = {
  attempt: {
    id: string;
    vendor: AutomationVendor;
    displayName: string;
    helperNonce: string;
    state: string;
    prompts: Array<{ kind: string; label: string; detail: string; required: boolean; codeLength?: number | null }>;
    hint?: {
      title: string;
      explanation: string;
      severity: string;
      nextActions: string[];
    } | null;
    lastErrorMessage?: string | null;
  };
  account?: {
    id: string;
    displayName: string;
  } | null;
};

const vendorDefaults = {
  DEPOP: {
    label: "Depop",
    accountHandle: "main-depop-shop",
    loginUrl: "https://www.depop.com/login/"
  },
  POSHMARK: {
    label: "Poshmark",
    accountHandle: "main-poshmark-closet",
    loginUrl: "https://poshmark.com/login"
  },
  WHATNOT: {
    label: "Whatnot",
    accountHandle: "main-whatnot-account",
    loginUrl: "https://www.whatnot.com/login"
  }
} satisfies Record<AutomationVendor, { label: string; accountHandle: string; loginUrl: string }>;

function HostedMarketplaceSigninPanel({
  token,
  vendor,
  attemptId,
  onClose,
  onConnected,
  pageMode = false
}: {
  token: string | null;
  vendor: AutomationVendor;
  attemptId: string;
  onClose?: () => void;
  onConnected?: () => void;
  pageMode?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const resourcePath = attemptId ? `/api/marketplace-accounts/${vendor}/connect/${attemptId}` : "/api/health";
  const attempt = useAuthedResource<AttemptResponse>(resourcePath, token, [vendor, attemptId].filter(Boolean));
  const connectedNotifiedRef = useRef(false);

  const defaults = useMemo(() => vendorDefaults[vendor], [vendor]);
  const titleId = pageMode ? undefined : "hosted-marketplace-signin-title";

  useEffect(() => {
    setError(null);
    setMessage(null);
    connectedNotifiedRef.current = false;
  }, [attemptId, vendor]);

  useEffect(() => {
    if (attempt.data?.attempt.state === "CONNECTED" && !connectedNotifiedRef.current) {
      connectedNotifiedRef.current = true;
      onConnected?.();
    }
  }, [attempt.data?.attempt.state, onConnected]);

  function submitHostedSession() {
    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/marketplace-accounts/${vendor}/connect/${attemptId}/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            helperNonce: attempt.data?.attempt.helperNonce,
            accountHandle: attempt.data?.account?.displayName?.trim() || defaults.accountHandle,
            sessionLabel: attempt.data?.attempt.displayName ?? `Main ${defaults.label} account`,
            captureMode: "WEB_POPUP_HELPER",
            challengeRequired: false,
            cookieCount: 3,
            origin:
              vendor === "POSHMARK"
                ? "https://poshmark.com"
                : vendor === "DEPOP"
                  ? "https://www.depop.com"
                  : "https://www.whatnot.com",
            storageStateJson: {
              origins: [
                {
                  origin:
                    vendor === "POSHMARK"
                      ? "https://poshmark.com"
                      : vendor === "DEPOP"
                        ? "https://www.depop.com"
                        : "https://www.whatnot.com",
                  localStorage: []
                }
              ]
            }
          })
        });
        const payload = (await response.json()) as AttemptResponse & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? `Could not capture ${defaults.label} hosted session.`);
        }

        setError(null);
        setMessage(`${defaults.label} account connected for remote automation.`);
        await attempt.refresh();
      } catch (caughtError) {
        setMessage(null);
        setError(caughtError instanceof Error ? caughtError.message : `Could not capture ${defaults.label} hosted session.`);
      }
    });
  }

  function openMarketplaceLogin() {
    window.open(defaults.loginUrl, "_blank");
  }

  function submitChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/marketplace-accounts/${vendor}/connect/${attemptId}/challenge`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            code: String(formData.get("code") ?? "").trim(),
            method: "SMS"
          })
        });
        const payload = (await response.json()) as AttemptResponse & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? `Could not verify ${defaults.label} challenge.`);
        }

        setError(null);
        setMessage(`${defaults.label} verification submitted.`);
        await attempt.refresh();
      } catch (caughtError) {
        setMessage(null);
        setError(caughtError instanceof Error ? caughtError.message : `Could not verify ${defaults.label} challenge.`);
      }
    });
  }

  return (
    <section className={`public-doc-card hosted-signin-panel${pageMode ? " hosted-signin-panel-page" : ""}`}>
      <div className="handoff-modal-header hosted-signin-header">
        <div>
          <p className="eyebrow">Hosted remote session</p>
          <h3 id={titleId}>{defaults.label} sign-in</h3>
        </div>
        <div className="actions hosted-signin-header-actions">
          <Button disabled={pending || attempt.loading} kind="ghost" onClick={() => void attempt.refresh()} type="button">
            <RefreshCw size={16} /> Refresh
          </Button>
          {onClose ? (
            <Button kind="ghost" onClick={onClose} type="button">
              <X size={16} /> Close
            </Button>
          ) : null}
        </div>
      </div>

      <p className="public-doc-summary">
        Open {defaults.label} in a separate tab, finish marketplace login there, then come back here and ask Mollie to
        recheck the session.
      </p>

      {attempt.error ? <div className="notice">{attempt.error}</div> : null}
      {error ? <div className="notice">{error}</div> : null}
      {message ? <div className="notice success">{message}</div> : null}

      {attempt.data?.attempt.hint ? (
        <div className="hosted-signin-hint">
          <strong>{attempt.data.attempt.hint.title}</strong>
          <p className="muted">{attempt.data.attempt.hint.explanation}</p>
          {attempt.data.attempt.hint.nextActions.length > 0 ? (
            <ul className="hosted-signin-next-actions">
              {attempt.data.attempt.hint.nextActions.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {attempt.loading ? (
        <div className="center-state">Loading sign-in session...</div>
      ) : attempt.data?.attempt.state === "AWAITING_2FA" ? (
        <form className="stack hosted-signin-form" onSubmit={submitChallenge}>
          <label className="label">
            Security code
            <input className="field" name="code" placeholder="123456" required />
          </label>
          <div className="actions">
            <Button disabled={pending} type="submit">
              Verify code
            </Button>
            <Button disabled={pending} kind="secondary" onClick={openMarketplaceLogin} type="button">
              <ExternalLink size={16} /> Open {defaults.label} login
            </Button>
          </div>
        </form>
      ) : attempt.data?.attempt.state === "CONNECTED" ? (
        <div className="stack hosted-signin-success">
          <div className="notice success">
            {attempt.data.account?.displayName ?? defaults.label} is connected and ready for remote automation.
          </div>
          <div className="actions">
            <a className="public-doc-link" href={defaults.loginUrl} rel="noreferrer" target="_blank">
              Open {defaults.label}
            </a>
            {onClose ? (
              <Button kind="secondary" onClick={onClose} type="button">
                Done
              </Button>
            ) : (
              <Link className="public-doc-link" href="/marketplaces">
                Back to marketplaces
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="stack hosted-signin-form">
          <div className="hosted-signin-prompt-grid">
            <div className="connect-prompt-card">
              <span className="eyebrow">Attempt state</span>
              <strong>{attempt.data?.attempt.state ?? "STARTING"}</strong>
            </div>
            <div className="connect-prompt-card">
              <span className="eyebrow">Next step</span>
              <strong>Login in another tab</strong>
            </div>
          </div>

          <div className="hosted-signin-flow-card">
            <strong>1. Open {defaults.label}</strong>
            <p className="muted">Sign in on the marketplace site without leaving Mollie.</p>
            <strong>2. Recheck login</strong>
            <p className="muted">
              After login is complete, Mollie will look for the session and attach it to this workspace.
            </p>
          </div>
          <div className="actions">
            <Button disabled={pending} kind="secondary" onClick={openMarketplaceLogin} type="button">
              <ExternalLink size={16} /> Open {defaults.label} login
            </Button>
            <Button disabled={pending || !attempt.data?.attempt.helperNonce} onClick={submitHostedSession} type="button">
              <RefreshCw size={16} /> Recheck login
            </Button>
            {pageMode ? (
              <Link className="public-doc-link" href="/marketplaces">
                Back to marketplaces
              </Link>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

export function HostedMarketplaceSigninModal({
  token,
  vendor,
  attemptId,
  open,
  onClose,
  onConnected
}: {
  token: string | null;
  vendor: AutomationVendor;
  attemptId: string;
  open: boolean;
  onClose: () => void;
  onConnected?: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="handoff-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        aria-labelledby="hosted-marketplace-signin-title"
        aria-modal="true"
        className="handoff-modal connect-modal hosted-signin-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <HostedMarketplaceSigninPanel attemptId={attemptId} onClose={onClose} onConnected={onConnected} token={token} vendor={vendor} />
      </div>
    </div>
  );
}

export function HostedMarketplaceSigninPage({
  token,
  vendor,
  attemptId
}: {
  token: string | null;
  vendor: AutomationVendor;
  attemptId: string;
}) {
  return <HostedMarketplaceSigninPanel attemptId={attemptId} pageMode token={token} vendor={vendor} />;
}
