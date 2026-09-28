// Server-side loader for the Explore page: one compact payload the browser
// filters and aggregates itself, so every filter change is instant.

import "server-only";
import { AREAS } from "../../src/areas";
// Imported (not read from disk) so it ships with the deployed app.
import eventsFile from "../../db/events.json";
import { bedroomGroup, pool } from "./data";
import { HOUR, MINUTE, cached } from "./cache";
import { audRate } from "./fx";
import { watchedKeys } from "./watch";
import type { BookingListing, ExploreData, ExploreListing, MarketEvent } from "./explore-types";

const DAY = 86_400_000;
const PAYLOAD_VERSION = 7;
const dayIndex = (from: string, date: string) => Math.round((Date.parse(date) - Date.parse(from)) / DAY);

function loadEvents(): MarketEvent[] {
  return eventsFile as MarketEvent[];
}

export async function loadExplore(): Promise<ExploreData | null> {
  const snapshot = await cached("latestSnapshot", 2 * MINUTE, async () => {
    const { rows } = await pool.query("select max(snapshot_date) d from calendar_snapshots where platform = 'airbnb'");
    return (rows[0]?.d as string | null) ?? null;
  });
  if (!snapshot) return null;
  // The market payload is shared; the watchlist changes whenever you star a villa, so it's always fresh.
  // Bump PAYLOAD_VERSION when the payload shape changes, so stale cached copies are ignored.
  const base = await cached(`explore:v${PAYLOAD_VERSION}:${snapshot}`, HOUR, () => buildExplore(snapshot));
  // Booking.com and the cross-platform links land in stages overnight, and the
  // watchlist changes whenever you star a villa, so these stay fresher.
  const [booking, web, watched] = await Promise.all([
    cached(`booking:v${PAYLOAD_VERSION}:${snapshot}`, 10 * MINUTE, () => loadBooking(base.from, base.days)),
    cached(`web:v${PAYLOAD_VERSION}:${snapshot}`, 10 * MINUTE, () => loadWeb(base.from, base.days)),
    watchedKeys(),
  ]);
  const slugByAirbnb = new Map(
    booking.listings.filter((l) => l.airbnbId).map((l) => [l.airbnbId!, l.slug] as [string, string]),
  );
  // Villas only on Booking.com join the market figures: availability from the
  // dates searched, prices put on Airbnb's footing with the measured gap.
  const listings = base.listings.map((l) => ({ ...l, bookingSlug: slugByAirbnb.get(l.id) ?? null }));
  const prices: ExploreData["prices"] = Object.fromEntries(Object.entries(base.prices).map(([d, a]) => [d, [...a]]));
  const wasPrices: ExploreData["wasPrices"] = Object.fromEntries(Object.entries(base.wasPrices).map(([d, a]) => [d, [...a]]));
  const checked = new Set(booking.checked);
  const openBy = new Map<number, Set<number>>();
  for (const [d, arr] of Object.entries(booking.prices)) for (const [bi] of arr) {
    if (!openBy.has(bi)) openBy.set(bi, new Set());
    openBy.get(bi)!.add(Number(d));
  }
  const newIndex = new Map<number, number>();
  booking.listings.forEach((b, bi) => {
    if (b.airbnbId) return;
    let nights = "";
    for (let d = 0; d < base.days; d++) nights += checked.has(d) ? (openBy.get(bi)?.has(d) ? "1" : "0") : "?";
    newIndex.set(bi, listings.length);
    listings.push({
      platform: "booking",
      url: `https://www.booking.com/hotel/id/${b.slug}.html`,
      id: b.id,
      name: b.name,
      area: b.area,
      kind: "Booking.com",
      bedrooms: b.bedrooms,
      rating: b.rating,
      beds: b.beds,
      bookingSlug: b.slug,
      dormant: false,
      nights,
      minStay: [],
    });
  });
  for (const [d, arr] of Object.entries(booking.prices))
    for (const [bi, p] of arr) if (newIndex.has(bi)) (prices[Number(d)] ??= []).push([newIndex.get(bi)!, Math.round(p / booking.ratio)]);
  for (const [d, arr] of Object.entries(booking.wasPrices))
    for (const [bi, p, seen] of arr) if (newIndex.has(bi)) (wasPrices[Number(d)] ??= []).push([newIndex.get(bi)!, Math.round(p / booking.ratio), seen]);

  return { ...base, listings, prices, wasPrices, booking, web, watched: [...watched] };
}

