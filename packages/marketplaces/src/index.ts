import type {
  AutomationVendor,
  AutomationOperationalState,
  ConnectorCapability,
  ConnectorExecutionMode,
  ConnectorFailureCode,
  ConnectorFallbackMode,
  ConnectorFeatureFamily,
  OperatorHint,
  ConnectorRateLimitStrategy,
  ConnectorRiskLevel,
  ConnectorSupportLevel,
  MarketplaceAccountStatus,
  CredentialValidationStatus,
  MarketplaceCredentialType,
  VendorConnectCaptureMode,
  VendorConnectPrompt,
  VendorConnectState,
  VendorSessionArtifactMetadata,
  VendorValidationResult,
  Platform,
  PublishResult
} from "@reselleros/types";

export type MarketplaceAccountContext = {
  id: string;
  platform: Platform;
  displayName: string;
  secretRef: string;
  status?: MarketplaceAccountStatus;
  credentialType: MarketplaceCredentialType;
  validationStatus: CredentialValidationStatus;
  externalAccountId?: string | null;
  credentialMetadata?: Record<string, unknown> | null;
  credentialPayload?: Record<string, unknown> | null;
};

export type PublishListingInput = {
  inventoryItemId: string;
  sku: string;
  quantity: number;
  title: string;
  description: string;
  price: number;
  images: string[];
  category: string;
  condition: string;
  brand?: string | null;
  attributes: Record<string, unknown>;
  marketplaceAccount: MarketplaceAccountContext;
};

export type ConnectorCapabilitySupport = {
  capability: ConnectorCapability;
  support: ConnectorSupportLevel;
  detail: string;
};

export type ConnectorFeatureFamilySupport = {
  family: ConnectorFeatureFamily;
  support: ConnectorSupportLevel;
  detail: string;
};

export type ConnectorDescriptor = {
  platform: Platform;
  displayName: string;
  executionMode: ConnectorExecutionMode;
  riskLevel: ConnectorRiskLevel;
  fallbackMode: ConnectorFallbackMode;
  rateLimitStrategy: ConnectorRateLimitStrategy;
  supportedCapabilities: ConnectorCapabilitySupport[];
  supportedFeatureFamilies: ConnectorFeatureFamilySupport[];
};

export type AutomationVendorConnectAttemptContext = {
  id: string;
  workspaceId: string;
  platform: AutomationVendor;
  displayName: string;
  state: VendorConnectState;
  helperNonce: string;
  metadata?: Record<string, unknown> | null;
  prompts?: VendorConnectPrompt[] | null;
  expiresAt: string;
};

export type VendorConnectStartResult = {
  state: VendorConnectState;
  prompts: VendorConnectPrompt[];
  hint: OperatorHint;
  helperPath: string;
  expiresInSeconds: number;
  metadata?: Record<string, unknown>;
};

export type VendorConnectSessionCaptureInput = {
  attempt: AutomationVendorConnectAttemptContext;
  accountHandle?: string | null;
  externalAccountId?: string | null;
  sessionLabel?: string | null;
  captureMode: VendorConnectCaptureMode;
  challengeRequired: boolean;
  cookieCount?: number | null;
  origin?: string | null;
  storageStateJson?: Record<string, unknown> | null;
};

export type VendorConnectSessionCaptureResult = {
  state: VendorConnectState;
  prompts: VendorConnectPrompt[];
  hint: OperatorHint;
  metadata?: Record<string, unknown>;
};

export type VendorConnectChallengeInput = {
  attempt: AutomationVendorConnectAttemptContext;
  code: string;
  method: "SMS" | "EMAIL" | "APPROVAL";
};

export type VendorAccountSummary = {
  accountHandle: string;
  externalAccountId?: string | null;
  detail: string;
};

