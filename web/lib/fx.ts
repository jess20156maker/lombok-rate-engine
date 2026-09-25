// AUD/IDR rate from the European Central Bank reference rates (via Frankfurter).
// Refreshed at most every 12 hours; falls back to the last known rate.

import "server-only";

const FALLBACK = { rate: 12601, date: "2026-09-24" };
let cached: { rate: number; date: string; at: number } | null = null;

export async function audRate(): Promise<{ rate: number; date: string }> {
  if (cached && Date.now() - cached.at < 12 * 3600_000) return cached;
  try {
    const res = await fetch("https://api.frankfurter.dev/v1/latest?base=AUD&symbols=IDR", {
      signal: AbortSignal.timeout(4000),
    });
    const j = await res.json();
    const rate = Number(j?.rates?.IDR);
    if (rate > 0) {
      cached = { rate, date: j.date, at: Date.now() };
      return cached;
    }
  } catch {
    /* offline or API down: use the fallback */
  }
  return cached ?? FALLBACK;
}
