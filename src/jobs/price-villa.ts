// Run the pricing engine for every property and save its suggestions.
// Runs nightly after collection (in `npm run finish`) and on demand.
//
//   npm run price-villa

import "dotenv/config";
import { readFileSync } from "node:fs";
import type { EventInput } from "../pricing/engine.js";
import type { Property } from "../pricing/load.js";
import { priceProperty } from "../pricing/run.js";
import { today } from "../lib/dates.js";
import { db } from "../lib/db.js";

const q = (text: string, params?: unknown[]) => db.query(text, params);

export async function priceAllProperties() {
  const start = today();
  const events = JSON.parse(readFileSync(new URL("../../db/events.json", import.meta.url), "utf8")) as EventInput[];
  const { rows: props } = await db.query<Property>("select * from properties");
  for (const p of props) {
    const { nights, compCount, compNote, latestSnapshot, pace } = await priceProperty(q, p, start, events, undefined, { smooth: true });
    const sample = (d: number) => `${nights[d].date} Rp ${(nights[d].price / 1e6).toFixed(2)}m (min ${nights[d].minStay})`;
    console.log(
      `${p.name}: priced ${nights.length} nights against ${compCount} comparable villas (${compNote}); ` +
        `market data from ${latestSnapshot}${pace ? `, pace vs ${pace}` : ", pace starts after a week of history"}. ` +
        `e.g. ${sample(1)}, ${sample(14)}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await priceAllProperties();
  await db.end();
}
