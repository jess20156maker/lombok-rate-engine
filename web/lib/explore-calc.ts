// Aggregation and insight rules for the Explore page. Pure functions: no React,
// no fetching, so the same numbers can later feed alerts or a pricing engine.

import type { ExploreData, ExploreListing, MarketEvent } from "./explore-types";

const DAY = 86_400_000;

export type Filters = {
  areas: string[]; // empty = all
  beds: string[]; // empty = all
  window: WindowKey;
  includeDormant: boolean;
};

export type WindowKey = "30" | "90" | "180" | "365" | `m:${string}`; // m:2026-12

export function dateOf(from: string, i: number) {
  return new Date(Date.parse(from) + i * DAY).toISOString().slice(0, 10);
}

export function windowRange(data: ExploreData, w: WindowKey): [number, number] {
  if (w.startsWith("m:")) {
    const month = w.slice(2);
    let start = -1;
    let end = -1;
    for (let i = 0; i < data.days; i++) {
      if (dateOf(data.from, i).startsWith(month)) {
        if (start < 0) start = i;
        end = i;
      }
    }
    return start < 0 ? [0, 0] : [start, end + 1];
  }
  return [0, Math.min(Number(w), data.days)];
}

export function filterListings(data: ExploreData, f: Filters) {
  const idx: number[] = [];
  data.listings.forEach((l, i) => {
    if (!f.includeDormant && l.dormant) return;
    if (f.areas.length && !f.areas.includes(l.area)) return;
    if (f.beds.length && !f.beds.includes(l.beds)) return;
    idx.push(i);
  });
  return idx;
}

