// Airbnb price sampling, split into shards so several machines can share the
// nightly work. Each shard prices every Nth check-in date and writes straight to
// Supabase, so shards don't need each other's files.
//
//   npm run prices                  all dates, one machine
//   npm run prices -- --shard 2/6   the 2nd of 6 shares (dates where index % 6 == 1)

import "dotenv/config";
import { MARKET, PRICE_SAMPLE, type BBox } from "../config.js";
import { nearestArea } from "../lib/geo.js";
import { searchAll } from "../airbnb/client.js";
import { addDays, today } from "../lib/dates.js";
import { db, upsert } from "../lib/db.js";

const args = process.argv.slice(2);
const shardArg = args.includes("--shard") ? args[args.indexOf("--shard") + 1] : "1/1";
const [shardNo, shardCount] = shardArg.split("/").map(Number);
if (!(shardNo >= 1 && shardNo <= shardCount)) throw new Error(`Bad --shard ${shardArg}; use e.g. 2/6`);

const date = today();

export function sampleCheckins(from: string): string[] {
  const { denseDays, denseStep, sparseUntilDays, sparseStep } = PRICE_SAMPLE;
  const out: string[] = [];
  for (let d = 1; d <= denseDays; d += denseStep) out.push(addDays(from, d));
  for (let d = denseDays + sparseStep; d <= sparseUntilDays; d += sparseStep) out.push(addDays(from, d));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [{ rows: tiles }, { rows: known }, { rows: done }] = await Promise.all([
    db.query("select north, east, south, west from market_tiles where platform = 'airbnb'"),
    db.query("select id, active from listings where platform = 'airbnb'"),
    db.query("select checkin::text from price_sample_dates where snapshot_date = $1 and platform = 'airbnb'", [date]),
  ]);
  // Every place ever recorded (a retired one coming back keeps its first-seen date), and the live ones we price.
  const everIds = new Set(known.map((r) => r.id as string));
  const knownIds = new Set(known.filter((r) => r.active).map((r) => r.id as string));
  const doneDates = new Set(done.map((r) => r.checkin as string));
  const mine = sampleCheckins(date).filter((_, i) => i % shardCount === shardNo - 1 && !doneDates.has(_));
  console.log(`Shard ${shardNo}/${shardCount}: ${mine.length} dates to price across ${tiles.length} tiles`);

  const nights = PRICE_SAMPLE.nights;
  const ratings = new Map<string, string>(); // "4.93 (76)": saved daily as review history (npm run finish)
  // Villas the daily searches turn up that we aren't tracking yet: added tonight,
  // so new competitors are caught within a day (the full sweep also runs daily).
  const seenTonight = new Set<string>();
  const fresh = new Map<string, Awaited<ReturnType<typeof searchAll>>["listings"][number]>();
  const inMarket = (l: { lat: number; lng: number }) =>
    l.lat <= MARKET.north && l.lat >= MARKET.south && l.lng <= MARKET.east && l.lng >= MARKET.west;
  for (const checkin of mine) {
    const checkout = addDays(checkin, nights);
    const found = new Map<string, { total: number; nightly: number | null }>();
    let complete = true;
    for (const tile of tiles as BBox[]) {
      try {
        const { listings } = await searchAll(tile, { checkin, checkout });
        for (const l of listings) {
          if (!everIds.has(l.id) && inMarket(l)) {
            fresh.set(l.id, l);
            everIds.add(l.id);
          }
          if (everIds.has(l.id) && inMarket(l)) knownIds.add(l.id); // back on the market
          if (knownIds.has(l.id)) seenTonight.add(l.id);
          if (knownIds.has(l.id) && l.total != null) found.set(l.id, { total: l.total, nightly: l.nightly });
          if (knownIds.has(l.id) && l.rating) ratings.set(l.id, l.rating);
        }
      } catch (err) {
        complete = false;
        console.warn(`  ${checkin}: a tile failed: ${(err as Error).message}`);
      }
    }
    await upsert(
      "price_samples",
      ["snapshot_date", "platform", "listing_id", "checkin", "nights"],
      [...found].map(([id, p]) => ({
        snapshot_date: date,
        platform: "airbnb",
        listing_id: id,
        checkin,
        nights,
        total: p.total,
        nightly: p.nightly,
      })),
    );
    // Only a fully searched date counts as done, so a gap really means "not open".
    if (complete) await upsert("price_sample_dates", ["snapshot_date", "platform", "checkin"], [{ snapshot_date: date, platform: "airbnb", checkin }]);
    console.log(`  ${checkin}: ${found.size} places priced${complete ? "" : " (incomplete)"}`);
  }
  if (fresh.size) {
    await upsert(
      "listings",
      ["platform", "id"],
      [...fresh.values()].map((l) => ({
        platform: "airbnb",
        id: l.id,
        name: l.name,
        kind: l.kind,
        area: nearestArea(l.lat, l.lng),
        lat: l.lat,
        lng: l.lng,
        bedrooms: l.bedrooms,
        rating: l.rating,
        first_seen: date,
        last_seen: date,
        active: true,
      })),
    );
    console.log(`New on Airbnb: ${[...fresh.values()].map((l) => `${l.name} (${l.bedrooms ?? "?"} bed)`).join(", ")}`);
  }
  // Seen tonight: still listed (the sweep retires places not seen for a week).
  if (seenTonight.size)
    await db.query("update listings set last_seen = $1, active = true where platform = 'airbnb' and id = any($2) and last_seen < $1", [
      date,
      [...seenTonight],
    ]);
  // Keep each villa's rating and review count current (the weekly sweep used to be the only update).
  if (ratings.size)
    await db.query(
      `update listings l set rating = v.rating from unnest($1::text[], $2::text[]) v(id, rating)
        where l.platform = 'airbnb' and l.id = v.id and l.rating is distinct from v.rating`,
      [[...ratings.keys()], [...ratings.values()]],
    );
  await db.end();
}
