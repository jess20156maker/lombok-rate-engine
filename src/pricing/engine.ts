// The pricing engine: one suggested price and minimum stay for every night,
// each with plain-English reasons. Pure calculation, no database: see
// src/pricing/load.ts for where the inputs come from.
//
// How a night's price is built:
//
//   1. Standing   Where the villa sits among comparable villas (same beach,
//                 similar size), at its chosen position (e.g. 65th percentile)
//                 of their typical nightly prices. History makes this steadier.
//   2. Date       How comparable villas price THIS night relative to their own
//                 usual rate (a ratio, so it isn't skewed by which villas are
//                 still available).
//   3. Demand     How booked the comparable villas are this night versus
//                 nearby nights.
//   4. Pace       How fast this night filled over the past week versus usual
//                 (once a week of history exists).
//   5. Events     A floor under big events and holidays, a dip for quiet ones.
//   6. Timing     Last-minute discounts when still open; a small premium far out.
//   7. Gaps       Short gaps between your own bookings get a lower minimum stay
//                 and a nudge to fill them.
//   8. Your rules Manual overrides win; everything is kept within min/max.

export type Reason = {
  kind: "standing" | "date" | "demand" | "pace" | "event" | "timing" | "gap" | "override" | "limit";
  label: string;
  effect: number | null; // multiplier applied (1.12 = +12%), null for context lines
};

export type CompInput = {
  id: string;
  typical: number; // IDR per night, median of this villa's observed prices
  nights: string; // availability from day 0: "0" blocked, anything else open
  priced: Map<number, number>; // day index -> IDR per night observed for that date
  prevNights?: string; // the same villa's availability ~a week earlier, aligned to day 0
};

export type EventInput = {
  name: string;
  category: string;
  start: string;
  end: string;
  impact: "high" | "medium" | "low";
  why: string;
  effect?: "up" | "down";
};

export type EngineInput = {
  start: string; // day 0, YYYY-MM-DD
  days: number;
  position: number; // 0..1
  minRate: number;
  maxRate: number;
  baseMinStay: number;
  comps: CompInput[]; // comparable villas
  wider: CompInput[]; // the whole beach, for dates the comps don't cover
  events: EventInput[];
  occupied: Set<number>; // day indexes the villa itself is booked or blocked
  overrides: Map<number, { price: number | null; minStay: number | null; note: string | null }>;
};

export type NightPrice = {
  day: number;
  date: string;
  price: number;
  minStay: number;
  marketPrice: number | null; // median observed comp price that night
  marketOcc: number | null;
  reasons: Reason[];
};

const DAY = 86_400_000;
const dateOf = (start: string, i: number) => new Date(Date.parse(start) + i * DAY).toISOString().slice(0, 10);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const pct = (m: number) => `${m >= 1 ? "+" : "−"}${Math.abs(Math.round((m - 1) * 100))}%`;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = clamp(q, 0, 1) * (s.length - 1);
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
}

/** Typical ratio of a night's price to each villa's usual price. */
function dateFactor(comps: CompInput[], day: number, min = 3): number | null {
  const ratios = comps.filter((c) => c.typical > 0 && c.priced.has(day)).map((c) => c.priced.get(day)! / c.typical);
  return ratios.length >= min ? median(ratios) : null;
}

function occupancy(comps: CompInput[], day: number, which: "nights" | "prevNights" = "nights"): number | null {
  let blocked = 0;
  let known = 0;
  for (const c of comps) {
    const ch = c[which]?.[day];
    if (ch === undefined) continue;
    known++;
    if (ch === "0") blocked++;
  }
  return known >= 3 ? blocked / known : null;
}

const roundPrice = (idr: number) => Math.round(idr / 50_000) * 50_000;

