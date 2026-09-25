"use client";

import { useEffect, useMemo, useState } from "react";
import {
  average,
  dayStats,
  filterListings,
  groupOcc,
  insightsFor,
  monthly,
  summarize,
  windowRange,
  type Filters,
  type WindowKey,
} from "@/lib/explore-calc";
import type { ExploreData } from "@/lib/explore-types";
import { HBars, MonthBars } from "./bars";
import { DayPanel } from "./day-panel";
import { FilterBar } from "./filter-bar";
import { TooltipProvider } from "./tooltip";
import { YearHeatmap, occFill } from "./year-heatmap";

const rp = (n: number | null) =>
  n == null ? "–" : n >= 1_000_000 ? `Rp ${(n / 1_000_000).toFixed(1)}m` : `Rp ${Math.round(n / 1000)}k`;
const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);
const monthShort = (m: string) =>
  new Date(m + "-01T00:00:00Z").toLocaleString("en-GB", { month: "short", timeZone: "UTC" }) + ` ’${m.slice(2, 4)}`;
const monthLong = (m: string) =>
  new Date(m + "-01T00:00:00Z").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export type InitialState = Filters & { day: number | null };

function Card({ title, sub, children, className = "" }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-panel p-5 ${className}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Explore({ data, initial }: { data: ExploreData; initial: InitialState }) {
  const [filters, setFilters] = useState<Filters>({
    areas: initial.areas,
    beds: initial.beds,
    window: initial.window,
    includeDormant: initial.includeDormant,
  });
  const [day, setDay] = useState<number | null>(initial.day);

  const idx = useMemo(() => filterListings(data, filters), [data, filters]);
  const stats = useMemo(() => dayStats(data, idx), [data, idx]);
  const range = useMemo(() => windowRange(data, filters.window), [data, filters.window]);
  const summary = useMemo(() => summarize(stats, range), [stats, range]);

  // Areas ignore the area filter so you can compare and click to pick.
  const bedIdx = useMemo(() => filterListings(data, { ...filters, areas: [] }), [data, filters]);
  const byArea = useMemo(
    () =>
      groupOcc(data, bedIdx, (l) => l.area, range).sort(
        (a, b) => data.areas.indexOf(a.key) - data.areas.indexOf(b.key),
      ),
    [data, bedIdx, range],
  );
  const areaIdx = useMemo(() => filterListings(data, { ...filters, beds: [] }), [data, filters]);
  const byBeds = useMemo(
    () => groupOcc(data, areaIdx, (l) => l.beds, range).filter((g) => g.key !== "?").sort((a, b) => a.key.localeCompare(b.key)),
    [data, areaIdx, range],
  );
  const months = useMemo(() => monthly(stats), [stats]);

  const areaCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of data.listings) if (filters.includeDormant || !l.dormant) c[l.area] = (c[l.area] ?? 0) + 1;
    return c;
  }, [data, filters.includeDormant]);

  // Default the day panel to the busiest night in the window.
  const selected = day ?? summary.busiest?.i ?? null;
  const selectedStat = selected != null ? stats[selected] : null;
  const insights = useMemo(
    () => (selectedStat ? insightsFor(selectedStat, stats, data.events) : []),
    [selectedStat, stats, data.events],
  );

  const upcoming = useMemo(() => {
    const [s, e] = range;
    const start = stats[s]?.date ?? "";
    const end = stats[Math.max(s, e - 1)]?.date ?? "";
    return data.events
      .filter((ev) => (ev.category === "event" || ev.category === "holiday") && ev.end >= start && ev.start <= end)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((ev) => {
        const nights = stats.filter((d) => d.date >= ev.start && d.date <= ev.end);
        return { ev, occ: average(nights.map((d) => d.occ)), first: nights[0]?.i ?? null };
      });
  }, [data.events, stats, range]);

  const scope =
    (filters.areas.length ? filters.areas.join(" + ") : "all beaches") +
    (filters.beds.length ? `, ${filters.beds.join("/")} bed` : "");

  // Keep the URL in step with the view so any state can be shared.
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.areas.length) p.set("areas", filters.areas.join(","));
    if (filters.beds.length) p.set("beds", filters.beds.join(","));
    if (filters.window !== "90") p.set("when", filters.window);
    if (filters.includeDormant) p.set("dormant", "1");
    if (day != null) p.set("day", stats[day]?.date ?? "");
    return p.toString();
  }, [filters, day, stats]);
  useEffect(() => {
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }, [query]);

  const windowLabel = filters.window.startsWith("m:")
    ? monthLong(filters.window.slice(2))
    : ({ "30": "the next 30 days", "90": "the next 90 days", "180": "the next 6 months", "365": "the next 12 months" } as Record<string, string>)[
        filters.window
      ];

  return (
    <TooltipProvider>
      <FilterBar
        filters={filters}
        setFilters={(f) => {
          setFilters(f);
          if (f.window !== filters.window) setDay(null);
        }}
        areas={data.areas}
        areaCounts={areaCounts}
        months={months.map((m) => ({ key: m.month, label: monthLong(m.month) }))}
      />

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {scope[0].toUpperCase() + scope.slice(1)}, {windowLabel}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {idx.length} places on Airbnb · calendars collected {dayLabel(data.snapshot)}
          {data.comparedTo ? ` · bookings compared with ${dayLabel(data.comparedTo)}` : " · new-booking tracking starts after tonight's run"}
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Nights booked" value={pct(summary.occ)} sub="average share of places taken" />
        <Tile label="Nearly sold-out nights" value={summary.soldOutDays} sub={`of ${summary.days}, 90%+ booked`} />
        <Tile label="Typical nightly price" value={rp(summary.price)} sub="median, before taxes" />
        <Tile
          label="Busiest night"
          value={summary.busiest ? dayLabel(summary.busiest.date) : "–"}
          sub={summary.busiest ? `${pct(summary.busiest.occ)} booked` : undefined}
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card title="How booked every night is" sub="Darker = fewer places left. Faded days are outside the time window. Hover for numbers; click for the reasons.">
          <YearHeatmap stats={stats} range={range} events={data.events} selected={selected} onSelect={setDay} />
        </Card>
        <div className="lg:sticky lg:top-28 lg:self-start">
          <DayPanel
            day={selectedStat}
            insights={insights}
            scope={scope}
            shareUrl={() => {
              const p = new URLSearchParams(query);
              if (selectedStat) p.set("day", selectedStat.date);
              return `${window.location.origin}${window.location.pathname}?${p}`;
            }}
          />
        </div>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Beach by beach" sub={`Share of nights booked, ${windowLabel}. Click a beach to filter.`}>
          <HBars
            bars={byArea.map((a) => ({
              key: a.key,
              label: a.key,
              value: a.occ,
              sub: `${a.listings} places`,
              active: filters.areas.length === 0 || filters.areas.includes(a.key),
              tip: () => (
                <div>
                  <div className="font-semibold">{pct(a.occ)} booked</div>
                  <div className="opacity-80">
                    {a.key} · {a.listings} places · median {rp(a.price)}
                  </div>
                </div>
              ),
            }))}
            onClick={(k) =>
              setFilters({
                ...filters,
                areas: filters.areas.includes(k) ? filters.areas.filter((x) => x !== k) : [...filters.areas, k],
              })
            }
          />
        </Card>
        <Card title="By size" sub={`Share of nights booked and typical price, ${windowLabel}. Click to filter.`}>
          <HBars
            bars={byBeds.map((b) => ({
              key: b.key,
              label: `${b.key} bedroom${b.key === "1" ? "" : "s"}`,
              value: b.occ,
              sub: rp(b.price),
              active: filters.beds.length === 0 || filters.beds.includes(b.key),
              tip: () => (
                <div>
                  <div className="font-semibold">{pct(b.occ)} booked</div>
                  <div className="opacity-80">
                    {b.listings} places · median {rp(b.price)} a night
                  </div>
                </div>
              ),
            }))}
            onClick={(k) =>
              setFilters({ ...filters, beds: filters.beds.includes(k) ? filters.beds.filter((x) => x !== k) : [...filters.beds, k] })
            }
          />
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card title="Month by month" sub="How full each month already is. Click a month to zoom in.">
          <MonthBars
            bars={months.map((m) => ({
              key: m.month,
              label: monthShort(m.month),
              value: m.occ,
              active: filters.window === `m:${m.month}`,
              tip: () => (
                <div>
                  <div className="font-semibold">{pct(m.occ)} booked</div>
                  <div className="opacity-80">{monthLong(m.month)}</div>
                </div>
              ),
            }))}
            onClick={(k) => {
              setFilters({ ...filters, window: `m:${k}` as WindowKey });
              setDay(null);
            }}
          />
        </Card>
        <Card title="What's coming up" sub={`Events and holidays in ${windowLabel}, with how booked those nights are.`}>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted">
              {data.events.length ? "Nothing on the events calendar in this window." : "The events calendar is still being researched."}
            </p>
          ) : (
            <ul className="grid max-h-72 gap-1 overflow-auto pr-1">
              {upcoming.map(({ ev, occ, first }) => (
                <li key={ev.name + ev.start}>
                  <button
                    type="button"
                    onClick={() => first != null && setDay(first)}
                    className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-accent-soft"
                  >
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-md text-xs font-semibold"
                      style={{ background: occFill(occ), color: (occ ?? 0) >= 0.5 ? "#fff" : "var(--ink)" }}
                    >
                      {pct(occ)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{ev.name}</span>
                      <span className="block text-xs text-muted">
                        {dayLabel(ev.start)}
                        {ev.end !== ev.start && ` – ${dayLabel(ev.end)}`} · {ev.impact} impact
                        {ev.confidence === "estimated" && " · dates estimated"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </TooltipProvider>
  );
}

