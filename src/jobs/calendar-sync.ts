// Pull every property's Airbnb and Booking.com calendars into the central
// calendar. Runs every 20 minutes (.github/workflows/calendar-sync.yml).
//
//   npm run calendar-sync

import "dotenv/config";
import { findConflicts, syncProperty } from "../lib/calendar-sync.js";
import { today } from "../lib/dates.js";
import { db } from "../lib/db.js";

const q = (text: string, params?: unknown[]) => db.query(text, params);
const date = today();

const problems: string[] = [];
const done: string[] = [];
const { rows: props } = await db.query("select id, name, airbnb_ical_url, booking_ical_url from properties");
for (const p of props) {
  if (!p.airbnb_ical_url && !p.booking_ical_url) {
    console.log(`${p.name}: no channel calendars linked yet`);
    continue;
  }
  for (const r of await syncProperty(q, p.id, date)) {
    if (r.ok) done.push(`${r.channel} ${r.events}`);
    else problems.push(`${p.name} ${r.channel} failed: ${r.error}`);
    console.log(
      r.ok
        ? `${p.name} ← ${r.channel}: ${r.events} stays/blocks (${r.added} new, ${r.cancelled} cancelled)`
        : `${p.name} ← ${r.channel}: FAILED (${r.error})`,
    );
  }
  const { rows: stays } = await db.query(
    "select id, source, checkin::text, checkout::text, guest_name from reservations where property_id = $1 and status = 'confirmed' and checkout >= $2",
    [p.id, date],
  );
  for (const [a, b] of findConflicts(stays)) {
    problems.push(`${p.name} DOUBLE BOOKING: ${a.source} ${a.checkin}→${a.checkout} overlaps ${b.source} ${b.checkin}→${b.checkout}`);
    console.warn(`  DOUBLE BOOKING: ${a.source} ${a.checkin}→${a.checkout} overlaps ${b.source} ${b.checkin}→${b.checkout}`);
  }
}
// Recorded for the health check; a failure or double booking fails the run so GitHub emails an alert.
await db.query("insert into job_runs (job, ok, detail) values ('calendar-sync', $1, $2)", [
  problems.length === 0,
  problems.join("; ") || (done.length ? `synced: ${done.join(", ")}` : "no channel calendars linked yet"),
]);
await db.end();
if (problems.length) process.exitCode = 1;
