import { createWorkspaceForUser, db, recordAuditLog } from "./index.js";

async function main() {
  const user = await db.user.upsert({
    where: { email: "demo@reselleros.local" },
    update: {
      name: "Demo Operator"
    },
    create: {
      email: "demo@reselleros.local",
      name: "Demo Operator"
    }
  });

  const membership = await db.workspaceMembership.findFirst({
    where: {
      userId: user.id
    },
    include: {
      workspace: true
    }
  });

  const activeWorkspace = membership?.workspace ?? (await createWorkspaceForUser(user.id, "Pilot Reseller"));

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
