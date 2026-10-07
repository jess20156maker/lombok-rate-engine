// Twice-daily proof that everything is working (.github/workflows/health.yml).
// Checks the data, the villa's prices and the live website, saves the result,
// and exits with an error if anything is wrong so GitHub raises the alarm.
//
//   npm run health
//
// Writes health-report.md (for the alert) and, when collection is stale,
// health-heal.txt naming the job to re-run.

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { db } from "../lib/db.js";
import { runHealth, type Check } from "../lib/health.js";

const q = (text: string, params?: unknown[]) => db.query(text, params);
const SITE = process.env.SITE_URL ?? "https://lombok-rate-engine.vercel.app";

const health = await runHealth(q);

// The website: up, password gate on, and able to read the database itself.
async function site(): Promise<Check[]> {
  const out: Check[] = [];
  try {
    const home = await fetch(SITE, { redirect: "manual" });
    out.push({
      name: "Website password gate",
      ok: home.status === 401,
      detail: home.status === 401 ? "site up and asking for the password" : `expected 401, got ${home.status}`,
    });
    const api = await fetch(`${SITE}/api/health`);
    const body = api.status === 200 || api.status === 503 ? ((await api.json()) as { ok: boolean; checks: Check[] }) : null;
    out.push({
      name: "Website reads live data",
      ok: !!body,
      detail: body ? `website sees ${body.checks.filter((c) => c.ok).length}/${body.checks.length} checks passing` : `health page returned ${api.status}`,
    });
  } catch (e) {
    out.push({ name: "Website", ok: false, detail: `unreachable: ${(e as Error).message}` });
  }
  return out;
}
health.checks.push(...(await site()));
health.ok = health.checks.every((c) => c.ok);

const collectionStale = health.checks.some(
  (c) => !c.ok && /^(Airbnb|Booking\.com)/.test(c.name) && /last collected|never collected|dates searched/.test(c.detail),
);
if (collectionStale) writeFileSync("health-heal.txt", "nightly");

const line = (c: Check) => `| ${c.ok ? (c.warn ? "⚠️" : "✅") : "❌"} | ${c.name} | ${c.detail} |`;
const report = [
  health.ok ? "**All checks passed.**" : "**Something needs attention.**",
  "",
  `Checked ${health.checkedAt.slice(0, 16).replace("T", " ")} UTC (Lombok date ${health.today}).`,
  "",
  "| | Check | Result |",
  "|---|---|---|",
  ...health.checks.map(line),
  collectionStale ? "\nCollection looked stale or incomplete, so the nightly collection was started again automatically." : "",
].join("\n");
writeFileSync("health-report.md", report);
console.log(report);

await q("insert into health_checks (ok, checks, healed) values ($1, $2, $3)", [
  health.ok,
  JSON.stringify(health.checks),
  collectionStale ? "nightly" : null,
]);
await db.end();
process.exitCode = health.ok ? 0 : 1;
