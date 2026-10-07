// The health check must notice real failures, not just pass on good days.

import assert from "node:assert/strict";
import { test } from "node:test";
import { runHealth } from "./health.js";
import type { Query } from "./sql.js";

// 20:00 UTC on 7 Oct = 04:00 on 8 Oct in Lombok (yesterday's data still counts);
// 06:00 UTC = 14:00 Lombok (today's must be in).
const EARLY = new Date("2026-10-07T20:00:00Z");
const AFTERNOON = new Date("2026-10-08T06:00:00Z");

type World = {
  air?: [string, number, number][]; // [day, dates searched, places priced], newest first
  booking?: [string, number, number][];
  calendars?: [string, number][];
  medians?: [string, number][];
  pricedAt?: string;
  nights?: number;
  outside?: number;
};

const good: World = {
  air: [["2026-10-08", 180, 830], ["2026-10-07", 180, 828]],
  booking: [["2026-10-08", 180, 426], ["2026-10-07", 179, 420]],
  calendars: [["2026-10-08", 929], ["2026-10-07", 930]],
  medians: [["2026-10-08", 2_430_000], ["2026-10-07", 2_400_000]],
  pricedAt: "2026-10-08T03:00:00Z",
  nights: 364,
  outside: 0,
};

/** A stand-in database answering each of the health check's queries. */
function fake(w: World): Query {
  return async (text) => {
    const rows = (() => {
      if (text.includes("from price_sample_dates")) {
        const out = [];
        for (const [p, list] of [["airbnb", w.air], ["booking", w.booking]] as const)
          for (const [k, [day, dates, places]] of (list ?? []).entries()) out.push({ platform: p, day, dates, places, k: k + 1 });
        return out;
      }
      if (text.includes("percentile_cont")) return (w.medians ?? []).map(([day, median]) => ({ day, median }));
      if (text.includes("platform = 'web'")) return [{ day: w.calendars?.[0]?.[0] ?? null }];
      if (text.includes("from calendar_snapshots")) return (w.calendars ?? []).map(([day, n]) => ({ day, n }));
      if (text.includes("from properties p"))
        return [{ id: "v", name: "Mulai Villa", min_rate: 1, max_rate: 2, at: w.pricedAt ?? null, nights: w.nights ?? 0, outside: w.outside ?? 0 }];
      if (text.includes("from job_runs")) return [];
      if (text.includes("ical_url is not null")) return [{ n: 0 }];
      if (text.includes("from listings")) return [{ day: "2026-10-04" }];
      throw new Error(`unexpected query: ${text}`);
    })();
    return { rows };
  };
}
const failed = async (w: World, now = AFTERNOON) => (await runHealth(fake(w), now)).checks.filter((c) => !c.ok).map((c) => c.name);

test("a normal day passes", async () => {
  assert.deepEqual(await failed(good), []);
});

test("yesterday's data is fine early in the morning, not in the afternoon", async () => {
  const yesterday: World = {
    ...good,
    air: good.air!.slice(1),
    booking: good.booking!.slice(1),
    calendars: good.calendars!.slice(1),
  };
  assert.deepEqual(await failed(yesterday, EARLY), []);
  assert.deepEqual(await failed(yesterday, AFTERNOON), ["Airbnb prices", "Booking.com prices", "Airbnb calendars"]);
});

test("an incomplete Booking.com run fails", async () => {
  assert.deepEqual(await failed({ ...good, booking: [["2026-10-08", 114, 300], ["2026-10-07", 180, 420]] }), ["Booking.com prices"]);
});

test("being blocked (far fewer places found) fails", async () => {
  assert.deepEqual(await failed({ ...good, air: [["2026-10-08", 180, 200], ["2026-10-07", 180, 830]] }), ["Airbnb prices"]);
});

test("a jump in typical price (a parsing or currency mistake) fails", async () => {
  assert.deepEqual(await failed({ ...good, medians: [["2026-10-08", 24_300_000], ["2026-10-07", 2_400_000]] }), ["Prices believable"]);
});

test("the villa not re-priced, or priced outside its limits, fails", async () => {
  assert.deepEqual(await failed({ ...good, pricedAt: "2026-10-06T03:00:00Z" }), ["Mulai Villa pricing"]);
  assert.deepEqual(await failed({ ...good, outside: 3 }), ["Mulai Villa pricing"]);
});
