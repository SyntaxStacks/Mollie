import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const rootDir = process.cwd();
const explicitEnvPath = process.env.RESELLEROS_E2E_ENV_FILE
  ? path.resolve(rootDir, process.env.RESELLEROS_E2E_ENV_FILE)
  : null;
const envPath = explicitEnvPath
  ? explicitEnvPath
  : existsSync(path.join(rootDir, ".env"))
    ? path.join(rootDir, ".env")
    : path.join(rootDir, ".env.example");

if (!existsSync(envPath)) {
  throw new Error(`E2E env file not found: ${envPath}`);
}

function loadEnvFile(filePath) {
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

function firstDefined(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function sanitizeTarget(urlString) {
  const parsed = new URL(urlString);
  const databaseName = parsed.pathname.replace(/^\/+/, "") || "<none>";
  const port = parsed.port || (parsed.protocol.startsWith("postgres") ? "5432" : "6379");
  return `${parsed.protocol}//${parsed.hostname}:${port}/${databaseName}`;
}

function assertLocalDatabaseTarget(name, urlString) {
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

function assertLocalRedisTarget(name, urlString) {
  const parsed = new URL(urlString);
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);

  if (!["redis:"].includes(parsed.protocol)) {
    throw new Error(`${name} must use a Redis URL. Received ${parsed.protocol}`);
  }

  if (!allowedHosts.has(parsed.hostname)) {
    throw new Error(`${name} must target a local Redis host. Received ${sanitizeTarget(urlString)}`);
  }
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

console.log(`E2E env source: ${path.relative(rootDir, envPath)}`);
console.log(`E2E DATABASE_URL: ${sanitizeTarget(effectiveDatabaseUrl)}`);
console.log(`E2E DIRECT_URL: ${sanitizeTarget(effectiveDirectUrl)}`);
console.log(`E2E REDIS_URL: ${sanitizeTarget(effectiveRedisUrl)}`);

const childEnv = {
  ...process.env,
  NODE_ENV: "test",
  RESELLEROS_DISABLE_API_BOOTSTRAP: "1",
  DATABASE_URL: effectiveDatabaseUrl,
  DIRECT_URL: effectiveDirectUrl,
  REDIS_URL: effectiveRedisUrl,
  POSTGRES_DB: postgresDatabase,
  POSTGRES_USER: postgresUser,
  POSTGRES_PASSWORD: postgresPassword,
  POSTGRES_HOST_PORT: postgresHostPort,
  REDIS_HOST_PORT: redisHostPort
};

const dbProbe =
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

if (dbProbe.status !== 0) {
  const details = [dbProbe.stdout, dbProbe.stderr].filter(Boolean).join("\n").trim();
  throw new Error(`E2E database preflight failed for ${sanitizeTarget(effectiveDatabaseUrl)}\n${details}`);
}

console.log("E2E database preflight passed");

const child =
  process.platform === "win32"
    ? spawn("cmd.exe", ["/c", "pnpm.cmd", "run", "test:e2e:raw"], {
        cwd: rootDir,
        stdio: "inherit",
        env: childEnv
      })
    : spawn("pnpm", ["run", "test:e2e:raw"], {
        cwd: rootDir,
        stdio: "inherit",
        env: childEnv
      });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
