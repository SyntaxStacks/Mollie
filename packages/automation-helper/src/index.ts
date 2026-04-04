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
  accountHandle?: string | null;
  externalAccountId?: string | null;
  sessionLabel?: string | null;
};

function parseProtocolUrl(rawUrl: string) {
  const parsed = new URL(rawUrl);

  if (parsed.protocol !== "mollie-helper:") {
    throw new Error("Desktop companion URL must use the mollie-helper:// scheme.");
  }

  return {
    vendor: parsed.searchParams.get("vendor") ?? "",
    attemptId: parsed.searchParams.get("attemptId") ?? "",
    helperNonce: parsed.searchParams.get("helperNonce") ?? "",
    token: parsed.searchParams.get("token") ?? "",
    apiBaseUrl: parsed.searchParams.get("apiBaseUrl") ?? "",
    loginUrl: parsed.searchParams.get("loginUrl") ?? "",
    accountHandle: parsed.searchParams.get("accountHandle") ?? "",
    externalAccountId: parsed.searchParams.get("externalAccountId"),
    sessionLabel: parsed.searchParams.get("sessionLabel")
  };
}

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

  const protocolUrl = values.get("url");
  const parsedFromProtocol = protocolUrl ? parseProtocolUrl(protocolUrl) : null;

  const vendor = parsedFromProtocol?.vendor?.toUpperCase() ?? values.get("vendor")?.toUpperCase() ?? "";
  const attemptId = parsedFromProtocol?.attemptId ?? values.get("attempt-id") ?? "";
  const helperNonce = parsedFromProtocol?.helperNonce ?? values.get("helper-nonce") ?? "";
  const token = parsedFromProtocol?.token ?? values.get("token") ?? "";
  const apiBaseUrl = parsedFromProtocol?.apiBaseUrl ?? values.get("api-base-url") ?? "";
  const loginUrl = parsedFromProtocol?.loginUrl ?? values.get("login-url") ?? "";
  const accountHandle = parsedFromProtocol?.accountHandle ?? values.get("account-handle") ?? "";

  if (!vendor || !attemptId || !helperNonce || !token || !apiBaseUrl || !loginUrl) {
    throw new Error(
      "Usage: pnpm --filter @reselleros/automation-helper connect -- --vendor DEPOP --attempt-id <id> --helper-nonce <nonce> --token <jwt> --api-base-url https://api.mollie.biz --login-url https://www.depop.com/login/ [--account-handle <handle>] [--session-label <label>] [--external-account-id <id>] [--url mollie-helper://connect?... ]"
    );
  }

  return {
    vendor,
    attemptId,
    helperNonce,
    token,
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ""),
    loginUrl,
    accountHandle: accountHandle || null,
    externalAccountId: parsedFromProtocol?.externalAccountId ?? values.get("external-account-id") ?? null,
    sessionLabel: parsedFromProtocol?.sessionLabel ?? values.get("session-label") ?? null
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
    const accountHandle = args.accountHandle?.trim() || args.sessionLabel?.trim() || `${args.vendor} account`;

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
          accountHandle,
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
