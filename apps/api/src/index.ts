import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { z } from "zod";

import { generateLotAnalysis } from "@reselleros/ai";
import { loadApiEnv } from "@reselleros/config";
import {
  Prisma,
  createExecutionLog,
  createInventoryItem,
  createSession,
  createWorkspaceForUser,
  db,
  getSessionByToken,
  getWorkspaceForUser,
  listWorkspaceInventory,
  listWorkspaceLots,
  listWorkspaceSummary,
  recordAuditLog
} from "@reselleros/db";
import { fetchMockLot, lotToInventoryCandidates } from "@reselleros/macbid";
import { createLogger } from "@reselleros/observability";
import { buildIdempotencyKey, enqueueJob } from "@reselleros/queue";
import {
  authPayloadSchema,
  createWorkspaceSchema,
  draftUpdateSchema,
  imageInputSchema,
  inventoryInputSchema,
  manualSaleSchema,
  marketplaceAccountSchema,
  sourceLotInputSchema
} from "@reselleros/types";

const env = loadApiEnv();
const logger = createLogger("api");
const app = Fastify({
  logger
});

app.register(cors, {
  origin: true
});
app.register(sensible);
app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute"
});

type AuthContext = {
  userId: string;
  email: string;
  workspaceId: string | null;
};

async function requireAuth(request: { headers: Record<string, unknown> }) {
  const authorization = request.headers.authorization;
  const token = typeof authorization === "string" ? authorization.replace(/^Bearer\s+/i, "") : null;

  if (!token) {
    throw app.httpErrors.unauthorized("Missing bearer token");
  }

  const session = await getSessionByToken(token);

  if (!session || session.expiresAt < new Date()) {
    throw app.httpErrors.unauthorized("Session is invalid or expired");
  }

  const workspace = await getWorkspaceForUser(session.userId);

  return {
    userId: session.userId,
    email: session.user.email,
    workspaceId: workspace?.id ?? null
  } satisfies AuthContext;
}

async function requireWorkspace(auth: AuthContext) {
  if (!auth.workspaceId) {
    throw app.httpErrors.preconditionFailed("Create a workspace first");
  }

  const workspace = await db.workspace.findUnique({
    where: { id: auth.workspaceId }
  });

  if (!workspace) {
    throw app.httpErrors.notFound("Workspace not found");
  }

  return workspace;
}

app.get("/health", async () => ({
  ok: true,
  service: "reselleros-api",
  timestamp: new Date().toISOString()
}));

app.post("/api/auth/login", async (request) => {
  const body = authPayloadSchema.parse(request.body);
  const { user, session, workspace } = await createSession(body.email, body.name);

  return {
    token: session.token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name
    },
    workspace
  };
});

app.post("/api/auth/logout", async (request) => {
  const auth = await requireAuth(request);
  const authorization = String(request.headers.authorization).replace(/^Bearer\s+/i, "");
  await db.session.deleteMany({
    where: {
      token: authorization,
      userId: auth.userId
    }
  });

  return { ok: true };
});

app.get("/api/auth/me", async (request) => {
  const auth = await requireAuth(request);
  const workspace = auth.workspaceId
    ? await db.workspace.findUnique({
        where: { id: auth.workspaceId }
      })
    : null;

  return {
    user: {
      id: auth.userId,
      email: auth.email
    },
    workspace
  };
});

app.get("/api/workspace", async (request) => {
  const auth = await requireAuth(request);

  if (!auth.workspaceId) {
    return { workspace: null };
  }

  const workspace = await db.workspace.findUnique({
    where: { id: auth.workspaceId }
  });

  return { workspace };
});

app.post("/api/workspace", async (request) => {
  const auth = await requireAuth(request);
  const body = createWorkspaceSchema.parse(request.body);
  const existing = await getWorkspaceForUser(auth.userId);

  if (existing) {
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

app.get("/api/marketplace-accounts", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const accounts = await db.marketplaceAccount.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" }
  });

  return { accounts };
});

