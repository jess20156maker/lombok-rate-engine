"use client";

import { useState } from "react";
import type { BookingDay } from "@/lib/explore-calc";

type Series = { key: string; label: string; color: string; get: (d: BookingDay) => number | null };

const dayLabel = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Two platforms on one scale over the sampled check-in dates. */
function TwoLines({
  days,
  series,
  format,
  min0,
  max1,
  title,
}: {
  days: BookingDay[];
  series: Series[];
  format: (v: number) => string;
  min0?: boolean;
  max1?: boolean;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 520;
  const H = 180;
  const P = { l: 44, r: 70, t: 12, b: 24 };
  const vals = days.flatMap((d) => series.map((s) => s.get(d))).filter((v): v is number => v != null);
  if (days.length < 2 || !vals.length) return <p className="text-sm text-muted">Builds up after the first Booking.com runs.</p>;
  const lo = min0 ? 0 : Math.min(...vals) * 0.9;
  const hi = max1 ? 1 : Math.max(...vals) * 1.05;
  const x = (i: number) => P.l + (i / (days.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const ticks = [lo, (lo + hi) / 2, hi];
  const h = hover ?? days.length - 1;

  return (
    <div>
      <div className="mb-1 text-xs font-medium">{title}</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none overflow-visible"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          days.forEach((_, i) => {
            if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
          });
          setHover(best);
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={title}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={P.l - 6} y={y(t) + 3} fontSize={10} fill="var(--faint)" textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {series.map((s) => {
          const pts = days.map((d, i) => [i, s.get(d)] as const).filter(([, v]) => v != null) as [number, number][];
          const path = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
          const last = pts.at(-1);
          return (
            <g key={s.key}>
              <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {last && (
                <text x={x(last[0]) + 6} y={y(last[1]) + 3} fontSize={10} fill="var(--muted)">
                  {s.label}
                </text>
              )}
            </g>
          );
        })}
        <line x1={x(h)} x2={x(h)} y1={P.t} y2={H - P.b} stroke="var(--faint)" strokeDasharray="2 2" />
        {series.map((s) => {
          const v = s.get(days[h]);
          return v == null ? null : <circle key={s.key} cx={x(h)} cy={y(v)} r={4.5} fill={s.color} stroke="var(--panel)" strokeWidth={2} />;
        })}
        {[0, days.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} fontSize={10} fill="var(--faint)" textAnchor={i ? "end" : "start"}>
            {dayLabel(days[i].date)}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 text-xs">
        <span className="text-faint">{dayLabel(days[h].date)}:</span>
        {series.map((s) => {
          const v = s.get(days[h]);
          return (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
              <span className="font-semibold">{v == null ? "–" : format(v)}</span>
              <span className="text-muted">{s.label}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function PlatformCompare({
  days,
  aud,
  bothCount,
  bookingCount,
}: {
  days: BookingDay[];
  aud: (n: number | null) => string;
  bothCount: number;
  bookingCount: number;
}) {
  const series = (a: (d: BookingDay) => number | null, b: (d: BookingDay) => number | null): Series[] => [
    { key: "airbnb", label: "Airbnb", color: "var(--airbnb)", get: a },
    { key: "booking", label: "Booking.com", color: "var(--booking)", get: b },
  ];
  return (
    <section className="mb-6 rounded-lg border border-line bg-panel p-5">
      <h2 className="text-sm font-semibold">Airbnb vs Booking.com</h2>
      <p className="mt-0.5 text-xs text-muted">
        {bookingCount} places on Booking.com in this selection, {bothCount} of them also on Airbnb. Booking.com is checked for
        every date in the next 6 months, every night. It has no public calendar, so &ldquo;not available&rdquo; there means
        booked, closed, or needing a longer stay. Prices are as each site shows them: Booking.com includes taxes, Airbnb
        includes its guest fees, and for the same villa Booking.com usually comes out a little cheaper.
      </p>
      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <TwoLines
          title="Share of places not available"
          days={days}
          min0
          max1
          format={(v) => `${Math.round(v * 100)}%`}
          series={series((d) => d.airbnbOcc, (d) => d.full)}
        />
        <TwoLines
          title="Typical price a night (A$)"
          days={days}
          format={(v) => aud(v)}
          series={series((d) => d.airbnbPrice, (d) => d.price)}
        />
      </div>
    </section>
  );
}