async function buildExplore(snapshot: string): Promise<Omit<ExploreData, "watched" | "booking" | "web">> {

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
      platform: "airbnb",
      url: `https://www.airbnb.com/rooms/${l.id}`,
      id: l.id,
      name: l.name,
      area: l.area,
      kind: l.kind,
      bedrooms: l.bedrooms,
      rating: l.rating,
      beds: bedroomGroup(l.bedrooms),
      bookingSlug: null, // filled from the (fresher) Booking.com data in loadExplore
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
    wasPrices: await wasPricesFor("airbnb", from, days, indexOf, priceMap),
    newBookings,
    comparedTo: changes.rows[0]?.compared_to ?? null,
    events: loadEvents(),
    audRate: fx.rate,
    rateDate: fx.date,
  };
}

/** Booking.com: places seen in the last 30 days, and the latest night's sampled prices. */
async function loadBooking(from: string, days: number): Promise<ExploreData["booking"]> {
  // The latest collection day that finished (or nearly): a night cut short by
  // Booking.com's bot check would otherwise make most places look booked.
  const { rows: recent } = await pool.query(
    `select snapshot_date::text d, count(*) n from price_sample_dates where platform = 'booking'
      group by 1 order by 1 desc limit 7`,
  );
  const most = Math.max(0, ...recent.map((r) => Number(r.n)));
  const snapshot: string | null = recent.find((r) => Number(r.n) >= most * 0.8)?.d ?? null;
  if (!snapshot) return { snapshot: null, listings: [], prices: {}, wasPrices: {}, checked: [], ratio: 0.87 };

  const [ls, ps, links] = await Promise.all([
    pool.query("select id, name, area, bedrooms, rating, slug from listings where platform = 'booking' and active"),
    pool.query(
      `select listing_id, checkin, round(total / nights)::int per_night
         from price_samples where platform = 'booking' and snapshot_date = $1`,
      [snapshot],
    ),
    pool.query("select airbnb_id, booking_id from listing_links"),
  ]);
  const airbnbByBooking = new Map(links.rows.map((r) => [r.booking_id as string, r.airbnb_id as string]));
  const listings: BookingListing[] = ls.rows.map((l) => ({
    id: l.id,
    name: l.name,
    area: l.area,
    bedrooms: l.bedrooms,
    beds: bedroomGroup(l.bedrooms),
    rating: l.rating,
    slug: l.slug ?? "",
    airbnbId: airbnbByBooking.get(l.id) ?? null,
  }));
  const index = new Map(listings.map((l, i) => [l.id, i]));
  const prices: ExploreData["booking"]["prices"] = {};
  for (const p of ps.rows) {
    const li = index.get(p.listing_id);
    const di = dayIndex(from, p.checkin);
    if (li == null || di < 0 || di >= days) continue;
    (prices[di] ??= []).push([li, p.per_night]);
  }
  const [checkedRows, ratioRows, wasPrices] = await Promise.all([
    pool.query("select checkin::text from price_sample_dates where platform = 'booking' and snapshot_date = $1", [snapshot]),
    // Same gap the pricing engine measures (src/pricing/load.ts).
    pool.query(
      `with per as (
         select k.booking_id, percentile_cont(0.5) within group (order by (b.total::float8 / b.nights) / (a.total::float8 / a.nights)) r
           from listing_links k
           join price_samples b on b.platform = 'booking' and b.listing_id = k.booking_id and b.snapshot_date = $1
           join price_samples a on a.platform = 'airbnb' and a.listing_id = k.airbnb_id and a.snapshot_date = b.snapshot_date and a.checkin = b.checkin
          group by 1)
       select percentile_cont(0.5) within group (order by r) ratio, count(*) n from per`,
      [snapshot],
    ),
    wasPricesFor("booking", from, days, index, prices),
  ]);
  const measured = Number(ratioRows.rows[0]?.ratio);
  const ratio = ratioRows.rows[0]?.n >= 10 && measured > 0.6 && measured < 1.4 ? measured : 0.87;
  const checked = checkedRows.rows.map((r) => dayIndex(from, r.checkin)).filter((d) => d >= 0 && d < days);
  return { snapshot, listings, prices, wasPrices, checked, ratio };
}

