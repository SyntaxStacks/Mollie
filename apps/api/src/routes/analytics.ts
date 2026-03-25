import { listWorkspaceInventory, listWorkspaceLots, listWorkspaceSummary } from "@reselleros/db";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

export function registerAnalyticsRoutes(app: ApiApp, context: ApiRouteContext) {
  app.get("/api/analytics/pnl", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const summary = await listWorkspaceSummary(workspace.id);
    const inventory = await listWorkspaceInventory(workspace.id);
    const lots = await listWorkspaceLots(workspace.id);

    return {
      summary,
      inventory,
      lots
    };
  });
}
