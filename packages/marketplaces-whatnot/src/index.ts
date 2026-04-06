import {
  ConnectorError,
  buildAutomationConnectHint,
  type AutomationVendorConnectAdapter,
  type MarketplaceAdapter,
  type PublishListingInput,
  type VendorConnectChallengeInput,
  type VendorConnectSessionCaptureInput
} from "@reselleros/marketplaces";
import type { VendorValidationResult } from "@reselleros/types";

function simulateWhatnotPublish(input: PublishListingInput) {
  if (!input.images.length) {
    throw new ConnectorError({
      code: "PREREQUISITE_MISSING",
      message: "Whatnot publish requires at least one image",
      retryable: false,
      metadata: {
        inventoryItemId: input.inventoryItemId
      }
    });
  }

  const externalListingId = `whatnot_${crypto.randomUUID().slice(0, 12)}`;

  return {
    externalListingId,
    externalUrl: `https://www.whatnot.com/listing/${externalListingId}`,
    title: input.title,
    price: input.price,
    rawResponse: {
      mode: "simulated",
      platform: "WHATNOT",
      account: input.marketplaceAccount.displayName
    }
  };
}

function summarizeWhatnotAccount(input: {
  accountHandle?: string | null;
  externalAccountId?: string | null;
  sessionLabel?: string | null;
}) {
  const normalizedHandle = input.accountHandle?.trim() || "";

  return {
    accountHandle: input.sessionLabel?.trim() || normalizedHandle || "Whatnot",
    externalAccountId: input.externalAccountId?.trim() || null,
    detail: normalizedHandle ? `Whatnot seller account ${normalizedHandle}` : "Whatnot seller account"
  };
}

function getStorageOrigins(storageStateJson: Record<string, unknown> | null | undefined) {
  const origins = Array.isArray(storageStateJson?.origins) ? storageStateJson.origins : [];

  return origins
    .map((entry) => (entry && typeof entry === "object" && typeof (entry as { origin?: unknown }).origin === "string"
      ? (entry as { origin: string }).origin
      : null))
    .filter((value): value is string => Boolean(value));
}

function hasWhatnotOrigin(storageStateJson: Record<string, unknown> | null | undefined, origin?: string | null) {
  if (origin?.toLowerCase().includes("whatnot.com")) {
    return true;
  }

  return getStorageOrigins(storageStateJson).some((candidate) => candidate.toLowerCase().includes("whatnot.com"));
}

function hasGoogleOrigin(storageStateJson: Record<string, unknown> | null | undefined) {
  return getStorageOrigins(storageStateJson).some((candidate) => {
    const normalized = candidate.toLowerCase();
    return normalized.includes("accounts.google.com") || normalized.includes("google.com");
  });
}

function buildWhatnotInvalidHint(explanation: string, nextActions: string[]) {
  return buildAutomationConnectHint({
    platform: "WHATNOT",
    platformLabel: "Whatnot",
    title: "Whatnot needs another desktop sign-in attempt.",
    explanation,
    severity: "ERROR",
    nextActions,
    canContinue: false,
    helpText: "Whatnot should be opened in a normal browser tab, then rechecked through the Mollie browser extension so the signed-in session can be validated."
  });
}

