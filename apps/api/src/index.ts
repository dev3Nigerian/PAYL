import { createServer } from "node:http";
import pino from "pino";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { IdentityService } from "./identity.js";
import { PaylOAuthProvider } from "./oauth.js";
import { PaylService } from "./service.js";

const config = loadConfig();
const logger = pino({ level: config.nodeEnv === "production" ? "info" : "debug" });
const pool = createPool(config);

await migrate(pool);
const service = new PaylService(pool, config);
await service.seedSandbox();
const identity = new IdentityService(pool, config);
await identity.seedSandboxUsers();
const oauth = new PaylOAuthProvider(pool, config);

const server = createServer(createApp(service, identity, oauth, config));
server.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      walletMcp: `http://localhost:${config.port}/mcp/wallet`,
      commerceMcp: `http://localhost:${config.port}/mcp/commerce`,
      merchantMcp: `http://localhost:${config.port}/mcp/merchants/${config.sandboxMerchantId}`,
    },
    "PAYL sandbox is ready",
  );
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
