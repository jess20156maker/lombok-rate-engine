import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageTitle, Stat, td, th } from "@/components/ui";
import { airbnbUrl, loadMarket } from "@/lib/data";
import { dateLabel, pct, rupiah } from "@/lib/format";

const COLORS: Record<string, string> = { "1": "var(--open)", c: "var(--nocheckin)", "0": "var(--blocked)" };

function YearCalendar({ from, nights }: { from: string; nights: string }) {
  // Group nights into calendar months, with Monday-first week alignment.
  const months: { label: string; lead: number; days: { date: string; c: string }[] }[] = [];
  for (let i = 0; i < nights.length; i++) {
    const d = new Date(Date.parse(from + "T00:00:00Z") + i * 86_400_000);
    const label = d.toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
    if (months.at(-1)?.label !== label) months.push({ label, lead: (d.getUTCDay() + 6) % 7, days: [] });
    months.at(-1)!.days.push({ date: d.toISOString().slice(0, 10), c: nights[i] });
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {months.map((m) => (
        <div key={m.label}>
          <div className="mb-1 text-xs font-medium">{m.label}</div>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: m.lead }).map((_, i) => (
              <div key={`l${i}`} />
            ))}
            {m.days.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.c === "0" ? "blocked" : d.c === "c" ? "open, no check-in" : "open"}`}
                className="aspect-square rounded-[2px]"
                style={{ background: COLORS[d.c] }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function ListingPage(props: PageProps<"/listings/[id]">) {
  const { id } = await props.params;
  const m = await loadMarket();
  const l = m.stats.find((s) => s.id === id);
  if (!l) notFound();

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
        {l.name}
      </PageTitle>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Blocked, next 30 nights" value={pct(l.blocked30)} />
        <Stat label="Blocked, next 90 nights" value={pct(l.blocked90)} />
        <Stat label="Blocked, next 365 nights" value={pct(l.blocked365)} sub={l.dormant ? "dormant: excluded from area averages" : undefined} />
        <Stat label="Median nightly" value={rupiah(l.medianNightly)} sub={`${l.priceSamples.length} price samples today`} />
      </div>

      <div className="grid gap-6">
        <Card
          title="Next 12 months"
          note={
            <span className="flex flex-wrap gap-4">
              {[
                ["1", "Open"],
                ["c", "Open, but no check-in that day"],
                ["0", "Blocked (booked or closed)"],
              ].map(([c, label]) => (
                <span key={c} className="flex items-center gap-1.5">
                  <span className="inline-block size-3 rounded-[2px]" style={{ background: COLORS[c] }} />
                  {label}
                </span>
              ))}
            </span>
          }
        >
          {l.nights && l.calendarFrom ? (
            <YearCalendar from={l.calendarFrom} nights={l.nights} />
          ) : (
            <p className="text-sm text-muted">Calendar not collected yet today.</p>
          )}
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card title="Prices found today" note="Per-night price for a 2-night stay starting on that date, before taxes. Missing dates mean the listing wasn't available then.">
            {l.priceSamples.length ? (
              <table className="tabular w-full text-sm">
                <thead className="border-b border-line">
                  <tr>
                    <th className={th}>Check-in</th>
                    <th className={th}>Per night</th>
                  </tr>
                </thead>
                <tbody>
                  {l.priceSamples.map((p) => (
                    <tr key={p.checkin} className="border-b border-line last:border-0">
                      <td className={td}>{dateLabel(p.checkin)}</td>
                      <td className={td}>{rupiah(p.perNight)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted">No prices yet: price sampling runs after all calendars are collected.</p>
            )}
          </Card>

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
