"use client";

import { useMemo, useState } from "react";
import { eventsOn, type DayStat } from "@/lib/explore-calc";
import type { MarketEvent } from "@/lib/explore-types";
import { tipProps, useTooltip } from "./tooltip";

export const STEPS = 8;
export function occStep(occ: number | null) {
  return occ == null ? -1 : Math.min(STEPS - 1, Math.floor(occ * STEPS));
}
export function occFill(occ: number | null) {
  const s = occStep(occ);
  return s < 0 ? "transparent" : `var(--seq-${s})`;
}
export function occInk(occ: number | null) {
  return occStep(occ) >= 4 ? "#ffffff" : "var(--ink)";
}

const WEEK = ["M", "T", "W", "T", "F", "S", "S"];
const rp = (n: number) => (n >= 1_000_000 ? `Rp ${(n / 1_000_000).toFixed(1)}m` : `Rp ${Math.round(n / 1000)}k`);

/** Events worth a marker on the calendar: short, dated events and holidays, not seasons, school terms or month-long periods. */
function markerEvents(events: MarketEvent[], date: string) {
  const days = (e: MarketEvent) => (Date.parse(e.end) - Date.parse(e.start)) / 86_400_000 + 1;
  return eventsOn(events, date).filter(
    (e) => (e.category === "event" || e.category === "holiday") && e.impact !== "low" && days(e) <= 10,
  );
}

export function YearHeatmap({
  stats,
  range,
  events,
  selected,
  onSelect,
}: {
  stats: DayStat[];
  range: [number, number];
  events: MarketEvent[];
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  const t = useTooltip();
  const [asTable, setAsTable] = useState(false);

  const months = useMemo(() => {
    const out: { key: string; label: string; lead: number; days: DayStat[] }[] = [];
    for (const d of stats) {
      const key = d.date.slice(0, 7);
      if (out.at(-1)?.key !== key) {
        const dt = new Date(d.date + "T00:00:00Z");
        out.push({
          key,
          label: dt.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
          lead: (dt.getUTCDay() + 6) % 7,
          days: [],
        });
      }
      out.at(-1)!.days.push(d);
    }
    return out;
  }, [stats]);

  const tip = (d: DayStat) => {
    const ev = eventsOn(events, d.date);
    return (
      <div className="grid gap-1">
        <div className="font-semibold">
          {d.occ == null ? "–" : `${Math.round(d.occ * 100)}% booked`}
          <span className="ml-2 font-normal opacity-70">
            {new Date(d.date + "T00:00:00Z").toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
          </span>
        </div>
        <div className="opacity-80">
          {d.total - d.blocked} of {d.total} places open
          {d.price != null && d.priceN >= 3 && <> · median {rp(d.price)}</>}
        </div>
        {ev.slice(0, 3).map((e) => (
          <div key={e.name} className="flex items-center gap-1.5">
            <span className="inline-block size-1.5 rounded-full" style={{ background: "var(--event)" }} />
            {e.name}
          </div>
        ))}
        <div className="opacity-60">Click for why</div>
      </div>
    );
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
        <span className="flex items-center gap-2">
          Open
          <span className="flex overflow-hidden rounded-sm">
            {Array.from({ length: STEPS }).map((_, s) => (
              <span key={s} className="inline-block h-3 w-5" style={{ background: `var(--seq-${s})` }} />
            ))}
          </span>
          Sold out
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full" style={{ background: "var(--event)" }} />
          Event or holiday
        </span>
        <button type="button" onClick={() => setAsTable(!asTable)} className="ml-auto text-accent hover:underline">
          {asTable ? "Show calendar" : "Show as table"}
        </button>
      </div>

      {asTable ? (
        <div className="max-h-[32rem] overflow-auto">
          <table className="tabular w-full text-sm">
            <thead className="sticky top-0 bg-panel text-left text-xs text-muted">
              <tr>
                <th className="py-1 pr-4">Night</th>
                <th className="py-1 pr-4">Booked</th>
                <th className="py-1 pr-4">Open places</th>
                <th className="py-1 pr-4">Median price</th>
                <th className="py-1">Events</th>
              </tr>
            </thead>
            <tbody>
              {stats.slice(range[0], range[1]).map((d) => (
                <tr key={d.i} className="cursor-pointer border-t border-line hover:bg-accent-soft" onClick={() => onSelect(d.i)}>
                  <td className="py-1 pr-4">{d.date}</td>
                  <td className="py-1 pr-4">{d.occ == null ? "–" : `${Math.round(d.occ * 100)}%`}</td>
                  <td className="py-1 pr-4">{d.total - d.blocked}</td>
                  <td className="py-1 pr-4">{d.price != null && d.priceN >= 3 ? rp(d.price) : "–"}</td>
                  <td className="py-1 text-muted">{eventsOn(events, d.date).map((e) => e.name).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {months.map((m) => (
            <div key={m.key}>
              <div className="mb-1.5 text-sm font-medium">{m.label}</div>
              <div className="grid grid-cols-7 gap-[3px] text-[10px] text-faint">
                {WEEK.map((w, i) => (
                  <div key={i} className="text-center">
                    {w}
                  </div>
                ))}
                {Array.from({ length: m.lead }).map((_, i) => (
                  <div key={`l${i}`} />
                ))}
                {m.days.map((d) => {
                  const inWindow = d.i >= range[0] && d.i < range[1];
                  const marker = markerEvents(events, d.date).length > 0;
                  const isSel = selected === d.i;
                  return (
                    <button
                      key={d.i}
                      type="button"
                      aria-label={`${d.date}: ${d.occ == null ? "no data" : Math.round(d.occ * 100) + "% booked"}`}
                      onClick={() => onSelect(d.i)}
                      {...tipProps(t, () => tip(d))}
                      className="relative aspect-square rounded-[3px] text-[10px] leading-none transition-[opacity,transform,box-shadow] duration-200 hover:z-10 hover:scale-125 focus:z-10 focus:outline-none"
                      style={{
                        background: occFill(d.occ),
                        color: occInk(d.occ),
                        opacity: inWindow ? 1 : 0.28,
                        boxShadow: isSel ? "0 0 0 2px var(--panel), 0 0 0 4px var(--ink)" : undefined,
                      }}
                    >
                      <span className="opacity-70">{Number(d.date.slice(8))}</span>
                      {marker && (
                        <span
                          className="absolute right-[2px] top-[2px] size-[5px] rounded-full ring-1"
                          style={{ background: "var(--event)", ["--tw-ring-color" as string]: "var(--panel)" }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
