import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type pg from "pg";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

export async function migrate(pool: pg.Pool): Promise<void> {
  const path = resolve(currentDirectory, "../migrations/0001_init.sql");
  const sql = await readFile(path, "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT (version) DO NOTHING",
      ["0001_init"],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
