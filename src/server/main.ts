import { loadMemoryServerConfig } from "./config.js";
import { createMemoryHttpServer } from "./http-server.js";
import { MEMORY_SERVER_VERSION } from "./mcp.js";
import { createStandaloneMemoryRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const config = loadMemoryServerConfig();
  const runtime = createStandaloneMemoryRuntime(config);
  const server = createMemoryHttpServer(runtime, config.http);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.http.port, config.http.host, () => resolve());
  });

  console.log(
    `memory-server@${MEMORY_SERVER_VERSION}: listening on http://${config.http.host}:${config.http.port} ` +
      `(mcp=/mcp, rest=/v1, db=${config.dbPath}, capture=${config.captureEnabled ? "ON" : "OFF"})`,
  );

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`memory-server: received ${signal}, shutting down`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.exitCode = 0;
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(`memory-server: startup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
