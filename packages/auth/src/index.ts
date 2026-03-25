import { createHash, randomInt, randomUUID } from "node:crypto";

import { db } from "@reselleros/db";
import { createLogger } from "@reselleros/observability";

const logger = createLogger("auth");
const sessionTtlMs = 1000 * 60 * 60 * 24 * 14;

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
  const user = await db.user.upsert({
    where: { email: input.email },
    update: {
      name: input.name ?? undefined
    },
    create: {
      email: input.email,
      name: input.name ?? undefined
    }
  });

  const code = generateNumericCode();
  const expiresAt = expiresInMinutes(resolveChallengeTtlMinutes());

  await db.authChallenge.create({
    data: {
      userId: user.id,
      email: user.email,
      codeHash: hashValue(code),
      expiresAt
    }
  });

  logger.info(
    {
      userId: user.id,
      email: user.email,
      expiresAt: expiresAt.toISOString(),
      code: process.env.NODE_ENV === "production" ? undefined : code,
      ipAddress: input.ipAddress ?? undefined,
      userAgent: input.userAgent ?? undefined
    },
    "issued login challenge"
  );

  return {
    email: user.email,
    expiresAt,
    devCode: process.env.NODE_ENV === "production" ? null : code
  };
}

export async function verifyLoginChallenge(input: {
  email: string;
  code: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const challenge = await db.authChallenge.findFirst({
    where: {
      email: input.email,
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
    throw new Error("No active login code found for that email");
  }

  if (challenge.codeHash !== hashValue(input.code)) {
    await db.authChallenge.update({
      where: { id: challenge.id },
      data: {
        attemptCount: {
          increment: 1
        }
      }
    });

    throw new Error("Invalid login code");
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
