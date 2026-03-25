import { createManualSaleForWorkspace, db } from "@reselleros/db";
import { manualSaleSchema } from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

export function registerSalesRoutes(app: ApiApp, context: ApiRouteContext) {
  app.get("/api/sales", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
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
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = manualSaleSchema.parse(request.body);
    const sale = await createManualSaleForWorkspace(workspace.id, {
      inventoryItemId: body.inventoryItemId,
      soldPrice: body.soldPrice,
      fees: body.fees,
      shippingCost: body.shippingCost,
      soldAt: body.soldAt ? new Date(body.soldAt) : new Date(),
      payoutStatus: body.payoutStatus
    });

    if (!sale) {
      throw app.httpErrors.notFound("Inventory item not found");
    }

    return { sale };
  });
}
