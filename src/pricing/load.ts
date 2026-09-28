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

  // Every live place on every platform: reviewed, or with real prices in the
  // last month (new villas have no reviews yet but are clearly taking bookings).
  const { rows: all } = await q(
    `select l.platform, l.id, l.lat, l.lng, l.bedrooms, (l.rating is not null) reviewed,
            exists (select 1 from price_samples s where s.platform = l.platform and s.listing_id = l.id and s.snapshot_date >= ($1::date - $2::int))
         or exists (select 1 from price_grid g where g.platform = l.platform and g.listing_id = l.id and g.snapshot_date >= ($1::date - $2::int)) priced
       from listings l where l.active and l.platform in ('airbnb', 'booking', 'web')`,
    [latest, HISTORY_DAYS],
  );
  // The same property on Airbnb and Booking.com counts once, as its Airbnb
  // listing (which has the full calendar).
  const { rows: links } = await q("select airbnb_id, booking_id from listing_links");
  const linkedBooking = new Set(links.map((r) => r.booking_id as string));
  const keyOf = (platform: string, id: string) => `${platform}:${id}`;
  const listings = all
    .filter((l) => l.reviewed || l.priced)
    .filter((l) => !(l.platform === "booking" && linkedBooking.has(l.id)))
    .map((l) => ({
      key: keyOf(l.platform, l.id),
      platform: l.platform as "airbnb" | "booking" | "web",
      id: l.id as string,
      bedrooms: l.bedrooms as number | null,
      dist: km(here.lat, here.lng, l.lat, l.lng),
    }));
  const byKey = new Map(listings.map((l) => [l.key, l]));

  // Comparable set: same bedrooms nearest first, widening the radius, then
  // allowing one bedroom either way, until there are at least 10.
  const within = (r: number, bedTolerance: number) =>
    listings
      .filter((l) => l.dist <= r && l.bedrooms != null && Math.abs(l.bedrooms - p.bedrooms) <= bedTolerance)
      .map((l) => l.key);
  let compIds: string[] = [];
  let compNote = "";
  search: for (const tol of [0, 1]) {
    for (const r of [3, 5, 8, 12]) {
      compIds = within(r, tol);
      compNote = `${tol ? `${p.bedrooms - 1}–${p.bedrooms + 1}` : p.bedrooms}-bedroom villas within ${r} km`;
      if (compIds.length >= 10) break search;
    }
  }
  const counts = { airbnb: 0, booking: 0, web: 0 };
  for (const k of compIds) counts[byKey.get(k)!.platform]++;
  compNote += ` (${[
    counts.airbnb && `${counts.airbnb} Airbnb`,
    counts.booking && `${counts.booking} Booking.com`,
    counts.web && `${counts.web} own website`,
  ]
    .filter(Boolean)
    .join(", ")})`;
  // Every live place within 5 km, any size: fills in nights the comparable set doesn't cover.
  const widerIds = listings.filter((l) => l.dist <= 5).map((l) => l.key);
  const allKeys = [...new Set([...compIds, ...widerIds])];
  const idsFor = (platform: string) => allKeys.map((k) => byKey.get(k)!).filter((l) => l.platform === platform).map((l) => l.id);

  // Booking.com and website prices include taxes; Airbnb's include its guest
  // fees. Put everything on Airbnb's footing using the gap measured on
  // properties listed on both (same night, same place).
  const { rows: ratioRows } = await q(
    `with snap as (select max(snapshot_date) d from price_samples where platform = 'booking'),
          per as (
            select k.booking_id, percentile_cont(0.5) within group (order by (b.total::float8 / b.nights) / (a.total::float8 / a.nights)) r
              from listing_links k
              join price_samples b on b.platform = 'booking' and b.listing_id = k.booking_id and b.snapshot_date = (select d from snap)
              join price_samples a on a.platform = 'airbnb' and a.listing_id = k.airbnb_id and a.snapshot_date = b.snapshot_date and a.checkin = b.checkin
             group by 1)
     select percentile_cont(0.5) within group (order by r) ratio, count(*) n from per`,
  );
  const measured = Number(ratioRows[0]?.ratio);
  const directRatio = ratioRows[0]?.n >= 10 && measured > 0.6 && measured < 1.4 ? measured : 0.87;
  const toAirbnb = (platform: string, perNight: number) => (platform === "airbnb" ? perNight : perNight / directRatio);

  // Availability snapshots: Airbnb and websites publish calendars; Booking.com's
  // is built from the dates we searched (open if it came back with a price).
  const { rows: bkSnaps } = await q(
    "select distinct snapshot_date::text d from price_sample_dates where platform = 'booking' order by 1 desc limit 10",
  );
  const bkLatest: string | undefined = bkSnaps[0]?.d;
  const bkPrev: string | undefined = bkLatest ? bkSnaps.find((s) => dayIndex(s.d, bkLatest) >= 6)?.d : undefined;
  const { rows: webSnaps } = await q("select max(snapshot_date)::text d from calendar_snapshots where platform = 'web'");
  const webLatest: string | undefined = webSnaps[0]?.d ?? undefined;

  const calQuery = (platform: string, snap: string | undefined) =>
    snap && idsFor(platform).length
      ? q("select listing_id, from_date, nights from calendar_snapshots where platform = $1 and snapshot_date = $2 and listing_id = any($3)", [
          platform,
          snap,
          idsFor(platform),
        ])
      : Promise.resolve({ rows: [] as any[] });
  const bookingChecked = async (snap: string | undefined) => {
    if (!snap || !idsFor("booking").length) return { checked: new Set<number>(), open: new Map<string, Set<number>>() };
    const [dates, openRows] = await Promise.all([
      q("select checkin from price_sample_dates where platform = 'booking' and snapshot_date = $1", [snap]),
      q(
        `select listing_id, checkin from price_samples where platform = 'booking' and snapshot_date = $1 and listing_id = any($2)
         union all
         select g.listing_id, (g.from_date + (u.k - 1)::int)::date from price_grid g, unnest(g.per_night) with ordinality u(per_night, k)
          where g.platform = 'booking' and g.snapshot_date = $1 and g.listing_id = any($2) and u.per_night is not null`,
        [snap, idsFor("booking")],
      ),
    ]);
    const open = new Map<string, Set<number>>();
    for (const r of openRows.rows) {
      if (!open.has(r.listing_id)) open.set(r.listing_id, new Set());
      open.get(r.listing_id)!.add(dayIndex(start, asDate(r.checkin)));
    }
    return { checked: new Set(dates.rows.map((r) => dayIndex(start, asDate(r.checkin)))), open };
  };

  const [cals, prevCals, webCals, bkNow, bkBefore, latestPrices, packedPrices] = await Promise.all([
    calQuery("airbnb", latest),
    calQuery("airbnb", prev),
    calQuery("web", webLatest),
    bookingChecked(bkLatest),
    bookingChecked(bkPrev),
    q(
      `select platform, listing_id, snapshot_date, checkin, (total / nights)::float8 per_night
         from price_samples where listing_id = any($1) and platform in ('airbnb', 'booking', 'web') and snapshot_date >= ($2::date - $3::int)`,
      [allKeys.map((k) => byKey.get(k)!.id), latest, HISTORY_DAYS],
    ),
    q(
      `select g.platform, g.listing_id, g.snapshot_date, (g.from_date + (u.k - 1)::int)::date checkin, u.per_night::float8 per_night
         from price_grid g, unnest(g.per_night) with ordinality u(per_night, k)
        where g.listing_id = any($1) and g.platform in ('airbnb', 'booking', 'web') and g.snapshot_date >= ($2::date - $3::int) and u.per_night is not null`,
      [allKeys.map((k) => byKey.get(k)!.id), latest, HISTORY_DAYS],
    ),
  ]);

  const align = (row: { from_date: unknown; nights: string } | undefined) => {
    if (!row) return "";
    const off = dayIndex(asDate(row.from_date), start);
    return off >= 0 ? row.nights.slice(off) : "?".repeat(-off) + row.nights;
  };
  const calBy = new Map(cals.rows.map((r) => [keyOf("airbnb", r.listing_id), r]));
  const prevBy = new Map(prevCals.rows.map((r) => [keyOf("airbnb", r.listing_id), r]));
  for (const r of webCals.rows) calBy.set(keyOf("web", r.listing_id), r);
  const bookingNights = (b: Awaited<ReturnType<typeof bookingChecked>>, id: string) => {
    let s = "";
    const open = b.open.get(id) ?? new Set<number>();
    for (let d = 0; d < days; d++) s += b.checked.has(d) ? (open.has(d) ? "1" : "0") : "?";
    return s;
  };

  const observations = new Map<string, number[]>(); // all prices seen, for "typical"
  const latestFor = new Map<string, Map<number, number>>(); // newest reading per night
  const newestSnap = new Map<string, string>();
  for (const r of [...latestPrices.rows, ...packedPrices.rows]) {
    const key = keyOf(r.platform, r.listing_id);
    if (!byKey.has(key)) continue;
    const perNight = toAirbnb(r.platform, r.per_night);
    observations.set(key, [...(observations.get(key) ?? []), perNight]);
    const d = dayIndex(start, asDate(r.checkin));
    if (d < 0 || d >= days) continue;
    const slot = `${key}|${d}`;
    const snap = asDate(r.snapshot_date);
    if ((newestSnap.get(slot) ?? "") > snap) continue;
    newestSnap.set(slot, snap);
    if (!latestFor.has(key)) latestFor.set(key, new Map());
    latestFor.get(key)!.set(d, perNight);
  }
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[s.length >> 1] : 0;
  };
  const comp = (key: string): CompInput => {
    const l = byKey.get(key)!;
    return {
      id: key,
      typical: med(observations.get(key) ?? []),
      nights: l.platform === "booking" ? bookingNights(bkNow, l.id) : align(calBy.get(key)),
      priced: latestFor.get(key) ?? new Map(),
      prevNights:
        l.platform === "airbnb"
          ? prevBy.has(key)
            ? align(prevBy.get(key))
            : undefined
          : l.platform === "booking" && bkPrev
            ? bookingNights(bkBefore, l.id)
            : undefined,
    };
  };

  return {
    comps: compIds.map(comp),
    wider: widerIds.map(comp),
    compNote,
    latestSnapshot: latest,
    pace: prev ?? null,
    directRatio,
  };
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
