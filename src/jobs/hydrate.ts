// Rebuild the local working files from Supabase. The cloud runner starts with an
// empty data/ folder every night; this gives the daily job what it needs:
//
//   - the listings registry and map tiles
//   - the most recent earlier snapshot's calendars (to detect changes against)
//   - anything already collected today (so a re-run resumes instead of restarting)
//
//   npm run hydrate

import "dotenv/config";
import type { BBox } from "../config.js";
import type { StoredCalendar } from "../lib/calendar-codec.js";
import { db } from "../lib/db.js";
import { today } from "../lib/dates.js";
import { listings, writeJson, type Listing } from "../lib/store.js";

// Return DATE columns as plain strings.
(await import("pg")).default.types.setTypeParser(1082, (v: string) => v);

const date = today();

const { rows: ls } = await db.query("select * from listings");
const registry: Record<string, Listing> = {};
for (const r of ls) {
  registry[listings.key(r.platform, r.id)] = {
    platform: r.platform,
    id: r.id,
    name: r.name,
    kind: r.kind,
    area: r.area,
    lat: r.lat,
    lng: r.lng,
    bedrooms: r.bedrooms,
    rating: r.rating,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    active: r.active,
  };
}
listings.save(registry);

const { rows: tiles } = await db.query("select north, east, south, west from market_tiles where platform = 'airbnb'");
writeJson("tiles.json", tiles as BBox[]);

async function calendarsFor(snapshot: string) {
  const { rows } = await db.query(
    "select listing_id, from_date, nights, min_stay from calendar_snapshots where snapshot_date = $1 and platform = 'airbnb'",
    [snapshot],
  );
  const out: Record<string, StoredCalendar> = {};
  for (const r of rows) out[r.listing_id] = { from: r.from_date, nights: r.nights, minStay: r.min_stay };
  writeJson(`snapshots/${snapshot}/airbnb-calendars.json`, out);
  return rows.length;
}

const { rows: prev } = await db.query(
  "select max(snapshot_date) d from calendar_snapshots where platform = 'airbnb' and snapshot_date < $1",
  [date],
);
const prevDate: string | null = prev[0]?.d ?? null;
const prevCount = prevDate ? await calendarsFor(prevDate) : 0;
const todayCount = await calendarsFor(date);

// Today's price progress, so completed check-in dates aren't searched again.
const { rows: done } = await db.query(
  "select checkin from price_sample_dates where snapshot_date = $1 and platform = 'airbnb'",
  [date],
);
if (done.length) {
  const { rows: samples } = await db.query(
    `select listing_id "listingId", checkin, nights, total::float8 total, nightly::float8 nightly
       from price_samples where snapshot_date = $1 and platform = 'airbnb'`,
    [date],
  );
  writeJson(`snapshots/${date}/airbnb-prices.json`, { done: done.map((r) => r.checkin), samples });
}

console.log(
  `Hydrated: ${ls.length} listings, ${tiles.length} tiles, ` +
    `${prevDate ? `${prevCount} calendars from ${prevDate}` : "no earlier snapshot"}, ${todayCount} from today`,
);
await db.end();
