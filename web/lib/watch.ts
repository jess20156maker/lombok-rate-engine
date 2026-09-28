import "server-only";
import { pool } from "./data";
import { audRate } from "./fx";

export type WatchPrice = {
  checkin: string;
  nights: number;
  available: boolean;
  perNight: number | null;
  firstPerNight: number | null;
  /** For booked nights: the last price seen while it was still open, and when. */
  wasPerNight: number | null;
  wasSeen: string | null;
};
export type WatchPoint = { date: string; value: number | null };

export type WatchedVilla = {
  platform: string;
  url: string;
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

/** Airbnb listing ids on the watchlist (for Airbnb-only pages). */
export async function watchedIds(): Promise<Set<string>> {
  const { rows } = await pool.query("select listing_id from watchlist where platform = 'airbnb'");
  return new Set(rows.map((r) => r.listing_id));
}

/** Every watched listing as "platform:id". */
export async function watchedKeys(): Promise<Set<string>> {
  const { rows } = await pool.query("select platform, listing_id from watchlist");
  return new Set(rows.map((r) => `${r.platform}:${r.listing_id}`));
}

export async function loadWatchlist(): Promise<{ villas: WatchedVilla[]; audRate: number; rateDate: string }> {
  const { rows: watch } = await pool.query(
    `select w.platform, w.listing_id id, w.note, w.added_at, l.name, l.kind, l.area, l.bedrooms, l.rating, l.slug
       from watchlist w join listings l on l.platform = w.platform and l.id = w.listing_id
      order by w.added_at desc`,
  );
  const fx = await audRate();
  if (!watch.length) return { villas: [], audRate: fx.rate, rateDate: fx.date };
  const platforms = watch.map((w) => w.platform as string);
  const ids = watch.map((w) => w.id as string);
  const pairs = "(platform, listing_id) in (select * from unnest($1::text[], $2::text[]))";
  const key = (platform: string, id: string) => `${platform}:${id}`;

  const [cals, direct, sampled, packed, checkedRows] = await Promise.all([
    pool.query(`select platform, listing_id, snapshot_date::text, from_date::text, nights from calendar_snapshots where ${pairs} order by snapshot_date`, [platforms, ids]),
    pool.query(`select platform, listing_id, snapshot_date::text, checkin::text, nights, available, total from watch_prices where ${pairs}`, [platforms, ids]),
    pool.query(`select platform, listing_id, snapshot_date::text, checkin::text, nights, total from price_samples where ${pairs}`, [platforms, ids]),
    // Older days are packed into price_grid (one row per listing per day).
    pool.query(
      `select g.platform, g.listing_id, g.snapshot_date::text, (g.from_date + (u.k - 1)::int)::date::text checkin, g.nights, u.per_night
         from price_grid g, unnest(g.per_night) with ordinality u(per_night, k)
        where (g.platform, g.listing_id) in (select * from unnest($1::text[], $2::text[])) and u.per_night is not null`,
      [platforms, ids],
    ),
    // Booking.com has no calendar: the dates searched each night tell us which were open.
    platforms.includes("booking")
      ? pool.query("select snapshot_date::text, checkin::text from price_sample_dates where platform = 'booking' order by 1")
      : Promise.resolve({ rows: [] as any[] }),
  ]);

  // Every price reading, from direct checks and from market sampling.
  type Reading = { snapshot: string; checkin: string; nights: number; available: boolean; perNight: number | null };
  const readings = new Map<string, Reading[]>();
  const add = (k: string, r: Reading) => readings.set(k, [...(readings.get(k) ?? []), r]);
  for (const r of direct.rows)
    add(key(r.platform, r.listing_id), {
      snapshot: r.snapshot_date,
      checkin: r.checkin,
      nights: r.nights,
      available: r.available,
      perNight: r.total != null ? Math.round(r.total / r.nights) : null,
    });
  for (const r of sampled.rows)
    add(key(r.platform, r.listing_id), { snapshot: r.snapshot_date, checkin: r.checkin, nights: r.nights, available: true, perNight: Math.round(r.total / r.nights) });
  for (const r of packed.rows)
    add(key(r.platform, r.listing_id), { snapshot: r.snapshot_date, checkin: r.checkin, nights: r.nights, available: true, perNight: r.per_night });

  const checkedBy = new Map<string, string[]>();
  for (const r of checkedRows.rows) checkedBy.set(r.snapshot_date, [...(checkedBy.get(r.snapshot_date) ?? []), r.checkin]);

  const villas = watch.map((w): WatchedVilla => {
    const k = key(w.platform, w.id);
    const rs = readings.get(k) ?? [];

    // Calendar per collection day: Airbnb/websites publish one; for Booking.com
    // rebuild it from the dates searched (open if it came back with a price).
    let calRows: { snapshot_date: string; from_date: string; nights: string }[] = cals.rows.filter((c) => key(c.platform, c.listing_id) === k);
    if (w.platform === "booking") {
      calRows = [...checkedBy.entries()].map(([snap, dates]) => {
        const open = new Set(rs.filter((r) => r.snapshot === snap).map((r) => r.checkin));
        const checked = new Set(dates);
        const from = new Date(Date.parse(snap) + DAY).toISOString().slice(0, 10);
        let nights = "?"; // the collection day itself
        for (let d = 0; d < 365; d++) {
          const date = new Date(Date.parse(from) + d * DAY).toISOString().slice(0, 10);
          nights += checked.has(date) ? (open.has(date) ? "1" : "0") : "?";
        }
        return { snapshot_date: snap, from_date: snap, nights };
      });
      // Nights searched but not returned: booked (or closed) on Booking.com.
      const last = calRows.at(-1);
      if (last) {
        const open = new Set(rs.filter((r) => r.snapshot === last.snapshot_date).map((r) => r.checkin));
        for (const date of checkedBy.get(last.snapshot_date) ?? [])
          if (!open.has(date)) rs.push({ snapshot: last.snapshot_date, checkin: date, nights: 2, available: false, perNight: null });
      }
    }
    const latest = calRows.at(-1);
    const offset = latest ? Math.round((Date.parse(latest.snapshot_date) - Date.parse(latest.from_date)) / DAY) + 1 : 0;
    const nights: string | null = latest ? latest.nights.slice(offset, offset + 365) : null;
    const share = (s: string | null, n: number) => {
      if (!s) return null;
      const known = [...s.slice(0, n)].filter((c) => c !== "?");
      return known.length ? known.filter((c) => c === "0").length / known.length : null;
    };

    const snapshots = [...new Set(rs.map((r) => r.snapshot))].sort();
    const lastSnap = snapshots.at(-1);

    // Latest reading per check-in date, prefer ones with a price.
    const latestBy = new Map<string, Reading>();
    for (const r of rs.filter((r) => r.snapshot === lastSnap)) {
      const cur = latestBy.get(r.checkin);
      if (!cur || (cur.perNight == null && r.perNight != null)) latestBy.set(r.checkin, r);
    }
    const firstBy = new Map<string, number>();
    const lastOpenBy = new Map<string, { perNight: number; seen: string }>();
    for (const r of [...rs].sort((a, b) => a.snapshot.localeCompare(b.snapshot))) {
      if (r.perNight == null) continue;
      if (!firstBy.has(r.checkin)) firstBy.set(r.checkin, r.perNight);
      lastOpenBy.set(r.checkin, { perNight: r.perNight, seen: r.snapshot });
    }

    const horizonEnd = lastSnap ? new Date(Date.parse(lastSnap) + 91 * DAY).toISOString().slice(0, 10) : "";
    // Booking.com is priced for every date, so show every third night to keep the row readable.
    const everyNth = w.platform === "booking" ? 3 : 1;
    const prices: WatchPrice[] = [...latestBy.values()]
      .filter((r) => r.checkin <= horizonEnd)
      .sort((a, b) => a.checkin.localeCompare(b.checkin))
      .filter((_, i) => i % everyNth === 0)
      .map((r) => ({
        checkin: r.checkin,
        nights: r.nights,
        available: r.available,
        perNight: r.perNight,
        firstPerNight: firstBy.get(r.checkin) ?? null,
        wasPerNight: r.available ? null : (lastOpenBy.get(r.checkin)?.perNight ?? null),
        wasSeen: r.available ? null : (lastOpenBy.get(r.checkin)?.seen ?? null),
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
      return { date: c.snapshot_date, value: share(c.nights.slice(off), 90) };
    });

    return {
      platform: w.platform,
      url: w.platform === "airbnb" ? `https://www.airbnb.com/rooms/${w.id}` : w.platform === "booking" ? `https://www.booking.com/hotel/id/${w.slug}.html` : w.slug,
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