export type AutomationVendorConnectAdapter = {
  platform: AutomationVendor;
  startConnect(input: { displayName: string }): VendorConnectStartResult;
  captureSession(input: VendorConnectSessionCaptureInput): VendorConnectSessionCaptureResult;
  acceptChallenge(input: VendorConnectChallengeInput): {
    state: VendorConnectState;
    prompts: VendorConnectPrompt[];
    hint: OperatorHint;
  };
  validateSession(input: {
    attempt: AutomationVendorConnectAttemptContext;
    accountHandle: string;
    externalAccountId?: string | null;
    captureMode: VendorConnectCaptureMode;
    sessionLabel?: string | null;
    cookieCount?: number | null;
    origin?: string | null;
    storageStateJson?: Record<string, unknown> | null;
  }): VendorValidationResult;
  summarizeAccount(input: {
    accountHandle: string;
    externalAccountId?: string | null;
    sessionLabel?: string | null;
  }): VendorAccountSummary;
};

export type MarketplaceAdapter = {
  platform: Platform;
  descriptor: ConnectorDescriptor;
  connect?(input: { marketplaceAccount: MarketplaceAccountContext }): Promise<{ ok: boolean; detail: string }>;
  validateAuth?(input: { marketplaceAccount: MarketplaceAccountContext }): Promise<{ ok: boolean; detail: string }>;
  refreshAuth?(input: { marketplaceAccount: MarketplaceAccountContext }): Promise<Record<string, unknown> | null>;
  syncAccountState?(input: { marketplaceAccount: MarketplaceAccountContext }): Promise<Record<string, unknown> | null>;
  publishListing(input: PublishListingInput): Promise<PublishResult>;
  reviseListing?(input: PublishListingInput & { externalListingId: string }): Promise<PublishResult>;
  delistListing?(input: { externalListingId: string; marketplaceAccount: MarketplaceAccountContext }): Promise<{ ok: boolean }>;
  relistListing?(input: { externalListingId: string; marketplaceAccount: MarketplaceAccountContext }): Promise<PublishResult>;
  sendOffer?(input: { externalListingId: string; marketplaceAccount: MarketplaceAccountContext; amount: number }): Promise<{ ok: boolean }>;
  runFeatureAction?(
    input: {
      family: ConnectorFeatureFamily;
      action: string;
      marketplaceAccount: MarketplaceAccountContext;
      payload?: Record<string, unknown>;
    }
  ): Promise<Record<string, unknown> | null>;
  reportHealth?(input: { marketplaceAccount: MarketplaceAccountContext }): Promise<{ state: string; detail: string }>;
  emitArtifacts?(input: { marketplaceAccount: MarketplaceAccountContext; context: string }): Promise<string[]>;
  syncListing(input: { externalListingId: string; currentStatus: string }): Promise<{ status: string }>;
  testConnection(input: { marketplaceAccount: MarketplaceAccountContext }): Promise<{ ok: boolean; detail: string }>;
};

function simulatedMarketplacePathsAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_SIMULATED_MARKETPLACE_PATHS === "true";
}

export function buildAutomationConnectHint(input: {
  platformLabel: string;
  platform: AutomationVendor;
  title: string;
  explanation: string;
  severity: OperatorHint["severity"];
  nextActions: string[];
  canContinue: boolean;
  helpText?: string;
}) {
  return buildAutomationHint({
    platformLabel: input.platformLabel,
    platform: input.platform,
    title: input.title,
    explanation: input.explanation,
    severity: input.severity,
    nextActions: input.nextActions,
    canContinue: input.canContinue,
    helpText: input.helpText
  });
}

