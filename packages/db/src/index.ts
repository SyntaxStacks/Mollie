import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

export { Prisma };
export * from "@prisma/client";

function nextSku() {
  return `SKU-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

export async function createSession(email: string, name?: string | null) {
  const user = await db.user.upsert({
    where: { email },
    update: {
      name: name ?? undefined
    },
    create: {
      email,
      name: name ?? undefined
    }
  });

  const session = await db.session.create({
    data: {
      token: crypto.randomUUID(),
      userId: user.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14)
    }
  });

  const workspace = await db.workspace.findFirst({
    where: {
      ownerUserId: user.id
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  return { user, session, workspace };
}

export async function getSessionByToken(token: string) {
  return db.session.findUnique({
    where: { token },
    include: {
      user: true
    }
  });
}

export async function getWorkspaceForUser(userId: string) {
  return db.workspace.findFirst({
    where: { ownerUserId: userId },
    include: {
      owner: true
    }
  });
}

export async function createWorkspaceForUser(userId: string, name: string) {
  return db.workspace.create({
    data: {
      ownerUserId: userId,
      name,
      billingCustomerId: `cus_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`
    }
  });
}

export async function recordAuditLog(input: {
  workspaceId: string;
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Prisma.InputJsonValue;
}) {
  return db.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadataJson: input.metadata
    }
  });
}

export async function createExecutionLog(input: {
  workspaceId: string;
  inventoryItemId?: string | null;
  platformListingId?: string | null;
  jobName: string;
  connector?: string | null;
  correlationId: string;
  requestPayload?: Prisma.InputJsonValue;
}) {
  return db.executionLog.create({
    data: {
      workspaceId: input.workspaceId,
      inventoryItemId: input.inventoryItemId ?? null,
      platformListingId: input.platformListingId ?? null,
      jobName: input.jobName,
      connector: input.connector ?? null,
      correlationId: input.correlationId,
      requestPayloadJson: input.requestPayload
    }
  });
}

export async function listWorkspaceSummary(workspaceId: string) {
  const [inventoryCount, listedCount, soldCount, pendingDrafts, sales] = await Promise.all([
    db.inventoryItem.count({ where: { workspaceId } }),
    db.inventoryItem.count({ where: { workspaceId, status: "LISTED" } }),
    db.inventoryItem.count({ where: { workspaceId, status: "SOLD" } }),
    db.listingDraft.count({
      where: {
        inventoryItem: { workspaceId },
        reviewStatus: {
          in: ["DRAFT", "NEEDS_REVIEW"]
        }
      }
    }),
    db.sale.findMany({
      where: { inventoryItem: { workspaceId } }
    })
  ]);

  const totalRevenue = sales.reduce((total: number, sale) => total + sale.soldPrice, 0);
  const totalFees = sales.reduce((total: number, sale) => total + sale.fees + (sale.shippingCost ?? 0), 0);
  const totalCost = (
    await db.inventoryItem.findMany({
      where: { workspaceId, status: "SOLD" },
      select: { costBasis: true }
    })
  ).reduce((total: number, item) => total + item.costBasis, 0);

  return {
    inventoryCount,
    listedCount,
    soldCount,
    pendingDrafts,
    totalRevenue,
    totalFees,
    totalMargin: totalRevenue - totalFees - totalCost
  };
}

export async function listWorkspaceLots(workspaceId: string) {
  return db.sourceLot.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" }
  });
}

export async function listWorkspaceInventory(workspaceId: string) {
  return db.inventoryItem.findMany({
    where: { workspaceId },
    include: {
      images: {
        orderBy: { position: "asc" }
      },
      sourceLot: true,
      listingDrafts: true,
      platformListings: true,
      sales: true
    },
    orderBy: { updatedAt: "desc" }
  });
}

export async function createInventoryItem(workspaceId: string, input: {
  sourceLotId?: string | null;
  title: string;
  brand?: string | null;
  category: string;
  condition: string;
  size?: string | null;
  color?: string | null;
  quantity?: number;
  costBasis?: number;
  estimatedResaleMin?: number | null;
  estimatedResaleMax?: number | null;
  priceRecommendation?: number | null;
  attributes?: Prisma.InputJsonValue;
}) {
  return db.inventoryItem.create({
    data: {
      workspaceId,
      sourceLotId: input.sourceLotId ?? null,
      sku: nextSku(),
      title: input.title,
      brand: input.brand ?? null,
      category: input.category,
      condition: input.condition,
      size: input.size ?? null,
      color: input.color ?? null,
      quantity: input.quantity ?? 1,
      costBasis: input.costBasis ?? 0,
      estimatedResaleMin: input.estimatedResaleMin ?? null,
      estimatedResaleMax: input.estimatedResaleMax ?? null,
      priceRecommendation: input.priceRecommendation ?? null,
      attributesJson: input.attributes ?? {},
      imageManifestJson: []
    }
  });
}

export async function addInventoryImage(inventoryItemId: string, input: {
  url: string;
  kind: "ORIGINAL" | "DERIVED";
  width?: number | null;
  height?: number | null;
  position: number;
}) {
  return db.imageAsset.create({
    data: {
      inventoryItemId,
      url: input.url,
      kind: input.kind,
      width: input.width ?? null,
      height: input.height ?? null,
      position: input.position
    }
  });
}
