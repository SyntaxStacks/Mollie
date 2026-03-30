import type { ApiApp, ApiRouteContext } from "../lib/context.js";
import { registerAnalyticsRoutes } from "./analytics.js";
import { registerAuthRoutes } from "./auth.js";
import { registerCatalogRoutes } from "./catalog.js";
import { registerDraftRoutes } from "./drafts.js";
import { registerEbayNotificationRoutes } from "./ebay-notifications.js";
import { registerHealthRoutes } from "./health.js";
import { registerInventoryRoutes } from "./inventory.js";
import { registerListingRoutes } from "./listings.js";
import { registerLogRoutes } from "./logs.js";
import { registerMarketplaceAccountRoutes } from "./marketplace-accounts.js";
import { registerSalesRoutes } from "./sales.js";
import { registerSourceLotRoutes } from "./source-lots.js";
import { registerWorkspaceRoutes } from "./workspace.js";

export function registerApiRoutes(app: ApiApp, context: ApiRouteContext) {
  registerHealthRoutes(app);
  registerEbayNotificationRoutes(app);
  registerAuthRoutes(app, context);
  registerWorkspaceRoutes(app, context);
  registerCatalogRoutes(app, context);
  registerMarketplaceAccountRoutes(app, context);
  registerSourceLotRoutes(app, context);
  registerInventoryRoutes(app, context);
  registerDraftRoutes(app, context);
  registerListingRoutes(app, context);
  registerLogRoutes(app, context);
  registerSalesRoutes(app, context);
  registerAnalyticsRoutes(app, context);
}
