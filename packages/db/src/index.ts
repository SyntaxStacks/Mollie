import prismaClientPackage from "@prisma/client";
import type { Prisma } from "@prisma/client";

const { PrismaClient } = prismaClientPackage;

const globalForPrisma = globalThis as unknown as { prisma?: import("@prisma/client").PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

export type { Prisma };

function nextSku() {
  return `SKU-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

export async function getWorkspaceForUser(userId: string) {
  return db.workspaceMembership.findFirst({
    where: { userId },
    include: {
      workspace: {
        include: {
          owner: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });
}

export async function createWorkspaceForUser(userId: string, name: string) {
  return db.workspace.create({
    data: {
      ownerUserId: userId,
      name,
      billingCustomerId: `cus_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      memberships: {
        create: {
          userId,
          role: "OWNER"
        }
      }
    }
  });
}

export async function listWorkspaceMembershipsForUser(userId: string) {
  return db.workspaceMembership.findMany({
    where: { userId },
    include: {
      workspace: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });
}

export async function listWorkspaceMembers(workspaceId: string) {
  return db.workspaceMembership.findMany({
    where: { workspaceId },
    include: {
      user: true
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }]
  });
}

export async function addWorkspaceMemberByEmail(
  workspaceId: string,
  input: {
    email: string;
    name?: string | null;
    role?: "OWNER" | "MEMBER";
  }
) {
  const normalizedEmail = input.email.trim().toLowerCase();

  return db.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email: normalizedEmail },
      update: {
        name: input.name ?? undefined
      },
      create: {
        email: normalizedEmail,
        name: input.name ?? undefined
      }
    });

    const existingMembership = await tx.workspaceMembership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: user.id
        }
      },
      include: {
        user: true
      }
    });

    if (existingMembership) {
      return {
        membership: existingMembership,
        created: false
      };
    }

    const membership = await tx.workspaceMembership.create({
      data: {
        workspaceId,
        userId: user.id,
        role: input.role ?? "MEMBER"
      },
      include: {
        user: true
      }
    });

    return {
      membership,
      created: true
    };
  });
}

