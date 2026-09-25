import "dotenv/config";
import pg from "pg";

// Supabase's pooler presents a certificate Node doesn't chain by default.
export const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

/**
 * Insert many rows in batches, updating on conflict.
 * `rows` are objects with the same keys; `key` is the primary key columns.
 */
export async function upsert(table: string, key: string[], rows: Record<string, unknown>[], batch = 500) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const updates = cols.filter((c) => !key.includes(c));
  const onConflict = updates.length
    ? `do update set ${updates.map((c) => `${c} = excluded.${c}`).join(", ")}`
    : "do nothing";

  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const values: unknown[] = [];
    const tuples = chunk.map((r, j) => {
      cols.forEach((c) => values.push(r[c]));
      return `(${cols.map((_, k) => `$${j * cols.length + k + 1}`).join(", ")})`;
    });
    await db.query(
      `insert into ${table} (${cols.join(", ")}) values ${tuples.join(", ")} on conflict (${key.join(", ")}) ${onConflict}`,
      values,
    );
  }
}
