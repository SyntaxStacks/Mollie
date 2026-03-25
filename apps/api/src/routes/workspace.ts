import { z } from "zod";

import {
  createWorkspaceForUser,
  listWorkspaceMembershipsForUser,
  recordAuditLog,
  updateWorkspaceConnectorAutomation
} from "@reselleros/db";
import { createWorkspaceSchema } from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

export function registerWorkspaceRoutes(app: ApiApp, context: ApiRouteContext) {
  app.get("/api/workspace", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = auth.memberships.find((membership) => membership.workspaceId === auth.workspaceId)?.workspace ?? null;

    return {
      workspace,
      workspaces: auth.memberships.map((membership) => membership.workspace)
    };
  });

  app.post("/api/workspace", async (request) => {
    const auth = await context.requireAuth(request);
    const body = createWorkspaceSchema.parse(request.body);
    const existingMemberships = await listWorkspaceMembershipsForUser(auth.userId);

    if (existingMemberships.length > 0) {
      throw app.httpErrors.conflict("User already has a workspace");
    }

    const workspace = await createWorkspaceForUser(auth.userId, body.name);
    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "workspace.created",
      targetType: "workspace",
      targetId: workspace.id,
      metadata: {
        plan: workspace.plan
      }
    });

    return { workspace };
  });

  app.patch("/api/workspace/connector-automation", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = z
      .object({
        enabled: z.boolean()
      })
      .parse(request.body);

    const updatedWorkspace = await updateWorkspaceConnectorAutomation(workspace.id, body.enabled);

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: body.enabled ? "workspace.connector_automation.enabled" : "workspace.connector_automation.disabled",
      targetType: "workspace",
      targetId: workspace.id
    });

    return { workspace: updatedWorkspace };
  });
}
