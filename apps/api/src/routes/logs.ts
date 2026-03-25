import { db } from "@reselleros/db";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

export function registerLogRoutes(app: ApiApp, context: ApiRouteContext) {
  app.get("/api/execution-logs", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const logs = await db.executionLog.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    return { logs };
  });

  app.get("/api/audit-logs", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const logs = await db.auditLog.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    return { logs };
  });
}
