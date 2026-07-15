import pg from "pg";
import type { Config } from "./config.js";

const { Pool } = pg;

export function createPool(config: Config): pg.Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: config.nodeEnv === "test" ? 4 : 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "payl-sandbox",
  });
}

export async function inTransaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
