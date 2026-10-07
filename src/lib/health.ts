// Daily proof that the system is working: is today's market data in, complete,
// and believable, and has the villa been re-priced? Shared by the twice-daily
// health job (src/jobs/health.ts) and the website (/collection, /api/health).
// Dependency-free: callers pass their own query function.

import type { Query } from "./sql";

export type Check = { name: string; ok: boolean; warn?: boolean; detail: string };
export type Health = { ok: boolean; checkedAt: string; today: string; checks: Check[] };

const DAY = 86_400_000;

/** Lombok (UTC+8) date and hour. */
function lombok(now: Date) {
  const t = new Date(now.getTime() + 8 * 3600_000);
  return { date: t.toISOString().slice(0, 10), hour: t.getUTCHours() };
}
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
const str = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10));

export async function runHealth(q: Query, now = new Date()): Promise<Health> {
  const { date: today, hour } = lombok(now);
  // The nightly run starts 01:00 Lombok but GitHub often starts it hours late;
  // until 10:00, yesterday's data still counts as current.
  const freshFrom = hour < 10 ? addDays(today, -1) : today;
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const fresh = (d: string | null) => d != null && d >= freshFrom;

  // Two latest collection days per platform: dates searched and places priced.
  const { rows: days } = await q(
    `with d as (
       select platform, snapshot_date, count(*)::int as dates,
              row_number() over (partition by platform order by snapshot_date desc) as k
         from price_sample_dates group by platform, snapshot_date)
     select d.platform, d.snapshot_date::text as day, d.dates, d.k,
            (select count(distinct listing_id)::int from price_samples s
              where s.platform = d.platform and s.snapshot_date = d.snapshot_date) as places
       from d where k <= 2 order by platform, k`,
  );
  const site = (p: string) => days.filter((r) => r.platform === p);
  for (const [p, label, minDates] of [
    ["airbnb", "Airbnb prices", 170],
    ["booking", "Booking.com prices", 170],
  ] as const) {
    const [cur, prev] = site(p);
    if (!cur) {
      add({ name: label, ok: false, detail: "never collected" });
      continue;
    }
    const problems: string[] = [];
    if (!fresh(cur.day)) problems.push(`last collected ${cur.day}`);
    if (cur.dates < minDates) problems.push(`only ${cur.dates} of ~180 dates searched`);
    // A sharp drop in places found means the collector is being blocked or the site changed.
    if (prev?.places && cur.places < prev.places * 0.8) problems.push(`${cur.places} places priced, down from ${prev.places}`);
    add({
      name: label,
      ok: problems.length === 0,
      detail: problems.length ? problems.join("; ") : `${cur.day}: ${cur.dates} dates searched, ${cur.places} places priced`,
    });
  }

  // Airbnb calendars (bookings are inferred from these).
  const { rows: cals } = await q(
    `select snapshot_date::text as day, count(*)::int as n from calendar_snapshots
      where platform = 'airbnb' group by 1 order by 1 desc limit 2`,
  );
  {
    const [cur, prev] = cals;
    const problems: string[] = [];
    if (!cur) problems.push("never collected");
    else {
      if (!fresh(cur.day)) problems.push(`last collected ${cur.day}`);
      if (prev && cur.n < prev.n * 0.85) problems.push(`${cur.n} calendars, down from ${prev.n}`);
    }
    add({ name: "Airbnb calendars", ok: !problems.length, detail: problems.join("; ") || `${cur.day}: ${cur.n} villa calendars` });
  }

  // Prices should move gradually. A big jump in the typical price means a
  // parsing or currency mistake, not a market move.
  const { rows: med } = await q(
    `select snapshot_date::text as day,
            percentile_cont(0.5) within group (order by total / nights)::float as median
       from price_samples where platform = 'airbnb'
        and snapshot_date in (select distinct snapshot_date from price_samples where platform = 'airbnb' order by 1 desc limit 2)
      group by 1 order by 1 desc`,
  );
  if (med.length === 2) {
    const change = med[0].median / med[1].median - 1;
    add({
      name: "Prices believable",
      ok: Math.abs(change) < 0.25 && med[0].median > 300_000 && med[0].median < 30_000_000,
      detail: `typical Airbnb night Rp ${(med[0].median / 1e6).toFixed(2)}m (${change >= 0 ? "+" : ""}${Math.round(change * 100)}% vs ${med[1].day})`,
    });
  }

  // Competitor websites (Boni Beach): a warning only, they're a handful of rooms.
  const { rows: web } = await q(`select max(snapshot_date)::text as day from calendar_snapshots where platform = 'web'`);
  add({
    name: "Competitor websites",
    ok: true,
    warn: !fresh(web[0]?.day ?? null),
    detail: web[0]?.day ? `last checked ${web[0].day}` : "never checked",
  });

  // Your villa re-priced after tonight's data, for a full year, inside its limits.
  const { rows: props } = await q(
    `select p.id, p.name, p.min_rate, p.max_rate,
            max(r.computed_at) as at, count(r.*)::int as nights,
            count(r.*) filter (where o.date is null and (r.price < p.min_rate or r.price > p.max_rate))::int as outside
       from properties p
       left join price_recommendations r on r.property_id = p.id and r.date >= $1
       left join rate_overrides o on o.property_id = p.id and o.date = r.date
      group by p.id`,
    [today],
  );
  for (const p of props) {
    const ageH = p.at ? (now.getTime() - new Date(p.at).getTime()) / 3600_000 : Infinity;
    const problems: string[] = [];
    if (ageH > 36) problems.push(p.at ? `last priced ${Math.round(ageH)} hours ago` : "never priced");
    if (p.nights < 300) problems.push(`only ${p.nights} nights priced ahead`);
    if (p.outside > 0) problems.push(`${p.outside} nights outside your min/max`);
    add({
      name: `${p.name} pricing`,
      ok: !problems.length,
      detail: problems.join("; ") || `${p.nights} nights priced, ${Math.round(ageH)} hours ago`,
    });
  }

  // Calendar sync and double bookings (only once channel calendars are linked).
  const { rows: runs } = await q(
    `select distinct on (job) job, ran_at, ok, detail from job_runs where job = 'calendar-sync' order by job, ran_at desc`,
  );
  const { rows: linked } = await q(`select count(*)::int as n from properties where airbnb_ical_url is not null or booking_ical_url is not null`);
  if (linked[0].n > 0) {
    const r = runs[0];
    const ageH = r ? (now.getTime() - new Date(r.ran_at).getTime()) / 3600_000 : Infinity;
    add({
      name: "Calendar sync",
      ok: !!r && r.ok && ageH < 12,
      detail: !r ? "never ran" : !r.ok ? r.detail : ageH >= 12 ? `last ran ${Math.round(ageH)} hours ago` : r.detail,
    });
  }

  // Listings sweep (weekly): most known villas should have been seen this fortnight.
  const { rows: seen } = await q(`select max(last_seen)::text as day from listings where platform = 'airbnb'`);
  const lastSeen = str(seen[0]?.day);
  add({
    name: "Listings up to date",
    ok: lastSeen != null && lastSeen >= addDays(today, -9),
    detail: lastSeen ? `Airbnb villas last refreshed ${lastSeen}` : "never",
  });

  return { ok: checks.every((c) => c.ok), checkedAt: now.toISOString(), today, checks };
}
