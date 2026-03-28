import { createLogger } from "@reselleros/observability";

const logger = createLogger("email");
const RESEND_API_URL = "https://api.resend.com/emails";

export type LoginCodeEmailInput = {
  to: string;
  code: string;
  expiresAt: Date;
  appBaseUrl?: string;
};

function getRequiredEnv(name: "RESEND_API_KEY" | "AUTH_EMAIL_FROM") {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

export function isLoginEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.AUTH_EMAIL_FROM?.trim());
}

export async function sendLoginCodeEmail(input: LoginCodeEmailInput) {
  const apiKey = getRequiredEnv("RESEND_API_KEY");
  const from = getRequiredEnv("AUTH_EMAIL_FROM");
  const replyTo = process.env.AUTH_EMAIL_REPLY_TO?.trim();
  const appBaseUrl = input.appBaseUrl ?? process.env.APP_BASE_URL?.trim();
  const expiresAtLabel = input.expiresAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      reply_to: replyTo ? [replyTo] : undefined,
      subject: "Your Mollie login code",
      text: [
        `Your Mollie login code is ${input.code}.`,
        `It expires at ${expiresAtLabel}.`,
        "Only the most recent login code will work.",
        appBaseUrl ? `Sign in at ${appBaseUrl}/onboarding.` : null
      ]
        .filter(Boolean)
        .join("\n"),
      html: [
        "<div style=\"font-family:Arial,sans-serif;line-height:1.5;color:#111827\">",
        "<h2 style=\"margin:0 0 16px\">Your Mollie login code</h2>",
        `<p style="margin:0 0 12px">Use this code to sign in: <strong style="font-size:20px">${input.code}</strong></p>`,
        `<p style="margin:0 0 12px">It expires at ${expiresAtLabel}.</p>`,
        "<p style=\"margin:0 0 12px\">Only the most recent login code will work.</p>",
        appBaseUrl
          ? `<p style="margin:0">Return to <a href="${appBaseUrl}/onboarding">${appBaseUrl}/onboarding</a> to continue.</p>`
          : "",
        "</div>"
      ].join("")
    })
  });

  if (!response.ok) {
    const responseText = await response.text();
    logger.error(
      {
        statusCode: response.status,
        responseText,
        to: input.to
      },
      "resend login email request failed"
    );
    throw new Error("Could not send login code email");
  }

  const payload = (await response.json()) as { id?: string };
  logger.info(
    {
      messageId: payload.id,
      to: input.to
    },
    "sent login code email"
  );

  return payload;
}