export async function updateWorkspaceConnectorAutomation(workspaceId: string, enabled: boolean) {
  return db.workspace.update({
    where: { id: workspaceId },
    data: {
      connectorAutomationEnabled: enabled
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
  attempt?: number;
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
      attempt: input.attempt ?? 1,
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

export async function createMarketplaceAccountForWorkspace(
  workspaceId: string,
  input: {
    platform: "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT";
    displayName: string;
    secretRef: string;
    credentialType?: "SECRET_REF" | "OAUTH_TOKEN_SET";
    validationStatus?: "UNVERIFIED" | "VALID" | "INVALID" | "NEEDS_REFRESH";
    externalAccountId?: string | null;
    credentialMetadata?: Prisma.InputJsonValue;
    credentialPayload?: Prisma.InputJsonValue;
  }
) {
  return db.marketplaceAccount.create({
    data: {
      workspaceId,
      platform: input.platform,
      displayName: input.displayName,
      secretRef: input.secretRef,
      credentialType: input.credentialType ?? "SECRET_REF",
      validationStatus: input.validationStatus ?? "VALID",
      externalAccountId: input.externalAccountId ?? null,
      credentialMetadataJson: input.credentialMetadata,
      credentialPayloadJson: input.credentialPayload,
      lastValidatedAt: input.validationStatus === "VALID" ? new Date() : null,
      status: "CONNECTED"
    }
  });
}

export async function upsertMarketplaceAccountConnectionForWorkspace(
  workspaceId: string,
  input: {
    platform: "EBAY" | "DEPOP" | "POSHMARK" | "WHATNOT";
    displayName: string;
    secretRef: string;
    credentialType: "SECRET_REF" | "OAUTH_TOKEN_SET";
    validationStatus: "UNVERIFIED" | "VALID" | "INVALID" | "NEEDS_REFRESH";
    externalAccountId?: string | null;
    credentialMetadata?: Prisma.InputJsonValue;
    credentialPayload?: Prisma.InputJsonValue;
  }
) {
  const existing =
    input.externalAccountId
      ? await db.marketplaceAccount.findFirst({
          where: {
            workspaceId,
            platform: input.platform,
            externalAccountId: input.externalAccountId
          }
        })
      : null;

  if (!existing) {
    return createMarketplaceAccountForWorkspace(workspaceId, input);
  }

  return db.marketplaceAccount.update({
    where: { id: existing.id },
    data: {
      displayName: input.displayName,
      secretRef: input.secretRef,
      credentialType: input.credentialType,
      validationStatus: input.validationStatus,
      credentialMetadataJson: input.credentialMetadata,
      credentialPayloadJson: input.credentialPayload,
      lastValidatedAt: input.validationStatus === "VALID" ? new Date() : null,
      lastErrorCode: null,
      lastErrorMessage: null,
      consecutiveFailureCount: 0,
      lastFailureAt: null,
      status: "CONNECTED"
    }
  });
}

export async function updateMarketplaceAccountCredentials(
  marketplaceAccountId: string,
  input: {
    validationStatus?: "UNVERIFIED" | "VALID" | "INVALID" | "NEEDS_REFRESH";
    credentialMetadata?: Prisma.InputJsonValue;
    credentialPayload?: Prisma.InputJsonValue;
    lastValidatedAt?: Date | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
  }
) {
  return db.marketplaceAccount.update({
    where: { id: marketplaceAccountId },
    data: {
      validationStatus: input.validationStatus,
      credentialMetadataJson: input.credentialMetadata,
      credentialPayloadJson: input.credentialPayload,
      lastValidatedAt: input.lastValidatedAt,
      lastErrorCode: input.lastErrorCode,
      lastErrorMessage: input.lastErrorMessage
    }
  });
}

export async function markMarketplaceAccountConnectorFailure(input: {
  marketplaceAccountId: string;
  code: string;
  message: string;
  failureThreshold: number;
}) {
  const account = await db.marketplaceAccount.findUnique({
    where: { id: input.marketplaceAccountId }
  });

  if (!account) {
    return null;
  }

  const nextFailureCount = account.consecutiveFailureCount + 1;

  return db.marketplaceAccount.update({
    where: { id: account.id },
    data: {
      consecutiveFailureCount: nextFailureCount,
      lastFailureAt: new Date(),
      lastErrorCode: input.code,
      lastErrorMessage: input.message,
      status: nextFailureCount >= input.failureThreshold ? "ERROR" : account.status
    }
  });
}

export async function resetMarketplaceAccountConnectorHealth(marketplaceAccountId: string) {
  return db.marketplaceAccount.update({
    where: { id: marketplaceAccountId },
    data: {
      consecutiveFailureCount: 0,
      lastFailureAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      status: "CONNECTED"
    }
  });
}

export async function disableMarketplaceAccountForWorkspace(workspaceId: string, accountId: string) {
  const account = await db.marketplaceAccount.findFirst({
    where: {
      id: accountId,
      workspaceId
    }
  });

  if (!account) {
    return null;
  }

  return db.marketplaceAccount.update({
    where: { id: account.id },
    data: {
      status: "DISABLED"
    }
  });
}

export async function markEbayMarketplaceAccountsDeleted(input: {
  externalAccountId?: string | null;
  username?: string | null;
  eiasToken?: string | null;
  notificationId: string;
  eventDate?: string | null;
  publishDate?: string | null;
  rawNotification: Prisma.InputJsonValue;
}) {
  const identifiers = [input.externalAccountId, input.username].filter(
    (value): value is string => Boolean(value && value.trim())
  );

  if (identifiers.length === 0 && !input.eiasToken) {
    return [];
  }

  const accounts = await db.marketplaceAccount.findMany({
    where: {
      platform: "EBAY",
      OR: [
        ...(identifiers.length
          ? [
              {
                externalAccountId: {
                  in: identifiers
                }
              }
            ]
          : []),
        ...(input.eiasToken
          ? [
              {
                credentialMetadataJson: {
                  path: ["eiasToken"],
                  equals: input.eiasToken
                }
              }
            ]
          : [])
      ]
    }
  });

  const updates: typeof accounts = [];

  for (const account of accounts) {
    const nextMetadata = {
      ...((account.credentialMetadataJson ?? {}) as Record<string, unknown>),
      marketplaceAccountDeletion: {
        notificationId: input.notificationId,
        eventDate: input.eventDate ?? null,
        publishDate: input.publishDate ?? null,
        deletedAt: new Date().toISOString()
      }
    } satisfies Record<string, unknown>;

    const updated = await db.marketplaceAccount.update({
      where: { id: account.id },
      data: {
        status: "DISABLED",
        validationStatus: "INVALID",
        lastErrorCode: "EBAY_MARKETPLACE_ACCOUNT_DELETION",
        lastErrorMessage: "eBay reported that this marketplace account requested deletion and closure.",
        credentialMetadataJson: nextMetadata
      }
    });

    await recordAuditLog({
      workspaceId: updated.workspaceId,
      action: "marketplace.ebay.account_deleted",
      targetType: "marketplace_account",
      targetId: updated.id,
      metadata: {
        notificationId: input.notificationId,
        externalAccountId: input.externalAccountId ?? null,
        username: input.username ?? null,
        eiasToken: input.eiasToken ?? null,
        rawNotification: input.rawNotification
      }
    });

    updates.push(updated);
  }

  return updates;
}

export async function updateMarketplaceAccountMetadataForWorkspace(
  workspaceId: string,
  accountId: string,
  metadata: Prisma.InputJsonValue
) {
  const account = await db.marketplaceAccount.findFirst({
    where: {
      id: accountId,
      workspaceId
    }
  });

  if (!account) {
    return null;
  }

  return db.marketplaceAccount.update({
    where: { id: account.id },
    data: {
      credentialMetadataJson: metadata
    }
  });
}

export async function findSourceLotForWorkspace(workspaceId: string, lotId: string) {
  return db.sourceLot.findFirst({
    where: {
      id: lotId,
      workspaceId
    }
  });
}

export async function findSourceLotDetailForWorkspace(workspaceId: string, lotId: string) {
  return db.sourceLot.findFirst({
    where: {
      id: lotId,
      workspaceId
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
}

export async function findInventoryItemForWorkspace(workspaceId: string, inventoryItemId: string) {
  return db.inventoryItem.findFirst({
    where: {
      id: inventoryItemId,
      workspaceId
    }
  });
}

export async function findInventoryItemDetailForWorkspace(workspaceId: string, inventoryItemId: string) {
  return db.inventoryItem.findFirst({
    where: {
      id: inventoryItemId,
      workspaceId
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
}

export async function findInventoryItemWithImagesForWorkspace(workspaceId: string, inventoryItemId: string) {
  return db.inventoryItem.findFirst({
    where: {
      id: inventoryItemId,
      workspaceId
    },
    include: {
      images: {
        orderBy: { position: "asc" }
      }
    }
  });
}

export async function updateInventoryItemForWorkspace(
  workspaceId: string,
  inventoryItemId: string,
  data: Prisma.InventoryItemUpdateInput
) {
  const item = await findInventoryItemForWorkspace(workspaceId, inventoryItemId);

  if (!item) {
    return null;
  }

  return db.inventoryItem.update({
    where: { id: item.id },
    data
  });
}

export async function addInventoryImageForWorkspace(
  workspaceId: string,
  inventoryItemId: string,
  input: {
    url: string;
    kind: "ORIGINAL" | "DERIVED";
    width?: number | null;
    height?: number | null;
    position: number;
  }
) {
  const item = await findInventoryItemWithImagesForWorkspace(workspaceId, inventoryItemId);

  if (!item) {
    return null;
  }

  const image = await db.imageAsset.create({
    data: {
      inventoryItemId: item.id,
      url: input.url,
      kind: input.kind,
      width: input.width ?? null,
      height: input.height ?? null,
      position: input.position
    }
  });

  return { item, image };
}

export async function deleteInventoryImageForWorkspace(workspaceId: string, inventoryItemId: string, imageId: string) {
  const item = await findInventoryItemWithImagesForWorkspace(workspaceId, inventoryItemId);

  if (!item) {
    return null;
  }

  const image = item.images.find((candidate) => candidate.id === imageId);

  if (!image) {
    return null;
  }

  await db.$transaction([
    db.imageAsset.delete({
      where: { id: image.id }
    }),
    ...item.images
      .filter((candidate) => candidate.id !== image.id)
      .sort((left, right) => left.position - right.position)
      .map((candidate, index) =>
        db.imageAsset.update({
          where: { id: candidate.id },
          data: {
            position: index
          }
        })
      )
  ]);

  return { item, image };
}

export async function reorderInventoryImagesForWorkspace(
  workspaceId: string,
  inventoryItemId: string,
  orderedImageIds: string[]
) {
  const item = await findInventoryItemWithImagesForWorkspace(workspaceId, inventoryItemId);

  if (!item) {
    return null;
  }

  const existingImageIds = item.images.map((image) => image.id).sort();
  const requestedImageIds = [...orderedImageIds].sort();

  if (
    existingImageIds.length !== requestedImageIds.length ||
    existingImageIds.some((imageId, index) => imageId !== requestedImageIds[index])
  ) {
    throw new Error("Image reorder must include every image exactly once");
  }

  await db.$transaction(
    orderedImageIds.map((imageId, index) =>
      db.imageAsset.update({
        where: { id: imageId },
        data: {
          position: index
        }
      })
    )
  );

  return findInventoryItemWithImagesForWorkspace(workspaceId, inventoryItemId);
}

export async function findDraftForWorkspace(workspaceId: string, draftId: string) {
  return db.listingDraft.findFirst({
    where: {
      id: draftId,
      inventoryItem: {
        workspaceId
      }
    }
  });
}

export async function updateDraftForWorkspace(
  workspaceId: string,
  draftId: string,
  data: Prisma.ListingDraftUpdateInput
) {
  const draft = await findDraftForWorkspace(workspaceId, draftId);

  if (!draft) {
    return null;
  }

  return db.listingDraft.update({
    where: { id: draft.id },
    data
  });
}

export async function approveDraftForWorkspace(workspaceId: string, draftId: string) {
  const draft = await findDraftForWorkspace(workspaceId, draftId);

  if (!draft) {
    return null;
  }

  const approvedDraft = await db.listingDraft.update({
    where: { id: draft.id },
    data: {
      reviewStatus: "APPROVED"
    }
  });

  await db.inventoryItem.update({
    where: { id: approvedDraft.inventoryItemId },
    data: {
      status: "READY"
    }
  });

  return approvedDraft;
}

export async function findPlatformListingForWorkspace(workspaceId: string, listingId: string) {
  return db.platformListing.findFirst({
    where: {
      id: listingId,
      inventoryItem: {
        workspaceId
      }
    }
  });
}

export async function findPlatformListingDetailForWorkspace(workspaceId: string, listingId: string) {
  return db.platformListing.findFirst({
    where: {
      id: listingId,
      inventoryItem: {
        workspaceId
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
}

export async function createManualSaleForWorkspace(
  workspaceId: string,
  input: {
    inventoryItemId: string;
    soldPrice: number;
    fees: number;
    shippingCost: number;
    soldAt: Date;
    payoutStatus: "PENDING" | "PAID" | "DISPUTED";
  }
) {
  const item = await findInventoryItemForWorkspace(workspaceId, input.inventoryItemId);

  if (!item) {
    return null;
  }

  const sale = await db.sale.create({
    data: {
      inventoryItemId: item.id,
      soldPrice: input.soldPrice,
      fees: input.fees,
      shippingCost: input.shippingCost,
      soldAt: input.soldAt,
      payoutStatus: input.payoutStatus
    }
  });

  await db.inventoryItem.update({
    where: { id: item.id },
    data: {
      status: "SOLD"
    }
  });

  return sale;
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
