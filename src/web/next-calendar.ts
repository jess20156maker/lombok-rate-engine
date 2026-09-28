// Adapter for sites built on Next.js that embed a rate calendar in the page's
// __NEXT_DATA__ (pageProps.calendar.days: date, rate, soldOut, cta, ctd).
// Plain HTTP; the whole year arrives in one page load.

export type WebDay = {
  date: string;
  rate: number | null; // per night, in `currency`, including taxes
  soldOut: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export async function readNextCalendar(url: string): Promise<{ currency: string; days: WebDay[] }> {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error(`No page data on ${url} (site changed?)`);
  const cal = JSON.parse(m[1])?.props?.pageProps?.calendar;
  if (!Array.isArray(cal?.days)) throw new Error(`No rate calendar on ${url} (site changed?)`);
  return {
    currency: cal.currency ?? "IDR",
    days: cal.days.map((d: any) => ({
      date: String(d.date).slice(0, 10),
      rate: typeof d.rate === "number" && d.rate > 0 ? Math.round(d.rate) : null,
      soldOut: !!d.soldOut,
      closedToArrival: !!d.cta,
      closedToDeparture: !!d.ctd,
    })),
  };
}
