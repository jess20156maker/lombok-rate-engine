// Price one property and save the results. Shared by the nightly job and the
// website's "Re-price now" button; callers pass their own query function.

import { upsertWith, type Query } from "../lib/sql";
import { priceNights, type EventInput } from "./engine";
import { loadEngineInput, type MarketInput, type Property } from "./load";

/** Most a night's price may move in one nightly run, more than two weeks out. */
export const MAX_DAILY_MOVE = 0.1;

/**
 * smooth: the nightly run limits how far each night moves from yesterday's
 * price, so one day's data (a competitor's odd price, newly found villas) can't
 * swing it. Changes made on the website apply in full straight away.
 */
export async function priceProperty(
  q: Query,
  p: Property,
  start: string,
  events: EventInput[],
  market?: MarketInput,
  opts: { smooth?: boolean } = {},
) {
  const { input, compNote, latestSnapshot, pace } = await loadEngineInput(q, p, start, events, market);
  const nights = priceNights(input);
  if (opts.smooth) {
    const { rows } = await q(
      "select date::text as d, price from price_recommendations where property_id = $1 and date >= $2 and computed_at > now() - interval '3 days'",
      [p.id, start],
    );
    const before = new Map(rows.map((r) => [r.d as string, Number(r.price)]));
    const round = (idr: number) => Math.round(idr / 50_000) * 50_000;
    for (const n of nights) {
      const was = before.get(n.date);
      if (was == null || n.day <= 14 || input.overrides.get(n.day)?.price != null) continue;
      const lo = Math.max(input.minRate, round(was * (1 - MAX_DAILY_MOVE)));
      const hi = Math.min(input.maxRate, round(was * (1 + MAX_DAILY_MOVE)));
      if (n.price >= lo && n.price <= hi) continue;
      const target = n.price;
      n.price = Math.min(hi, Math.max(lo, target));
      n.reasons.push({
        kind: "limit",
        label: `Moving gradually toward Rp ${(target / 1e6).toFixed(2)}m: prices change at most ${MAX_DAILY_MOVE * 100}% a day this far ahead`,
        effect: null,
      });
    }
  }
  const computedAt = new Date().toISOString();
  await upsertWith(
    q,
    "price_recommendations",
    ["property_id", "date"],
    nights.map((n) => ({
      property_id: p.id,
      date: n.date,
      price: n.price,
      min_stay: n.minStay,
      market_price: n.marketPrice == null ? null : Math.round(n.marketPrice),
      market_occ: n.marketOcc,
      comp_count: input.comps.length,
      reasons: JSON.stringify(n.reasons),
      computed_at: computedAt,
    })),
    400, // one round trip for the whole year
  );
  await upsertWith(q, "price_history", ["property_id", "run_date"], [
    { property_id: p.id, run_date: start, from_date: start, prices: nights.map((n) => n.price) },
  ]);
  return { nights, compCount: input.comps.length, compNote, latestSnapshot, pace };
}
