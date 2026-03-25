import type { FastifyInstance } from "fastify";

import { authenticateSessionToken, selectWorkspaceForSession } from "@reselleros/auth";
import { db } from "@reselleros/db";

export type ApiApp = FastifyInstance<any, any, any, any>;

export type AuthContext = {
  userId: string;
  email: string;
  workspaceId: string | null;
  memberships: Array<{
    workspaceId: string;
    role: string;
    workspace: {
      id: string;
      name: string;
      plan: string;
      billingCustomerId: string | null;
    };
  }>;
};

export type ApiRouteContext = {
  getRequestMetadata(request: { headers: Record<string, unknown>; ip?: string }): {
    ipAddress: string | null;
    userAgent: string | null;
  };
  requireAuth(request: { headers: Record<string, unknown>; ip?: string }): Promise<AuthContext>;
  requireWorkspace(auth: AuthContext): Promise<NonNullable<Awaited<ReturnType<typeof db.workspace.findUnique>>>>;
};

export function createApiRouteContext(app: ApiApp): ApiRouteContext {
  function getRequestMetadata(request: { headers: Record<string, unknown>; ip?: string }) {
    return {
      ipAddress: request.ip ?? null,
      userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null
    };
  }

  async function requireAuth(request: { headers: Record<string, unknown>; ip?: string }) {
    const authorization = request.headers.authorization;
    const token = typeof authorization === "string" ? authorization.replace(/^Bearer\s+/i, "") : null;

    if (!token) {
      throw app.httpErrors.unauthorized("Missing bearer token");
    }

    const session = await authenticateSessionToken(token);

    if (!session) {
      throw app.httpErrors.unauthorized("Session is invalid or expired");
    }

    const requestedWorkspaceId =
      typeof request.headers["x-workspace-id"] === "string" ? request.headers["x-workspace-id"] : null;
    const activeMembership = selectWorkspaceForSession(session, requestedWorkspaceId);
    const memberships = session.user.memberships.map((membership) => ({
      workspaceId: membership.workspaceId,
      role: membership.role,
      workspace: {
        id: membership.workspace.id,
        name: membership.workspace.name,
        plan: membership.workspace.plan,
        billingCustomerId: membership.workspace.billingCustomerId
      }
    }));

    return {
      userId: session.userId,
      email: session.user.email,
      workspaceId: activeMembership?.workspaceId ?? null,
      memberships
    } satisfies AuthContext;
  }

  async function requireWorkspace(auth: AuthContext) {
    if (!auth.workspaceId) {
      throw app.httpErrors.preconditionFailed("Create a workspace first");
    }

    const workspace = await db.workspace.findUnique({
      where: { id: auth.workspaceId }
    });

    if (!workspace) {
      throw app.httpErrors.notFound("Workspace not found");
    }

    return workspace;
  }

  return {
    getRequestMetadata,
    requireAuth,
    requireWorkspace
  };
}
