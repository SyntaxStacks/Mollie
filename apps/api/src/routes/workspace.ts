import { z } from "zod";

import {
  addWorkspaceMemberByEmail,
  createWorkspaceForUser,
  listWorkspaceMembers,
  listWorkspaceMembershipsForUser,
  recordAuditLog,
  updateWorkspaceConnectorAutomation
} from "@reselleros/db";
import { createWorkspaceSchema, workspaceMemberInviteSchema } from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

export function registerWorkspaceRoutes(app: ApiApp, context: ApiRouteContext) {
  function getActiveMembership(auth: Awaited<ReturnType<ApiRouteContext["requireAuth"]>>) {
    return auth.memberships.find((membership) => membership.workspaceId === auth.workspaceId) ?? null;
  }

  function requireWorkspaceOwner(auth: Awaited<ReturnType<ApiRouteContext["requireAuth"]>>) {
    const membership = getActiveMembership(auth);

    if (!membership || membership.role !== "OWNER") {
      throw app.httpErrors.forbidden("Only workspace owners can manage members");
    }

    return membership;
  }

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

  app.get("/api/workspace/members", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const activeMembership = getActiveMembership(auth);
    const memberships = await listWorkspaceMembers(workspace.id);

    return {
      canManageMembers: activeMembership?.role === "OWNER",
      members: memberships.map((membership) => ({
        id: membership.id,
        role: membership.role,
        createdAt: membership.createdAt.toISOString(),
        user: {
          id: membership.user.id,
          email: membership.user.email,
          name: membership.user.name
        }
      }))
    };
  });

  app.post("/api/workspace/members", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    requireWorkspaceOwner(auth);
    const body = workspaceMemberInviteSchema.parse(request.body);

    const result = await addWorkspaceMemberByEmail(workspace.id, {
      email: body.email,
      name: body.name ?? null,
      role: body.role
    });

    if (!result.created) {
      throw app.httpErrors.conflict("That user is already a member of this workspace");
    }

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "workspace.member.added",
      targetType: "workspace_membership",
      targetId: result.membership.id,
      metadata: {
        email: result.membership.user.email,
        role: result.membership.role
      }
    });

    return {
      member: {
        id: result.membership.id,
        role: result.membership.role,
        createdAt: result.membership.createdAt.toISOString(),
        user: {
          id: result.membership.user.id,
          email: result.membership.user.email,
          name: result.membership.user.name
        }
      }
    };
  });

  app.patch("/api/workspace/connector-automation", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    requireWorkspaceOwner(auth);
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
