// Dependency-free database helpers, shared by the collector (pg Pool in
// src/lib/db.ts) and the website (its own pool). Callers pass a query function.

export type Query = (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

/** Postgres DATE columns may arrive as strings or Date objects; always use YYYY-MM-DD. */
export function asDate(v: unknown): string {
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** Insert many rows in batches, updating on conflict. */
export async function upsertWith(q: Query, table: string, key: string[], rows: Record<string, unknown>[], batch = 500) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const updates = cols.filter((c) => !key.includes(c));
  const onConflict = updates.length ? `do update set ${updates.map((c) => `${c} = excluded.${c}`).join(", ")}` : "do nothing";
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const values: unknown[] = [];
    const tuples = chunk.map((r, j) => {
      cols.forEach((c) => values.push(r[c]));
      return `(${cols.map((_, k) => `$${j * cols.length + k + 1}`).join(", ")})`;
    });
    await q(`insert into ${table} (${cols.join(", ")}) values ${tuples.join(", ")} on conflict (${key.join(", ")}) ${onConflict}`, values);
  }
}
