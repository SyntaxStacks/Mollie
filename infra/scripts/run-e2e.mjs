import { spawn } from "node:child_process";

import { logResolvedRuntimeTargets, probeLocalDatabase, resolveTestRuntimeEnv } from "./test-runtime-env.mjs";

const rootDir = process.cwd();
const runtime = resolveTestRuntimeEnv(rootDir, {
  envVarName: "RESELLEROS_E2E_ENV_FILE",
  label: "E2E"
});
const childEnv = {
  ...runtime.childEnv,
  RESELLEROS_DISABLE_API_BOOTSTRAP: "1"
};

logResolvedRuntimeTargets("E2E", rootDir, runtime);
probeLocalDatabase(rootDir, childEnv, runtime.effectiveDatabaseUrl, "E2E");

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