export function createAutomationVendorConnectAdapter(config: {
  platform: AutomationVendor;
  platformLabel: string;
  loginUrl: string;
  challengeLabel: string;
  challengeDetail: string;
  summaryLabel: string;
}) {
  const helperPath = `/marketplaces/connect-helper?vendor=${config.platform.toLowerCase()}`;
  const summarizeAccount = (input: {
    accountHandle?: string | null;
    externalAccountId?: string | null;
    sessionLabel?: string | null;
  }) => {
    const normalizedHandle = input.accountHandle?.trim() || "";
    const sessionLabel = input.sessionLabel?.trim() || "";
    const accountHandle = sessionLabel || normalizedHandle || config.platformLabel;

    return {
      accountHandle,
    externalAccountId: input.externalAccountId?.trim() || null,
      detail: normalizedHandle ? `${config.summaryLabel} ${normalizedHandle}` : config.summaryLabel
    };
  };

  return {
    platform: config.platform,
    startConnect({ displayName }) {
      return {
        state: "AWAITING_LOGIN",
        prompts: [
          {
            kind: "LOGIN",
            label: `Sign in to ${config.platformLabel}`,
            detail: `Open ${config.platformLabel}, finish sign-in, and return to the secure bridge to capture the session for ${displayName}.`,
            required: true
          }
        ],
        hint: buildAutomationConnectHint({
          platform: config.platform,
          platformLabel: config.platformLabel,
          title: `${config.platformLabel} sign-in is ready to start.`,
          explanation: `Launch the hosted ${config.platformLabel} sign-in session from Mollie, finish login there, and let Mollie capture the remote browser session for automation.`,
          severity: "INFO",
          nextActions: [
            `Launch the hosted ${config.platformLabel} sign-in session from Mollie.`,
            "Finish vendor login and return to Mollie once the session is captured."
          ],
          canContinue: true
        }),
        helperPath,
        expiresInSeconds: 15 * 60,
        metadata: {
          loginUrl: config.loginUrl,
          summaryLabel: config.summaryLabel
        }
      };
    },
    captureSession({
      attempt,
      accountHandle,
      externalAccountId,
      sessionLabel,
      captureMode,
      challengeRequired,
      cookieCount,
      origin,
      storageStateJson
    }) {
      const summary = summarizeAccount({
        accountHandle,
        externalAccountId,
        sessionLabel
      });

      if (challengeRequired) {
        return {
          state: "AWAITING_2FA",
          prompts: [
            {
              kind: "CODE",
              label: config.challengeLabel,
              detail: config.challengeDetail,
              required: true,
              codeLength: 6
            }
          ],
          hint: buildAutomationConnectHint({
            platform: config.platform,
            platformLabel: config.platformLabel,
            title: `${config.platformLabel} needs one more verification step.`,
            explanation: `Mollie captured the ${config.platformLabel} sign-in context for ${summary.accountHandle}, but the vendor still needs a verification code before the session can be validated.`,
            severity: "WARNING",
            nextActions: ["Enter the verification code in Mollie.", "Wait for the account to switch to connected and ready."],
            canContinue: true
          }),
          metadata: {
            pendingSession: {
              accountHandle: summary.accountHandle,
              externalAccountId: summary.externalAccountId ?? null,
              sessionLabel: sessionLabel ?? null,
              captureMode,
              connectAttemptId: attempt.id,
              cookieCount: cookieCount ?? null,
              origin: origin ?? null,
              storageStateJson: storageStateJson ?? null
            } satisfies Partial<VendorSessionArtifactMetadata>
          }
        };
      }

      return {
        state: "VALIDATING",
        prompts: [],
        hint: buildAutomationConnectHint({
          platform: config.platform,
          platformLabel: config.platformLabel,
          title: `${config.platformLabel} sign-in was captured and is being validated.`,
          explanation: `Mollie is checking that ${summary.accountHandle} can be used for automation safely before marking the account connected.`,
          severity: "INFO",
          nextActions: ["Wait for validation to finish.", "Keep this window open until Mollie confirms the account is ready."],
          canContinue: true
        }),
        metadata: {
            pendingSession: {
              accountHandle: summary.accountHandle,
              externalAccountId: summary.externalAccountId ?? null,
              sessionLabel: sessionLabel ?? null,
              captureMode,
              connectAttemptId: attempt.id,
              cookieCount: cookieCount ?? null,
              origin: origin ?? null,
              storageStateJson: storageStateJson ?? null
            } satisfies Partial<VendorSessionArtifactMetadata>
          }
        };
    },
    acceptChallenge({ code }) {
      if (!/^\d{6}$/.test(code) || code === "000000") {
        return {
          state: "FAILED",
          prompts: [
            {
              kind: "CODE",
              label: config.challengeLabel,
              detail: config.challengeDetail,
              required: true,
              codeLength: 6
            }
          ],
          hint: buildAutomationConnectHint({
            platform: config.platform,
            platformLabel: config.platformLabel,
            title: `${config.platformLabel} could not verify that code.`,
            explanation: "The verification code looked invalid or expired, so the vendor session was not marked ready.",
            severity: "ERROR",
            nextActions: ["Request a new vendor verification code.", "Restart the connect flow if the challenge expired."],
            canContinue: false
          })
        };
      }

      return {
        state: "VALIDATING",
        prompts: [],
        hint: buildAutomationConnectHint({
          platform: config.platform,
          platformLabel: config.platformLabel,
          title: `${config.platformLabel} verification was accepted.`,
          explanation: "Mollie is validating the captured session now.",
          severity: "INFO",
          nextActions: ["Wait for the account to switch to connected and ready."],
          canContinue: true
        })
      };
    },
    validateSession({ accountHandle, externalAccountId, captureMode, sessionLabel, attempt }) {
      const normalizedHandle = accountHandle?.trim() || sessionLabel?.trim() || config.platformLabel;

      if (!normalizedHandle || /fail|invalid|blocked/i.test(normalizedHandle)) {
        return {
          validationStatus: "INVALID",
          accountHandle: normalizedHandle || config.platformLabel,
          externalAccountId: externalAccountId ?? null,
          summary: `${config.platformLabel} sign-in could not be validated.`,
          detail: "The captured session did not look safe enough to reuse for automation.",
          operatorHint: buildAutomationConnectHint({
            platform: config.platform,
            platformLabel: config.platformLabel,
            title: `${config.platformLabel} needs another sign-in attempt.`,
            explanation: "Mollie could not validate the captured session. Start the connect flow again and make sure the right account finishes sign-in.",
            severity: "ERROR",
            nextActions: ["Restart the secure sign-in flow.", "Confirm the vendor account in hand matches the account you intend to automate."],
            canContinue: false
          })
        };
      }

      const summary = summarizeAccount({
        accountHandle: normalizedHandle,
        externalAccountId,
        sessionLabel
      });

      return {
        validationStatus: "VALID",
        accountHandle: summary.accountHandle,
        externalAccountId: summary.externalAccountId ?? `${config.platform.toLowerCase()}:${normalizedHandle.toLowerCase()}`,
        summary: `${config.platformLabel} session validated for ${summary.accountHandle}.`,
        detail: `${config.summaryLabel} is ready for workspace automation through Mollie's remote runtime.`,
        operatorHint: buildAutomationConnectHint({
          platform: config.platform,
          platformLabel: config.platformLabel,
          title: `${config.platformLabel} is connected and ready.`,
          explanation: `Mollie validated ${summary.accountHandle} and stored the hosted browser session artifact for remote automation.`,
          severity: "SUCCESS",
          nextActions: ["Return to inventory to publish through this account.", "Reconnect the account later if the session expires or the vendor challenges sign-in again."],
          canContinue: true
        })
      };
    },
    summarizeAccount
  } satisfies AutomationVendorConnectAdapter;
}

