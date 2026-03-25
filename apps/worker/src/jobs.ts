import { Prisma, db, recordAuditLog } from "@reselleros/db";
import { generateListingDraft, generateLotAnalysis } from "@reselleros/ai";
import { ebayAdapter } from "@reselleros/marketplaces-ebay";
import type { JobName, JobPayload } from "@reselleros/queue";

export async function processWorkerJob(name: JobName, data: JobPayload<JobName>) {
  switch (name) {
    case "macbid.fetchLot":
      return null;

    case "macbid.analyzeLot": {
      const payload = data as JobPayload<"macbid.analyzeLot">;
      const lot = await db.sourceLot.findUnique({
        where: { id: payload.lotId }
      });

      if (!lot) {
        throw new Error("Lot not found");
      }

      const rawMetadata = lot.rawMetadataJson as Record<string, unknown>;
      const analysis = await generateLotAnalysis({
        title: lot.title,
        normalizedTitle: lot.title,
        categoryHint: String(rawMetadata.categoryHint ?? "General Merchandise"),
        quantity: Number(rawMetadata.quantity ?? 1)
      });

      await db.sourceLot.update({
        where: { id: lot.id },
        data: {
          estimatedResaleMin: analysis.resaleRange.min,
          estimatedResaleMax: analysis.resaleRange.max,
          recommendedMaxBid: analysis.recommendedMaxBid,
          confidenceScore: analysis.confidenceScore,
          riskScore: analysis.riskScore,
          analysisSummary: analysis.summary,
          analysisRationaleJson: analysis.rationale,
          status: "ANALYZED"
        }
      });

      await recordAuditLog({
        workspaceId: payload.workspaceId,
        action: "source_lot.analyzed",
        targetType: "source_lot",
        targetId: lot.id,
        metadata: analysis
      });

      return analysis;
    }

    case "inventory.generateListingDraft": {
      const payload = data as JobPayload<"inventory.generateListingDraft">;
      const item = await db.inventoryItem.findUnique({
        where: { id: payload.inventoryItemId },
        include: {
          images: {
            orderBy: { position: "asc" }
          }
        }
      });

      if (!item) {
        throw new Error("Inventory item not found");
      }

      const createdDrafts = [];

      for (const platform of payload.platforms) {
        const generated = await generateListingDraft(
          {
            title: item.title,
            brand: item.brand,
            category: item.category,
            condition: item.condition,
            size: item.size,
            color: item.color,
            attributes: item.attributesJson as Record<string, unknown>,
            estimatedResaleMin: item.estimatedResaleMin,
            estimatedResaleMax: item.estimatedResaleMax,
            priceRecommendation: item.priceRecommendation
          },
          platform
        );

        const draft = await db.listingDraft.upsert({
          where: {
            inventoryItemId_platform: {
              inventoryItemId: item.id,
              platform
            }
          },
          update: {
            generatedTitle: generated.title,
            generatedDescription: generated.description,
            generatedPrice: generated.price,
            generatedTagsJson: generated.tags,
            attributesJson: generated.attributes,
            reviewStatus: "NEEDS_REVIEW"
          },
          create: {
            inventoryItemId: item.id,
            platform,
            generatedTitle: generated.title,
            generatedDescription: generated.description,
            generatedPrice: generated.price,
            generatedTagsJson: generated.tags,
            attributesJson: generated.attributes,
            reviewStatus: "NEEDS_REVIEW"
          }
        });

        createdDrafts.push(draft);
      }

      await recordAuditLog({
        workspaceId: payload.workspaceId,
        action: "draft.generated",
        targetType: "inventory_item",
        targetId: item.id,
        metadata: {
          platforms: payload.platforms
        }
      });

      return createdDrafts;
    }

    case "listing.publishEbay": {
      const payload = data as JobPayload<"listing.publishEbay">;
      await db.executionLog.update({
        where: { id: payload.executionLogId },
        data: {
          status: "RUNNING",
          startedAt: new Date()
        }
      });

      const [item, draft, account] = await Promise.all([
        db.inventoryItem.findUnique({
          where: { id: payload.inventoryItemId },
          include: {
            images: {
              orderBy: { position: "asc" }
            }
          }
        }),
        db.listingDraft.findUnique({
          where: { id: payload.draftId }
        }),
        db.marketplaceAccount.findUnique({
          where: { id: payload.marketplaceAccountId }
        })
      ]);

      if (!item || !draft || !account) {
        throw new Error("Publish prerequisites missing");
      }

      const publishResult = await ebayAdapter.publishListing({
        inventoryItemId: item.id,
        marketplaceAccountId: account.id,
        marketplaceAccountDisplayName: account.displayName,
        title: draft.generatedTitle,
        description: draft.generatedDescription,
        price: draft.generatedPrice,
        images: item.images.map((image) => image.url),
        attributes: draft.attributesJson as Record<string, unknown>
      });

      const existingListing = await db.platformListing.findFirst({
        where: {
          inventoryItemId: item.id,
          marketplaceAccountId: account.id,
          platform: "EBAY"
        }
      });

      const listing = existingListing
        ? await db.platformListing.update({
            where: { id: existingListing.id },
            data: {
              externalListingId: publishResult.externalListingId,
              externalUrl: publishResult.externalUrl,
              publishedTitle: publishResult.title,
              publishedPrice: publishResult.price,
              rawLastResponseJson: publishResult.rawResponse as Prisma.InputJsonValue,
              lastSyncAt: new Date(),
              status: "PUBLISHED"
            }
          })
        : await db.platformListing.create({
            data: {
              inventoryItemId: item.id,
              marketplaceAccountId: account.id,
              platform: "EBAY",
              externalListingId: publishResult.externalListingId,
              externalUrl: publishResult.externalUrl,
              publishedTitle: publishResult.title,
              publishedPrice: publishResult.price,
              rawLastResponseJson: publishResult.rawResponse as Prisma.InputJsonValue,
              lastSyncAt: new Date(),
              status: "PUBLISHED"
            }
          });

      await db.inventoryItem.update({
        where: { id: item.id },
        data: {
          status: "LISTED"
        }
      });

      await db.executionLog.update({
        where: { id: payload.executionLogId },
        data: {
          platformListingId: listing.id,
          status: "SUCCEEDED",
          responsePayloadJson: publishResult.rawResponse as Prisma.InputJsonValue,
          finishedAt: new Date()
        }
      });

      return listing;
    }

    case "listing.syncStatus": {
      const payload = data as JobPayload<"listing.syncStatus">;
      const listing = await db.platformListing.findUnique({
        where: { id: payload.listingId }
      });

      if (!listing) {
        throw new Error("Listing not found");
      }

      await db.platformListing.update({
        where: { id: listing.id },
        data: {
          status: listing.status === "PUBLISHED" ? "SYNCED" : listing.status,
          lastSyncAt: new Date()
        }
      });

      return { listingId: listing.id };
    }

    case "sales.sync":
    case "maintenance.retryFailures":
      return { ok: true };

    case "listing.publishDepop":
      throw new Error("Depop publish jobs are handled by connector-runner");

    default:
      return null;
  }
}
