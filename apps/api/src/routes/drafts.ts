import { z } from "zod";

import { approveDraftForWorkspace, updateDraftForWorkspace } from "@reselleros/db";
import { draftUpdateSchema } from "@reselleros/types";

import type { ApiApp, ApiRouteContext } from "../lib/context.js";

export function registerDraftRoutes(app: ApiApp, context: ApiRouteContext) {
  app.patch("/api/drafts/:id", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = draftUpdateSchema.parse(request.body);
    const draft = await updateDraftForWorkspace(workspace.id, params.id, {
      generatedTitle: body.generatedTitle,
      generatedDescription: body.generatedDescription,
      generatedPrice: body.generatedPrice,
      generatedTagsJson: body.generatedTags,
      attributesJson: body.attributes,
      reviewStatus: body.reviewStatus
    });

    if (!draft) {
      throw app.httpErrors.notFound("Draft not found");
    }

    return { draft };
  });

  app.post("/api/drafts/:id/approve", async (request) => {
    const auth = await context.requireAuth(request);
    const workspace = await context.requireWorkspace(auth);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const draft = await approveDraftForWorkspace(workspace.id, params.id);

    if (!draft) {
      throw app.httpErrors.notFound("Draft not found");
    }

    return { draft };
  });
}
