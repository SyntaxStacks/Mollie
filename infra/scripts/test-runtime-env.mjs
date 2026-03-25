import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function firstDefined(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

export function loadEnvFile(filePath) {
  const entries = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    entries[key] = value;
  }

  return entries;
}

export function sanitizeTarget(urlString) {
  const parsed = new URL(urlString);
  const databaseName = parsed.pathname.replace(/^\/+/, "") || "<none>";
  const port = parsed.port || (parsed.protocol.startsWith("postgres") ? "5432" : "6379");
  return `${parsed.protocol}//${parsed.hostname}:${port}/${databaseName}`;
}

export function assertLocalDatabaseTarget(name, urlString) {
  const parsed = new URL(urlString);
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);

  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    throw new Error(`${name} must use a PostgreSQL URL. Received ${parsed.protocol}`);
  }

  if (!allowedHosts.has(parsed.hostname)) {
    throw new Error(`${name} must target a local PostgreSQL host. Received ${sanitizeTarget(urlString)}`);
  }

  if (parsed.pathname.replace(/^\/+/, "") !== "reselleros") {
    throw new Error(`${name} must target the reselleros database. Received ${sanitizeTarget(urlString)}`);
  }
}

export function assertLocalRedisTarget(name, urlString) {
  const parsed = new URL(urlString);
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);

  if (parsed.protocol !== "redis:") {
    throw new Error(`${name} must use a Redis URL. Received ${parsed.protocol}`);
  }

  if (!allowedHosts.has(parsed.hostname)) {
    throw new Error(`${name} must target a local Redis host. Received ${sanitizeTarget(urlString)}`);
  }
}

export function resolveTestRuntimeEnv(rootDir, options) {
  const explicitEnvPath = process.env[options.envVarName] ? path.resolve(rootDir, process.env[options.envVarName]) : null;
  const envPath = explicitEnvPath
    ? explicitEnvPath
    : existsSync(path.join(rootDir, ".env"))
      ? path.join(rootDir, ".env")
      : path.join(rootDir, ".env.example");

  if (!existsSync(envPath)) {
    throw new Error(`${options.label} env file not found: ${envPath}`);
  }

  const fileEnv = loadEnvFile(envPath);
  const postgresUser = firstDefined(fileEnv.POSTGRES_USER, "postgres");
  const postgresPassword = firstDefined(fileEnv.POSTGRES_PASSWORD, "postgres");
  const postgresDatabase = firstDefined(fileEnv.POSTGRES_DB, "reselleros");
  const postgresHostPort = firstDefined(fileEnv.POSTGRES_HOST_PORT, "5432");
  const redisHostPort = firstDefined(fileEnv.REDIS_HOST_PORT, "6379");
  const derivedDatabaseUrl = `postgresql://${postgresUser}:${postgresPassword}@localhost:${postgresHostPort}/${postgresDatabase}`;
  const derivedRedisUrl = `redis://localhost:${redisHostPort}`;
  const effectiveDatabaseUrl = firstDefined(fileEnv.DATABASE_URL, derivedDatabaseUrl);
  const effectiveDirectUrl = firstDefined(fileEnv.DIRECT_URL, effectiveDatabaseUrl);
  const effectiveRedisUrl = firstDefined(fileEnv.REDIS_URL, derivedRedisUrl);

  assertLocalDatabaseTarget("DATABASE_URL", effectiveDatabaseUrl);
  assertLocalDatabaseTarget("DIRECT_URL", effectiveDirectUrl);
  assertLocalRedisTarget("REDIS_URL", effectiveRedisUrl);

  const childEnv = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: effectiveDatabaseUrl,
    DIRECT_URL: effectiveDirectUrl,
    REDIS_URL: effectiveRedisUrl,
    POSTGRES_DB: postgresDatabase,
    POSTGRES_USER: postgresUser,
    POSTGRES_PASSWORD: postgresPassword,
    POSTGRES_HOST_PORT: postgresHostPort,
    REDIS_HOST_PORT: redisHostPort,
    SESSION_SECRET: firstDefined(fileEnv.SESSION_SECRET, options.defaultSessionSecret ?? "test-session-secret"),
    GCS_BUCKET_UPLOADS: firstDefined(fileEnv.GCS_BUCKET_UPLOADS, options.defaultUploadsBucket ?? "reselleros-test-uploads"),
    GCS_BUCKET_ARTIFACTS: firstDefined(fileEnv.GCS_BUCKET_ARTIFACTS, options.defaultArtifactsBucket ?? "reselleros-test-artifacts"),
    OPENAI_MODEL: firstDefined(fileEnv.OPENAI_MODEL, "gpt-4.1-mini"),
    ...(options.extraEnv ?? {})
  };

  return {
    envPath,
    effectiveDatabaseUrl,
    effectiveDirectUrl,
    effectiveRedisUrl,
    childEnv
  };
}

export function logResolvedRuntimeTargets(label, rootDir, runtime, extraTargets = {}) {
  console.log(`${label} env source: ${path.relative(rootDir, runtime.envPath)}`);
  console.log(`${label} DATABASE_URL: ${sanitizeTarget(runtime.effectiveDatabaseUrl)}`);
  console.log(`${label} DIRECT_URL: ${sanitizeTarget(runtime.effectiveDirectUrl)}`);
  console.log(`${label} REDIS_URL: ${sanitizeTarget(runtime.effectiveRedisUrl)}`);

  for (const [name, value] of Object.entries(extraTargets)) {
    console.log(`${label} ${name}: ${value}`);
  }
}

export function probeLocalDatabase(rootDir, childEnv, databaseUrl, label) {
  const result =
    process.platform === "win32"
      ? spawnSync(
          "cmd.exe",
          [
            "/c",
            "pnpm.cmd",
            "--filter",
            "@reselleros/db",
            "exec",
            "prisma",
            "db",
            "execute",
            "--stdin",
            "--schema",
            "prisma/schema.prisma"
          ],
          {
            cwd: rootDir,
            env: childEnv,
            encoding: "utf8",
            input: "SELECT 1;"
          }
        )
      : spawnSync(
          "pnpm",
          ["--filter", "@reselleros/db", "exec", "prisma", "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"],
          {
            cwd: rootDir,
            env: childEnv,
            encoding: "utf8",
            input: "SELECT 1;"
          }
        );

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${label} database preflight failed for ${sanitizeTarget(databaseUrl)}\n${details}`);
  }

  console.log(`${label} database preflight passed`);
}
