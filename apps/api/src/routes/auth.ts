import { issueLoginChallenge, revokeSessionToken, verifyLoginChallenge } from "@reselleros/auth";
import { authRequestSchema, authVerifySchema } from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

export function registerAuthRoutes(app: ApiApp, context: ApiRouteContext) {
  app.post("/api/auth/request-code", async (request) => {
    const body = authRequestSchema.parse(request.body);
    const challenge = await issueLoginChallenge({
      email: body.email,
      name: body.name,
      ...context.getRequestMetadata(request)
    });

    return {
      ok: true,
      email: challenge.email,
      expiresAt: challenge.expiresAt.toISOString(),
      devCode: challenge.devCode,
      deliveryMethod: challenge.deliveryMethod
    };
  });

  app.post("/api/auth/verify-code", async (request) => {
    const body = authVerifySchema.parse(request.body);
    const { user, token, workspace, memberships } = await verifyLoginChallenge({
      email: body.email,
      code: body.code,
      ...context.getRequestMetadata(request)
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      },
      workspace,
      workspaces: memberships.map((membership) => membership.workspace)
    };
  });

  app.post("/api/auth/logout", async (request) => {
    const auth = await context.requireAuth(request);
    const authorization = String(request.headers.authorization).replace(/^Bearer\s+/i, "");
    await revokeSessionToken(authorization, auth.userId);

    return { ok: true };
  });

  app.get("/api/auth/me", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = auth.memberships.find((membership) => membership.workspaceId === auth.workspaceId)?.workspace ?? null;

    return {
      user: {
        id: auth.userId,
        email: auth.email
      },
      workspace,
      workspaces: auth.memberships.map((membership) => membership.workspace)
    };
  });
}
