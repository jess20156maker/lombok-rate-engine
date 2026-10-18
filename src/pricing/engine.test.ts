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

test("rounding never takes a price past your limits, and your own price stays exact", () => {
  const out = priceNights(base({ maxRate: 4_528_200, minRate: 4_510_000, overrides: new Map([[21, { price: 8_782_900, minStay: null, note: null }]]) }));
  assert.equal(out[20].price, 4_528_200); // Rp 5m capped: not rounded up to 4.55m
  assert.equal(out[2].price, 4_510_000); // last-minute cut held at the floor: not rounded down to 4.5m
  assert.equal(out[21].price, 8_782_900);
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

import { bookedSignal, BOOKED_HALF_WEIGHT } from "./engine.js";

// Ten comparable villas, all usually Rp 5m, all listed at Rp 5m on days 0–39.
// `bookedAt` is what the booked nights went for.
const market = (bookedAt: number, perVilla = 30, unsoldAt?: number) =>
  Array.from({ length: 10 }, (_, i): CompInput => ({
    id: `v${i}`,
    typical: 5_000_000,
    nights: "1".repeat(40),
    priced: new Map(Array.from({ length: 40 }, (_, d) => [d, 5_000_000] as [number, number])),
    booked: Array.from({ length: perVilla }, (_, k) => ({ day: -k - 1, price: bookedAt })),
    unsold: unsoldAt ? Array.from({ length: 5 }, (_, k) => ({ day: -k - 1, price: unsoldAt })) : [],
  }));

// Thirty more villas on the beach, listed at their usual Rp 5m on those past nights: the going rate.
const beach = Array.from({ length: 30 }, (_, i): CompInput => ({
  id: `w${i}`,
  typical: 5_000_000,
  nights: "1".repeat(40),
  priced: new Map(),
  unsold: Array.from({ length: 100 }, (_, k) => ({ day: -k - 1, price: 5_000_000 })),
}));

test("booked prices below the going rate nudge the price down, weighted by sample size", () => {
  // 300 booked nights at 10% below a Rp 5m going rate (the unsold ones keep it there).
  const comps = market(4_500_000, 30, 5_500_000);
  const n = priceNights(base({ comps, wider: beach }))[20];
  const r = n.reasons.find((x) => x.kind === "booked")!;
  const w = 300 / (300 + BOOKED_HALF_WEIGHT);
  assert.ok(Math.abs(r.effect! - (1 - 0.1 * w)) < 0.01, `effect ${r.effect}`);
  assert.match(r.label, /below the going rate \(300 booked nights; nights left unbooked close in were \d+% above\)/);
  assert.ok(n.price < 5_000_000);
});

test("booked prices above the going rate nudge it up", () => {
  const n = priceNights(base({ comps: market(5_500_000), wider: beach }))[20];
  assert.ok(n.reasons.find((x) => x.kind === "booked")!.effect! > 1);
  assert.ok(n.price > 5_000_000);
});

test("the booked-price signal stays silent with under 10 booked nights and fades in as data grows", () => {
  assert.equal(bookedSignal(market(4_000_000, 0).map((c, i) => (i ? c : { ...c, booked: c.booked!.concat([{ day: -1, price: 4e6 }]) })), beach, 40), null);
  const few = bookedSignal(market(4_000_000, 2), beach, 40)![20].effect!; // 20 nights
  const many = bookedSignal(market(4_000_000, 100), beach, 40)![20].effect!; // 1000 nights
  assert.ok(few > many && few < 1, `few ${few}, many ${many}`);
  assert.ok(many >= 0.88); // never more than −12%
});

test("booked nights near a date move that date more than others", () => {
  const comps = market(5_000_000, 30);
  for (const c of comps.slice(0, 5)) c.booked!.push({ day: 20, price: 6_000_000 }); // half booked night 20 at Rp 6m
  const s = bookedSignal(comps, [], 40)!;
  assert.ok(s[20].effect! > 1.01 && s[35].effect == null, `${s[20].effect} / ${s[35].effect}`);
  assert.match(s[20].label, /the 5 booked around this date were 9% above it/);
});

test("min/max and overrides still win over the booked-price signal", () => {
  const comps = market(4_000_000, 100);
  const overrides = new Map([[21, { price: 9_000_000, minStay: null, note: null }]]);
  const out = priceNights(base({ comps, wider: beach, overrides, minRate: 5_000_000 }));
  assert.equal(out[20].price, 5_000_000);
  assert.equal(out[21].price, 9_000_000);
});

test("nights beyond what villas have published follow the same week a year earlier", () => {
  // Market prices only for the first 40 nights; night 10 runs +30%.
  const comps = ["a", "b", "c"].map((id) => comp(id, 5_000_000, "1".repeat(40), [[10, 6_500_000]]));
  const out = priceNights(base({ comps, days: 730 }));
  assert.equal(out.length, 730);
  const dateEffect = (n: (typeof out)[number]) => n.reasons.find((r) => r.kind === "date")?.effect;
  assert.equal(dateEffect(out[374]), dateEffect(out[10])); // 364 days on: same weekday, same lift
  assert.match(out[374].reasons.find((r) => r.kind === "date")!.label, /same week a year earlier: \+30%/);
});

test("seasons repeat each year beyond the researched events calendar", () => {
  const events = [{ name: "Wet season", category: "season", start: "2026-11-01", end: "2027-03-31", impact: "low" as const, why: "Rain.", effect: "down" as const }];
  const out = priceNights(base({ events, days: 500, comps: [comp("a", 5e6, ""), comp("b", 5e6, ""), comp("c", 5e6, "")] }));
  const wet = (d: number) => out[d].reasons.some((r) => r.kind === "event" && r.label.startsWith("Wet season"));
  assert.ok(wet(30) && wet(400)); // Dec 2026 and Dec 2027
  assert.ok(!wet(200)); // May 2027
});
