import { createSession, createWorkspaceForUser, db, recordAuditLog } from "./index.js";

async function main() {
  const { user, workspace } = await createSession("demo@reselleros.local", "Demo Operator");
  const activeWorkspace = workspace ?? (await createWorkspaceForUser(user.id, "Pilot Reseller"));

  const inventory = await db.inventoryItem.create({
    data: {
      workspaceId: activeWorkspace.id,
      sku: `SKU-SEED-${Date.now()}`,
      title: "Vintage Nike Windbreaker",
      brand: "Nike",
      category: "Apparel",
      condition: "Good used condition",
      size: "L",
      color: "Blue",
      quantity: 1,
      costBasis: 18,
      estimatedResaleMin: 48,
      estimatedResaleMax: 72,
      priceRecommendation: 59,
      status: "READY",
      attributesJson: {
        source: "seed"
      }
    }
  });

  await db.listingDraft.upsert({
    where: {
      inventoryItemId_platform: {
        inventoryItemId: inventory.id,
        platform: "EBAY"
      }
    },
    update: {},
    create: {
      inventoryItemId: inventory.id,
      platform: "EBAY",
      generatedTitle: "Vintage Nike Windbreaker Jacket Size L Blue",
      generatedDescription: "Seed draft for local development.",
      generatedPrice: 59,
      generatedTagsJson: ["nike", "windbreaker", "vintage"],
      attributesJson: {
        category: "Apparel",
        condition: "Good used condition"
      },
      reviewStatus: "APPROVED"
    }
  });

  await recordAuditLog({
    workspaceId: activeWorkspace.id,
    actorUserId: user.id,
    action: "seed.bootstrap",
    targetType: "workspace",
    targetId: activeWorkspace.id,
    metadata: {
      note: "Local development seed data created"
    }
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
