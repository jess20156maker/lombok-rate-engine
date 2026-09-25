export function rupiah(n: number | null | undefined) {
  if (n == null) return "–";
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  return `Rp ${Math.round(n / 1000)}k`;
}

export function pct(n: number | null | undefined) {
  return n == null ? "–" : `${Math.round(n * 100)}%`;
}

export function monthLabel(ym: string) {
  return new Date(ym + "-01T00:00:00Z").toLocaleString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function dateLabel(d: string) {
  return new Date(d + "T00:00:00Z").toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
