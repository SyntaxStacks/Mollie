import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";

import { loadApiEnv } from "@reselleros/config";
import { createLogger } from "@reselleros/observability";

import { createApiRouteContext, type ApiApp } from "./lib/context.js";
import { registerApiRoutes } from "./routes/index.js";

const env = loadApiEnv();

export function buildApiApp(): ApiApp {
  const app = Fastify({
    loggerInstance: createLogger("api")
  });

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");

    if (rawBody.trim().length === 0) {
      done(null, {});
      return;
    }

    try {
      done(null, JSON.parse(rawBody));
    } catch (error) {
      done(error as Error);
    }
  });

  app.register(cors, {
    origin: true
  });
  app.register(multipart);
  app.register(sensible);
  app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute"
  });

  registerApiRoutes(app, createApiRouteContext(app));

  app.setErrorHandler((error, request, reply) => {
    const resolvedError = error as Error & { statusCode?: number };
    request.log.error(error);
    reply.status(resolvedError.statusCode ?? 500).send({
      error: resolvedError.message
    });
  });

  return app as ApiApp;
}

export async function startApiServer() {
  const app = buildApiApp();

  try {
    await app.listen({
      host: "0.0.0.0",
      port: Number(process.env.PORT ?? env.API_PORT)
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

if (process.env.RESELLEROS_DISABLE_API_BOOTSTRAP !== "1") {
  void startApiServer();
}
