import { classifyIdentifier, createProductLookupService, lookupCatalogIdentifier, normalizeIdentifier } from "@reselleros/catalog";
import { catalogLookupRequestSchema, productLookupBarcodeRequestSchema } from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

function isCatalogStorageError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("CatalogIdentifier") ||
    message.includes("CatalogObservation") ||
    message.includes("WorkspaceCatalogObservation") ||
    message.includes("WorkspaceCatalogOverride")
  );
}

function wrapCatalogError(app: ApiApp, error: unknown): never {
  if (isCatalogStorageError(error)) {
    throw app.httpErrors.serviceUnavailable(
      "Barcode lookup is still being prepared. Continue with manual entry while catalog storage finishes syncing."
    );
  }

  throw error;
}

function invalidIdentifierMessage() {
  return "Scan or enter a UPC, EAN, or ISBN barcode. QR code links are not supported in this step.";
}

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

    let result;

    try {
      result = await lookupCatalogIdentifier({
        workspaceId: workspace.id,
        identifier,
        identifierType: body.identifierType ?? null
      });
    } catch (error) {
      wrapCatalogError(app, error);
    }

    return { result };
  });

  app.post("/api/product-lookup/barcode", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const parsedBody = productLookupBarcodeRequestSchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw app.httpErrors.badRequest(invalidIdentifierMessage());
    }

    const normalizedBarcode = normalizeIdentifier(parsedBody.data.barcode);

    if (!normalizedBarcode || classifyIdentifier(normalizedBarcode) === "UNKNOWN") {
      throw app.httpErrors.badRequest(invalidIdentifierMessage());
    }

    let result;

    try {
      result = await productLookupService.lookupBarcode({
        workspaceId: workspace.id,
        barcode: normalizedBarcode
      });
    } catch (error) {
      wrapCatalogError(app, error);
    }

    return { result };
  });
}
