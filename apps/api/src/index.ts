import { createServer } from "node:http";
import pino from "pino";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { IdentityService } from "./identity.js";
import { PaylOAuthProvider } from "./oauth.js";
import { PaylService } from "./service.js";
import { LifecycleWorkers } from "./workers.js";

const config = loadConfig();
const logger = pino({ level: config.nodeEnv === "production" ? "info" : "debug" });
const pool = createPool(config);

await migrate(pool);
const service = new PaylService(pool, config);
const identity = new IdentityService(pool, config);
if (config.sandboxBootstrapEnabled) {
  await service.seedSandbox();
  logger.info(await service.seedSampleCatalog(), "Sandbox sample catalog checked");
  await identity.seedSandboxUsers();
}
const oauth = new PaylOAuthProvider(pool, config);
const workers = new LifecycleWorkers(service, config.lifecycleWorkerIntervalMs, logger);
workers.start();

const server = createServer(createApp(service, identity, oauth, config));
server.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      deploymentProfile: config.deploymentProfile,
      consumerMcp: new URL("/mcp", config.publicBaseUrl).href,
      walletMcp: new URL("/mcp/wallet", config.publicBaseUrl).href,
      commerceMcp: new URL("/mcp/commerce", config.publicBaseUrl).href,
      merchantMcp: new URL(`/mcp/merchants/${config.sandboxMerchantId}`, config.publicBaseUrl).href,
    },
    "Antspace sandbox is ready",
  );
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  workers.stop();
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
