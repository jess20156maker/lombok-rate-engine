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

import "dotenv/config";
import { MARKET, PRICE_SAMPLE } from "../config.js";
import { closeSession, openSession, searchStay, type BookingResult } from "../booking/client.js";
import { addDays, today } from "../lib/dates.js";
import { db, upsert } from "../lib/db.js";
import { nearestArea } from "../lib/geo.js";

const args = process.argv.slice(2);
const maxDates = args.includes("--dates") ? Number(args[args.indexOf("--dates") + 1]) : Infinity;
// --force re-collects dates already done today (used to test a fresh environment).
const force = args.includes("--force") || process.env.BOOKING_FORCE === "true";
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
const todo = sampleCheckins().filter((c) => !done.has(c)).slice(0, maxDates);
if (todo.length === 0) {
  console.log("Booking.com: all dates already collected today");
  await db.end();
  process.exit(0);
}

const nights = PRICE_SAMPLE.nights;
// Open on a date six weeks out: plenty of results there makes the page load a
// second batch reliably. Each search then sets its own dates.
const session = await openSession(addDays(date, 42), addDays(date, 42 + nights), 5);
const seen = new Map<string, BookingResult>();

try {
  for (const checkin of todo) {
    const results = (await searchStay(session, checkin, addDays(checkin, nights))).filter(inMarket);
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
  }
} finally {
  await closeSession(session);
}

async function saveListings(results: BookingResult[]) {
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
      first_seen: date, // kept on conflict below
      last_seen: date,
      active: true,
    })),
  );
  // upsert overwrote first_seen; restore the earliest date we have evidence for.
  await db.query(
    `update listings l set first_seen = least(l.first_seen, coalesce(
        (select min(snapshot_date) from price_samples p where p.platform = 'booking' and p.listing_id = l.id), l.first_seen))
      where l.platform = 'booking' and l.last_seen = $1`,
    [date],
  );
}

// Places not seen for 30 days have probably left Booking.com.
await db.query(
  "update listings set active = false where platform = 'booking' and last_seen < ($1::date - 30)",
  [date],
);

console.log(`Booking.com: ${seen.size} places seen across ${todo.length} dates`);

// Link places listed on both platforms.
const { linkPlatforms } = await import("./link.js");
await linkPlatforms();
await db.end();