/** Competitor websites: latest calendar and nightly rates for each tracked room. */
async function loadWeb(from: string, days: number): Promise<ExploreData["web"]> {
  const { rows: latest } = await pool.query("select max(snapshot_date)::text d from calendar_snapshots where platform = 'web'");
  const snap: string | null = latest[0]?.d ?? null;
  if (!snap) return { listings: [], prices: {}, wasPrices: {} };
  const [ls, cals, ps] = await Promise.all([
    pool.query("select id, name, area, bedrooms, slug from listings where platform = 'web' and active order by name"),
    pool.query("select listing_id, from_date::text, nights from calendar_snapshots where platform = 'web' and snapshot_date = $1", [snap]),
    pool.query("select listing_id, checkin::text, (total / nights)::int per_night from price_samples where platform = 'web' and snapshot_date = $1", [snap]),
  ]);
  const calBy = new Map(cals.rows.map((r) => [r.listing_id as string, r]));
  const listings = ls.rows.map((l) => {
    const c = calBy.get(l.id);
    // Align the site's calendar to the dashboard's day 0.
    const off = c ? dayIndex(c.from_date, from) : 0;
    const nights = c ? (off >= 0 ? c.nights.slice(off) : "?".repeat(-off) + c.nights).slice(0, days) : "";
    return { id: l.id as string, name: l.name as string, area: l.area as string, beds: bedroomGroup(l.bedrooms), url: l.slug as string, nights };
  });
  const index = new Map(listings.map((l, i) => [l.id, i]));
  const prices: ExploreData["web"]["prices"] = {};
  for (const p of ps.rows) {
    const li = index.get(p.listing_id);
    const di = dayIndex(from, p.checkin);
    if (li == null || di < 0 || di >= days) continue;
    (prices[di] ??= []).push([li, p.per_night]);
  }
  return { listings, prices, wasPrices: await wasPricesFor("web", from, days, index, prices) };
}

/**
 * For nights with no current price (booked or sold out), the most recent price
 * seen for that place and night on an earlier collection day, from recent
 * checks and the packed history.
 */
async function wasPricesFor(
  platform: "airbnb" | "booking" | "web",
  from: string,
  days: number,
  index: Map<string, number>,
  current: Record<number, [number, number][]>,
): Promise<Record<number, [number, number, string][]>> {
  const until = new Date(Date.parse(from) + (days - 1) * DAY).toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `select distinct on (listing_id, checkin) listing_id, checkin::text, per_night, snapshot_date::text seen from (
       select listing_id, checkin, (total / nights)::int per_night, snapshot_date
         from price_samples where platform = $1 and checkin between $2 and $3
       union all
       select g.listing_id, (g.from_date + (u.k - 1)::int)::date, u.per_night, g.snapshot_date
         from price_grid g, unnest(g.per_night) with ordinality u(per_night, k)
        where g.platform = $1 and u.per_night is not null and (g.from_date + (u.k - 1)::int) between $2 and $3
     ) x order by listing_id, checkin, snapshot_date desc`,
    [platform, from, until],
  );
  const priced = new Set<string>();
  for (const [di, arr] of Object.entries(current)) for (const [li] of arr) priced.add(`${li}|${di}`);
  const out: Record<number, [number, number, string][]> = {};
  for (const r of rows) {
    const li = index.get(r.listing_id);
    const di = dayIndex(from, r.checkin);
    if (li == null || di < 0 || di >= days || priced.has(`${li}|${di}`)) continue;
    (out[di] ??= []).push([li, r.per_night, r.seen]);
  }
  return out;
}