export function priceNights(input: EngineInput): NightPrice[] {
  const { comps, wider, days } = input;

  // 1. Standing: the villa's place among comparable villas' usual prices.
  const typicals = comps.map((c) => c.typical).filter((t) => t > 0);
  const standing = quantile(typicals, input.position) ?? input.minRate;

  // 2. Date factors, falling back to the wider beach, then to nearby days,
  // then to the month's typical factor.
  const factor: (number | null)[] = Array.from({ length: days }, (_, d) => dateFactor(comps, d) ?? dateFactor(wider, d, 5));
  const byMonth = new Map<string, number[]>();
  factor.forEach((f, d) => {
    if (f != null) {
      const m = dateOf(input.start, d).slice(0, 7);
      byMonth.set(m, [...(byMonth.get(m) ?? []), f]);
    }
  });
  const filled = factor.map((f, d) => {
    if (f != null) return { f, how: "observed" as const };
    for (let k = 1; k <= 3; k++) {
      const near = factor[d - k] ?? factor[d + k];
      if (near != null) return { f: near, how: "nearby" as const };
    }
    const m = median(byMonth.get(dateOf(input.start, d).slice(0, 7)) ?? []);
    return { f: m ?? 1, how: m != null ? ("month" as const) : ("none" as const) };
  });

  const occ = Array.from({ length: days }, (_, d) => occupancy(comps, d) ?? occupancy(wider, d));
  const prevOcc = Array.from({ length: days }, (_, d) => occupancy(comps, d, "prevNights") ?? occupancy(wider, d, "prevNights"));
  const pace = occ.map((o, d) => (o != null && prevOcc[d] != null ? o - prevOcc[d]! : null));

  // Runs of open nights between the villa's own bookings.
  const gapLength = new Map<number, number>();
  for (let d = 0; d < days; d++) {
    if (input.occupied.has(d) || gapLength.has(d)) continue;
    let e = d;
    while (e < days && !input.occupied.has(e)) e++;
    const bounded = d > 0 && input.occupied.has(d - 1) && e < days && input.occupied.has(e);
    for (let k = d; k < e; k++) gapLength.set(k, bounded ? e - d : Infinity);
    d = e;
  }

  return Array.from({ length: days }, (_, d): NightPrice => {
    const date = dateOf(input.start, d);
    const reasons: Reason[] = [];
    let price = standing;
    let minStay = input.baseMinStay;

    reasons.push({
      kind: "standing",
      label: `Starts from comparable villas' usual rate at your chosen position (${Math.round(input.position * 100)}th percentile of ${typicals.length})`,
      effect: null,
    });

    // 2. Date
    const { f, how } = filled[d];
    let fc = clamp(f, 0.6, 2.5);
    // When most comparable villas are booked, the few still open are the cheap
    // or discounting ones, so a low ratio says nothing about demand.
    if (fc < 1 && (occ[d] ?? 0) >= 0.7) {
      reasons.push({
        kind: "date",
        label: `Most comparable villas are booked (${Math.round(occ[d]! * 100)}%); the few still open are discounting, so that's ignored`,
        effect: null,
      });
      fc = 1;
    }
    if (Math.abs(fc - 1) >= 0.03) {
      reasons.push({
        kind: "date",
        label:
          how === "observed"
            ? `Comparable villas charge ${pct(fc)} vs their usual rate this night`
            : how === "nearby"
              ? `Nearby nights run ${pct(fc)} vs usual (this night not priced yet)`
              : `This month typically runs ${pct(fc)} vs usual`,
        effect: fc,
      });
    }
    price *= fc;

    // Seasons fill in only where there's no observed market price for the night yet.
    if (how === "month" || how === "none") {
      for (const e of input.events) {
        if (e.category !== "season" || e.start > date || e.end < date) continue;
        const m = e.effect === "down" ? 0.92 : e.impact === "high" ? 1.08 : 1;
        if (m !== 1) {
          reasons.push({ kind: "event", label: `${e.name} (no market prices for this night yet, so the season sets the tone)`, effect: m });
          price *= m;
          break;
        }
      }
    }

    // 3. Demand vs nearby nights
    const local = median(occ.slice(Math.max(0, d - 10), d + 11).filter((x): x is number => x != null));
    if (occ[d] != null && local != null) {
      const m = clamp(1 + 0.4 * (occ[d]! - local), 0.88, 1.2);
      if (Math.abs(m - 1) >= 0.02) {
        reasons.push({
          kind: "demand",
          label: `${Math.round(occ[d]! * 100)}% of comparable villas are booked, vs ${Math.round(local * 100)}% on nearby nights`,
          effect: m,
        });
        price *= m;
      }
    }

    // 4. Pace over the last week
    const localPace = median(pace.slice(Math.max(0, d - 15), d + 16).filter((x): x is number => x != null));
    if (pace[d] != null && localPace != null) {
      const m = clamp(1 + 0.8 * (pace[d]! - localPace), 0.9, 1.15);
      if (Math.abs(m - 1) >= 0.02) {
        reasons.push({
          kind: "pace",
          label:
            m > 1
              ? `This night is booking up faster than usual: +${Math.round(pace[d]! * 100)} points this week`
              : `This night is booking up slower than usual this week`,
          effect: m,
        });
        price *= m;
      }
    }

    // 5. Events: a floor under the big ones, a dip for quiet periods
    const rel = price / standing;
    for (const e of input.events) {
      if (e.start > date || e.end < date) continue;
      if (e.category === "school-holiday" || e.category === "season") continue;
      if (e.effect === "down") {
        reasons.push({ kind: "event", label: `${e.name}: ${e.why}`, effect: 0.95 });
        price *= 0.95;
      } else if (e.impact !== "low") {
        const floor = e.impact === "high" ? 1.2 : 1.08;
        if (rel < floor) {
          const m = floor / rel;
          reasons.push({ kind: "event", label: `${e.name}: ${e.why}`, effect: m });
          price *= m;
        } else {
          reasons.push({ kind: "event", label: `${e.name} (already reflected in market prices)`, effect: null });
        }
        if (e.impact === "high") minStay = Math.max(minStay, 3);
      }
    }

    // 6. Timing
    const open = !input.occupied.has(d);
    if (open && d <= 7) {
      const soft = occ[d] == null || local == null || occ[d]! <= local + 0.05;
      if (soft) {
        const m = d <= 3 ? 0.85 : 0.92;
        reasons.push({ kind: "timing", label: `Only ${d === 0 ? "hours" : `${d} day${d === 1 ? "" : "s"}`} away and still open: last-minute price`, effect: m });
        price *= m;
        minStay = Math.min(minStay, d <= 3 ? 1 : 2);
      }
    } else if (d > 270) {
      reasons.push({ kind: "timing", label: "Far ahead: a small premium, with room to adjust as it approaches", effect: 1.05 });
      price *= 1.05;
    }
    if ((occ[d] ?? 0) >= 0.75) minStay = Math.max(minStay, 3);

    // 7. Gap nights between your own bookings
    const gap = gapLength.get(d);
    if (open && gap != null && gap !== Infinity && gap <= Math.max(3, input.baseMinStay)) {
      minStay = gap;
      reasons.push({ kind: "gap", label: `Fills a ${gap}-night gap between your bookings: minimum stay ${gap}`, effect: 0.9 });
      price *= 0.9;
    }

    // 8. Your rules
    const o = input.overrides.get(d);
    if (o?.price != null) {
      price = o.price;
      reasons.push({ kind: "override", label: `You set this price${o.note ? `: ${o.note}` : ""}`, effect: null });
    }
    if (o?.minStay != null) {
      minStay = o.minStay;
      reasons.push({ kind: "override", label: `You set a ${o.minStay}-night minimum stay`, effect: null });
    }
    if (o?.price == null) {
      if (price < input.minRate) {
        reasons.push({ kind: "limit", label: "Held at your minimum price", effect: null });
        price = input.minRate;
      } else if (price > input.maxRate) {
        reasons.push({ kind: "limit", label: "Held at your maximum price", effect: null });
        price = input.maxRate;
      }
    }

    const observed = comps.filter((c) => c.priced.has(d)).map((c) => c.priced.get(d)!);
    return {
      day: d,
      date,
      price: roundPrice(price),
      minStay: Math.max(1, minStay),
      marketPrice: median(observed),
      marketOcc: occ[d],
      reasons,
    };
  });
}
