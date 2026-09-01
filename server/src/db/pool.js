import pg from "pg";
import { env } from "../config/env.js";

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL error", error);
});

export async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
