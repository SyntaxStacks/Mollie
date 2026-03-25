process.env.NODE_ENV ??= "test";

const port = Number(process.env.API_PORT ?? process.env.UI_E2E_API_PORT ?? 4100);
const host = process.env.API_HOST ?? "127.0.0.1";

async function main() {
  const apiModule = await import("../../apps/api/src/index.js");
  const app = apiModule.buildApiApp();

  await app.listen({
    host,
    port
  });

  async function shutdown() {
    await app.close();
    process.exit(0);
  }

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main();
