"use client";

import type { FormEvent } from "react";

import type { AutomationVendor, VendorConnectAttempt } from "@reselleros/types";
import { Button } from "@reselleros/ui";

import { OperatorHintCard } from "./operator-hint-card";

const vendorLabels: Record<AutomationVendor, string> = {
  DEPOP: "Depop",
  POSHMARK: "Poshmark",
  WHATNOT: "Whatnot"
};

function renderPromptList(attempt: VendorConnectAttempt | null) {
  if (!attempt || attempt.prompts.length === 0) {
    return null;
  }

  return (
    <div className="stack" style={{ gap: "0.65rem" }}>
      <div className="muted">Current step</div>
      {attempt.prompts.map((prompt) => (
        <div className="connect-prompt-card" key={`${prompt.kind}-${prompt.label}`}>
          <div className="split">
            <strong>{prompt.label}</strong>
            <span className="execution-inline-code">{prompt.kind}</span>
          </div>
          <div className="muted">{prompt.detail}</div>
        </div>
      ))}
    </div>
  );
}

export function AutomationVendorConnectModal(props: {
  open: boolean;
  vendor: AutomationVendor | null;
  displayName: string;
  challengeCode: string;
  attempt: VendorConnectAttempt | null;
  pending: boolean;
  error: string | null;
  desktopSupported: boolean;
  onDisplayNameChange: (value: string) => void;
  onChallengeCodeChange: (value: string) => void;
  onClose: () => void;
  onStart: () => void;
  onOpenHelper: () => void;
  onSubmitChallenge: (event: FormEvent<HTMLFormElement>) => void;
  onRetry: () => void;
}) {
  if (!props.open || !props.vendor) {
    return null;
  }

  const label = vendorLabels[props.vendor];
  const attemptState = props.attempt?.state ?? "PENDING";

  return (
    <div className="handoff-modal-backdrop" role="presentation" onClick={props.onClose}>
      <div
        aria-labelledby="automation-vendor-connect-title"
        aria-modal="true"
        className="handoff-modal connect-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="handoff-modal-header">
          <div>
            <p className="eyebrow">Automation vendor connect</p>
            <h3 id="automation-vendor-connect-title">Connect {label}</h3>
          </div>
          <Button kind="ghost" onClick={props.onClose}>
            Close
          </Button>
        </div>

        {!props.desktopSupported ? (
          <div className="notice">
            Finish this connection on desktop. The secure sign-in bridge for {label} is desktop-first for MVP and may not
            capture a reliable vendor session on mobile browsers.
          </div>
        ) : null}

        {props.error ? <div className="notice">{props.error}</div> : null}
        {props.attempt?.hint ? <OperatorHintCard hint={props.attempt.hint} /> : null}

        {!props.attempt ? (
          <div className="stack">
            <p className="handoff-copy">
              Mollie will walk you through a secure {label} sign-in bridge, capture a workspace session artifact, and only
              mark the account connected after validation succeeds.
            </p>
            <label className="label">
              Account label in Mollie
              <input
                className="field"
                disabled={props.pending || !props.desktopSupported}
                placeholder={`Main ${label} account`}
                value={props.displayName}
                onChange={(event) => props.onDisplayNameChange(event.target.value)}
              />
            </label>
            <div className="actions">
              <Button disabled={props.pending || !props.desktopSupported} onClick={props.onStart}>
                {props.pending ? "Starting..." : `Start secure ${label} sign-in`}
              </Button>
            </div>
          </div>
        ) : (
          <div className="stack">
            <div className="connect-state-strip">
              <span className="execution-inline-code">{attemptState}</span>
              <span className="muted">Expires {new Date(props.attempt.expiresAt).toLocaleTimeString()}</span>
            </div>

            {renderPromptList(props.attempt)}

            {attemptState === "AWAITING_LOGIN" || attemptState === "CAPTURING_SESSION" ? (
              <div className="stack">
                <div className="muted">
                  Open the secure sign-in bridge in a popup, finish the vendor login there, and then return here if a code
                  challenge appears.
                </div>
                <div className="actions">
                  <Button disabled={props.pending} onClick={props.onOpenHelper}>
                    Open secure sign-in
                  </Button>
                  <Button disabled={props.pending} kind="secondary" onClick={props.onRetry}>
                    Refresh status
                  </Button>
                </div>
              </div>
            ) : null}

            {attemptState === "AWAITING_2FA" ? (
              <form className="stack" onSubmit={props.onSubmitChallenge}>
                <label className="label">
                  Verification code
                  <input
                    className="field"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="123456"
                    value={props.challengeCode}
                    onChange={(event) => props.onChallengeCodeChange(event.target.value)}
                  />
                </label>
                <div className="actions">
                  <Button disabled={props.pending} type="submit">
                    {props.pending ? "Verifying..." : "Verify and connect"}
                  </Button>
                </div>
              </form>
            ) : null}

            {attemptState === "VALIDATING" ? (
              <div className="notice success">
                Mollie captured the {label} session and is validating the account before it becomes automation-ready.
              </div>
            ) : null}

            {attemptState === "CONNECTED" ? (
              <div className="notice success">
                {label} is connected. This account is now stored as a workspace-scoped automation session.
              </div>
            ) : null}

            {attemptState === "FAILED" || attemptState === "EXPIRED" ? (
              <div className="actions">
                <Button disabled={props.pending || !props.desktopSupported} onClick={props.onStart}>
                  Restart connect flow
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
