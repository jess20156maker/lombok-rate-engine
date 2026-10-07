import Link from "next/link";
import { connection } from "next/server";
import { pool } from "@/lib/data";

/** Header warning when the latest automatic check found a problem. */
export async function HealthBadge() {
  await connection();
  const { rows } = await pool
    .query("select ok, checked_at from health_checks order by checked_at desc limit 1")
    .catch(() => ({ rows: [] as { ok: boolean; checked_at: Date }[] }));
  const last = rows[0];
  // Silence for more than a day means the checks themselves stopped running.
  const stale = last && Date.now() - new Date(last.checked_at).getTime() > 30 * 3600_000;
  if (!last || (last.ok && !stale)) return null;
  return (
    <Link href="/collection" className="shrink-0 rounded-full bg-[#d03b3b] px-3 py-1 text-xs font-medium text-white">
      {stale ? "Checks not running" : "Data problem: see Collection"}
    </Link>
  );
}
