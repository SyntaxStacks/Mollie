import type { ApiApp } from "../lib/context.js";

export function registerHealthRoutes(app: ApiApp) {
  app.get("/health", async () => ({
    ok: true,
    service: "reselleros-api",
    timestamp: new Date().toISOString()
  }));
}
