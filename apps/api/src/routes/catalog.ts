import { identifyProductFromImage } from "@reselleros/ai";
import { classifyIdentifier, createProductLookupService, lookupCatalogIdentifier, normalizeIdentifier } from "@reselleros/catalog";
import { acceptedImageContentTypes, maxInventoryImageBytes } from "@reselleros/storage";
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
  return "Scan or enter a supported barcode. QR code links are not supported in this step.";
}

export function registerCatalogRoutes(app: ApiApp, context: ApiRouteContext) {
  const productLookupService = createProductLookupService();

  app.post("/api/catalog/lookup", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const body = catalogLookupRequestSchema.parse(request.body);

    const identifier = body.identifier?.trim() || body.barcode?.trim();

    if (!identifier) {
      throw app.httpErrors.badRequest("Provide a supported barcode");
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

  app.post("/api/product-lookup/vision", async (request) => {
    const auth = await context.requireAuth(request);
    await context.requireWorkspace(auth);
    const file = await request.file({
      limits: {
        files: 1,
        fileSize: maxInventoryImageBytes
      }
    });

    if (!file) {
      throw app.httpErrors.badRequest("Choose an image to analyze.");
    }

    if (!acceptedImageContentTypes.has(file.mimetype)) {
      throw app.httpErrors.unsupportedMediaType("Upload a JPG, PNG, WEBP, or GIF image.");
    }

    const notesField = file.fields.notes;
    const notes =
      notesField && "value" in notesField && typeof notesField.value === "string" && notesField.value.trim().length > 0
        ? notesField.value.trim()
        : null;
    const result = await identifyProductFromImage({
      imageBase64: (await file.toBuffer()).toString("base64"),
      mediaType: file.mimetype,
      notes
    });

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
    const identifierType = parsedBody.data.identifierType ?? classifyIdentifier(normalizedBarcode);

    if (!normalizedBarcode || identifierType === "UNKNOWN") {
      throw app.httpErrors.badRequest(invalidIdentifierMessage());
    }

    let result;

    try {
      result = await productLookupService.lookupBarcode({
        workspaceId: workspace.id,
        barcode: normalizedBarcode,
        identifierType
      });
    } catch (error) {
      wrapCatalogError(app, error);
    }

    return { result };
  });
}
