import { spawn, spawnSync } from "node:child_process";

const rootDir = process.cwd();
const webPort = process.env.UI_E2E_WEB_PORT ?? process.env.WEB_PORT ?? "3100";

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const runner = process.platform === "win32" ? "cmd.exe" : "pnpm";
const buildArgs =
  process.platform === "win32"
    ? ["/c", "pnpm.cmd", "--filter", "@reselleros/web", "build"]
    : ["--filter", "@reselleros/web", "build"];
const startArgs =
  process.platform === "win32"
    ? ["/c", "pnpm.cmd", "--filter", "@reselleros/web", "exec", "next", "start", "-p", webPort]
    : ["--filter", "@reselleros/web", "exec", "next", "start", "-p", webPort];

const env = {
  ...process.env,
  NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next-ui-e2e"
};

run(runner, buildArgs, env);

const child = spawn(runner, startArgs, {
  cwd: rootDir,
  env,
  stdio: "inherit"
});

function stop(signal) {
  if (!child.killed) {
    child.kill(signal);
  }
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

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
