// The nightly collection run.
//
//   npm run daily                     full run
//   npm run daily -- --limit 20       only the first 20 listings (testing)
//   npm run daily -- --skip-prices    calendars and changes only
//
// 1. Fetch every active listing's 365-day calendar.
// 2. Compare with the previous snapshot to detect bookings, blocks and reopenings.
// 3. Sample prices by searching each map tile for a spread of check-in dates.
//
// Safe to re-run: listings and dates already collected today are skipped.

import "dotenv/config";
import { PRICE_SAMPLE, type BBox } from "../config.js";
import { calendar, searchAll } from "../airbnb/client.js";
import { diffCalendars, type Change } from "../analysis/changes.js";
import { decode, encode, type StoredCalendar } from "../lib/calendar-codec.js";
import { addDays, today } from "../lib/dates.js";
import { listings, readJson, snapshotDates, writeJson } from "../lib/store.js";

const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const skipPrices = args.includes("--skip-prices");

const date = today();
const dir = `snapshots/${date}`;

// Save progress to Supabase at checkpoints, so a run that is cut off
// (e.g. a cloud time limit) keeps what it collected.
async function checkpoint() {
  if (!process.env.DATABASE_URL) return;
  const { syncSnapshot } = await import("./sync.js");
  await syncSnapshot(date);
}

// ---- 1. Calendars -----------------------------------------------------------

const active = Object.values(listings.load())
  .filter((l) => l.platform === "airbnb" && l.active)
  .slice(0, limit);
if (active.length === 0) {
  console.error("No listings yet. Run `npm run discover` first.");
  process.exit(1);
}

const calendars = readJson<Record<string, StoredCalendar>>(`${dir}/airbnb-calendars.json`, {});
const failures: string[] = [];
let fetched = 0;
for (const l of active) {
  if (calendars[l.id]) continue;
  try {
    calendars[l.id] = encode(await calendar(l.id, date));
  } catch (err) {
    failures.push(l.id);
    console.warn(`  calendar ${l.id} failed: ${(err as Error).message}`);
    continue;
  }
  if (++fetched % 25 === 0) {
    writeJson(`${dir}/airbnb-calendars.json`, calendars);
    console.log(`  calendars: ${Object.keys(calendars).length}/${active.length}`);
  }
}
writeJson(`${dir}/airbnb-calendars.json`, calendars);
console.log(`Calendars: ${Object.keys(calendars).length}/${active.length} (${failures.length} failed)`);

// ---- 2. Changes since the previous snapshot ---------------------------------

const prevDate = snapshotDates().filter((d) => d < date).at(-1);
const events: (Change & { listingId: string })[] = [];
if (prevDate) {
  const prev = readJson<Record<string, StoredCalendar>>(`snapshots/${prevDate}/airbnb-calendars.json`, {});
  for (const [id, cal] of Object.entries(calendars)) {
    if (!prev[id]) continue;
    for (const c of diffCalendars(decode(prev[id]), decode(cal), date)) events.push({ listingId: id, ...c });
  }
  writeJson(`${dir}/airbnb-events.json`, { comparedTo: prevDate, events });
  const count = (k: string) => events.filter((e) => e.kind === k).length;
  console.log(
    `Changes vs ${prevDate}: ${count("booking")} likely bookings, ` +
      `${count("owner-block")} owner blocks, ${count("reopened")} reopened`,
  );
} else {
  console.log("First snapshot: bookings are detected from the next run on.");
}
await checkpoint();

// ---- 3. Price sampling ------------------------------------------------------

export type PriceSample = { listingId: string; checkin: string; nights: number; total: number; nightly: number | null };

function sampleCheckins(): string[] {
  const { denseDays, denseStep, sparseUntilDays, sparseStep } = PRICE_SAMPLE;
  const out: string[] = [];
  for (let d = 1; d <= denseDays; d += denseStep) out.push(addDays(date, d));
  for (let d = denseDays + sparseStep; d <= sparseUntilDays; d += sparseStep) out.push(addDays(date, d));
  return out;
}

if (!skipPrices) {
  const tiles = readJson<BBox[]>("tiles.json", []);
  const pricesFile = `${dir}/airbnb-prices.json`;
  const prices = readJson<{ done: string[]; samples: PriceSample[] }>(pricesFile, { done: [], samples: [] });
  const known = new Set(active.map((l) => l.id));

  for (const checkin of sampleCheckins()) {
    if (prices.done.includes(checkin)) continue;
    const checkout = addDays(checkin, PRICE_SAMPLE.nights);
    let n = 0;
    let complete = true;
    for (const tile of tiles) {
      try {
        const { listings: found } = await searchAll(tile, { checkin, checkout });
        for (const l of found) {
          if (!known.has(l.id) || l.total == null) continue;
          prices.samples.push({ listingId: l.id, checkin, nights: PRICE_SAMPLE.nights, total: l.total, nightly: l.nightly });
          n++;
        }
      } catch (err) {
        complete = false;
        console.warn(`  prices for ${checkin}, one tile failed: ${(err as Error).message}`);
      }
    }
    // Only a fully searched date counts as done: a gap then really means "not available".
    if (complete) prices.done.push(checkin);
    writeJson(pricesFile, prices);
    console.log(`  prices for ${checkin}: ${n} listings${complete ? "" : " (incomplete)"}`);
    if (prices.done.length % 5 === 0) await checkpoint();
  }
  console.log(`Prices: ${prices.samples.length} samples across ${prices.done.length} check-in dates`);
}

// ---- 4. Copy into Supabase -----------------------------------------------------

if (process.env.DATABASE_URL) {
  const { syncListings } = await import("./sync.js");
  const { db } = await import("../lib/db.js");
  await syncListings();
  await checkpoint();
  await db.end();
} else {
  console.log("DATABASE_URL not set: data kept in files only.");
}