export const whatnotConnectAdapter: AutomationVendorConnectAdapter = {
  platform: "WHATNOT",
  startConnect({ displayName }) {
    return {
      state: "AWAITING_LOGIN",
      prompts: [
        {
          kind: "LOGIN",
          label: "Open Whatnot in another tab",
          detail: `Open Whatnot in another tab, finish sign-in there, and then ask Mollie to recheck the signed-in browser session for ${displayName}.`,
          required: true
        }
      ],
      hint: buildAutomationConnectHint({
        platform: "WHATNOT",
        platformLabel: "Whatnot",
        title: "Whatnot sign-in starts in another browser tab.",
        explanation:
          "Whatnot sessions should be completed in the operator's own browser tab, especially when the account uses Google sign-in. Mollie will recheck that signed-in tab through the browser extension before marking the account ready.",
        severity: "INFO",
        nextActions: [
          "Open Whatnot in another tab and finish login there.",
          "If you use Google sign-in, finish that handoff in the same browser.",
          "Return to Mollie and click recheck login."
        ],
        canContinue: true,
        helpText: "The browser extension is the supported Whatnot recheck path."
      }),
      helperPath: "/marketplaces/connect-helper?vendor=whatnot",
      expiresInSeconds: 15 * 60,
      metadata: {
        loginUrl: "https://www.whatnot.com/login",
        summaryLabel: "Whatnot seller account",
        requiresLocalBridge: false
      }
    };
  },
  captureSession(input: VendorConnectSessionCaptureInput) {
    const summary = summarizeWhatnotAccount({
      accountHandle: input.accountHandle,
      externalAccountId: input.externalAccountId,
      sessionLabel: input.sessionLabel
    });

    if (input.captureMode !== "LOCAL_BRIDGE" && input.captureMode !== "EXTENSION_BROWSER") {
      return {
        state: "FAILED",
        prompts: [
          {
            kind: "LOGIN",
            label: "Use the browser extension recheck for Whatnot",
            detail: "Whatnot sign-in should be rechecked through the Mollie browser extension so the real browser session can be validated.",
            required: true
          }
        ],
        hint: buildWhatnotInvalidHint(
          "The popup helper did not provide the browser session data Mollie needs for Whatnot. Open Whatnot in another tab and recheck it through the browser extension instead.",
          ["Open Whatnot in another tab.", "Finish the Whatnot or Google sign-in there.", "Return to Mollie and click recheck login."]
        ),
        metadata: {
          pendingSession: null
        }
      };
    }

    if (!input.storageStateJson || !hasWhatnotOrigin(input.storageStateJson, input.origin) || (input.cookieCount ?? 0) <= 0) {
      return {
        state: "FAILED",
        prompts: [],
        hint: buildWhatnotInvalidHint(
          `Mollie captured ${summary.accountHandle}, but the storage state did not contain a usable Whatnot session yet.`,
          [
            "Finish sign-in fully in the Whatnot browser tab.",
            "Make sure you reach a signed-in Whatnot page before completing capture."
          ]
        ),
        metadata: {
          pendingSession: null
        }
      };
    }

    if (input.challengeRequired) {
      return {
        state: "AWAITING_2FA",
        prompts: [
          {
            kind: "CODE",
            label: "Whatnot verification code",
            detail: "Enter the 6-digit Whatnot code if the vendor still requires one after sign-in.",
            required: true,
            codeLength: 6
          }
        ],
        hint: buildAutomationConnectHint({
          platform: "WHATNOT",
          platformLabel: "Whatnot",
          title: "Whatnot still needs one verification step.",
        explanation: `Mollie captured a signed-in browser context for ${summary.accountHandle}, but Whatnot still requires a verification code before the session can be trusted.`,
          severity: "WARNING",
          nextActions: ["Enter the verification code in Mollie.", "Wait for the account to switch to connected and ready."],
          canContinue: true
        }),
        metadata: {
          pendingSession: {
            accountHandle: summary.accountHandle,
            externalAccountId: summary.externalAccountId ?? null,
            sessionLabel: input.sessionLabel ?? null,
            captureMode: input.captureMode,
            connectAttemptId: input.attempt.id,
            cookieCount: input.cookieCount ?? null,
            origin: input.origin ?? null,
            storageStateJson: input.storageStateJson ?? null
          }
        }
      };
    }

    return {
      state: "VALIDATING",
      prompts: [],
      hint: buildAutomationConnectHint({
        platform: "WHATNOT",
        platformLabel: "Whatnot",
        title: "Whatnot sign-in was captured and is being validated.",
        explanation:
          hasGoogleOrigin(input.storageStateJson)
            ? `Mollie captured the Whatnot browser session for ${summary.accountHandle}, including the Google sign-in handoff, and is validating it now.`
            : `Mollie captured the Whatnot browser session for ${summary.accountHandle} and is validating it now.`,
        severity: "INFO",
        nextActions: ["Wait for validation to finish.", "Keep the Whatnot tab open until Mollie confirms the account is ready."],
        canContinue: true
      }),
      metadata: {
        pendingSession: {
          accountHandle: summary.accountHandle,
          externalAccountId: summary.externalAccountId ?? null,
          sessionLabel: input.sessionLabel ?? null,
          captureMode: input.captureMode,
          connectAttemptId: input.attempt.id,
          cookieCount: input.cookieCount ?? null,
          origin: input.origin ?? null,
          storageStateJson: input.storageStateJson ?? null
        }
      }
    };
  },
  acceptChallenge(input: VendorConnectChallengeInput) {
    if (!/^\d{6}$/.test(input.code) || input.code === "000000") {
      return {
        state: "FAILED",
        prompts: [
          {
            kind: "CODE",
            label: "Whatnot verification code",
            detail: "Enter the current 6-digit Whatnot verification code.",
            required: true,
            codeLength: 6
          }
        ],
        hint: buildWhatnotInvalidHint(
          "The Whatnot verification code looked invalid or expired, so Mollie did not trust the captured session.",
          ["Request a fresh verification code from Whatnot.", "Restart the helper flow if the challenge expired."]
        )
      };
    }

    return {
      state: "VALIDATING",
      prompts: [],
      hint: buildAutomationConnectHint({
        platform: "WHATNOT",
        platformLabel: "Whatnot",
        title: "Whatnot verification was accepted.",
        explanation: "Mollie is validating the helper-captured session now.",
        severity: "INFO",
        nextActions: ["Wait for the account to switch to connected and ready."],
        canContinue: true
      })
    };
  },
  validateSession(input): VendorValidationResult {
    const normalizedHandle = input.accountHandle?.trim() || input.sessionLabel?.trim() || "Whatnot";

    if (!normalizedHandle || /fail|invalid|blocked/i.test(normalizedHandle)) {
      return {
        validationStatus: "INVALID",
        accountHandle: normalizedHandle || "Whatnot",
        externalAccountId: input.externalAccountId ?? null,
        summary: "Whatnot sign-in could not be validated.",
        detail: "The captured browser context did not look safe enough to reuse for automation.",
        operatorHint: buildWhatnotInvalidHint(
          "Mollie could not validate the Whatnot session from the captured browser context.",
          ["Restart the Whatnot login flow in a browser tab.", "Make sure the correct seller account finishes sign-in."]
        )
      };
    }

    if (input.captureMode !== "LOCAL_BRIDGE" && input.captureMode !== "EXTENSION_BROWSER") {
      return {
        validationStatus: "INVALID",
        accountHandle: normalizedHandle,
        externalAccountId: input.externalAccountId ?? null,
        summary: "Whatnot sign-in requires the browser extension recheck.",
        detail: "The popup flow did not provide a reusable browser session artifact for Whatnot.",
        operatorHint: buildWhatnotInvalidHint(
          "Whatnot should be connected through the browser extension recheck so Mollie can validate the real browser session.",
          ["Open Whatnot in another tab.", "Complete the Whatnot or Google sign-in there instead of the popup-only flow.", "Return to Mollie and click recheck login."]
        )
      };
    }

    if (!input.storageStateJson || !hasWhatnotOrigin(input.storageStateJson, input.origin) || (input.cookieCount ?? 0) <= 0) {
      return {
        validationStatus: "INVALID",
        accountHandle: normalizedHandle,
        externalAccountId: input.externalAccountId ?? null,
        summary: "Whatnot session capture was incomplete.",
        detail: "The browser tab did not expose a Whatnot session with usable account data yet.",
        operatorHint: buildWhatnotInvalidHint(
          "Mollie needs a signed-in Whatnot browser tab before this account can connect.",
          [
            "Finish login fully in the Whatnot browser tab.",
            "Wait until you reach a signed-in Whatnot page, then complete capture again."
          ]
        )
      };
    }

    const summary = summarizeWhatnotAccount({
      accountHandle: normalizedHandle,
      externalAccountId: input.externalAccountId,
      sessionLabel: input.sessionLabel
    });

    return {
      validationStatus: "VALID",
      accountHandle: summary.accountHandle,
      externalAccountId: summary.externalAccountId ?? `whatnot:${normalizedHandle.toLowerCase()}`,
      summary: `${summary.accountHandle} was validated as a Whatnot session.`,
      detail:
        hasGoogleOrigin(input.storageStateJson)
          ? "The helper captured a Whatnot browser session that included the Google sign-in handoff and reached a signed-in Whatnot origin."
          : "The helper captured a signed-in Whatnot browser session with reusable storage state.",
      operatorHint: buildAutomationConnectHint({
        platform: "WHATNOT",
        platformLabel: "Whatnot",
        title: "Whatnot is connected and ready for runtime testing.",
        explanation:
          "Mollie validated the helper-captured Whatnot browser session and stored the workspace session artifact. The next step is exercising the real Whatnot automation runtime against this account.",
        severity: "SUCCESS",
        nextActions: [
          "Return to inventory and use this account from the marketplace rail.",
          "Reconnect the account later if Whatnot expires or challenges the session again."
        ],
        canContinue: true
      })
    };
  },
  summarizeAccount: summarizeWhatnotAccount
};

