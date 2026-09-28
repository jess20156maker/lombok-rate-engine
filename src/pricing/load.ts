// Gather everything the pricing engine needs from Supabase.

import { AREAS } from "../areas";
import { asDate, type Query } from "../lib/sql";
import type { CompInput, EngineInput, EventInput } from "./engine";

const DAY = 86_400_000;
const dayIndex = (from: string, date: string) => Math.round((Date.parse(date) - Date.parse(from)) / DAY);
const HISTORY_DAYS = 30; // how far back "typical price" looks

export type Property = {
  id: string;
  name: string;
  area: string;
  bedrooms: number;
  position: number;
  min_rate: number;
  max_rate: number;
  base_min_stay: number;
  lat?: number | null;
  lng?: number | null;
};

/** Straight-line distance in km. */
function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dLat = (aLat - bLat) * 111.32;
  const dLng = (aLng - bLng) * 111.32 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

export type MarketInput = Awaited<ReturnType<typeof loadMarketInput>>;

/** Comparable villas, calendars and prices: changes once a night, so callers may cache it. */
export async function loadMarketInput(q: Query, p: Property, start: string, days = 365) {
  const { rows: snaps } = await q(
    "select distinct snapshot_date::text d from calendar_snapshots where platform = 'airbnb' order by 1 desc limit 10",
  );
  const latest: string = snaps[0].d;
  // A snapshot about a week older, for booking pace (none until a week of history exists).
  const prev: string | undefined = snaps.find((s) => dayIndex(s.d, latest) >= 6)?.d;

  // Where the villa is: its own coordinates, else its beach's centre.
  const centre = AREAS.find((a) => a.name === p.area);
  const here = { lat: p.lat ?? centre?.lat ?? -8.87, lng: p.lng ?? centre?.lng ?? 116.16 };

  // Live listings: reviewed, or with real prices in the last month (new villas
  // have no reviews yet but are clearly taking bookings).
  const { rows: all } = await q(
    `select l.id, l.lat, l.lng, l.bedrooms, (l.rating is not null) reviewed,
            exists (select 1 from price_samples s where s.platform = 'airbnb' and s.listing_id = l.id and s.snapshot_date >= ($1::date - $2::int))
         or exists (select 1 from price_grid g where g.platform = 'airbnb' and g.listing_id = l.id and g.snapshot_date >= ($1::date - $2::int)) priced
       from listings l where l.platform = 'airbnb' and l.active`,
    [latest, HISTORY_DAYS],
  );
  const listings = all
    .filter((l) => l.reviewed || l.priced)
    .map((l) => ({ id: l.id as string, bedrooms: l.bedrooms as number | null, dist: km(here.lat, here.lng, l.lat, l.lng) }));

  // Comparable set: same bedrooms nearest first, widening the radius, then
  // allowing one bedroom either way, until there are at least 10.
  const within = (r: number, bedTolerance: number) =>
    listings
      .filter((l) => l.dist <= r && l.bedrooms != null && Math.abs(l.bedrooms - p.bedrooms) <= bedTolerance)
      .map((l) => l.id);
  let compIds: string[] = [];
  let compNote = "";
  search: for (const tol of [0, 1]) {
    for (const r of [3, 5, 8, 12]) {
      compIds = within(r, tol);
      compNote = `${tol ? `${p.bedrooms - 1}–${p.bedrooms + 1}` : p.bedrooms}-bedroom villas within ${r} km`;
      if (compIds.length >= 10) break search;
    }
  }
  // Every live villa within 5 km, any size: fills in nights the comparable set doesn't cover.
  const widerIds = listings.filter((l) => l.dist <= 5).map((l) => l.id);
  const allIds = [...new Set([...compIds, ...widerIds])];

  const [cals, prevCals, latestPrices, packedPrices] = await Promise.all([
    q("select listing_id, from_date, nights from calendar_snapshots where platform = 'airbnb' and snapshot_date = $1 and listing_id = any($2)", [latest, allIds]),
    prev
      ? q("select listing_id, from_date, nights from calendar_snapshots where platform = 'airbnb' and snapshot_date = $1 and listing_id = any($2)", [prev, allIds])
      : Promise.resolve({ rows: [] as any[] }),
    q(
      `select listing_id, snapshot_date, checkin, (total / nights)::float8 per_night
         from price_samples where platform = 'airbnb' and listing_id = any($1) and snapshot_date >= ($2::date - $3::int)`,
      [allIds, latest, HISTORY_DAYS],
    ),
    q(
      `select g.listing_id, g.snapshot_date, (g.from_date + (u.k - 1)::int)::date checkin, u.per_night::float8 per_night
         from price_grid g, unnest(g.per_night) with ordinality u(per_night, k)
        where g.platform = 'airbnb' and g.listing_id = any($1) and g.snapshot_date >= ($2::date - $3::int) and u.per_night is not null`,
      [allIds, latest, HISTORY_DAYS],
    ),
  ]);

  const align = (row: { from_date: unknown; nights: string } | undefined) => {
    if (!row) return "";
    const off = dayIndex(asDate(row.from_date), start);
    return off >= 0 ? row.nights.slice(off) : "?".repeat(-off) + row.nights;
  };
  const calBy = new Map(cals.rows.map((r) => [r.listing_id, r]));
  const prevBy = new Map(prevCals.rows.map((r) => [r.listing_id, r]));

  const observations = new Map<string, number[]>(); // all prices seen, for "typical"
  const latestFor = new Map<string, Map<number, number>>(); // newest reading per night
  const newestSnap = new Map<string, string>();
  for (const r of [...latestPrices.rows, ...packedPrices.rows]) {
    observations.set(r.listing_id, [...(observations.get(r.listing_id) ?? []), r.per_night]);
    const d = dayIndex(start, asDate(r.checkin));
    if (d < 0 || d >= days) continue;
    const key = `${r.listing_id}|${d}`;
    const snap = asDate(r.snapshot_date);
    if ((newestSnap.get(key) ?? "") > snap) continue;
    newestSnap.set(key, snap);
    if (!latestFor.has(r.listing_id)) latestFor.set(r.listing_id, new Map());
    latestFor.get(r.listing_id)!.set(d, r.per_night);
  }
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[s.length >> 1] : 0;
  };
  const comp = (id: string): CompInput => ({
    id,
    typical: med(observations.get(id) ?? []),
    nights: align(calBy.get(id)),
    priced: latestFor.get(id) ?? new Map(),
    prevNights: prevBy.has(id) ? align(prevBy.get(id)) : undefined,
  });

  return { comps: compIds.map(comp), wider: widerIds.map(comp), compNote, latestSnapshot: latest, pace: prev ?? null };
}

