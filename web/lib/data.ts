// Everything the dashboard shows comes through this file. It reads Supabase
// (Postgres) via DATABASE_URL; the pages never query the database directly.

import "server-only";
import pg from "pg";
import { databaseUrl } from "../../src/lib/env";
import { HOUR, MINUTE, cached } from "./cache";

// Return DATE columns as "YYYY-MM-DD" strings and BIGINT as numbers.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));

const globalForDb = globalThis as unknown as { pool?: pg.Pool };
// One pool per server process, surviving dev hot-reloads.
export const pool = (globalForDb.pool ??= new pg.Pool({
  connectionString: databaseUrl(),
  ssl: { rejectUnauthorized: false },
  max: 3,
}));

// ---- Raw shapes --------------------------------------------------------------

export type Listing = {
  platform: "airbnb" | "booking";
  id: string;
  name: string;
  kind: string;
  area: string;
  lat: number;
  lng: number;
  bedrooms: number | null;
  rating: string | null;
  firstSeen: string;
  lastSeen: string;
  active: boolean;
};

type StoredCalendar = { from: string; nights: string };
type PriceSample = { listingId: string; checkin: string; nights: number; total: number; nightly: number | null };
export type ChangeEvent = { listingId: string; kind: "booking" | "owner-block" | "reopened"; checkin: string; nights: number; leadDays: number };

async function loadListings(): Promise<Listing[]> {
  return cached("listings", 10 * MINUTE, () => queryListings());
}

async function queryListings(): Promise<Listing[]> {
  const { rows } = await pool.query(
    `select platform, id, name, kind, area, lat, lng, bedrooms, rating,
            first_seen as "firstSeen", last_seen as "lastSeen", active
       from listings where platform = 'airbnb' and active`,
  );
  return rows;
}

export async function snapshotDates(): Promise<string[]> {
  return cached("snapshotDates", 2 * MINUTE, querySnapshotDates);
}

async function querySnapshotDates(): Promise<string[]> {
  const { rows } = await pool.query(
    "select distinct snapshot_date d from calendar_snapshots where platform = 'airbnb' order by 1",
  );
  return rows.map((r) => r.d);
}

// A day's snapshot is complete once collected; reload hourly in case a run was still syncing.
function loadSnapshot(date: string) {
  return cached(`snapshot:${date}`, HOUR, () => querySnapshot(date));
}

async function querySnapshot(date: string) {
  const [cals, samples, done, changes] = await Promise.all([
    pool.query(
      `select listing_id, from_date, nights from calendar_snapshots where snapshot_date = $1 and platform = 'airbnb'`,
      [date],
    ),
    pool.query(
      `select listing_id "listingId", checkin, nights, total, nightly
         from price_samples where snapshot_date = $1 and platform = 'airbnb'`,
      [date],
    ),
    pool.query(`select checkin from price_sample_dates where snapshot_date = $1 and platform = 'airbnb' order by 1`, [date]),
    pool.query(
      `select compared_to, listing_id "listingId", kind, checkin, nights, lead_days "leadDays"
         from calendar_changes where snapshot_date = $1 and platform = 'airbnb'`,
      [date],
    ),
  ]);
  const calendars: Record<string, StoredCalendar> = {};
  for (const r of cals.rows) calendars[r.listing_id] = { from: r.from_date, nights: r.nights };
  return {
    calendars,
    prices: { done: done.rows.map((r) => r.checkin as string), samples: samples.rows as PriceSample[] },
    // Changes only exist from the second snapshot on.
    events: changes.rows.length
      ? { comparedTo: changes.rows[0].compared_to as string, events: changes.rows as ChangeEvent[] }
      : null,
  };
}

// ---- Derived figures ----------------------------------------------------------

export type ListingStats = Listing & {
  calendarFrom: string | null;
  nights: string | null; // one char per night from calendarFrom: 1 open, c open no check-in, 0 blocked
  blocked30: number | null; // share of the next 30 nights blocked
  blocked90: number | null;
  blocked365: number | null;
  dormant: boolean; // blocked almost all year: probably not really taking bookings
  medianNightly: number | null; // from today's price samples
  priceSamples: { checkin: string; perNight: number }[];
};

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function blockedShare(nights: string, fromIdx: number, count: number) {
  const slice = nights.slice(fromIdx, fromIdx + count);
  return slice.length ? [...slice].filter((c) => c === "0").length / slice.length : null;
}

