import { createHash, randomInt, randomUUID } from "node:crypto";

import { db } from "@reselleros/db";
import { isLoginEmailConfigured, sendLoginCodeEmail } from "@reselleros/email";
import { createLogger } from "@reselleros/observability";

const logger = createLogger("auth");
const sessionTtlMs = 1000 * 60 * 60 * 24 * 14;

class AuthFlowError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AuthFlowError";
    this.statusCode = statusCode;
  }
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function now() {
  return new Date();
}

function expiresInMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function resolveChallengeTtlMinutes() {
  const parsed = Number(process.env.AUTH_CHALLENGE_TTL_MINUTES ?? "10");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

function resolveMaxChallengeAttempts() {
  const parsed = Number(process.env.AUTH_MAX_VERIFY_ATTEMPTS ?? "5");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
}

function shouldExposeChallengeCode() {
  return process.env.NODE_ENV !== "production" || process.env.AUTH_EXPOSE_DEV_CODE === "true";
}

function shouldRequireEmailDelivery() {
  return process.env.NODE_ENV === "production" && !shouldExposeChallengeCode();
}

function generateNumericCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function buildSessionToken() {
  return `${randomUUID()}.${randomUUID().replace(/-/g, "")}`;
}

type AuthContextInput = {
  email: string;
  name?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function issueLoginChallenge(input: AuthContextInput) {
  const email = input.email.trim().toLowerCase();
  const name = input.name?.trim() || undefined;

  if (shouldRequireEmailDelivery() && !isLoginEmailConfigured()) {
    throw new AuthFlowError("Login email delivery is not configured", 503);
  }

  const user = await db.user.upsert({
    where: { email },
    update: {
      name
    },
    create: {
      email,
      name
    }
  });

  const code = generateNumericCode();
  const expiresAt = expiresInMinutes(resolveChallengeTtlMinutes());

  await db.authChallenge.updateMany({
    where: {
      userId: user.id,
      consumedAt: null,
      expiresAt: {
        gt: now()
      }
    },
    data: {
      consumedAt: now()
    }
  });

  await db.authChallenge.create({
    data: {
      userId: user.id,
      email: user.email,
      codeHash: hashValue(code),
      expiresAt
    }
  });

  const shouldSendEmail = isLoginEmailConfigured();

  if (shouldSendEmail) {
    try {
      await sendLoginCodeEmail({
        to: user.email,
        code,
        expiresAt,
        appBaseUrl: process.env.APP_BASE_URL
      });
    } catch (error) {
      await db.authChallenge.deleteMany({
        where: {
          userId: user.id,
          codeHash: hashValue(code),
          consumedAt: null
        }
      });

      throw new AuthFlowError("Could not send login code email", 502);
    }
  }

  logger.info(
    {
      userId: user.id,
      email: user.email,
      expiresAt: expiresAt.toISOString(),
      code: shouldExposeChallengeCode() ? code : undefined,
      deliveryMethod: shouldSendEmail ? "email" : "inline",
      ipAddress: input.ipAddress ?? undefined,
      userAgent: input.userAgent ?? undefined
    },
    "issued login challenge"
  );

  return {
    email: user.email,
    expiresAt,
    devCode: shouldExposeChallengeCode() ? code : null,
    deliveryMethod: shouldSendEmail ? "email" : "inline"
  };
}

export async function verifyLoginChallenge(input: {
  email: string;
  code: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const email = input.email.trim().toLowerCase();
  const code = input.code.trim();

  const challenge = await db.authChallenge.findFirst({
    where: {
      email,
      consumedAt: null,
      expiresAt: {
        gt: now()
      }
    },
    include: {
      user: {
        include: {
          memberships: {
            include: {
              workspace: true
            },
            orderBy: {
              createdAt: "asc"
            }
          }
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  if (!challenge) {
    throw new AuthFlowError("No active login code found for that email");
  }

  const maxAttempts = resolveMaxChallengeAttempts();
  if (challenge.attemptCount >= maxAttempts) {
    await db.authChallenge.update({
      where: { id: challenge.id },
      data: {
        consumedAt: now()
      }
    });

    throw new AuthFlowError("Login code expired. Request a new code.");
  }

  if (challenge.codeHash !== hashValue(code)) {
    const nextAttemptCount = challenge.attemptCount + 1;
    await db.authChallenge.update({
      where: { id: challenge.id },
      data: {
        attemptCount: {
          increment: 1
        },
        ...(nextAttemptCount >= maxAttempts ? { consumedAt: now() } : {})
      }
    });

    if (nextAttemptCount >= maxAttempts) {
      throw new AuthFlowError("Login code expired. Request a new code.");
    }

    throw new AuthFlowError("Invalid login code");
  }

  await db.authChallenge.update({
    where: { id: challenge.id },
    data: {
      consumedAt: now()
    }
  });

  const rawToken = buildSessionToken();
  const session = await db.session.create({
    data: {
      userId: challenge.userId,
      sessionTokenHash: hashValue(rawToken),
      expiresAt: new Date(Date.now() + sessionTtlMs),
      lastUsedAt: now(),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null
    }
  });

  const memberships = challenge.user.memberships.map((membership) => ({
    workspaceId: membership.workspaceId,
    role: membership.role,
    workspace: membership.workspace
  }));

  return {
    token: rawToken,
    session,
    user: challenge.user,
    memberships,
    workspace: memberships.at(0)?.workspace ?? null
  };
}

export async function authenticateSessionToken(token: string) {
  const session = await db.session.findUnique({
    where: {
      sessionTokenHash: hashValue(token)
    },
    include: {
      user: {
        include: {
          memberships: {
            include: {
              workspace: true
            },
            orderBy: {
              createdAt: "asc"
            }
          }
        }
      }
    }
  });

  if (!session || session.revokedAt || session.expiresAt <= now()) {
    return null;
  }

  await db.session.update({
    where: { id: session.id },
    data: {
      lastUsedAt: now()
    }
  });

  return session;
}

export async function revokeSessionToken(token: string, userId: string) {
  return db.session.updateMany({
    where: {
      sessionTokenHash: hashValue(token),
      userId,
      revokedAt: null
    },
    data: {
      revokedAt: now()
    }
  });
}

export function selectWorkspaceForSession(
  session: Awaited<ReturnType<typeof authenticateSessionToken>>,
  requestedWorkspaceId?: string | null
) {
  if (!session) {
    return null;
  }

  const memberships = session.user.memberships;

  if (requestedWorkspaceId) {
    const matched = memberships.find((membership) => membership.workspaceId === requestedWorkspaceId);
    return matched ?? null;
  }

  return memberships.at(0) ?? null;
}
