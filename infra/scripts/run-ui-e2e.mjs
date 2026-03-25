import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

import { logResolvedRuntimeTargets, probeLocalDatabase, resolveTestRuntimeEnv } from "./test-runtime-env.mjs";

const apiPort = "4100";
const webPort = "3100";
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const appBaseUrl = `http://127.0.0.1:${webPort}`;
const rootDir = process.cwd();
const nextEnvPath = path.join(rootDir, "apps", "web", "next-env.d.ts");
const originalNextEnv = readFileSync(nextEnvPath, "utf8");
const runtime = resolveTestRuntimeEnv(rootDir, {
  envVarName: "RESELLEROS_UI_E2E_ENV_FILE",
  label: "UI E2E",
  defaultSessionSecret: "ui-e2e-session-secret",
  defaultUploadsBucket: "reselleros-ui-uploads",
  defaultArtifactsBucket: "reselleros-ui-artifacts",
  extraEnv: {
    APP_BASE_URL: appBaseUrl,
    NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
    API_PORT: apiPort,
    UI_E2E_API_PORT: apiPort,
    UI_E2E_WEB_PORT: webPort,
    NEXT_DIST_DIR: ".next-ui-e2e"
  }
});
const childEnv = runtime.childEnv;

function restoreNextEnv() {
  const currentNextEnv = readFileSync(nextEnvPath, "utf8");

  if (currentNextEnv !== originalNextEnv) {
    writeFileSync(nextEnvPath, originalNextEnv, "utf8");
  }
}

logResolvedRuntimeTargets("UI E2E", rootDir, runtime, {
  APP_BASE_URL: appBaseUrl,
  API_BASE_URL: apiBaseUrl
});
probeLocalDatabase(rootDir, childEnv, runtime.effectiveDatabaseUrl, "UI E2E");

const child =
  process.platform === "win32"
    ? spawn("cmd.exe", ["/c", "pnpm.cmd", "exec", "playwright", "test", "tests/ui"], {
        cwd: rootDir,
        stdio: "inherit",
        env: childEnv
      })
    : spawn("pnpm", ["exec", "playwright", "test", "tests/ui"], {
        cwd: rootDir,
        stdio: "inherit",
        env: childEnv
      });

child.on("exit", (code, signal) => {
  restoreNextEnv();

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  restoreNextEnv();
  console.error(error);
  process.exit(1);
});
