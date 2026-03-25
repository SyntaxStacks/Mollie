import { z } from "zod";

import type { Prisma } from "@reselleros/db";
import {
  createInventoryItem,
  db,
  findSourceLotDetailForWorkspace,
  findSourceLotForWorkspace,
  listWorkspaceLots,
  recordAuditLog
} from "@reselleros/db";
import { fetchMockLot, lotToInventoryCandidates } from "@reselleros/macbid";
import { buildIdempotencyKey, enqueueJob } from "@reselleros/queue";
import { sourceLotInputSchema } from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

export function registerSourceLotRoutes(app: ApiApp, context: ApiRouteContext) {
  app.post("/api/source-lots/macbid", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = sourceLotInputSchema.parse(request.body);
    const fetchedLot = fetchMockLot(body.url, body.titleHint);
    const lot = await db.sourceLot.upsert({
      where: {
        workspaceId_externalId: {
          workspaceId: workspace.id,
          externalId: fetchedLot.externalId
        }
      },
      update: {
        title: fetchedLot.title,
        sourceUrl: fetchedLot.sourceUrl,
        rawMetadataJson: fetchedLot.rawMetadata as Prisma.InputJsonValue,
        status: "FETCHED"
      },
      create: {
        workspaceId: workspace.id,
        externalId: fetchedLot.externalId,
        title: fetchedLot.title,
        sourceUrl: fetchedLot.sourceUrl,
        rawMetadataJson: fetchedLot.rawMetadata as Prisma.InputJsonValue,
        status: "FETCHED"
      }
    });

    await enqueueJob(
      "macbid.analyzeLot",
      {
        lotId: lot.id,
        workspaceId: workspace.id,
        correlationId: crypto.randomUUID()
      },
      {
        jobId: buildIdempotencyKey("macbid.analyzeLot", lot.id)
      }
    );

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "source_lot.created",
      targetType: "source_lot",
      targetId: lot.id,
      metadata: {
        sourceUrl: lot.sourceUrl
      }
    });

    return { lot };
  });

  app.get("/api/source-lots", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const lots = await listWorkspaceLots(workspace.id);

    return { lots };
  });

  app.get("/api/source-lots/:id", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const lot = await findSourceLotDetailForWorkspace(workspace.id, params.id);

    if (!lot) {
      throw app.httpErrors.notFound("Lot not found");
    }

    return { lot };
  });

  app.post("/api/source-lots/:id/analyze", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const lot = await findSourceLotForWorkspace(workspace.id, params.id);

    if (!lot) {
      throw app.httpErrors.notFound("Lot not found");
    }

    await enqueueJob(
      "macbid.analyzeLot",
      {
        lotId: lot.id,
        workspaceId: workspace.id,
        correlationId: crypto.randomUUID()
      },
      {
        jobId: buildIdempotencyKey("macbid.analyzeLot", lot.id)
      }
    );

    return { ok: true };
  });

  app.post("/api/source-lots/:id/create-inventory", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const lot = await findSourceLotForWorkspace(workspace.id, params.id);

    if (!lot) {
      throw app.httpErrors.notFound("Lot not found");
    }

    const rawMetadata = lot.rawMetadataJson as Record<string, unknown>;
    const candidates = lotToInventoryCandidates({
      externalId: lot.externalId,
      title: lot.title,
      sourceUrl: lot.sourceUrl,
      categoryHint: String(rawMetadata.categoryHint ?? "General Merchandise"),
      brandHint: (rawMetadata.brandHint as string | undefined) ?? undefined,
      quantity: Number(rawMetadata.quantity ?? 1),
      rawMetadata,
      images: [],
      estimatedResaleMin: lot.estimatedResaleMin ?? undefined,
      estimatedResaleMax: lot.estimatedResaleMax ?? undefined
    });

    const items = await Promise.all(
      candidates.map((candidate) =>
        createInventoryItem(workspace.id, {
          sourceLotId: lot.id,
          title: candidate.title,
          brand: candidate.brand,
          category: candidate.category,
          condition: candidate.condition,
          quantity: candidate.quantity,
          costBasis: lot.recommendedMaxBid ?? 0,
          estimatedResaleMin: candidate.estimatedResaleMin,
          estimatedResaleMax: candidate.estimatedResaleMax,
          priceRecommendation: candidate.priceRecommendation,
          attributes: candidate.attributes
        })
      )
    );

    await recordAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.userId,
      action: "source_lot.converted",
      targetType: "source_lot",
      targetId: lot.id,
      metadata: {
        inventoryCount: items.length
      }
    });

    return { items };
  });
}
