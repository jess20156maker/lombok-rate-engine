"use client";

import { useState } from "react";

type Point = { date: string; value: number | null };

const label = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** One series over collection days: 2px line, crosshair + readout on hover. */
export function TrendLine({
  points,
  format,
  title,
  min0 = false,
}: {
  points: Point[];
  format: (v: number) => string;
  title: string;
  min0?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const valid = points.filter((p) => p.value != null) as { date: string; value: number }[];
  const W = 320;
  const H = 90;
  const PAD = { l: 4, r: 4, t: 10, b: 18 };

  if (valid.length === 0) {
    return (
      <div>
        <div className="text-xs text-muted">{title}</div>
        <div className="mt-2 text-sm text-faint">No readings yet.</div>
      </div>
    );
  }
  const vals = valid.map((p) => p.value);
  let lo = min0 ? 0 : Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi === lo) {
    hi = hi * 1.1 || 1;
    lo = min0 ? 0 : lo * 0.9;
  }
  const x = (i: number) => PAD.l + (valid.length === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (valid.length - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const path = valid.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const h = hover ?? valid.length - 1;
  const first = valid[0].value;
  const last = valid.at(-1)!.value;
  const change = valid.length > 1 && first ? last / first - 1 : null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs text-muted">{title}</div>
        <div className="tabular text-right text-sm">
          <span className="font-semibold">{format(valid[h].value)}</span>
          <span className="ml-1.5 text-xs text-faint">{label(valid[h].date)}</span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 w-full touch-none overflow-visible"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          valid.forEach((_, i) => {
            if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
          });
          setHover(best);
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${title}: ${valid.map((p) => `${label(p.date)} ${format(p.value)}`).join(", ")}`}
      >
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--axis)" strokeWidth={1} />
        {valid.length > 1 && <path d={path} fill="none" stroke="var(--seq-5)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {hover != null && <line x1={x(h)} x2={x(h)} y1={PAD.t - 4} y2={H - PAD.b} stroke="var(--faint)" strokeWidth={1} strokeDasharray="2 2" />}
        {valid.map((p, i) =>
          i === h || valid.length <= 12 ? (
            <circle key={p.date} cx={x(i)} cy={y(p.value)} r={i === h ? 4.5 : 3} fill="var(--seq-5)" stroke="var(--panel)" strokeWidth={2} />
          ) : null,
        )}
        <text x={PAD.l} y={H - 4} fontSize={9} fill="var(--faint)">
          {label(valid[0].date)}
        </text>
        {valid.length > 1 && (
          <text x={W - PAD.r} y={H - 4} fontSize={9} fill="var(--faint)" textAnchor="end">
            {label(valid.at(-1)!.date)}
          </text>
        )}
      </svg>
      <div className="text-[11px] text-faint">
        {valid.length === 1
          ? "One reading so far: this line grows by one point every night."
          : change != null && `${change >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(change * 100))}% since ${label(valid[0].date)}`}
      </div>
    </div>
  );
}
