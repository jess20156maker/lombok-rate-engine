// npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { priceNights, type CompInput, type EngineInput } from "./engine.js";

const comp = (id: string, typical: number, nights = "1".repeat(40), priced: [number, number][] = []): CompInput => ({
  id,
  typical,
  nights,
  priced: new Map(priced),
});

const base = (over: Partial<EngineInput> = {}): EngineInput => ({
  start: "2026-11-02",
  days: 40,
  position: 0.5,
  minRate: 1_000_000,
  maxRate: 20_000_000,
  baseMinStay: 2,
  comps: [comp("a", 4_000_000), comp("b", 5_000_000), comp("c", 6_000_000)],
  wider: [],
  events: [],
  occupied: new Set(),
  overrides: new Map(),
  ...over,
});

test("standing is the chosen percentile of comparable villas' usual prices", () => {
  const n = priceNights(base())[20];
  assert.equal(n.price, 5_000_000);
});

test("a night the market prices 30% above usual is priced 30% higher", () => {
  const comps = ["a", "b", "c"].map((id, i) => comp(id, (i + 4) * 1_000_000, "1".repeat(40), [[20, (i + 4) * 1_300_000]]));
  const n = priceNights(base({ comps }))[20];
  assert.equal(n.price, 6_500_000);
});

test("a low ratio is ignored when most comparable villas are booked", () => {
  const busy = "1".repeat(20) + "0" + "1".repeat(19);
  const comps = ["a", "b", "c", "d"].map((id) => comp(id, 5_000_000, busy, [[20, 4_000_000]]));
  const n = priceNights(base({ comps }))[20];
  assert.ok(n.price >= 5_000_000, `expected at least usual, got ${n.price}`);
});

test("a high-impact event lifts price to at least +20% and minimum stay to 3", () => {
  const events = [{ name: "Race", category: "event", start: "2026-11-22", end: "2026-11-22", impact: "high" as const, why: "Fans." }];
  const n = priceNights(base({ events }))[20];
  assert.equal(n.price, 6_000_000);
  assert.equal(n.minStay, 3);
});

test("a 2-night gap between own bookings gets a 2-night minimum and a nudge down", () => {
  const occupied = new Set([18, 19, 22, 23]);
  const n = priceNights(base({ occupied }))[20];
  assert.equal(n.minStay, 2);
  assert.equal(n.price, 4_500_000);
});

test("overrides win and limits hold", () => {
  const overrides = new Map([[20, { price: 9_000_000, minStay: 5, note: null }]]);
  const out = priceNights(base({ overrides, maxRate: 4_000_000 }));
  assert.equal(out[20].price, 9_000_000); // an explicit override may exceed max
  assert.equal(out[20].minStay, 5);
  assert.equal(out[21].price, 4_000_000); // otherwise capped at max
});

test("last-minute open nights are discounted with a short minimum stay", () => {
  const n = priceNights(base())[2];
  assert.equal(n.price, 4_250_000);
  assert.equal(n.minStay, 1);
});

test("a villa with under 5 reviews is held at the median, then moves to its chosen position", () => {
  assert.equal(priceNights(base({ position: 0.9, reviews: 0 }))[20].price, 5_000_000);
  assert.equal(priceNights(base({ position: 0.9, reviews: 12 }))[20].price, 5_800_000);
});

test("a quiet period doesn't discount a night inside a big holiday", () => {
  const events = [
    { name: "Ramadan", category: "holiday", start: "2026-11-10", end: "2026-11-25", impact: "low" as const, why: "Quiet.", effect: "down" as const },
    { name: "Lebaran", category: "holiday", start: "2026-11-22", end: "2026-11-30", impact: "high" as const, why: "Busy." },
  ];
  const out = priceNights(base({ events }));
  assert.equal(out[12].price, 4_750_000); // Ramadan alone: −5%
  assert.equal(out[20].price, 6_000_000); // Lebaran: +20% floor, no Ramadan cut
});

import { unopenedAsUnknown } from "./load.js";

test("calendar nights not opened yet count as unknown, not booked", () => {
  assert.equal(unopenedAsUnknown("1101" + "0".repeat(10)), "1101" + "?".repeat(10));
  assert.equal(unopenedAsUnknown("110100"), "110100"); // a short run at the end is likely real bookings
  // Booked nights stop counting as demand once they're past the calendar's edge.
  const comps = ["a", "b", "c"].map((id) => comp(id, 5_000_000, unopenedAsUnknown("1".repeat(30) + "0".repeat(10))));
  assert.equal(priceNights(base({ comps }))[35].marketOcc, null);
});