app.post("/api/marketplace-accounts/ebay/connect", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const body = marketplaceAccountSchema.extend({ platform: z.literal("EBAY") }).parse({
    ...(request.body as Record<string, unknown>),
    platform: "EBAY"
  });

  const account = await db.marketplaceAccount.create({
    data: {
      workspaceId: workspace.id,
      platform: body.platform,
      displayName: body.displayName,
      secretRef: body.secretRef,
      status: "CONNECTED"
    }
  });

  await recordAuditLog({
    workspaceId: workspace.id,
    actorUserId: auth.userId,
    action: "marketplace.ebay.connected",
    targetType: "marketplace_account",
    targetId: account.id,
    metadata: {
      displayName: account.displayName
    }
  });

  return { account };
});

app.post("/api/marketplace-accounts/depop/session", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const body = marketplaceAccountSchema.extend({ platform: z.literal("DEPOP") }).parse({
    ...(request.body as Record<string, unknown>),
    platform: "DEPOP"
  });

  const account = await db.marketplaceAccount.create({
    data: {
      workspaceId: workspace.id,
      platform: body.platform,
      displayName: body.displayName,
      secretRef: body.secretRef,
      status: "CONNECTED"
    }
  });

  await recordAuditLog({
    workspaceId: workspace.id,
    actorUserId: auth.userId,
    action: "marketplace.depop.connected",
    targetType: "marketplace_account",
    targetId: account.id,
    metadata: {
      displayName: account.displayName
    }
  });

  return { account };
});

app.post("/api/marketplace-accounts/:id/disable", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);

  const account = await db.marketplaceAccount.update({
    where: { id: params.id, workspaceId: workspace.id },
    data: { status: "DISABLED" }
  });

  await recordAuditLog({
    workspaceId: workspace.id,
    actorUserId: auth.userId,
    action: "marketplace.disabled",
    targetType: "marketplace_account",
    targetId: account.id
  });

  return { account };
});

app.post("/api/source-lots/macbid", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
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
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const lots = await listWorkspaceLots(workspace.id);

  return { lots };
});

app.get("/api/source-lots/:id", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const lot = await db.sourceLot.findFirst({
    where: {
      id: params.id,
      workspaceId: workspace.id
    },
    include: {
      inventoryItems: {
        include: {
          images: true,
          listingDrafts: true
        }
      }
    }
  });

  if (!lot) {
    throw app.httpErrors.notFound("Lot not found");
  }

  return { lot };
});

app.post("/api/source-lots/:id/analyze", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const lot = await db.sourceLot.findFirst({
    where: {
      id: params.id,
      workspaceId: workspace.id
    }
  });

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
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const lot = await db.sourceLot.findFirst({
    where: {
      id: params.id,
      workspaceId: workspace.id
    }
  });

  if (!lot) {
    throw app.httpErrors.notFound("Lot not found");
  }

  const candidates = lotToInventoryCandidates({
    externalId: lot.externalId,
    title: lot.title,
    sourceUrl: lot.sourceUrl,
    categoryHint: String((lot.rawMetadataJson as Record<string, unknown>).categoryHint ?? "General Merchandise"),
    brandHint: ((lot.rawMetadataJson as Record<string, unknown>).brandHint as string | undefined) ?? undefined,
    quantity: Number((lot.rawMetadataJson as Record<string, unknown>).quantity ?? 1),
    rawMetadata: lot.rawMetadataJson as Record<string, unknown>,
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

app.get("/api/inventory", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const items = await listWorkspaceInventory(workspace.id);

  return { items };
});

app.post("/api/inventory", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const body = inventoryInputSchema.parse(request.body);
  const item = await createInventoryItem(workspace.id, {
    ...body,
    attributes: body.attributes
  });

  await recordAuditLog({
    workspaceId: workspace.id,
    actorUserId: auth.userId,
    action: "inventory.created",
    targetType: "inventory_item",
    targetId: item.id
  });

  return { item };
});

app.get("/api/inventory/:id", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const item = await db.inventoryItem.findFirst({
    where: {
      id: params.id,
      workspaceId: workspace.id
    },
    include: {
      images: {
        orderBy: { position: "asc" }
      },
      sourceLot: true,
      listingDrafts: true,
      platformListings: true,
      sales: true
    }
  });

  if (!item) {
    throw app.httpErrors.notFound("Inventory item not found");
  }

  return { item };
});

