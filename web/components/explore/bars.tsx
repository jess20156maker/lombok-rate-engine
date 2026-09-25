"use client";

import type { ReactNode } from "react";
import { tipProps, useTooltip } from "./tooltip";

export type Bar = { key: string; label: string; value: number | null; sub?: string; active?: boolean; tip?: () => ReactNode };

const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);

/** Horizontal bars, one hue, 0–100%. Click a bar to act on it (e.g. filter). */
export function HBars({ bars, onClick }: { bars: Bar[]; onClick?: (key: string) => void }) {
  const t = useTooltip();
  return (
    <div className="grid gap-1.5">
      {bars.map((b) => (
        <button
          key={b.key}
          type="button"
          onClick={() => onClick?.(b.key)}
          {...tipProps(t, () => b.tip?.() ?? `${b.label}: ${pct(b.value)}`)}
          className="group grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-3 rounded px-1 py-1 text-left text-sm hover:bg-accent-soft"
        >
          <span className={`truncate ${b.active === false ? "text-faint" : ""}`}>{b.label}</span>
          <span className="relative h-4">
            <span className="absolute inset-0 rounded-sm bg-line opacity-40" />
            <span
              className="absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-500 ease-out"
              style={{ width: `${(b.value ?? 0) * 100}%`, background: b.active === false ? "var(--axis)" : "var(--seq-5)" }}
            />
          </span>
          <span className="tabular text-right">
            {pct(b.value)}
            {b.sub && <span className="block text-[10px] text-faint">{b.sub}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Vertical bars, one per month. */
export function MonthBars({
  bars,
  onClick,
}: {
  bars: Bar[];
  onClick?: (key: string) => void;
}) {
  const t = useTooltip();
  return (
    <div>
      <div className="flex h-40 items-end gap-[3px] border-b border-line">
        {bars.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => onClick?.(b.key)}
            aria-label={`${b.label}: ${pct(b.value)} booked`}
            {...tipProps(t, () => b.tip?.() ?? `${b.label}: ${pct(b.value)}`)}
            className="group relative flex h-full flex-1 items-end"
          >
            <span
              className="w-full rounded-t-[4px] transition-[height,background] duration-500 ease-out group-hover:brightness-110"
              style={{
                height: `${Math.max(2, (b.value ?? 0) * 100)}%`,
                background: b.active ? "var(--seq-6)" : "var(--seq-3)",
              }}
            />
            <span className="tabular absolute -top-5 left-0 right-0 text-center text-[10px] text-muted opacity-0 transition-opacity group-hover:opacity-100">
              {pct(b.value)}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px] text-[10px] text-faint">
        {bars.map((b) => (
          <span key={b.key} className="flex-1 text-center">
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
