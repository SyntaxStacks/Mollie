import { createProductLookupService, lookupCatalogIdentifier } from "@reselleros/catalog";
import { catalogLookupRequestSchema, productLookupBarcodeRequestSchema } from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

export function registerCatalogRoutes(app: ApiApp, context: ApiRouteContext) {
  const productLookupService = createProductLookupService();

  app.post("/api/catalog/lookup", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = catalogLookupRequestSchema.parse(request.body);

    const identifier = body.identifier?.trim() || body.barcode?.trim();

    if (!identifier) {
      throw app.httpErrors.badRequest("Provide a UPC, EAN, or ISBN");
    }

    const result = await lookupCatalogIdentifier({
      workspaceId: workspace.id,
      identifier,
      identifierType: body.identifierType ?? null
    });

    return { result };
  });

  app.post("/api/product-lookup/barcode", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = productLookupBarcodeRequestSchema.parse(request.body);
    const result = await productLookupService.lookupBarcode({
      workspaceId: workspace.id,
      barcode: body.barcode
    });

    return { result };
  });
}