app.patch("/api/inventory/:id", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const body = inventoryInputSchema.partial().parse(request.body);
  const item = await db.inventoryItem.update({
    where: {
      id: params.id,
      workspaceId: workspace.id
    },
    data: {
      title: body.title,
      brand: body.brand,
      category: body.category,
      condition: body.condition,
      size: body.size,
      color: body.color,
      quantity: body.quantity,
      costBasis: body.costBasis,
      estimatedResaleMin: body.estimatedResaleMin,
      estimatedResaleMax: body.estimatedResaleMax,
      priceRecommendation: body.priceRecommendation,
      attributesJson: body.attributes
    }
  });

  await recordAuditLog({
    workspaceId: workspace.id,
    actorUserId: auth.userId,
    action: "inventory.updated",
    targetType: "inventory_item",
    targetId: item.id
  });

  return { item };
});

app.post("/api/inventory/:id/images", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const body = imageInputSchema.parse(request.body);
  const item = await db.inventoryItem.findFirst({
    where: {
      id: params.id,
      workspaceId: workspace.id
    },
    include: {
      images: true
    }
  });

  if (!item) {
    throw app.httpErrors.notFound("Inventory item not found");
  }

  const image = await db.imageAsset.create({
    data: {
      inventoryItemId: item.id,
      url: body.url,
      kind: body.kind,
      width: body.width ?? null,
      height: body.height ?? null,
      position: body.position ?? item.images.length
    }
  });

  return { image };
});

app.post("/api/inventory/:id/generate-drafts", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const body = z
    .object({
      platforms: z.array(z.enum(["EBAY", "DEPOP"])).min(1)
    })
    .parse(request.body);
  const item = await db.inventoryItem.findFirst({
    where: {
      id: params.id,
      workspaceId: workspace.id
    }
  });

  if (!item) {
    throw app.httpErrors.notFound("Inventory item not found");
  }

  await enqueueJob(
    "inventory.generateListingDraft",
    {
      inventoryItemId: item.id,
      workspaceId: workspace.id,
      platforms: body.platforms,
      correlationId: crypto.randomUUID()
    },
    {
      jobId: buildIdempotencyKey("inventory.generateListingDraft", `${item.id}:${body.platforms.join(",")}`)
    }
  );

  return { ok: true };
});

app.get("/api/inventory/:id/drafts", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);

  const drafts = await db.listingDraft.findMany({
    where: {
      inventoryItemId: params.id,
      inventoryItem: {
        workspaceId: workspace.id
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return { drafts };
});

app.patch("/api/drafts/:id", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const body = draftUpdateSchema.parse(request.body);
  const draft = await db.listingDraft.update({
    where: {
      id: params.id,
      inventoryItem: {
        workspaceId: workspace.id
      }
    },
    data: {
      generatedTitle: body.generatedTitle,
      generatedDescription: body.generatedDescription,
      generatedPrice: body.generatedPrice,
      generatedTagsJson: body.generatedTags,
      attributesJson: body.attributes,
      reviewStatus: body.reviewStatus
    }
  });

  return { draft };
});

app.post("/api/drafts/:id/approve", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const draft = await db.listingDraft.update({
    where: {
      id: params.id,
      inventoryItem: {
        workspaceId: workspace.id
      }
    },
    data: {
      reviewStatus: "APPROVED"
    }
  });

  await db.inventoryItem.update({
    where: { id: draft.inventoryItemId },
    data: {
      status: "READY"
    }
  });

  return { draft };
});

