import { assistListing, getAiStatus } from "@reselleros/ai";
import { getWorkspaceAiUsageForDay, incrementWorkspaceAiUsageForDay } from "@reselleros/db";
import { aiListingAssistRequestSchema } from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

function getUsageDayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function getDailyLimit() {
  const parsed = Number(process.env.AI_DAILY_LIMIT_PER_WORKSPACE ?? 50);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

export function registerAiRoutes(app: ApiApp, context: ApiRouteContext) {
  app.get("/api/ai/status", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const status = getAiStatus();
    const usage = await getWorkspaceAiUsageForDay(workspace.id, getUsageDayKey());
    const used = usage?.requestCount ?? 0;
    const remaining = Math.max(status.dailyQuota - used, 0);

    return {
      ...status,
      remainingDailyQuota: remaining
    };
  });

  app.post("/api/ai/listing-assist", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = aiListingAssistRequestSchema.parse(request.body);
    const status = getAiStatus();

    if (!status.enabled) {
      throw app.httpErrors.forbidden(status.message ?? "AI suggestions are disabled for this environment.");
    }

    const day = getUsageDayKey();
    const usage = await getWorkspaceAiUsageForDay(workspace.id, day);
    const used = usage?.requestCount ?? 0;
    const remainingBefore = Math.max(status.dailyQuota - used, 0);

    if (remainingBefore <= 0) {
      throw app.httpErrors.tooManyRequests("This workspace has reached its daily AI request limit.");
    }

    const suggestion = await assistListing({
      operation: body.operation,
      platform: body.platform ?? null,
      item: body.item
    });

    const updatedUsage = await incrementWorkspaceAiUsageForDay(workspace.id, day);
    const remaining = Math.max(status.dailyQuota - updatedUsage.requestCount, 0);

    return {
      enabled: true,
      provider: status.provider,
      operation: body.operation,
      suggestion,
      remainingDailyQuota: remaining,
      dailyQuota: status.dailyQuota,
      message: null
    };
  });
}
