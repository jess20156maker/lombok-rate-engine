/** Dates are plain YYYY-MM-DD strings in Lombok time (UTC+8). */

export function today(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}
