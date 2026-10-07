// Nightly Booking.com collection.
//
// Booking.com doesn't publish per-listing calendars, so for each sampled
// check-in date we fetch every entire-place result in the market. A place that
// appears is open for that stay (with its price); a known place that doesn't
// appear is booked, closed, or needs a longer minimum stay.
//
//   npm run booking
//   npm run booking -- --dates 3     (first 3 dates only, for testing)
//   npm run booking -- --force       (re-collect dates already done today)
//   npm run booking -- --shard 2/3   (the 2nd of 3 shares of the dates, for parallel machines)

import "dotenv/config";
import { MARKET, PRICE_SAMPLE } from "../config.js";
import { BookingBlockedError, closeSession, openSession, searchStay, type BookingResult } from "../booking/client.js";
import { addDays, today } from "../lib/dates.js";
import { db, upsert } from "../lib/db.js";
import { nearestArea } from "../lib/geo.js";

const args = process.argv.slice(2);
const maxDates = args.includes("--dates") ? Number(args[args.indexOf("--dates") + 1]) : Infinity;
// --force re-collects dates already done today (used to test a fresh environment).
const force = args.includes("--force") || process.env.BOOKING_FORCE === "true";
const [shardNo, shardCount] = (args.includes("--shard") ? args[args.indexOf("--shard") + 1] : "1/1").split("/").map(Number);
const date = today();

// Same check-in dates as the Airbnb price sampling, so the two compare directly.
function sampleCheckins(): string[] {
  const { denseDays, denseStep, sparseUntilDays, sparseStep } = PRICE_SAMPLE;
  const out: string[] = [];
  for (let d = 1; d <= denseDays; d += denseStep) out.push(addDays(date, d));
  for (let d = denseDays + sparseStep; d <= sparseUntilDays; d += sparseStep) out.push(addDays(date, d));
  return out;
}

const inMarket = (r: BookingResult) =>
  r.lat <= MARKET.north && r.lat >= MARKET.south && r.lng <= MARKET.east && r.lng >= MARKET.west;

const { rows: doneRows } = await db.query(
  "select checkin::text from price_sample_dates where snapshot_date = $1 and platform = 'booking'",
  [date],
);
const done = new Set(force ? [] : doneRows.map((r) => r.checkin));
const todo = sampleCheckins()
  .filter((_, i) => i % shardCount === shardNo - 1)
  .filter((c) => !done.has(c))
  .slice(0, maxDates);
if (todo.length === 0) {
  console.log("Booking.com: all dates already collected today");
  await db.end();
  process.exit(0);
}

const nights = PRICE_SAMPLE.nights;
// Open on a date six weeks out: plenty of results there makes the page load a
// second batch reliably. Each search then sets its own dates.
const open = () => openSession(addDays(date, 42), addDays(date, 42 + nights), 5);
let session = await open();
const seen = new Map<string, BookingResult>();
let blocks = 0;

/** Search one stay, starting a fresh session (and slowing down) if the bot check steps in. */
async function searchWithRecovery(checkin: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await searchStay(session, checkin, addDays(checkin, nights));
    } catch (err) {
      if (!(err instanceof BookingBlockedError) || attempt >= 3) throw err;
      blocks++;
      console.warn(`  ${checkin}: ${err.message}; starting a fresh session (attempt ${attempt + 1})`);
      await closeSession(session).catch(() => {});
      await new Promise((r) => setTimeout(r, 30_000 * attempt + Math.random() * 30_000));
      session = await open();
    }
  }
}

let failedDates = 0;
try {
  for (const checkin of todo) {
    let found: BookingResult[];
    try {
      found = await searchWithRecovery(checkin);
    } catch (err) {
      // Keep going: a missed date is better than a missed night.
      failedDates++;
      console.warn(`  ${checkin}: skipped (${(err as Error).message})`);
      if (failedDates >= 8) {
        console.warn("  Too many dates failed; stopping this share for tonight (what was collected is saved).");
        break;
      }
      continue;
    }
    const results = found.filter(inMarket);
    for (const r of results) seen.set(r.id, r);

    const prices = new Map(results.filter((r) => r.total != null && !r.soldOut).map((r) => [r.id, r]));
    await upsert(
      "price_samples",
      ["snapshot_date", "platform", "listing_id", "checkin", "nights"],
      [...prices.values()].map((r) => ({
        snapshot_date: date,
        platform: "booking",
        listing_id: r.id,
        checkin,
        nights,
        total: r.total,
        nightly: Math.round(r.total! / nights),
        includes_taxes: true,
      })),
    );
    // Saving listings as we go means a partial run still leaves consistent data.
    await saveListings([...prices.values()]);
    await upsert("price_sample_dates", ["snapshot_date", "platform", "checkin"], [{ snapshot_date: date, platform: "booking", checkin }]);
    console.log(`  Booking.com ${checkin}: ${prices.size} places open`);
    // A person doesn't search 60 dates a minute.
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));
  }
} finally {
  await closeSession(session).catch(() => {});
}
console.log(`Booking.com shard ${shardNo}/${shardCount}: bot check met ${blocks} time(s), ${failedDates} date(s) skipped`);

async function saveListings(results: BookingResult[]) {
  // Keep the date each place was first found (the upsert below rewrites every column).
  const { rows: had } = await db.query("select id, first_seen::text from listings where platform = 'booking' and id = any($1)", [
    results.map((r) => r.id),
  ]);
  const firstSeen = new Map(had.map((r) => [r.id as string, r.first_seen as string]));
  await upsert(
    "listings",
    ["platform", "id"],
    results.map((r) => ({
      platform: "booking",
      id: r.id,
      name: r.name,
      kind: r.unitType,
      area: nearestArea(r.lat, r.lng),
      lat: r.lat,
      lng: r.lng,
      bedrooms: r.bedrooms,
      rating: r.rating,
      slug: r.pageName,
      first_seen: firstSeen.get(r.id) ?? date,
      last_seen: date,
      active: true,
    })),
  );
}

console.log(`Booking.com shard ${shardNo}/${shardCount}: ${seen.size} places seen across ${todo.length} dates`);
// Retiring stale places and cross-platform matching run once in `npm run finish`.
await db.end();
