"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useRef, useState, useTransition } from "react";

import type { AutomationVendor, OperatorHint, VendorConnectAttempt } from "@reselleros/types";
import { Button, Card, StatusPill } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { AutomationVendorConnectModal } from "../../components/automation-vendor-connect-modal";
import { OperatorHintCard } from "../../components/operator-hint-card";
import { ProtectedView } from "../../components/protected-view";
import { useAuth } from "../../components/auth-provider";
import { useAuthedResource } from "../../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const automationVendorLabels: Record<AutomationVendor, string> = {
  DEPOP: "Depop",
  POSHMARK: "Poshmark",
  WHATNOT: "Whatnot"
};

const finalAttemptStates = new Set(["CONNECTED", "FAILED", "EXPIRED"]);

function renderConnectorDescriptor(account: {
  connectorDescriptor?: {
    executionMode: string;
    fallbackMode: string;
    riskLevel: string;
    rateLimitStrategy: string;
    supportedCapabilities: Array<{
      capability: string;
      support: string;
      detail: string;
    }>;
    supportedFeatureFamilies: Array<{
      family: string;
      support: string;
      detail: string;
    }>;
  } | null;
}) {
  const descriptor = account.connectorDescriptor;

  if (!descriptor) {
    return null;
  }

  const visibleCapabilities = descriptor.supportedCapabilities.filter((entry) => entry.support !== "UNSUPPORTED");
  const visibleFamilies = descriptor.supportedFeatureFamilies.filter((entry) => entry.support !== "UNSUPPORTED");

  return (
    <div className="stack" style={{ marginTop: "0.75rem" }}>
      <div className="muted">
        Execution mode: {descriptor.executionMode} | Fallback: {descriptor.fallbackMode} | Risk: {descriptor.riskLevel} |
        Rate limit: {descriptor.rateLimitStrategy}
      </div>
      <div className="stack" style={{ gap: "0.45rem" }}>
        <div className="muted">Shared capabilities</div>
        <div className="inline-actions">
          {visibleCapabilities.map((entry) => (
            <span className="execution-inline-code" key={`${entry.capability}-${entry.support}`} title={entry.detail}>
              {entry.capability} · {entry.support}
            </span>
          ))}
        </div>
      </div>
      {visibleFamilies.length > 0 ? (
        <div className="stack" style={{ gap: "0.45rem" }}>
          <div className="muted">Marketplace-native feature families</div>
          <div className="inline-actions">
            {visibleFamilies.map((entry) => (
              <span className="execution-inline-code" key={`${entry.family}-${entry.support}`} title={entry.detail}>
                {entry.family} · {entry.support}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderOperatorHint(account: {
  readiness?: {
    hint?: OperatorHint | null;
  } | null;
}) {
  return <OperatorHintCard hint={account.readiness?.hint} />;
}

function MarketplacesPageContent() {
  const auth = useAuth();
  const searchParams = useSearchParams();
  const { data, refresh, error } = useAuthedResource<{
    accounts: Array<{
      id: string;
      platform: string;
      displayName: string;
      status: string;
      secretRef: string;
      credentialType: string;
      validationStatus: string;
      ebayState?: string | null;
      publishMode?: string | null;
      externalAccountId: string | null;
      credentialMetadata?: {
        publishMode?: string;
        username?: string;
        accountHandle?: string;
        ebayLiveDefaults?: {
          merchantLocationKey?: string;
          paymentPolicyId?: string;
          returnPolicyId?: string;
          fulfillmentPolicyId?: string;
          marketplaceId?: string;
          currency?: string;
        };
      } | null;
      lastValidatedAt?: string | null;
      lastErrorMessage?: string | null;
      readiness?: {
        state: string;
        status: string;
        publishMode: string;
        summary: string;
        detail: string;
        hint?: OperatorHint | null;
      } | null;
      connectorDescriptor?: {
        executionMode: string;
        fallbackMode: string;
        riskLevel: string;
        rateLimitStrategy: string;
        supportedCapabilities: Array<{
          capability: string;
          support: string;
          detail: string;
        }>;
        supportedFeatureFamilies: Array<{
          family: string;
          support: string;
          detail: string;
        }>;
      } | null;
    }>;
  }>("/api/marketplace-accounts", auth.token);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeAutomationVendor, setActiveAutomationVendor] = useState<AutomationVendor | null>(null);
  const [connectDisplayName, setConnectDisplayName] = useState("");
  const [connectAttempt, setConnectAttempt] = useState<VendorConnectAttempt | null>(null);
  const [challengeCode, setChallengeCode] = useState("");
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [desktopSupported, setDesktopSupported] = useState(true);
  const popupRef = useRef<Window | null>(null);
  const oauthStatus = searchParams.get("ebay_oauth");
  const oauthMessage = searchParams.get("message");
  const oauthCode = searchParams.get("code");
  const oauthAccountId = searchParams.get("accountId");
  const accounts = data?.accounts ?? [];

  const activeAutomationAccounts = useMemo(
    () => ({
      DEPOP: accounts.filter((account) => account.platform === "DEPOP"),
      POSHMARK: accounts.filter((account) => account.platform === "POSHMARK"),
      WHATNOT: accounts.filter((account) => account.platform === "WHATNOT")
    }),
    [accounts]
  );

  useEffect(() => {
    if (typeof navigator === "undefined") {
      return;
    }

    setDesktopSupported(!/iphone|ipad|android|mobile/i.test(navigator.userAgent));
  }, []);

  useEffect(() => {
    if (oauthStatus === "connected") {
      void refresh();
    }
  }, [oauthStatus, refresh]);

  useEffect(() => {
    if (!connectAttempt || finalAttemptStates.has(connectAttempt.state)) {
      return;
    }

    const interval = window.setInterval(async () => {
      if (!activeAutomationVendor) {
        return;
      }

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/marketplace-accounts/${activeAutomationVendor}/connect/${connectAttempt.id}`,
          {
            headers: {
              Authorization: `Bearer ${auth.token}`
            },
            cache: "no-store"
          }
        );
        const payload = (await response.json()) as { error?: string; attempt?: VendorConnectAttempt };

        if (!response.ok || !payload.attempt) {
          throw new Error(payload.error ?? "Could not refresh vendor sign-in status.");
        }

        setConnectAttempt(payload.attempt);

        if (payload.attempt.state === "CONNECTED") {
          setSubmitError(null);
          await refresh();
        }
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not refresh vendor sign-in status.");
      }
    }, 1500);

    return () => window.clearInterval(interval);
  }, [activeAutomationVendor, auth.token, connectAttempt, refresh]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data?.type !== "reselleros-vendor-connect") {
        return;
      }

      if (!connectAttempt || event.data.attemptId !== connectAttempt.id || !activeAutomationVendor) {
        return;
      }

      void (async () => {
        try {
          const response = await fetch(
            `${API_BASE_URL}/api/marketplace-accounts/${activeAutomationVendor}/connect/${connectAttempt.id}`,
            {
              headers: {
                Authorization: `Bearer ${auth.token}`
              },
              cache: "no-store"
            }
          );
          const payload = (await response.json()) as { attempt?: VendorConnectAttempt };
          if (response.ok && payload.attempt) {
            setConnectAttempt(payload.attempt);
            if (payload.attempt.state === "CONNECTED") {
              await refresh();
            }
          }
        } catch {
          // polling already handles errors
        }
      })();
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [activeAutomationVendor, auth.token, connectAttempt, refresh]);

  async function fetchAttempt(vendor: AutomationVendor, attemptId: string) {
    const response = await fetch(`${API_BASE_URL}/api/marketplace-accounts/${vendor}/connect/${attemptId}`, {
      headers: {
        Authorization: `Bearer ${auth.token}`
      },
      cache: "no-store"
    });
    const payload = (await response.json()) as { error?: string; attempt?: VendorConnectAttempt };

    if (!response.ok || !payload.attempt) {
      throw new Error(payload.error ?? "Could not load vendor sign-in attempt.");
    }

    setConnectAttempt(payload.attempt);

    if (payload.attempt.state === "CONNECTED") {
      await refresh();
    }
  }

  function launchEbayOAuth(displayName: string) {
    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/marketplace-accounts/ebay/oauth/start`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            displayName
          })
        });
        const payload = (await response.json()) as { authorizeUrl?: string; error?: string };

        if (!response.ok || !payload.authorizeUrl) {
          throw new Error(payload.error ?? "Could not start eBay OAuth");
        }

        window.location.assign(payload.authorizeUrl);
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not start eBay OAuth");
      }
    });
  }

  function startEbayOAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const displayName = String(formData.get("ebayOauthDisplayName") ?? "").trim();

    if (!displayName) {
      setSubmitError("Enter an eBay OAuth display name.");
      return;
    }

    launchEbayOAuth(displayName);
  }

  function connectSimulatedEbay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/marketplace-accounts/ebay/connect`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            displayName: formData.get("ebayDisplayName"),
            secretRef: formData.get("ebaySecretRef")
          })
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not connect simulated eBay account");
        }

        setSubmitError(null);
        form.reset();
        await refresh();
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not connect simulated eBay account");
      }
    });
  }

  function openAutomationConnect(vendor: AutomationVendor, displayName?: string) {
    setActiveAutomationVendor(vendor);
    setConnectDisplayName(displayName ?? `Main ${automationVendorLabels[vendor]} account`);
    setConnectAttempt(null);
    setChallengeCode("");
    setSubmitError(null);
    setConnectModalOpen(true);
  }

  function startAutomationConnect() {
    if (!activeAutomationVendor) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/marketplace-accounts/${activeAutomationVendor}/connect/start`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            displayName: connectDisplayName
          })
        });
        const payload = (await response.json()) as { error?: string; attempt?: VendorConnectAttempt };

        if (!response.ok || !payload.attempt) {
          throw new Error(payload.error ?? "Could not start vendor sign-in.");
        }

        setConnectAttempt(payload.attempt);
        setSubmitError(null);
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not start vendor sign-in.");
      }
    });
  }

  function openHelperPopup() {
    if (!connectAttempt?.helperLaunchUrl) {
      return;
    }

    popupRef.current = window.open(
      connectAttempt.helperLaunchUrl,
      "mollie-vendor-connect",
      "popup=yes,width=720,height=860,noopener=no,noreferrer=no"
    );
  }

  function submitAutomationChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeAutomationVendor || !connectAttempt) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/marketplace-accounts/${activeAutomationVendor}/connect/${connectAttempt.id}/challenge`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${auth.token}`
            },
            body: JSON.stringify({
              code: challengeCode,
              method: "SMS"
            })
          }
        );
        const payload = (await response.json()) as {
          error?: string;
          attempt?: VendorConnectAttempt;
        };

        if (!response.ok || !payload.attempt) {
          throw new Error(payload.error ?? "Could not verify vendor code.");
        }

        setConnectAttempt(payload.attempt);
        setChallengeCode("");
        setSubmitError(null);
        if (payload.attempt.state === "CONNECTED") {
          await refresh();
        }
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not verify vendor code.");
      }
    });
  }

  function refreshAutomationAttempt() {
    if (!activeAutomationVendor || !connectAttempt) {
      return;
    }

    startTransition(async () => {
      try {
        await fetchAttempt(activeAutomationVendor, connectAttempt.id);
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not refresh vendor sign-in status.");
      }
    });
  }

  function closeAutomationConnect() {
    if (!activeAutomationVendor || !connectAttempt || finalAttemptStates.has(connectAttempt.state)) {
      setConnectModalOpen(false);
      setConnectAttempt(null);
      setActiveAutomationVendor(null);
      setChallengeCode("");
      return;
    }

    startTransition(async () => {
      try {
        await fetch(`${API_BASE_URL}/api/marketplace-accounts/${activeAutomationVendor}/connect/${connectAttempt.id}/cancel`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token}`
          }
        });
      } catch {
        // ignore cancel errors on close
      } finally {
        setConnectModalOpen(false);
        setConnectAttempt(null);
        setActiveAutomationVendor(null);
        setChallengeCode("");
      }
    });
  }

  function saveEbayLiveDefaults(accountId: string) {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);

      startTransition(async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/marketplace-accounts/${accountId}/ebay-live-defaults`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${auth.token}`
            },
            body: JSON.stringify({
              merchantLocationKey: formData.get("merchantLocationKey"),
              paymentPolicyId: formData.get("paymentPolicyId"),
              returnPolicyId: formData.get("returnPolicyId"),
              fulfillmentPolicyId: formData.get("fulfillmentPolicyId"),
              marketplaceId: formData.get("marketplaceId"),
              currency: formData.get("currency")
            })
          });
          const payload = (await response.json()) as { error?: string };

          if (!response.ok) {
            throw new Error(payload.error ?? "Could not save eBay live defaults");
          }

          setSubmitError(null);
          await refresh();
        } catch (caughtError) {
          setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not save eBay live defaults");
        }
      });
    };
  }

  function renderAutomationAccounts(platform: AutomationVendor) {
    const platformAccounts = activeAutomationAccounts[platform];

    if (platformAccounts.length === 0) {
      return null;
    }

    return (
      <div className="stack" style={{ marginTop: "1rem" }}>
        {platformAccounts.map((account) => (
          <div className="rs-card" key={account.id}>
            <div className="split">
              <div>
                <strong>{account.displayName}</strong>
                <div className="muted">
                  {account.credentialMetadata?.accountHandle ?? account.externalAccountId ?? account.secretRef}
                </div>
              </div>
              {account.readiness ? <StatusPill status={account.readiness.state} /> : <StatusPill status={account.status} />}
            </div>
            {account.readiness ? (
              <div className="stack" style={{ marginTop: "0.75rem" }}>
                <div className="muted">
                  State: {account.readiness.state} | Active mode: {account.readiness.publishMode}
                </div>
                <div>{account.readiness.summary}</div>
                <div className="muted">{account.readiness.detail}</div>
                {renderOperatorHint(account)}
                {renderConnectorDescriptor(account)}
                <div className="actions">
                  <Button disabled={pending} kind="secondary" onClick={() => openAutomationConnect(platform, account.displayName)}>
                    Reconnect {automationVendorLabels[platform]}
                  </Button>
                </div>
                {account.lastErrorMessage ? <div className="notice">{account.lastErrorMessage}</div> : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  function renderAutomationCard(platform: AutomationVendor) {
    const platformAccounts = activeAutomationAccounts[platform];
    const label = automationVendorLabels[platform];

    return (
      <Card eyebrow={label} title="Automation connector">
        <div className="stack">
          <div className="muted">
            {label} uses a secure helper-assisted sign-in flow. Mollie validates the captured workspace session before the
            account becomes automation-ready.
          </div>
          <div className="actions">
            <Button disabled={pending} onClick={() => openAutomationConnect(platform, platformAccounts[0]?.displayName)}>
              {platformAccounts.length > 0 ? `Reconnect ${label}` : `Connect ${label}`}
            </Button>
          </div>
          {!desktopSupported ? (
            <div className="notice">
              {label} sign-in capture is desktop-first for MVP. Start this flow on desktop so Mollie can validate the session
              reliably.
            </div>
          ) : null}
        </div>
        {renderAutomationAccounts(platform)}
      </Card>
    );
  }

  return (
    <ProtectedView>
      <AppShell title="Marketplace Accounts">
        {error ? <div className="notice">{error}</div> : null}
        {submitError ? <div className="notice">{submitError}</div> : null}
        {oauthStatus === "connected" ? (
          <div className="notice">
            eBay OAuth connected successfully{oauthAccountId ? ` for account ${oauthAccountId}` : ""}.
          </div>
        ) : null}
        {oauthStatus === "error" ? (
          <div className="notice">
            eBay OAuth failed{oauthCode ? ` (${oauthCode})` : ""}: {oauthMessage ?? "Unknown OAuth error"}
          </div>
        ) : null}
        <div className="grid-2">
          <Card eyebrow="eBay" title="Primary connector">
            <form className="stack" onSubmit={startEbayOAuth}>
              <label className="label">
                OAuth display name
                <input className="field" name="ebayOauthDisplayName" placeholder="Main eBay account" required />
              </label>
              <Button type="submit" disabled={pending}>
                Start eBay OAuth
              </Button>
            </form>

            <div className="notice">
              OAuth now validates a real eBay account and stores encrypted tokens. Live eBay publish is still gated, so the
              manual secret-ref connector remains available for simulated pilot publish jobs.
            </div>

            <div className="stack" style={{ marginTop: "1rem" }}>
              {accounts
                .filter((account) => account.platform === "EBAY")
                .map((account) => (
                  <div className="rs-card" key={account.id}>
                    <div className="split">
                      <div>
                        <strong>{account.displayName}</strong>
                        <div className="muted">{account.credentialMetadata?.username ?? account.externalAccountId ?? account.secretRef}</div>
                      </div>
                      {account.ebayState ? (
                        <StatusPill status={account.ebayState} />
                      ) : account.readiness ? (
                        <StatusPill status={account.readiness.status} />
                      ) : null}
                    </div>
                    {account.readiness ? (
                      <div className="stack" style={{ marginTop: "0.75rem" }}>
                        <div className="muted">
                          State: {account.readiness.state} | Active mode: {account.readiness.publishMode}
                        </div>
                        <div>{account.readiness.summary}</div>
                        <div className="muted">{account.readiness.detail}</div>
                        {renderOperatorHint(account)}
                        {renderConnectorDescriptor(account)}
                        {account.lastErrorMessage ? <div className="notice">{account.lastErrorMessage}</div> : null}
                        {account.credentialType === "OAUTH_TOKEN_SET" ? (
                          <>
                            <div className="actions">
                              <Button
                                disabled={pending}
                                kind={account.readiness.status === "BLOCKED" ? "primary" : "secondary"}
                                onClick={() => launchEbayOAuth(account.displayName)}
                              >
                                {account.readiness.status === "BLOCKED" ? "Reconnect eBay OAuth" : "Refresh eBay OAuth"}
                              </Button>
                            </div>
                            <form className="stack" onSubmit={saveEbayLiveDefaults(account.id)}>
                              <label className="label">
                                Merchant location key
                                <input
                                  className="field"
                                  defaultValue={account.credentialMetadata?.ebayLiveDefaults?.merchantLocationKey ?? ""}
                                  name="merchantLocationKey"
                                  placeholder="pilot-warehouse"
                                />
                              </label>
                              <label className="label">
                                Payment policy ID
                                <input
                                  className="field"
                                  defaultValue={account.credentialMetadata?.ebayLiveDefaults?.paymentPolicyId ?? ""}
                                  name="paymentPolicyId"
                                  placeholder="payment-policy"
                                />
                              </label>
                              <label className="label">
                                Return policy ID
                                <input
                                  className="field"
                                  defaultValue={account.credentialMetadata?.ebayLiveDefaults?.returnPolicyId ?? ""}
                                  name="returnPolicyId"
                                  placeholder="return-policy"
                                />
                              </label>
                              <label className="label">
                                Fulfillment policy ID
                                <input
                                  className="field"
                                  defaultValue={account.credentialMetadata?.ebayLiveDefaults?.fulfillmentPolicyId ?? ""}
                                  name="fulfillmentPolicyId"
                                  placeholder="fulfillment-policy"
                                />
                              </label>
                              <label className="label">
                                Marketplace ID
                                <input
                                  className="field"
                                  defaultValue={account.credentialMetadata?.ebayLiveDefaults?.marketplaceId ?? ""}
                                  name="marketplaceId"
                                  placeholder="EBAY_US"
                                />
                              </label>
                              <label className="label">
                                Currency
                                <input
                                  className="field"
                                  defaultValue={account.credentialMetadata?.ebayLiveDefaults?.currency ?? ""}
                                  name="currency"
                                  placeholder="USD"
                                />
                              </label>
                              <div className="muted">
                                These defaults are stored on the eBay account and used for live publish before env fallbacks.
                              </div>
                              <div className="actions">
                                <Button disabled={pending} kind="secondary" type="submit">
                                  Save live defaults
                                </Button>
                              </div>
                            </form>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
            </div>

            <form className="stack" onSubmit={connectSimulatedEbay}>
              <label className="label">
                Manual display name
                <input className="field" name="ebayDisplayName" placeholder="Simulated eBay account" required />
              </label>
              <label className="label">
                Manual secret reference
                <input className="field" name="ebaySecretRef" placeholder="secret://ebay/main" required />
              </label>
              <Button type="submit" disabled={pending}>
                Connect simulated eBay
              </Button>
            </form>
          </Card>

          {renderAutomationCard("DEPOP")}
          {renderAutomationCard("POSHMARK")}
          {renderAutomationCard("WHATNOT")}
        </div>

        <Card eyebrow="Connections" title="Connected marketplace accounts">
          <table className="table">
            <thead>
              <tr>
                <th>Platform</th>
                <th>Display name</th>
                <th>Status</th>
                <th>Auth</th>
                <th>Validation</th>
                <th>Readiness</th>
                <th>Account</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>{account.platform}</td>
                  <td>{account.displayName}</td>
                  <td>
                    <StatusPill status={account.status} />
                  </td>
                  <td>{account.credentialType}</td>
                  <td>{account.validationStatus}</td>
                  <td>
                    {account.readiness ? (
                      <div>
                        <StatusPill status={account.readiness.state} />
                        <div className="muted" style={{ marginTop: "0.35rem" }}>
                          {account.readiness.summary} ({account.readiness.publishMode})
                        </div>
                      </div>
                    ) : (
                      <span className="muted">n/a</span>
                    )}
                  </td>
                  <td>
                    <div>{account.credentialMetadata?.username ?? account.credentialMetadata?.accountHandle ?? account.externalAccountId ?? account.secretRef}</div>
                    {account.lastValidatedAt ? (
                      <div className="muted">Last validated: {new Date(account.lastValidatedAt).toLocaleString()}</div>
                    ) : null}
                    {account.lastErrorMessage ? <div className="muted">{account.lastErrorMessage}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <AutomationVendorConnectModal
          attempt={connectAttempt}
          challengeCode={challengeCode}
          desktopSupported={desktopSupported}
          displayName={connectDisplayName}
          error={submitError}
          onChallengeCodeChange={setChallengeCode}
          onClose={closeAutomationConnect}
          onDisplayNameChange={setConnectDisplayName}
          onOpenHelper={openHelperPopup}
          onRetry={refreshAutomationAttempt}
          onStart={startAutomationConnect}
          onSubmitChallenge={submitAutomationChallenge}
          open={connectModalOpen}
          pending={pending}
          vendor={activeAutomationVendor}
        />
      </AppShell>
    </ProtectedView>
  );
}

export default function MarketplacesPage() {
  return (
    <Suspense
      fallback={
        <ProtectedView>
          <AppShell title="Marketplace Accounts">
            <div className="center-state">Loading marketplace accounts...</div>
          </AppShell>
        </ProtectedView>
      }
    >
      <MarketplacesPageContent />
    </Suspense>
  );
}
