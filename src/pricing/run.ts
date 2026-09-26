// Price one property and save the results. Shared by the nightly job and the
// website's "Re-price now" button; callers pass their own query function.

import { upsertWith, type Query } from "../lib/sql.js";
import { priceNights, type EventInput } from "./engine.js";
import { loadEngineInput, type Property } from "./load.js";

export async function priceProperty(q: Query, p: Property, start: string, events: EventInput[]) {
  const { input, compNote, latestSnapshot, pace } = await loadEngineInput(q, p, start, events);
  const nights = priceNights(input);
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
    200,
  );
  await upsertWith(q, "price_history", ["property_id", "run_date"], [
    { property_id: p.id, run_date: start, from_date: start, prices: nights.map((n) => n.price) },
  ]);
  return { nights, compCount: input.comps.length, compNote, latestSnapshot, pace };
}