export function bedroomGroup(b: number | null) {
  if (b == null) return "?";
  if (b >= 4) return "4+";
  return String(Math.max(b, 1));
}
export const BEDROOM_GROUPS = ["1", "2", "3", "4+"];

export async function loadMarket() {
  const dates = await snapshotDates();
  const date = dates.at(-1) ?? null;
  const [listings, snap] = await Promise.all([loadListings(), date ? loadSnapshot(date) : null]);

  const samplesBy = new Map<string, { checkin: string; perNight: number }[]>();
  for (const s of snap?.prices.samples ?? []) {
    const arr = samplesBy.get(s.listingId) ?? [];
    arr.push({ checkin: s.checkin, perNight: Math.round(s.total / s.nights) });
    samplesBy.set(s.listingId, arr);
  }

  const stats: ListingStats[] = listings.map((l) => {
    const cal = snap?.calendars[l.id];
    // Night 0 is the snapshot day itself, which closes on its own; start at tomorrow.
    const b365 = cal ? blockedShare(cal.nights, 1, 365) : null;
    const samples = (samplesBy.get(l.id) ?? []).sort((a, b) => a.checkin.localeCompare(b.checkin));
    return {
      ...l,
      calendarFrom: cal?.from ?? null,
      nights: cal?.nights ?? null,
      blocked30: cal ? blockedShare(cal.nights, 1, 30) : null,
      blocked90: cal ? blockedShare(cal.nights, 1, 90) : null,
      blocked365: b365,
      dormant: b365 != null && b365 > 0.95,
      medianNightly: median(samples.map((s) => s.perNight)),
      priceSamples: samples,
    };
  });

  return {
    date,
    dates,
    stats,
    events: snap?.events ?? null,
    priceDates: snap?.prices.done ?? [],
    calendarsCollected: Object.keys(snap?.calendars ?? {}).length,
  };
}

export type Market = Awaited<ReturnType<typeof loadMarket>>;

export function areaSummaries(m: Market) {
  const areas = new Map<string, ListingStats[]>();
  for (const s of m.stats) areas.set(s.area, [...(areas.get(s.area) ?? []), s]);

  return [...areas.entries()]
    .map(([area, ls]) => {
      // Dormant listings would drag occupancy up without meaning anything.
      const live = ls.filter((l) => l.nights && !l.dormant);
      const avg = (f: (l: ListingStats) => number | null) => {
        const xs = live.map(f).filter((x): x is number => x != null);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
      };
      const priceByBeds = Object.fromEntries(
        BEDROOM_GROUPS.map((g) => [
          g,
          median(ls.filter((l) => bedroomGroup(l.bedrooms) === g && l.medianNightly).map((l) => l.medianNightly!)),
        ]),
      );
      return {
        area,
        listings: ls.length,
        tracked: live.length,
        dormant: ls.filter((l) => l.dormant).length,
        blocked30: avg((l) => l.blocked30),
        blocked90: avg((l) => l.blocked90),
        priceByBeds,
      };
    })
    .sort((a, b) => b.listings - a.listings);
}

/** Share of nights blocked per calendar month ahead, per area. */
export function forwardByMonth(m: Market, months = 12) {
  if (!m.date) return { months: [] as string[], rows: [] as { area: string; values: (number | null)[] }[] };
  const start = new Date(m.date + "T00:00:00Z");
  const labels: string[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    labels.push(d.toISOString().slice(0, 7));
  }
  const acc = new Map<string, { blocked: number[]; total: number[] }>();
  for (const l of m.stats) {
    if (!l.nights || !l.calendarFrom || l.dormant) continue;
    const a = acc.get(l.area) ?? { blocked: Array(months).fill(0), total: Array(months).fill(0) };
    for (let i = 1; i < l.nights.length; i++) {
      const month = new Date(Date.parse(l.calendarFrom + "T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 7);
      const idx = labels.indexOf(month);
      if (idx < 0) continue;
      a.total[idx]++;
      if (l.nights[i] === "0") a.blocked[idx]++;
    }
    acc.set(l.area, a);
  }
  const rows = [...acc.entries()]
    .map(([area, a]) => ({ area, values: a.total.map((t, i) => (t ? a.blocked[i] / t : null)) }))
    .sort((x, y) => (m.stats.filter((s) => s.area === y.area).length - m.stats.filter((s) => s.area === x.area).length));
  return { months: labels, rows };
}

export function airbnbUrl(id: string) {
  return `https://www.airbnb.com/rooms/${id}`;
}
