// Money display. Prices are stored in IDR; AUD is a display conversion.

export type Currency = "IDR" | "AUD";
export type Money = { currency: Currency; audRate: number; rateDate: string };

/** Compact: "Rp 2.3m" / "A$182". */
export function fmt(n: number | null | undefined, m: Money): string {
  if (n == null) return "–";
  if (m.currency === "AUD") {
    const a = n / m.audRate;
    return a >= 10_000 ? `A$${(a / 1000).toFixed(1)}k` : `A$${Math.round(a).toLocaleString("en-AU")}`;
  }
  return n >= 1_000_000 ? `Rp ${(n / 1_000_000).toFixed(1)}m` : `Rp ${Math.round(n / 1000)}k`;
}

/** Both currencies: "A$182 · Rp 2.3m". */
export function both(n: number | null | undefined, audRate: number): string {
  if (n == null) return "–";
  const m = { audRate, rateDate: "" };
  return `${fmt(n, { ...m, currency: "AUD" })} · ${fmt(n, { ...m, currency: "IDR" })}`;
}

/** Both currencies, for tooltips: "Rp 2.3m (A$182)". */
export function fmtBoth(n: number | null | undefined, m: Money): string {
  if (n == null) return "–";
  const other: Money = { ...m, currency: m.currency === "AUD" ? "IDR" : "AUD" };
  return `${fmt(n, m)} (${fmt(n, other)})`;
}
