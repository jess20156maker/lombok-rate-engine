// The daily "new villas" message. Runs after the nightly collection.
//
// Writes new-villas.md listing every active Airbnb / Booking.com place not yet
// announced, then marks them announced. The workflow posts the file as a
// comment on the pinned "New villas" GitHub issue, which emails the owner.
// Re-runs on the same day only post when something new turned up.
//
//   npm run new-villas

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { today } from "../lib/dates.js";
import { db } from "../lib/db.js";

const DASHBOARD = "https://lombok-rate-engine.vercel.app";
const date = today();

const { rows } = await db.query(
  `select l.platform, l.id, l.name, l.area, l.bedrooms, l.slug
     from listings l
     left join listing_announcements a on a.platform = l.platform and a.listing_id = l.id
    where l.active and l.platform in ('airbnb', 'booking') and a.listing_id is null
    order by l.area, l.bedrooms desc nulls last, l.name`,
);

const { rows: posted } = await db.query(
  "select 1 from job_runs where job = 'new-villas' and ok and (ran_at at time zone 'Asia/Makassar')::date = $1::date",
  [date],
);

const nice = new Date(date + "T00:00:00Z").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const clean = (s: string) => s.replace(/\s+/g, " ").trim() || "(no name)";
const line = (r: (typeof rows)[number]) => {
  const beds = r.bedrooms ? `${r.bedrooms} bed` : "studio";
  const big = r.bedrooms >= 3 ? " **★**" : "";
  if (r.platform === "airbnb")
    return `- ${clean(r.name)} · ${beds}${big} · Airbnb · [listing](https://www.airbnb.com/rooms/${r.id}) · [dashboard](${DASHBOARD}/listings/${r.id})`;
  return `- ${clean(r.name)} · ${beds}${big} · Booking.com · [listing](https://www.booking.com/hotel/id/${r.slug}.html)`;
};

let body = "";
if (rows.length) {
  const byArea = new Map<string, typeof rows>();
  for (const r of rows) byArea.set(r.area, [...(byArea.get(r.area) ?? []), r]);
  body = `## ${nice}: ${rows.length} new place${rows.length === 1 ? "" : "s"}\n\n★ = 3+ bedrooms, closest to Mulai Villa.\n`;
  for (const [area, list] of byArea) body += `\n**${area}**\n${list.map(line).join("\n")}\n`;
  body += `\nAll new places: ${DASHBOARD}/listings (tick "New").`;
} else if (!posted.length) {
  body = `## ${nice}: no new places today\n\nCollection ran; no new Airbnb or Booking.com places in south Lombok.`;
}

if (rows.length) {
  const values = rows.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}, $${rows.length * 2 + 1}::date)`).join(",");
  await db.query(
    `insert into listing_announcements (platform, listing_id, announced_on) values ${values} on conflict do nothing`,
    [...rows.flatMap((r) => [r.platform, r.id]), date],
  );
}
writeFileSync("new-villas.md", body);
if (body) await db.query("insert into job_runs (job, ok, detail) values ('new-villas', true, $1)", [`${rows.length} new`]);
console.log(body || "Nothing new since the last message today.");
await db.end();
