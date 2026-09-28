import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageTitle, Stat, td, th } from "@/components/ui";
import { StarButton } from "@/components/star-button";
import { airbnbUrl, loadMarket } from "@/lib/data";
import { loadExplore } from "@/lib/explore";
import { fmt } from "@/lib/money";
import { watchedIds } from "@/lib/watch";
import { dateLabel, pct } from "@/lib/format";

const COLORS: Record<string, string> = { "1": "var(--open)", c: "var(--nocheckin)", "0": "var(--blocked)" };

type Night = { date: string; c: string; price: number | null; was: [number, string] | null; estimate: number | null };

/** 12 months, Monday-first, with the nightly rate in every square. */
function RateCalendar({ nights, aud, idr }: { nights: Night[]; aud: (n: number) => string; idr: (n: number) => string }) {
  const months: { label: string; lead: number; days: Night[] }[] = [];
  for (const n of nights) {
    const d = new Date(n.date + "T00:00:00Z");
    const label = d.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    if (months.at(-1)?.label !== label) months.push({ label, lead: (d.getUTCDay() + 6) % 7, days: [] });
    months.at(-1)!.days.push(n);
  }
  const short = (n: number) => aud(n).replace("A$", "");
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {months.map((m) => (
        <div key={m.label}>
          <div className="mb-1 text-sm font-medium">{m.label}</div>
          <div className="grid grid-cols-7 gap-[2px] text-center">
            {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
              <div key={i} className="text-[10px] text-faint">
                {w}
              </div>
            ))}
            {Array.from({ length: m.lead }).map((_, i) => (
              <div key={`l${i}`} />
            ))}
            {m.days.map((d) => {
              const booked = d.c === "0";
              const seen = d.was ? dateLabel(d.was[1]) : "";
              const title = booked
                ? d.was
                  ? `${d.date}: booked. Last seen open at ${aud(d.was[0])} · ${idr(d.was[0])} a night, on ${seen}`
                  : d.estimate != null
                    ? `${d.date}: booked before we saw its price. Estimated ~${aud(d.estimate)} · ${idr(d.estimate)} a night, from this villa's prices on nearby open nights`
                    : `${d.date}: booked or closed (no price seen nearby)`
                : d.price != null
                  ? `${d.date}: ${aud(d.price)} · ${idr(d.price)} a night (2-night stay)${d.c === "c" ? ", no check-in that day" : ""}`
                  : `${d.date}: open, price not checked for this date`;
              return (
                <div
                  key={d.date}
                  title={title}
                  className="flex min-h-11 flex-col items-center justify-center rounded-[3px] px-0.5 leading-tight"
                  style={{ background: COLORS[d.c] ?? "transparent", color: booked ? "#fff" : "var(--ink)" }}
                >
                  <span className="text-[9px] opacity-70">{Number(d.date.slice(8))}</span>
                  <span className="tabular text-[10px] font-semibold">
                    {booked ? (d.was ? short(d.was[0]) : d.estimate != null ? `~${short(d.estimate)}` : "") : d.price != null ? short(d.price) : "–"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function ListingPage(props: PageProps<"/listings/[id]">) {
  const { id } = await props.params;
  const [m, watched, explore] = await Promise.all([loadMarket(), watchedIds(), loadExplore()]);
  const l = m.stats.find((s) => s.id === id);
  if (!l) notFound();

  // Nightly rates from the same data as the Rates page: today's price, or for a
  // booked night the last price seen while it was open.
  const aud = (n: number) => fmt(n, { currency: "AUD", audRate: explore?.audRate ?? 12600, rateDate: "" });
  const idr = (n: number) => fmt(n, { currency: "IDR", audRate: explore?.audRate ?? 12600, rateDate: "" });
  const li = explore?.listings.findIndex((x) => x.platform === "airbnb" && x.id === id) ?? -1;
  const nights: Night[] = [];
  if (explore && li >= 0) {
    const price = new Map<number, number>();
    for (const [d, arr] of Object.entries(explore.prices)) for (const [i, p] of arr) if (i === li) price.set(Number(d), p);
    const was = new Map<number, [number, string]>();
    for (const [d, arr] of Object.entries(explore.wasPrices)) for (const [i, p, seen] of arr) if (i === li) was.set(Number(d), [p, seen]);
    const ln = explore.listings[li].nights;
    // For booked nights with no price seen: this villa's median price on open
    // nights within a week either side (widening to a month), marked as an estimate.
    const near = (d: number) => {
      for (const span of [7, 14, 30]) {
        const xs: number[] = [];
        for (let k = d - span; k <= d + span; k++) {
          const p = price.get(k) ?? was.get(k)?.[0];
          if (p != null) xs.push(p);
        }
        if (xs.length >= 2) return xs.sort((a, b) => a - b)[xs.length >> 1];
      }
      return null;
    };
    for (let d = 0; d < ln.length; d++) {
      nights.push({
        date: new Date(Date.parse(explore.from) + d * 86_400_000).toISOString().slice(0, 10),
        c: ln[d],
        price: price.get(d) ?? null,
        was: was.get(d) ?? null,
        estimate: ln[d] === "0" && !was.has(d) ? near(d) : null,
      });
    }
  }
  const upcoming = nights.slice(0, 90).map((n) => n.price).filter((p): p is number => p != null).sort((a, b) => a - b);

  const events = m.events?.events.filter((e) => e.listingId === id) ?? [];

  return (
    <>
      <div className="mb-2 text-sm">
        <Link href={`/listings?area=${encodeURIComponent(l.area)}`} className="text-muted hover:text-ink">
          ← {l.area}
        </Link>
      </div>
      <PageTitle
        sub={
          <>
            {l.kind} · {l.bedrooms ?? "?"} bedrooms · {l.rating ?? "no rating"} · first seen {dateLabel(l.firstSeen)} ·{" "}
            <a className="text-accent hover:underline" href={airbnbUrl(l.id)} target="_blank" rel="noreferrer">
              open on Airbnb ↗
            </a>
          </>
        }
      >
        <span className="mr-3">{l.name}</span>
        <StarButton id={l.id} watched={watched.has(l.id)} label />
      </PageTitle>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Blocked, next 30 nights" value={pct(l.blocked30)} />
        <Stat label="Blocked, next 90 nights" value={pct(l.blocked90)} />
        <Stat label="Blocked, next 365 nights" value={pct(l.blocked365)} sub={l.dormant ? "dormant: excluded from area averages" : undefined} />
        <Stat
          label="Typical rate, next 90 nights"
          value={upcoming.length ? aud(upcoming[upcoming.length >> 1]) : "–"}
          sub={upcoming.length ? `${idr(upcoming[upcoming.length >> 1])} · range ${aud(upcoming[0])}–${aud(upcoming.at(-1)!)}` : "no prices yet"}
        />
      </div>

      <div className="grid gap-6">
        <Card
          title="Nightly rates, next 12 months"
          note={
            <span className="flex flex-wrap gap-4">
              {[
                ["1", "Open: that night's rate (A$, for a 2-night stay, before taxes)"],
                ["c", "Open, but no check-in that day"],
                ["0", "Booked: the rate before it sold, or ~ an estimate from nearby nights"],
              ].map(([c, label]) => (
                <span key={c} className="flex items-center gap-1.5">
                  <span className="inline-block size-3 rounded-[2px]" style={{ background: COLORS[c] }} />
                  {label}
                </span>
              ))}
              <span>Hover a night for Rupiah and details.</span>
            </span>
          }
        >
          {nights.length ? <RateCalendar nights={nights} aud={aud} idr={idr} /> : <p className="text-sm text-muted">Calendar not collected yet today.</p>}
        </Card>

        <div className="grid gap-6">
          <Card title="Changes detected" note="Compared with the previous day's calendar.">
            {!m.events ? (
              <p className="text-sm text-muted">Available after the second daily run.</p>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted">No changes since {dateLabel(m.events.comparedTo)}.</p>
            ) : (
              <table className="tabular w-full text-sm">
                <thead className="border-b border-line">
                  <tr>
                    <th className={th}>What</th>
                    <th className={th}>Check-in</th>
                    <th className={th}>Nights</th>
                    <th className={th}>Lead time</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className={td}>{e.kind}</td>
                      <td className={td}>{dateLabel(e.checkin)}</td>
                      <td className={td}>{e.nights}</td>
                      <td className={td}>{e.leadDays} days</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
