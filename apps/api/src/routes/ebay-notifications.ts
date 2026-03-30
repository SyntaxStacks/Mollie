import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";

import { markEbayMarketplaceAccountsDeleted } from "@reselleros/db";
import {
  ebayMarketplaceAccountDeletionChallengeSchema,
  ebayMarketplaceAccountDeletionNotificationSchema
} from "@reselleros/types";

import type { ApiApp } from "../lib/context.js";

const EBAY_ACCOUNT_DELETION_PATH = "/api/ebay/marketplace-account-deletion";

function resolvePublicEndpoint(request: FastifyRequest) {
  const configuredBaseUrl = process.env.API_PUBLIC_BASE_URL?.trim();

  if (configuredBaseUrl) {
    return new URL(EBAY_ACCOUNT_DELETION_PATH, configuredBaseUrl).toString();
  }

  const protocol = request.headers["x-forwarded-proto"] ?? "http";
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;

  if (!host) {
    throw new Error("Could not resolve public endpoint host for eBay notifications");
  }

  return `${protocol}://${host}${EBAY_ACCOUNT_DELETION_PATH}`;
}

function buildChallengeResponse(challengeCode: string, verificationToken: string, endpoint: string) {
  return createHash("sha256").update(challengeCode).update(verificationToken).update(endpoint).digest("hex");
}

export function registerEbayNotificationRoutes(app: ApiApp) {
  app.get(EBAY_ACCOUNT_DELETION_PATH, async (request) => {
    const query = ebayMarketplaceAccountDeletionChallengeSchema.parse(request.query);
    const verificationToken = process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN;

    if (!verificationToken) {
      throw app.httpErrors.serviceUnavailable("eBay marketplace account deletion verification token is not configured");
    }

    const endpoint = resolvePublicEndpoint(request);

    return {
      challengeResponse: buildChallengeResponse(query.challenge_code, verificationToken, endpoint)
    };
  });

  app.post(EBAY_ACCOUNT_DELETION_PATH, async (request, reply) => {
    const body = ebayMarketplaceAccountDeletionNotificationSchema.parse(request.body);

    const updatedAccounts = await markEbayMarketplaceAccountsDeleted({
      notificationId: body.notification.notificationId,
      externalAccountId: body.notification.data.userId ?? null,
      username: body.notification.data.username ?? null,
      eiasToken: body.notification.data.eiasToken ?? null,
      eventDate: body.notification.eventDate,
      publishDate: body.notification.publishDate,
      rawNotification: body
    });

    request.log.info(
      {
        topic: body.metadata.topic,
        notificationId: body.notification.notificationId,
        externalAccountId: body.notification.data.userId ?? null,
        username: body.notification.data.username ?? null,
        matchedMarketplaceAccounts: updatedAccounts.length
      },
      "processed ebay marketplace account deletion notification"
    );

    return reply.status(204).send();
  });
}
