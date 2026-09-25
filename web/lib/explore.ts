// Server-side loader for the Explore page: one compact payload the browser
// filters and aggregates itself, so every filter change is instant.

import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AREAS } from "../../src/areas";
import { bedroomGroup, pool } from "./data";
import { HOUR, MINUTE, cached } from "./cache";
import { audRate } from "./fx";
import { watchedIds } from "./watch";
import type { ExploreData, ExploreListing, MarketEvent } from "./explore-types";

const DAY = 86_400_000;
const dayIndex = (from: string, date: string) => Math.round((Date.parse(date) - Date.parse(from)) / DAY);

function loadEvents(): MarketEvent[] {
  const file = join(process.cwd(), "..", "db", "events.json");
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf8")) as MarketEvent[];
  } catch {
    return [];
  }
}

export async function loadExplore(): Promise<ExploreData | null> {
  const snapshot = await cached("latestSnapshot", 2 * MINUTE, async () => {
    const { rows } = await pool.query("select max(snapshot_date) d from calendar_snapshots where platform = 'airbnb'");
    return (rows[0]?.d as string | null) ?? null;
  });
  if (!snapshot) return null;
  // The market payload is shared; the watchlist changes whenever you star a villa, so it's always fresh.
  const [base, watched] = await Promise.all([
    cached(`explore:${snapshot}`, HOUR, () => buildExplore(snapshot)),
    watchedIds(),
  ]);
  return { ...base, watched: [...watched] };
}

async function buildExplore(snapshot: string): Promise<Omit<ExploreData, "watched">> {

  const [ls, cals, prices, changes] = await Promise.all([
    pool.query("select id, name, kind, area, bedrooms, rating from listings where platform = 'airbnb' and active"),
    pool.query(
      "select listing_id, from_date, nights, min_stay from calendar_snapshots where snapshot_date = $1 and platform = 'airbnb'",
      [snapshot],
    ),
    pool.query(
      `select listing_id, checkin, round(total / nights)::int per_night
         from price_samples where snapshot_date = $1 and platform = 'airbnb'`,
      [snapshot],
    ),
    pool.query(
      `select listing_id, checkin, nights, compared_to from calendar_changes
        where snapshot_date = $1 and platform = 'airbnb' and kind = 'booking'`,
      [snapshot],
    ),
  ]);

  const calBy = new Map(cals.rows.map((r) => [r.listing_id as string, r]));
  // Night 0 is the collection day itself; the market view starts tomorrow.
  const from = new Date(Date.parse(snapshot) + DAY).toISOString().slice(0, 10);
  const days = 365;

  const listings: ExploreListing[] = [];
  const indexOf = new Map<string, number>();
  for (const l of ls.rows) {
    const c = calBy.get(l.id);
    if (!c) continue;
    const offset = dayIndex(c.from_date, from);
    const nights = (c.nights as string).slice(offset, offset + days);
    const blocked = [...nights].filter((ch) => ch === "0").length;
    const minStay = (c.min_stay as [string, number][])
      .map(([d, n]) => [Math.max(0, dayIndex(from, d)), n] as [number, number])
      // Collapse entries before the window into its first day.
      .filter((e, i, arr) => i === arr.length - 1 || arr[i + 1][0] > e[0]);
    indexOf.set(l.id, listings.length);
    listings.push({
      id: l.id,
      name: l.name,
      area: l.area,
      kind: l.kind,
      bedrooms: l.bedrooms,
      rating: l.rating,
      beds: bedroomGroup(l.bedrooms),
      dormant: nights.length > 0 && blocked / nights.length > 0.95,
      nights,
      minStay,
    });
  }

  const priceMap: ExploreData["prices"] = {};
  for (const p of prices.rows) {
    const li = indexOf.get(p.listing_id);
    const di = dayIndex(from, p.checkin);
    if (li == null || di < 0 || di >= days) continue;
    (priceMap[di] ??= []).push([li, p.per_night]);
  }

  const newBookings: ExploreData["newBookings"] = {};
  for (const c of changes.rows) {
    const li = indexOf.get(c.listing_id);
    if (li == null) continue;
    const start = dayIndex(from, c.checkin);
    for (let i = start; i < start + c.nights; i++) if (i >= 0 && i < days) (newBookings[i] ??= []).push(li);
  }

  const present = new Set(listings.map((l) => l.area));
  const fx = await audRate();
  return {
    snapshot,
    from,
    days,
    areas: AREAS.map((a) => a.name).filter((a) => present.has(a)),
    listings,
    prices: priceMap,
    newBookings,
    comparedTo: changes.rows[0]?.compared_to ?? null,
    events: loadEvents(),
    audRate: fx.rate,
    rateDate: fx.date,
  };
}