export async function loadEngineInput(q: Query, p: Property, start: string, events: EventInput[], market?: MarketInput, days = 365) {
  const m = market ?? (await loadMarketInput(q, p, start, days));

  // The villa's own bookings and blocks.
  const { rows: res } = await q(
    "select checkin, checkout from reservations where property_id = $1 and status = 'confirmed' and checkout > $2",
    [p.id, start],
  );
  const occupied = new Set<number>();
  for (const r of res)
    for (let d = Math.max(0, dayIndex(start, asDate(r.checkin))); d < Math.min(days, dayIndex(start, asDate(r.checkout))); d++) occupied.add(d);

  const { rows: ov } = await q("select date, price, min_stay, note from rate_overrides where property_id = $1 and date >= $2", [p.id, start]);
  const overrides = new Map(
    ov.map((o) => [dayIndex(start, asDate(o.date)), { price: o.price == null ? null : Number(o.price), minStay: o.min_stay, note: o.note }]),
  );

  const input: EngineInput = {
    start,
    days,
    position: p.position,
    minRate: Number(p.min_rate),
    maxRate: Number(p.max_rate),
    baseMinStay: p.base_min_stay,
    comps: m.comps,
    wider: m.wider,
    events,
    occupied,
    overrides,
  };
  return { input, compNote: m.compNote, latestSnapshot: m.latestSnapshot, pace: m.pace };
}
