import { z } from "zod";

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  SESSION_SECRET: z.string().min(8),
  AUTH_EXPOSE_DEV_CODE: z.coerce.boolean().default(false),
  AUTH_EMAIL_FROM: z.string().email().optional(),
  AUTH_EMAIL_REPLY_TO: z.string().email().optional(),
  RESEND_API_KEY: z.string().optional(),
  APP_BASE_URL: z.string().url(),
  API_PUBLIC_BASE_URL: z.string().url().optional(),
  GCS_BUCKET_UPLOADS: z.string().min(1),
  GCS_BUCKET_ARTIFACTS: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  EBAY_CLIENT_ID: z.string().optional(),
  EBAY_CLIENT_SECRET: z.string().optional(),
  EBAY_REDIRECT_URI: z.string().url().optional(),
  EBAY_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  EBAY_SCOPES: z.string().optional(),
  EBAY_LIVE_PUBLISH_ENABLED: z.coerce.boolean().default(false),
  EBAY_MARKETPLACE_ID: z.string().default("EBAY_US"),
  EBAY_CURRENCY: z.string().default("USD"),
  EBAY_MERCHANT_LOCATION_KEY: z.string().optional(),
  EBAY_PAYMENT_POLICY_ID: z.string().optional(),
  EBAY_RETURN_POLICY_ID: z.string().optional(),
  EBAY_FULFILLMENT_POLICY_ID: z.string().optional()
});

const apiEnvSchema = baseEnvSchema.extend({
  API_PORT: z.coerce.number().int().positive().default(4000)
});

const workerEnvSchema = baseEnvSchema.extend({
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5)
});

const connectorEnvSchema = baseEnvSchema.extend({
  API_PORT: z.coerce.number().int().positive().default(4010),
  CONNECTOR_CONCURRENCY: z.coerce.number().int().positive().default(1),
  CONNECTOR_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(3),
  ARTIFACT_BASE_DIR: z.string().default("tmp/artifacts")
});

const webEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_API_BASE_URL: z.string().url(),
  WEB_PORT: z.coerce.number().int().positive().default(3000)
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type ConnectorEnv = z.infer<typeof connectorEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;

export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return apiEnvSchema.parse(source);
}

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return workerEnvSchema.parse(source);
}

export function loadConnectorEnv(source: NodeJS.ProcessEnv = process.env): ConnectorEnv {
  return connectorEnvSchema.parse(source);
}

export function loadWebEnv(source: NodeJS.ProcessEnv = process.env): WebEnv {
  return webEnvSchema.parse(source);
}