export type DayStat = {
  i: number;
  date: string;
  total: number;
  blocked: number;
  occ: number | null; // share of listings blocked that night
  price: number | null; // median per-night price among sampled listings
  priceN: number;
  longStay: number | null; // share of OPEN listings requiring 3+ nights
  newBookings: number;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function minStayAt(l: ExploreListing, i: number) {
  let v = 1;
  for (const [d, n] of l.minStay) {
    if (d > i) break;
    v = n;
  }
  return v;
}

export function dayStats(data: ExploreData, idx: number[]): DayStat[] {
  const inSet = new Set(idx);
  const out: DayStat[] = [];
  for (let i = 0; i < data.days; i++) {
    let blocked = 0;
    let open = 0;
    let long = 0;
    for (const li of idx) {
      const l = data.listings[li];
      const ch = l.nights[i];
      if (ch === undefined) continue;
      if (ch === "0") blocked++;
      else {
        open++;
        if (minStayAt(l, i) >= 3) long++;
      }
    }
    const total = blocked + open;
    const prices = (data.prices[i] ?? []).filter(([li]) => inSet.has(li)).map(([, p]) => p);
    out.push({
      i,
      date: dateOf(data.from, i),
      total,
      blocked,
      occ: total ? blocked / total : null,
      price: median(prices),
      priceN: prices.length,
      longStay: open ? long / open : null,
      newBookings: (data.newBookings[i] ?? []).filter((li) => inSet.has(li)).length,
    });
  }
  return out;
}

export function average(xs: (number | null)[]) {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function summarize(stats: DayStat[], [start, end]: [number, number]) {
  const w = stats.slice(start, end);
  const busiest = w.reduce<DayStat | null>((b, d) => (d.occ != null && (!b || d.occ > (b.occ ?? 0)) ? d : b), null);
  return {
    occ: average(w.map((d) => d.occ)),
    price: median(w.map((d) => d.price).filter((p): p is number => p != null)),
    busiest,
    soldOutDays: w.filter((d) => (d.occ ?? 0) >= 0.9).length,
    days: w.length,
  };
}

/** Occupancy per group (area or bedrooms) over a window. */
export function groupOcc(
  data: ExploreData,
  idx: number[],
  key: (l: ExploreListing) => string,
  [start, end]: [number, number],
) {
  const acc = new Map<string, { blocked: number; total: number; listings: number; prices: number[] }>();
  const inSet = new Set(idx);
  const inRange = (i: number) => i >= start && i < end;
  for (const li of idx) {
    const l = data.listings[li];
    const a = acc.get(key(l)) ?? { blocked: 0, total: 0, listings: 0, prices: [] };
    a.listings++;
    for (let i = start; i < end && i < l.nights.length; i++) {
      a.total++;
      if (l.nights[i] === "0") a.blocked++;
    }
    acc.set(key(l), a);
  }
  for (const [di, arr] of Object.entries(data.prices)) {
    if (!inRange(Number(di))) continue;
    for (const [li, p] of arr) {
      if (!inSet.has(li)) continue;
      acc.get(key(data.listings[li]))?.prices.push(p);
    }
  }
  return [...acc.entries()].map(([k, a]) => ({
    key: k,
    occ: a.total ? a.blocked / a.total : null,
    listings: a.listings,
    price: median(a.prices),
  }));
}

export function monthly(stats: DayStat[]) {
  const acc = new Map<string, number[]>();
  for (const d of stats) {
    if (d.occ == null) continue;
    const m = d.date.slice(0, 7);
    acc.set(m, [...(acc.get(m) ?? []), d.occ]);
  }
  return [...acc.entries()].map(([month, xs]) => ({ month, occ: average(xs), days: xs.length }));
}

export function eventsOn(events: MarketEvent[], date: string) {
  const rank = { high: 0, medium: 1, low: 2 };
  return events
    .filter((e) => e.start <= date && date <= e.end)
    .sort((a, b) => rank[a.impact] - rank[b.impact]);
}

// ---- Insights ----------------------------------------------------------------

export type Insight = {
  kind: "event" | "holiday" | "school" | "season" | "rank" | "weekend" | "price" | "minstay" | "momentum" | "timing" | "booking";
  tone: "up" | "down" | "neutral"; // pushes demand up, down, or is context
  title: string;
  detail?: string;
  source?: string;
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function insightsFor(
  day: DayStat,
  stats: DayStat[],
  events: MarketEvent[],
  money: (n: number) => string,
): Insight[] {
  const out: Insight[] = [];
  if (day.occ == null) return out;
  const occs = stats.map((d) => d.occ).filter((x): x is number => x != null);

  // 1. Dated events and holidays: the most concrete "because".
  const onDay = eventsOn(events, day.date);
  const toneOf = (e: MarketEvent): Insight["tone"] => (e.effect === "down" ? "down" : "up");
  for (const e of onDay.filter((e) => e.category === "event" || e.category === "holiday")) {
    out.push({
      kind: e.category === "holiday" ? "holiday" : "event",
      tone: toneOf(e),
      title: e.name,
      detail: e.why + (e.confidence === "estimated" ? " (dates estimated)" : ""),
      source: e.source,
    });
  }
  // School breaks and seasons are background; they go after the data-driven reasons.
  const background: Insight[] = [];
  const school = onDay.filter((e) => e.category === "school-holiday");
  if (school.length) {
    const COUNTRY: Record<string, string> = { AU: "Australia", SG: "Singapore", EU: "Europe", ID: "Indonesia" };
    const byMarket = new Map<string, string[]>();
    for (const e of school) {
      const m = e.markets[0] ?? "";
      // "NSW school holidays (summer)" -> "NSW"; country-wide names keep the country.
      const region = e.name.replace(/ school holidays.*$/i, "").replace(/^(Singapore|Indonesia).*$/, "");
      byMarket.set(m, [...(byMarket.get(m) ?? []), region].filter(Boolean));
    }
    const parts = [...byMarket.entries()].map(([m, regions]) => {
      const uniq = [...new Set(regions)];
      return uniq.length ? `${COUNTRY[m] ?? m} (${uniq.join(", ")})` : (COUNTRY[m] ?? m);
    });
    background.push({
      kind: "school",
      tone: "up",
      title: `School holidays: ${parts.join(", ")}`,
      detail: "Families from these places are on a school break.",
    });
  }
  for (const e of onDay.filter((e) => e.category === "season")) {
    background.push({ kind: "season", tone: e.effect === "down" ? "down" : "neutral", title: e.name, detail: e.why, source: e.source });
  }

  // 2. How this night ranks against the rest of the year.
  const below = occs.filter((o) => o < day.occ!).length / occs.length;
  const isTop = occs.every((o) => o <= day.occ!);
  const rankText = isTop ? "The busiest night of the next year" : `Busier than ${pct(Math.min(below, 0.99))} of nights in the next year`;
  const open = day.total - day.blocked;
  if (day.occ >= 0.9) {
    out.push({
      kind: "rank",
      tone: "up",
      title: `Nearly sold out: only ${open} of ${day.total} places still open`,
      detail: `${rankText}.`,
    });
  } else if (below >= 0.8) {
    out.push({ kind: "rank", tone: "up", title: rankText, detail: `${open} of ${day.total} places are still open.` });
  } else if (below <= 0.2) {
    out.push({ kind: "rank", tone: "down", title: `Quieter than ${pct(1 - below)} of nights in the next year`, detail: `${open} of ${day.total} places are still open.` });
  }

  // 3. Weekend pattern, only when it's real in this selection.
  const dow = new Date(day.date + "T00:00:00Z").getUTCDay();
  const near = stats.slice(Math.max(0, day.i - 45), day.i + 45);
  const wk = average(near.filter((d) => [5, 6].includes(new Date(d.date + "T00:00:00Z").getUTCDay())).map((d) => d.occ));
  const wd = average(near.filter((d) => ![5, 6].includes(new Date(d.date + "T00:00:00Z").getUTCDay())).map((d) => d.occ));
  if ((dow === 5 || dow === 6) && wk != null && wd != null && wk - wd >= 0.04) {
    out.push({
      kind: "weekend",
      tone: "up",
      title: `${WEEKDAY[dow]} night`,
      detail: `Around this time, Friday and Saturday nights run ${Math.round((wk - wd) * 100)} points fuller than weeknights.`,
    });
  }

  // 4. Price against the typical rate for this selection.
  const priced = stats.filter((d) => d.price != null && d.priceN >= 3);
  const typical = median(priced.map((d) => d.price!));
  const here = day.price != null && day.priceN >= 3 ? day : priced.find((d) => Math.abs(d.i - day.i) <= 3);
  if (typical && here?.price) {
    const diff = here.price / typical - 1;
    const when =
      here.i === day.i
        ? ""
        : ` (prices checked for ${new Date(here.date + "T00:00:00Z").toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })})`;
    // On a busy night the dearer places sell first, so the places still open skew cheap.
    const sellOut = diff < 0 && day.occ >= 0.5;
    if (sellOut && Math.abs(diff) >= 0.1) {
      out.push({
        kind: "price",
        tone: "up",
        title: "The pricier places are already booked",
        detail: `The ${here.priceN} places still open ask a median ${money(here.price)} a night, below the usual ${money(typical)}${when}: what's left is the cheaper end.`,
      });
    } else if (Math.abs(diff) >= 0.1) {
      out.push({
        kind: "price",
        tone: diff > 0 ? "up" : "down",
        title: `Prices ${diff > 0 ? "up" : "down"} ${pct(Math.abs(diff))} on the usual rate`,
        detail: `Median ${money(here.price)} a night vs ${money(typical)} typical${when}, from ${here.priceN} open listings.`,
      });
    } else {
      out.push({ kind: "price", tone: "neutral", title: "Prices are about normal", detail: `Median ${money(here.price)} a night${when}.` });
    }
  }

  // 5. Hosts demanding longer stays is a sign they expect demand.
  const typicalLong = average(stats.map((d) => d.longStay));
  if (day.longStay != null && typicalLong != null && day.longStay - typicalLong >= 0.1) {
    out.push({
      kind: "minstay",
      tone: "up",
      title: `Hosts want longer stays: ${pct(day.longStay)} require 3+ nights`,
      detail: `Usually ${pct(typicalLong)}. Hosts raise minimum stays when they expect to fill anyway.`,
    });
  }

  // 6. Fresh bookings since yesterday.
  if (day.newBookings > 0) {
    out.push({
      kind: "momentum",
      tone: "up",
      title: `${day.newBookings} new booking${day.newBookings === 1 ? "" : "s"} for this night since yesterday`,
    });
  }

  out.push(...background);

  // 7. Timing context for quiet nights far away.
  if (day.i > 60 && day.occ < 0.5) {
    out.push({
      kind: "timing",
      tone: "neutral",
      title: `${day.i + 1} days away`,
      detail: "Many stays are booked within a couple of months of the date, so a far-off night looking quiet is normal.",
    });
  }

  return out;
}

// ---- Top places ----------------------------------------------------------------

export type PlaceRank = {
  li: number;
  occ: number; // share of window nights blocked
  bookedNights: number;
  nights: number;
  price: number | null; // this place's median per-night price (window samples, else any)
  value: number | null; // bookedNights x price: rough value of the booked nights
  fullyBlocked: boolean; // 100% blocked across a long window: may be closed, not booked
};

export type RankBy = "occ" | "value" | "price";

export function rankPlaces(
  data: ExploreData,
  idx: number[],
  [start, end]: [number, number],
  by: RankBy,
): PlaceRank[] {
  // Each place's own price samples, split into in-window and any-time.
  const inWin = new Map<number, number[]>();
  const any = new Map<number, number[]>();
  for (const [di, arr] of Object.entries(data.prices)) {
    const d = Number(di);
    for (const [li, p] of arr) {
      any.set(li, [...(any.get(li) ?? []), p]);
      if (d >= start && d < end) inWin.set(li, [...(inWin.get(li) ?? []), p]);
    }
  }
  const rows: PlaceRank[] = idx.map((li) => {
    const l = data.listings[li];
    const slice = l.nights.slice(start, end);
    const booked = [...slice].filter((c) => c === "0").length;
    const price = median(inWin.get(li) ?? []) ?? median(any.get(li) ?? []);
    const occ = slice.length ? booked / slice.length : 0;
    return {
      li,
      occ,
      bookedNights: booked,
      nights: slice.length,
      price,
      value: price != null ? booked * price : null,
      fullyBlocked: occ === 1 && slice.length >= 30,
    };
  });
  const key = (r: PlaceRank) => (by === "occ" ? r.occ : by === "value" ? (r.value ?? -1) : (r.price ?? -1));
  // Ties on occupancy break toward the pricier place (it earns more for the same nights).
  return rows.sort((a, b) => key(b) - key(a) || (b.price ?? 0) - (a.price ?? 0));
}

// ---- Booking.com ----------------------------------------------------------------

export type BookingDay = {
  i: number;
  date: string;
  known: number; // Booking.com places in the selection
  open: number; // of those, open for a 2-night stay from this date
  full: number | null; // 1 - open/known: booked, closed, or longer minimum stay
  price: number | null; // median per night of open places, INCLUDING taxes
  airbnbOcc: number | null;
  airbnbPrice: number | null; // before taxes
};

export function bookingDays(data: ExploreData, f: Filters, stats: DayStat[]): BookingDay[] {
  const keep = data.booking.listings.map(
    (l) => (!f.areas.length || f.areas.includes(l.area)) && (!f.beds.length || f.beds.includes(l.beds)),
  );
  const known = keep.filter(Boolean).length;
  return Object.entries(data.booking.prices)
    .map(([di, arr]) => {
      const i = Number(di);
      const open = arr.filter(([li]) => keep[li]);
      return {
        i,
        date: dateOf(data.from, i),
        known,
        open: open.length,
        full: known ? Math.max(0, 1 - open.length / known) : null,
        price: median(open.map(([, p]) => p)),
        airbnbOcc: stats[i]?.occ ?? null,
        airbnbPrice: stats[i]?.priceN >= 3 ? stats[i].price : null,
      };
    })
    .sort((a, b) => a.i - b.i);
}

/** A Booking.com line for the day panel, from the nearest sampled date within 3 days. */
export function bookingInsight(day: DayStat, days: BookingDay[], money: (n: number) => string): Insight | null {
  const near = days.filter((b) => Math.abs(b.i - day.i) <= 3).sort((a, b) => Math.abs(a.i - day.i) - Math.abs(b.i - day.i))[0];
  if (!near || !near.known || near.full == null) return null;
  const when =
    near.i === day.i
      ? ""
      : ` (checked for ${new Date(near.date + "T00:00:00Z").toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })})`;
  const typical = median(days.map((b) => b.full).filter((x): x is number => x != null));
  const busier = typical != null && near.full - typical >= 0.1;
  return {
    kind: "booking",
    tone: busier ? "up" : "neutral",
    title: `On Booking.com: ${near.open} of ${near.known} places open${when}`,
    detail:
      (near.price != null ? `Median ${money(near.price)} a night including taxes. ` : "") +
      (typical != null ? `Usually ${Math.round((1 - typical) * near.known)} are open on the dates we check.` : ""),
  };
}
