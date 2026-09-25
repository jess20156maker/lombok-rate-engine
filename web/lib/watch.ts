import "server-only";
import { pool } from "./data";
import { audRate } from "./fx";

export type WatchPrice = { checkin: string; nights: number; available: boolean; perNight: number | null; firstPerNight: number | null };
export type WatchPoint = { date: string; value: number | null };

export type WatchedVilla = {
  id: string;
  name: string;
  kind: string;
  area: string;
  bedrooms: number | null;
  rating: string | null;
  note: string | null;
  addedAt: string;
  nights: string | null; // latest calendar from tomorrow
  blocked30: number | null;
  blocked90: number | null;
  prices: WatchPrice[]; // latest reading per check-in date, with its first reading
  priceHistory: WatchPoint[]; // median asking price for open dates in the next 90 days, per collection day
  bookedHistory: WatchPoint[]; // share of the next 90 nights blocked, per collection day
};

const DAY = 86_400_000;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function watchedIds(): Promise<Set<string>> {
  const { rows } = await pool.query("select listing_id from watchlist where platform = 'airbnb'");
  return new Set(rows.map((r) => r.listing_id));
}

export async function loadWatchlist(): Promise<{ villas: WatchedVilla[]; audRate: number; rateDate: string }> {
  const { rows: watch } = await pool.query(
    `select w.listing_id id, w.note, w.added_at, l.name, l.kind, l.area, l.bedrooms, l.rating
       from watchlist w join listings l on l.platform = w.platform and l.id = w.listing_id
      where w.platform = 'airbnb' order by w.added_at desc`,
  );
  const fx = await audRate();
  if (!watch.length) return { villas: [], audRate: fx.rate, rateDate: fx.date };
  const ids = watch.map((w) => w.id);

  const [cals, direct, sampled] = await Promise.all([
    pool.query(
      `select listing_id, snapshot_date, from_date, nights from calendar_snapshots
        where platform = 'airbnb' and listing_id = any($1) order by snapshot_date`,
      [ids],
    ),
    pool.query(
      `select listing_id, snapshot_date, checkin, nights, available, total from watch_prices
        where platform = 'airbnb' and listing_id = any($1)`,
      [ids],
    ),
    pool.query(
      `select listing_id, snapshot_date, checkin, nights, total from price_samples
        where platform = 'airbnb' and listing_id = any($1)`,
      [ids],
    ),
  ]);

  // Every price reading, from direct checks and from market sampling.
  type Reading = { snapshot: string; checkin: string; nights: number; available: boolean; perNight: number | null };
  const readings = new Map<string, Reading[]>();
  const add = (id: string, r: Reading) => readings.set(id, [...(readings.get(id) ?? []), r]);
  for (const r of direct.rows)
    add(r.listing_id, {
      snapshot: r.snapshot_date,
      checkin: r.checkin,
      nights: r.nights,
      available: r.available,
      perNight: r.total != null ? Math.round(r.total / r.nights) : null,
    });
  for (const r of sampled.rows)
    add(r.listing_id, { snapshot: r.snapshot_date, checkin: r.checkin, nights: r.nights, available: true, perNight: Math.round(r.total / r.nights) });

  const villas = watch.map((w): WatchedVilla => {
    const calRows = cals.rows.filter((c) => c.listing_id === w.id);
    const latest = calRows.at(-1);
    const offset = latest ? Math.round((Date.parse(latest.snapshot_date) - Date.parse(latest.from_date)) / DAY) + 1 : 0;
    const nights: string | null = latest ? latest.nights.slice(offset, offset + 365) : null;
    const share = (s: string | null, n: number) =>
      s ? [...s.slice(0, n)].filter((c) => c === "0").length / Math.max(1, Math.min(n, s.length)) : null;

    const rs = readings.get(w.id) ?? [];
    const snapshots = [...new Set(rs.map((r) => r.snapshot))].sort();
    const lastSnap = snapshots.at(-1);

    // Latest reading per check-in date, prefer direct checks (they include "booked").
    const latestBy = new Map<string, Reading>();
    for (const r of rs.filter((r) => r.snapshot === lastSnap)) {
      const cur = latestBy.get(r.checkin);
      if (!cur || (cur.perNight == null && r.perNight != null)) latestBy.set(r.checkin, r);
    }
    const firstBy = new Map<string, number>();
    for (const r of [...rs].sort((a, b) => a.snapshot.localeCompare(b.snapshot)))
      if (r.perNight != null && !firstBy.has(r.checkin)) firstBy.set(r.checkin, r.perNight);

    const horizonEnd = lastSnap ? new Date(Date.parse(lastSnap) + 91 * DAY).toISOString().slice(0, 10) : "";
    const prices: WatchPrice[] = [...latestBy.values()]
      .filter((r) => r.checkin <= horizonEnd)
      .sort((a, b) => a.checkin.localeCompare(b.checkin))
      .map((r) => ({
        checkin: r.checkin,
        nights: r.nights,
        available: r.available,
        perNight: r.perNight,
        firstPerNight: firstBy.get(r.checkin) ?? null,
      }));

    const priceHistory = snapshots.map((s) => {
      const end = new Date(Date.parse(s) + 91 * DAY).toISOString().slice(0, 10);
      return {
        date: s,
        value: median(rs.filter((r) => r.snapshot === s && r.perNight != null && r.checkin <= end).map((r) => r.perNight!)),
      };
    });
    const bookedHistory = calRows.map((c) => {
      const off = Math.round((Date.parse(c.snapshot_date) - Date.parse(c.from_date)) / DAY) + 1;
      return { date: c.snapshot_date as string, value: share(c.nights.slice(off), 90) };
    });

    return {
      id: w.id,
      name: w.name,
      kind: w.kind,
      area: w.area,
      bedrooms: w.bedrooms,
      rating: w.rating,
      note: w.note,
      addedAt: new Date(w.added_at).toISOString().slice(0, 10),
      nights,
      blocked30: share(nights, 30),
      blocked90: share(nights, 90),
      prices,
      priceHistory,
      bookedHistory,
    };
  });

  return { villas, audRate: fx.rate, rateDate: fx.date };
}
