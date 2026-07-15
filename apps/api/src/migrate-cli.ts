import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";

const pool = createPool(loadConfig());
try {
  await migrate(pool);
  console.log("PAYL database migration applied");
} finally {
  await pool.end();
}