export const whatnotAdapter: MarketplaceAdapter = {
  platform: "WHATNOT",
  descriptor: {
    platform: "WHATNOT",
    displayName: "Whatnot",
    executionMode: "SIMULATED",
    riskLevel: "HIGH",
    fallbackMode: "MANUAL",
    rateLimitStrategy: "SESSION_PACED",
    supportedCapabilities: [
      {
        capability: "CONNECT_ACCOUNT",
        support: "SUPPORTED",
        detail: "Operators connect Whatnot by signing in on another tab and rechecking that browser session through the Mollie extension."
      },
      {
        capability: "VALIDATE_AUTH",
        support: "SUPPORTED",
        detail: "Whatnot sessions are validated against extension-rechecked browser state before the account is marked ready."
      },
      {
        capability: "REFRESH_AUTH",
        support: "UNSUPPORTED",
        detail: "No OAuth refresh path exists for Whatnot."
      },
      {
        capability: "SYNC_ACCOUNT_STATE",
        support: "PLANNED",
        detail: "Future runtime hardening may add richer account sync checks."
      },
      {
        capability: "SYNC_LISTINGS",
        support: "SUPPORTED",
        detail: "Listing status sync uses the shared sync path."
      },
      {
        capability: "SYNC_ORDERS",
        support: "PLANNED",
        detail: "Order and sale reconciliation are planned."
      },
      {
        capability: "CREATE_LISTING",
        support: "SIMULATED",
        detail: "Publish still needs a real Whatnot browser-session runtime in connector-runner."
      },
      {
        capability: "UPDATE_LISTING",
        support: "PLANNED",
        detail: "Revise listing workflows are planned."
      },
      {
        capability: "DELIST_LISTING",
        support: "PLANNED",
        detail: "Delist flows are planned."
      },
      {
        capability: "RELIST_LISTING",
        support: "PLANNED",
        detail: "Relist workflows are planned where Whatnot catalog behavior allows it."
      },
      {
        capability: "SEND_OFFER",
        support: "UNSUPPORTED",
        detail: "Generic offer support is not part of the current Whatnot connector."
      },
      {
        capability: "FETCH_MESSAGES",
        support: "UNSUPPORTED",
        detail: "Messaging is not modeled in the current Whatnot connector."
      },
      {
        capability: "RECORD_HEALTH",
        support: "SUPPORTED",
        detail: "Automation readiness, failure artifacts, and connector degradation are already tracked."
      },
      {
        capability: "FETCH_ANALYTICS",
        support: "UNSUPPORTED",
        detail: "Analytics retrieval is not part of the current integration."
      }
    ],
    supportedFeatureFamilies: [
      {
        family: "WHATNOT_LIVE_SELLING",
        support: "PLANNED",
        detail: "Live-show inventory assignment, auction controls, and stream reconciliation should remain Whatnot-native workflows."
      }
    ]
  },
  async publishListing(input) {
    return simulateWhatnotPublish(input);
  },
  async syncListing({ currentStatus }) {
    return { status: currentStatus === "PUBLISHED" ? "SYNCED" : currentStatus };
  },
  async testConnection({ marketplaceAccount }) {
    return {
      ok: true,
      detail: `Whatnot session captured for ${marketplaceAccount.displayName}. Publish runtime still needs the real browser-session automation path.`
    };
  }
};
