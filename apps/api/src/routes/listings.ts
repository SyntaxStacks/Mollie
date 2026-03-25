import { z } from "zod";

import {
  createExecutionLog,
  db,
  findPlatformListingDetailForWorkspace,
  findPlatformListingForWorkspace
} from "@reselleros/db";
import { enqueueJob } from "@reselleros/queue";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

export function registerListingRoutes(app: ApiApp, context: ApiRouteContext) {
  app.get("/api/listings/:id", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const listing = await findPlatformListingDetailForWorkspace(workspace.id, params.id);

    if (!listing) {
      throw app.httpErrors.notFound("Listing not found");
    }

    return { listing };
  });

  app.post("/api/listings/:id/retry", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const listing = await findPlatformListingForWorkspace(workspace.id, params.id);

    if (!listing) {
      throw app.httpErrors.notFound("Listing not found");
    }

    const draft = await db.listingDraft.findFirst({
      where: {
        inventoryItemId: listing.inventoryItemId,
        platform: listing.platform,
        reviewStatus: "APPROVED",
        inventoryItem: {
          workspaceId: workspace.id
        }
      }
    });

    if (!draft) {
      throw app.httpErrors.preconditionFailed("No approved draft found for retry");
    }

    const executionLog = await createExecutionLog({
      workspaceId: workspace.id,
      inventoryItemId: listing.inventoryItemId,
      platformListingId: listing.id,
      jobName: listing.platform === "EBAY" ? "listing.publishEbay" : "listing.publishDepop",
      connector: listing.platform,
      correlationId: crypto.randomUUID()
    });

    await enqueueJob(listing.platform === "EBAY" ? "listing.publishEbay" : "listing.publishDepop", {
      inventoryItemId: listing.inventoryItemId,
      draftId: draft.id,
      marketplaceAccountId: listing.marketplaceAccountId,
      executionLogId: executionLog.id,
      correlationId: executionLog.correlationId
    });

    return { executionLog };
  });
}
