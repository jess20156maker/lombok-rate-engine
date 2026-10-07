// Is everything working? Pass/fail per check, no prices or names beyond the
// villa's. Open without the password so the twice-daily check (and an uptime
// monitor) can read it; see proxy.ts.

import { connection } from "next/server";
import { runHealth } from "../../../../src/lib/health";
import { pool } from "@/lib/data";

export async function GET() {
  await connection();
  const health = await runHealth((text, params) => pool.query(text, params));
  return Response.json(health, { status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
