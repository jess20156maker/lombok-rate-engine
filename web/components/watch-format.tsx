"use client";

import { TrendLine } from "./trend-line";

// Formatting functions can't cross from a server page to a client chart,
// so this wrapper picks the format on the client side.
export function WatchFormat({
  kind,
  audRate,
  points,
  title,
}: {
  kind: "money" | "pct";
  audRate: number;
  points: { date: string; value: number | null }[];
  title: string;
}) {
  const format =
    kind === "pct"
      ? (v: number) => `${Math.round(v * 100)}%`
      : (v: number) =>
          `A$${Math.round(v / audRate).toLocaleString("en-AU")} · ${v >= 1_000_000 ? `Rp ${(v / 1_000_000).toFixed(1)}m` : `Rp ${Math.round(v / 1000)}k`}`;
  return <TrendLine points={points} format={format} title={title} min0={kind === "pct"} />;
}
