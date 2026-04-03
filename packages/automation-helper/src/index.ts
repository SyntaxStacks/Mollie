import { chromium } from "@playwright/test";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

type ParsedArgs = {
  vendor: string;
  attemptId: string;
  helperNonce: string;
  token: string;
  apiBaseUrl: string;
  loginUrl: string;
  accountHandle: string;
  externalAccountId?: string | null;
  sessionLabel?: string | null;
};

function parseArgs(argv: string[]): ParsedArgs {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value?.startsWith("--")) {
      continue;
    }

    values.set(value.slice(2), argv[index + 1] ?? "");
    index += 1;
  }

  const vendor = values.get("vendor")?.toUpperCase() ?? "";
  const attemptId = values.get("attempt-id") ?? "";
  const helperNonce = values.get("helper-nonce") ?? "";
  const token = values.get("token") ?? "";
  const apiBaseUrl = values.get("api-base-url") ?? "";
  const loginUrl = values.get("login-url") ?? "";
  const accountHandle = values.get("account-handle") ?? "";

  if (!vendor || !attemptId || !helperNonce || !token || !apiBaseUrl || !loginUrl || !accountHandle) {
    throw new Error(
      "Usage: pnpm --filter @reselleros/automation-helper connect -- --vendor DEPOP --attempt-id <id> --helper-nonce <nonce> --token <jwt> --api-base-url https://api.mollie.biz --login-url https://www.depop.com/login/ --account-handle <handle> [--session-label <label>] [--external-account-id <id>]"
    );
  }

  return {
    vendor,
    attemptId,
    helperNonce,
    token,
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ""),
    loginUrl,
    accountHandle,
    externalAccountId: values.get("external-account-id") ?? null,
    sessionLabel: values.get("session-label") ?? null
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const rl = readline.createInterface({ input, output });

  try {
    await page.goto(args.loginUrl, { waitUntil: "domcontentloaded" });
    await rl.question(`Finish ${args.vendor} sign-in in the opened browser, then press Enter here to capture the session...`);

    const storageState = await context.storageState();
    const cookieCount = storageState.cookies.length;
    const origin = storageState.origins[0]?.origin ?? new URL(args.loginUrl).origin;

    const response = await fetch(
      `${args.apiBaseUrl}/api/marketplace-accounts/${args.vendor}/connect/${args.attemptId}/session`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${args.token}`
        },
        body: JSON.stringify({
          helperNonce: args.helperNonce,
          accountHandle: args.accountHandle,
          externalAccountId: args.externalAccountId,
          sessionLabel: args.sessionLabel,
          captureMode: "LOCAL_BRIDGE",
          challengeRequired: false,
          cookieCount,
          origin,
          storageStateJson: storageState
        })
      }
    );

    const payload = await response.json().catch(() => ({ error: "Could not complete local helper connect." }));

    if (!response.ok) {
      throw new Error((payload as { error?: string }).error ?? "Could not complete local helper connect.");
    }

    output.write(`Connected ${args.vendor} for attempt ${args.attemptId}.\n`);
  } finally {
    await rl.close();
    await browser.close();
  }
}

void main().catch((error) => {
  output.write(`${error instanceof Error ? error.message : "Local automation helper failed."}\n`);
  process.exitCode = 1;
});