export type AutomationMarketplaceReadiness = {
  state: AutomationOperationalState;
  status: "READY" | "BLOCKED";
  publishMode: "automation" | "extension";
  summary: string;
  detail: string;
  hint: OperatorHint;
};

function getAutomationFeatureFamily(platform: Platform): ConnectorFeatureFamily {
  if (platform === "DEPOP") {
    return "DEPOP_PROMOTION";
  }

  if (platform === "POSHMARK") {
    return "POSHMARK_SOCIAL";
  }

  return "WHATNOT_LIVE_SELLING";
}

function buildAutomationHint(input: {
  platformLabel: string;
  platform: Platform;
  title: string;
  explanation: string;
  severity: OperatorHint["severity"];
  nextActions: string[];
  canContinue: boolean;
  helpText?: string;
}) {
  return {
    title: input.title,
    explanation: input.explanation,
    severity: input.severity,
    nextActions: input.nextActions,
    routeTarget: "/marketplaces",
    featureFamily: getAutomationFeatureFamily(input.platform),
    canContinue: input.canContinue,
    helpText: input.helpText ?? `${input.platformLabel} is currently handled as an automation-class connector.`
  } satisfies OperatorHint;
}

export class ConnectorError extends Error {
  code: ConnectorFailureCode;
  retryable: boolean;
  metadata?: Record<string, unknown>;