async function queuePublish(platform: "EBAY" | "DEPOP", inventoryItemId: string, workspaceId: string) {
  const [item, account, draft] = await Promise.all([
    db.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      include: { images: { orderBy: { position: "asc" } } }
    }),
    db.marketplaceAccount.findFirst({
      where: {
        workspaceId,
        platform,
        status: "CONNECTED"
      }
    }),
    db.listingDraft.findFirst({
      where: {
        inventoryItemId,
        platform,
        reviewStatus: "APPROVED"
      }
    })
  ]);

  if (!item) {
    throw app.httpErrors.notFound("Inventory item not found");
  }

  if (!account) {
    throw app.httpErrors.preconditionFailed(`Connect a ${platform} account first`);
  }

  if (!draft) {
    throw app.httpErrors.preconditionFailed(`Approve a ${platform} draft before publishing`);
  }

  const correlationId = crypto.randomUUID();
  const executionLog = await createExecutionLog({
    workspaceId,
    inventoryItemId,
    jobName: platform === "EBAY" ? "listing.publishEbay" : "listing.publishDepop",
    connector: platform,
    correlationId,
    requestPayload: {
      draftId: draft.id,
      marketplaceAccountId: account.id
    }
  });

  await enqueueJob(platform === "EBAY" ? "listing.publishEbay" : "listing.publishDepop", {
    inventoryItemId,
    draftId: draft.id,
    marketplaceAccountId: account.id,
    executionLogId: executionLog.id,
    correlationId
  });

  return {
    executionLog,
    draft
  };
}

app.post("/api/inventory/:id/publish/ebay", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);

  return queuePublish("EBAY", params.id, workspace.id);
});

app.post("/api/inventory/:id/publish/depop", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);

  return queuePublish("DEPOP", params.id, workspace.id);
});

app.get("/api/listings/:id", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const listing = await db.platformListing.findFirst({
    where: {
      id: params.id,
      inventoryItem: {
        workspaceId: workspace.id
      }
    },
    include: {
      inventoryItem: true,
      marketplaceAccount: true,
      executionLogs: {
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!listing) {
    throw app.httpErrors.notFound("Listing not found");
  }

  return { listing };
});

app.post("/api/listings/:id/retry", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const listing = await db.platformListing.findFirst({
    where: {
      id: params.id,
      inventoryItem: {
        workspaceId: workspace.id
      }
    }
  });

  if (!listing) {
    throw app.httpErrors.notFound("Listing not found");
  }

  const draft = await db.listingDraft.findFirst({
    where: {
      inventoryItemId: listing.inventoryItemId,
      platform: listing.platform,
      reviewStatus: "APPROVED"
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

app.get("/api/execution-logs", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const logs = await db.executionLog.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return { logs };
});

app.get("/api/audit-logs", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const logs = await db.auditLog.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return { logs };
});

app.get("/api/sales", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const sales = await db.sale.findMany({
    where: {
      inventoryItem: {
        workspaceId: workspace.id
      }
    },
    include: {
      inventoryItem: true,
      platformListing: true
    },
    orderBy: { soldAt: "desc" }
  });

  return { sales };
});

app.post("/api/sales/manual", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const body = manualSaleSchema.parse(request.body);
  const item = await db.inventoryItem.findFirst({
    where: {
      id: body.inventoryItemId,
      workspaceId: workspace.id
    }
  });

  if (!item) {
    throw app.httpErrors.notFound("Inventory item not found");
  }

  const sale = await db.sale.create({
    data: {
      inventoryItemId: item.id,
      soldPrice: body.soldPrice,
      fees: body.fees,
      shippingCost: body.shippingCost,
      soldAt: body.soldAt ? new Date(body.soldAt) : new Date(),
      payoutStatus: body.payoutStatus
    }
  });

  await db.inventoryItem.update({
    where: { id: item.id },
    data: {
      status: "SOLD"
    }
  });

  return { sale };
});

app.get("/api/analytics/pnl", async (request) => {
  const auth = await requireAuth(request);
  const workspace = await requireWorkspace(auth);
  const summary = await listWorkspaceSummary(workspace.id);
  const inventory = await listWorkspaceInventory(workspace.id);
  const lots = await listWorkspaceLots(workspace.id);

  return {
    summary,
    inventory,
    lots
  };
});

app.setErrorHandler((error, request, reply) => {
  const resolvedError = error as Error & { statusCode?: number };
  request.log.error(error);
  reply.status(resolvedError.statusCode ?? 500).send({
    error: resolvedError.message
  });
});

const bootstrap = async () => {
  try {
    await app.listen({
      host: "0.0.0.0",
      port: env.API_PORT
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

bootstrap();
