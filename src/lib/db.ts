import "dotenv/config";
import pg from "pg";
import { databaseUrl } from "./env.js";
import { upsertWith } from "./sql.js";

// Supabase's pooler presents a certificate Node doesn't chain by default.
export const db = new pg.Pool({
  connectionString: databaseUrl(),
  ssl: { rejectUnauthorized: false },
  max: 2,
});

/** Insert many rows in batches, updating on conflict (see src/lib/sql.ts). */
export function upsert(table: string, key: string[], rows: Record<string, unknown>[], batch = 500) {
  return upsertWith((text, params) => db.query(text, params), table, key, rows, batch);
}