  constructor(input: {
    code: ConnectorFailureCode;
    message: string;
    retryable?: boolean;
    metadata?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "ConnectorError";
    this.code = input.code;
    this.retryable = input.retryable ?? true;
    this.metadata = input.metadata;
  }
}

export function classifyConnectorError(error: unknown) {
  if (error instanceof ConnectorError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "Unknown connector error";
  const lower = message.toLowerCase();

  if (lower.includes("prerequisite") || lower.includes("missing")) {
    return new ConnectorError({
      code: "PREREQUISITE_MISSING",
      message,
      retryable: false
    });
  }

  if (lower.includes("disabled") || lower.includes("unavailable")) {
    return new ConnectorError({
      code: "ACCOUNT_UNAVAILABLE",
      message,
      retryable: false
    });
  }

  if (lower.includes("rate")) {
    return new ConnectorError({
      code: "RATE_LIMITED",
      message,
      retryable: true
    });
  }

  return new ConnectorError({
    code: "AUTOMATION_FAILED",
    message,
    retryable: true
  });
}

export function getAutomationAccountReadiness(input: {
  account: MarketplaceAccountContext;
  workspaceAutomationEnabled?: boolean;
  accountStatus?: MarketplaceAccountStatus;
  lastErrorMessage?: string | null;
}) {
  const accountStatus = input.accountStatus ?? input.account.status ?? "CONNECTED";
  const credentialMetadata = (input.account.credentialMetadata ?? {}) as Record<string, unknown>;
  const vendorSessionArtifact =
    credentialMetadata.vendorSessionArtifact && typeof credentialMetadata.vendorSessionArtifact === "object"
      ? (credentialMetadata.vendorSessionArtifact as Record<string, unknown>)
      : null;
  const captureMode =
      typeof vendorSessionArtifact?.captureMode === "string"
        ? vendorSessionArtifact.captureMode
        : typeof credentialMetadata.captureMode === "string"
          ? credentialMetadata.captureMode
          : null;
    const extensionDraftPrepReady = input.account.platform === "DEPOP" && captureMode === "EXTENSION_BROWSER";
    const remoteRuntimeReady = credentialMetadata.publishMode === "remote";
  const platformLabel =
    input.account.platform === "DEPOP"
      ? "Depop"
      : input.account.platform === "POSHMARK"
        ? "Poshmark"
        : input.account.platform === "WHATNOT"
          ? "Whatnot"
          : input.account.platform;

  if (accountStatus === "ERROR") {
    return {
      state: "AUTOMATION_ERROR",
      status: "BLOCKED",
      publishMode: extensionDraftPrepReady ? ("extension" as const) : ("automation" as const),
      summary: input.lastErrorMessage?.trim() || `${platformLabel} automation is in an error state.`,
      detail: "Reconnect or repair the automation session before publishing again.",
      hint: buildAutomationHint({
        platform: input.account.platform,
        platformLabel,
        title: `${platformLabel} needs attention before it can publish again.`,
        explanation: input.lastErrorMessage?.trim() || "The last automation run failed and the connector is currently blocked.",
        severity: "ERROR",
        nextActions: [
          `Reconnect the ${platformLabel} session or secret reference.`,
          "Open Executions to inspect the last failure details and artifacts.",
          "Use manual handling if this publish cannot wait."
        ],
        canContinue: false
      })
    };
  }

  if (accountStatus === "DISABLED") {
    return {
      state: "AUTOMATION_BLOCKED",
      status: "BLOCKED",
      publishMode: extensionDraftPrepReady ? ("extension" as const) : ("automation" as const),
      summary: `${platformLabel} automation is disabled for this account.`,
      detail: "Reconnect or re-enable the account before publishing.",
      hint: buildAutomationHint({
        platform: input.account.platform,
        platformLabel,
        title: `${platformLabel} is disabled for this account.`,
        explanation: "Mollie will not send automation jobs to this account until it is re-enabled or reconnected.",
        severity: "ERROR",
        nextActions: [`Reconnect the ${platformLabel} account.`, "Return here to confirm the account is ready before publishing."],
        canContinue: false
      })
    };
  }

  if (input.account.validationStatus !== "VALID") {
    return {
      state: "AUTOMATION_BLOCKED",
      status: "BLOCKED",
      publishMode: extensionDraftPrepReady ? ("extension" as const) : ("automation" as const),
      summary: `${platformLabel} session needs attention before automation can run.`,
      detail:
        input.account.validationStatus === "NEEDS_REFRESH"
          ? "Refresh the stored session secret before publishing."
          : "Reconnect the automation session before publishing.",
      hint: buildAutomationHint({
        platform: input.account.platform,
        platformLabel,
        title: `${platformLabel} session needs to be refreshed before it can publish.`,
        explanation:
          input.account.validationStatus === "NEEDS_REFRESH"
            ? "The saved automation session is stale and needs a fresh secret or session reference."
            : "The saved automation session is not valid enough to run publish jobs.",
        severity: "WARNING",
        nextActions: [
          `Refresh or replace the saved ${platformLabel} session reference.`,
          "Retry the publish after the account shows ready again."
        ],
        canContinue: false
      })
    };
  }

  if (extensionDraftPrepReady) {
    return {
      state: "AUTOMATION_READY",
      status: "READY",
      publishMode: "extension" as const,
      summary: `${platformLabel} browser session is ready for extension draft prep.`,
      detail: "This account can prepare marketplace drafts through the Mollie browser extension in your current browser.",
      hint: buildAutomationHint({
        platform: input.account.platform,
        platformLabel,
        title: `${platformLabel} is ready for browser-extension draft prep.`,
        explanation: "Mollie can open the live Depop listing flow in your browser and apply the supported draft fields there.",
        severity: "SUCCESS",
        nextActions: ["Return to an inventory item and choose Open in extension.", "Use Recheck login later if the browser session expires."],
        canContinue: true
      })
    };
  }

    if (!simulatedMarketplacePathsAllowed() && !remoteRuntimeReady) {
      return {
      state: "AUTOMATION_BLOCKED",
      status: "BLOCKED",
      publishMode: "automation" as const,
      summary: `${platformLabel} automation sign-in exists, but live marketplace automation is not enabled in production yet.`,
        detail: "This connector still relies on simulated publish behavior, so Mollie blocks it in production until the live remote runtime is shipped.",
      hint: buildAutomationHint({
        platform: input.account.platform,
        platformLabel,
        title: `${platformLabel} is not live for production publishing yet.`,
        explanation:
            "Mollie can store the account metadata, but this marketplace still depends on simulated automation behavior. Production blocks it instead of implying the account is ready.",
        severity: "ERROR",
        nextActions: [
          "Do not rely on this connector for production publish yet.",
          "Use manual handling or another live connector until the real automation runtime is available."
        ],
        canContinue: false
      })
    };
  }

  if (input.workspaceAutomationEnabled === false) {
    return {
      state: "AUTOMATION_BLOCKED",
      status: "BLOCKED",
      publishMode: "automation" as const,
      summary: `${platformLabel} automation is disabled for this workspace.`,
      detail: "Re-enable workspace connector automation before publishing.",
      hint: buildAutomationHint({
        platform: input.account.platform,
        platformLabel,
        title: `${platformLabel} needs workspace automation turned back on.`,
        explanation: "This account cannot publish until connector automation is re-enabled for the workspace.",
        severity: "ERROR",
        nextActions: ["Re-enable connector automation in Workspace settings.", "Retry publish after automation is enabled."],
        canContinue: false
      })
    };
  }

    return {
      state: "AUTOMATION_READY",
      status: "READY",
      publishMode: "automation" as const,
      summary: `${platformLabel} automation is ready for remote publish jobs.`,
      detail: "This account will publish through Mollie's remote automation runtime.",
      hint: buildAutomationHint({
        platform: input.account.platform,
        platformLabel,
        title: `${platformLabel} is ready for remote automation.`,
        explanation: "Mollie can queue publish work for this account through the shared remote automation runtime.",
        severity: "SUCCESS",
        nextActions: ["Continue from inventory detail to publish an item.", "Check Executions if a publish later needs support review."],
        canContinue: true
      })
  };
}
