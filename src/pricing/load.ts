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
};

/** Beaches nearest to `area`, nearest first (including itself). */
function nearbyAreas(area: string) {
  const me = AREAS.find((a) => a.name === area);
  if (!me) return [area];
  return [...AREAS]
    .sort((a, b) => (a.lat - me.lat) ** 2 + (a.lng - me.lng) ** 2 - ((b.lat - me.lat) ** 2 + (b.lng - me.lng) ** 2))
    .map((a) => a.name);
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

  const areas = nearbyAreas(p.area);
  const { rows: listings } = await q(
    "select id, area, bedrooms, rating from listings where platform = 'airbnb' and active and area = any($1)",
    [areas.slice(0, 3)],
  );

  // Comparable set: same beach and bedrooms; widen by bedrooms, then by neighbouring beaches, until there are enough.
  const reviewed = listings.filter((l) => l.rating);
  const pick = (f: (l: (typeof listings)[number]) => boolean) => reviewed.filter(f).map((l) => l.id as string);
  let compIds = pick((l) => l.area === p.area && l.bedrooms === p.bedrooms);
  let compNote = `${p.bedrooms}-bedroom villas at ${p.area}`;
  if (compIds.length < 8) {
    compIds = pick((l) => l.area === p.area && Math.abs(l.bedrooms - p.bedrooms) <= 1);
    compNote = `${p.bedrooms - 1}–${p.bedrooms + 1} bedroom villas at ${p.area}`;
  }
  if (compIds.length < 8) {
    compIds = pick((l) => areas.slice(0, 3).includes(l.area) && Math.abs(l.bedrooms - p.bedrooms) <= 1);
    compNote = `${p.bedrooms - 1}–${p.bedrooms + 1} bedroom villas at ${areas.slice(0, 3).join(", ")}`;
  }
  const widerIds = listings.filter((l) => l.area === p.area).map((l) => l.id as string);
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
