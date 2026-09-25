// Copy collected files into Supabase. The files stay as the working copy (they
// make the collector resumable); the database is what the dashboard reads.
//
//   npm run sync               listings + every snapshot on disk
//   npm run sync -- 2026-09-25 listings + one snapshot

import type { BBox } from "../config.js";
import type { PriceSample } from "./daily.js";
import type { Change } from "../analysis/changes.js";
import type { StoredCalendar } from "../lib/calendar-codec.js";
import { db, upsert } from "../lib/db.js";
import { listings, readJson, snapshotDates } from "../lib/store.js";

export async function syncListings() {
  const rows = Object.values(listings.load()).map((l) => ({
    platform: l.platform,
    id: l.id,
    name: l.name,
    kind: l.kind,
    area: l.area,
    lat: l.lat,
    lng: l.lng,
    bedrooms: l.bedrooms,
    rating: l.rating,
    first_seen: l.firstSeen,
    last_seen: l.lastSeen,
    active: l.active,
  }));
  await upsert("listings", ["platform", "id"], rows);
  console.log(`listings: ${rows.length}`);
}

export async function syncTiles() {
  const tiles = readJson<BBox[]>("tiles.json", []);
  if (tiles.length === 0) return;
  // Discovery replaces the whole tile set, so the table mirrors the file.
  await db.query("delete from market_tiles where platform = 'airbnb'");
  await upsert("market_tiles", ["platform", "north", "east", "south", "west"], tiles.map((t) => ({ platform: "airbnb", ...t })));
  console.log(`tiles: ${tiles.length}`);
}

export async function syncSnapshot(date: string) {
  const dir = `snapshots/${date}`;

  const cals = readJson<Record<string, StoredCalendar>>(`${dir}/airbnb-calendars.json`, {});
  await upsert(
    "calendar_snapshots",
    ["snapshot_date", "platform", "listing_id"],
    Object.entries(cals).map(([id, c]) => ({
      snapshot_date: date,
      platform: "airbnb",
      listing_id: id,
      from_date: c.from,
      nights: c.nights,
      min_stay: JSON.stringify(c.minStay),
    })),
  );

  const prices = readJson<{ done: string[]; samples: PriceSample[] }>(`${dir}/airbnb-prices.json`, { done: [], samples: [] });
  // A listing can appear in two overlapping map tiles; keep one row per key.
  const unique = new Map(prices.samples.map((s) => [`${s.listingId}|${s.checkin}|${s.nights}`, s]));
  await upsert(
    "price_samples",
    ["snapshot_date", "platform", "listing_id", "checkin", "nights"],
    [...unique.values()].map((s) => ({
      snapshot_date: date,
      platform: "airbnb",
      listing_id: s.listingId,
      checkin: s.checkin,
      nights: s.nights,
      total: s.total,
      nightly: s.nightly,
    })),
  );
  await upsert(
    "price_sample_dates",
    ["snapshot_date", "platform", "checkin"],
    prices.done.map((checkin) => ({ snapshot_date: date, platform: "airbnb", checkin })),
  );

  const events = readJson<{ comparedTo: string; events: (Change & { listingId: string })[] } | null>(
    `${dir}/airbnb-events.json`,
    null,
  );
  if (events) {
    const unique = new Map(events.events.map((e) => [`${e.listingId}|${e.checkin}|${e.kind}`, e]));
    await upsert(
      "calendar_changes",
      ["snapshot_date", "platform", "listing_id", "checkin", "kind"],
      [...unique.values()].map((e) => ({
        snapshot_date: date,
        compared_to: events.comparedTo,
        platform: "airbnb",
        listing_id: e.listingId,
        kind: e.kind,
        checkin: e.checkin,
        nights: e.nights,
        lead_days: e.leadDays,
      })),
    );
  }
  console.log(
    `${date}: ${Object.keys(cals).length} calendars, ${unique.size} prices, ${events?.events.length ?? 0} changes`,
  );
}

// Run directly (not when imported by daily.ts).
if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv[2];
  await syncListings();
  await syncTiles();
  for (const d of only ? [only] : snapshotDates()) await syncSnapshot(d);
  await db.end();
}
