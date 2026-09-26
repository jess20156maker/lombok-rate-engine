// Runs once after every nightly collection job has finished.
//
//   1. Retire Booking.com places not seen for 30 days.
//   2. Match places listed on both Airbnb and Booking.com.
//   3. Compact price history: keep the last KEEP_DAYS collection days in
//      price_samples (the dashboard reads those directly) and pack older days
//      into price_grid, one row per listing per day.
//
//   npm run finish

import "dotenv/config";
import pg from "pg";
import { today } from "../lib/dates.js";
import { db, upsert } from "../lib/db.js";
import { linkPlatforms } from "./link.js";

const KEEP_DAYS = Number(process.env.KEEP_DAYS ?? 3);
const DAY = 86_400_000;
pg.types.setTypeParser(1082, (v: string) => v);

const date = today();

await db.query("update listings set active = false where platform = 'booking' and last_seen < ($1::date - 30)", [date]);
await linkPlatforms();

// Tonight's market data is in: re-price the villa(s).
const { priceAllProperties } = await import("./price-villa.js");
await priceAllProperties();

// Keep the most recent KEEP_DAYS collection days that actually exist (the
// dashboard reads the latest one), whatever today's date is.
const { rows: days } = await db.query("select distinct snapshot_date from price_samples order by 1 desc");
const old = days.slice(Math.max(1, KEEP_DAYS)).reverse();

for (const { snapshot_date: snap } of old) {
  const { rows } = await db.query(
    `select platform, listing_id, nights, checkin, total, includes_taxes
       from price_samples where snapshot_date = $1`,
    [snap],
  );
  const from = new Date(Date.parse(snap) + DAY).toISOString().slice(0, 10);
  const grids = new Map<string, { platform: string; listing_id: string; nights: number; taxes: boolean; prices: (number | null)[] }>();
  for (const r of rows) {
    const k = Math.round((Date.parse(r.checkin) - Date.parse(from)) / DAY);
    if (k < 0 || k > 400) continue;
    const key = `${r.platform}|${r.listing_id}|${r.nights}`;
    let g = grids.get(key);
    if (!g) grids.set(key, (g = { platform: r.platform, listing_id: r.listing_id, nights: r.nights, taxes: r.includes_taxes, prices: [] }));
    while (g.prices.length <= k) g.prices.push(null);
    g.prices[k] = Math.round(Number(r.total) / r.nights);
  }
  await upsert(
    "price_grid",
    ["snapshot_date", "platform", "listing_id", "nights"],
    [...grids.values()].map((g) => ({
      snapshot_date: snap,
      platform: g.platform,
      listing_id: g.listing_id,
      nights: g.nights,
      from_date: from,
      per_night: g.prices,
      includes_taxes: g.taxes,
    })),
    200,
  );
  await db.query("delete from price_samples where snapshot_date = $1", [snap]);
  console.log(`Compacted ${snap}: ${rows.length} price rows into ${grids.size}`);
}

await db.end();
