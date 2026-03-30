import { lookupAmazonCatalog } from "@reselleros/catalog";
import { catalogLookupRequestSchema } from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

export function registerCatalogRoutes(app: ApiApp, context: ApiRouteContext) {
  app.post("/api/catalog/lookup", async (request) => {
    const auth = await context.requireAuth(request);
    await context.requireWorkspace(auth);
    const body = catalogLookupRequestSchema.parse(request.body);

    if (body.provider === "AMAZON") {
      const result = await lookupAmazonCatalog({
        barcode: body.barcode ?? null,
        amazonAsin: body.amazonAsin ?? null
      });

      return { result };
    }

    throw app.httpErrors.badRequest("Unsupported catalog provider");
  });
}
