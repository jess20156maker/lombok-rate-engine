import Link from "next/link";
import { connection } from "next/server";
import { Card, PageTitle, Stat, heat, heatText, td, th } from "@/components/ui";
import { BEDROOM_GROUPS, areaSummaries, forwardByMonth, loadMarket } from "@/lib/data";
import { dateLabel, monthLabel, pct, rupiah } from "@/lib/format";

export default async function MarketPage() {
  await connection();
  const m = await loadMarket();

  if (!m.date) {
    return <PageTitle sub="Run `npm run discover` then `npm run daily` in the repo.">No data collected yet</PageTitle>;
  }

  const areas = areaSummaries(m);
  const fwd = forwardByMonth(m);
  const live = m.stats.filter((s) => s.nights && !s.dormant);
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const bookings = m.events?.events.filter((e) => e.kind === "booking") ?? [];

  return (
    <>
      <PageTitle
        sub={
          <>
            Airbnb, whole-property listings · snapshot {dateLabel(m.date)} · {m.dates.length} day
            {m.dates.length === 1 ? "" : "s"} of history
          </>
        }
      >
        South Lombok market
      </PageTitle>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Listings tracked" value={m.stats.length} sub={`${m.calendarsCollected} calendars collected today`} />
        <Stat label="Blocked, next 30 nights" value={pct(avg(live.map((s) => s.blocked30)))} sub="average across active listings" />
        <Stat label="Blocked, next 90 nights" value={pct(avg(live.map((s) => s.blocked90)))} sub="average across active listings" />
        <Stat
          label="Likely bookings detected"
          value={m.events ? bookings.length : "–"}
          sub={m.events ? `since ${dateLabel(m.events.comparedTo)}` : "starts after the second daily run"}
        />
      </div>

      <div className="grid gap-6">
        <Card
          title="By area"
          note="Blocked = not available on Airbnb: booked, or closed by the host. Dormant listings (blocked >95% of the year) are left out of the averages. Prices are the median per-night rate from today's 2-night searches, before taxes."
        >
          <div className="overflow-x-auto">
            <table className="tabular w-full text-sm">
              <thead className="border-b border-line">
                <tr>
                  <th className={th}>Area</th>
                  <th className={th}>Listings</th>
                  <th className={th}>Dormant</th>
                  <th className={th}>Blocked 30d</th>
                  <th className={th}>Blocked 90d</th>
                  {BEDROOM_GROUPS.map((g) => (
                    <th key={g} className={th}>
                      {g} bed / night
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {areas.map((a) => (
                  <tr key={a.area} className="border-b border-line last:border-0">
                    <td className={td}>
                      <Link className="text-accent hover:underline" href={`/listings?area=${encodeURIComponent(a.area)}`}>
                        {a.area}
                      </Link>
                    </td>
                    <td className={td}>{a.listings}</td>
                    <td className={`${td} text-muted`}>{a.dormant}</td>
                    <td className={td} style={{ background: heat(a.blocked30), color: heatText(a.blocked30) }}>
                      {pct(a.blocked30)}
                    </td>
                    <td className={td} style={{ background: heat(a.blocked90), color: heatText(a.blocked90) }}>
                      {pct(a.blocked90)}
                    </td>
                    {BEDROOM_GROUPS.map((g) => (
                      <td key={g} className={td}>
                        {rupiah(a.priceByBeds[g])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="How full each month already is"
          note="Share of nights already blocked, by month of stay. Early months fill as the date gets closer; comparing this table day to day shows booking pace."
        >
          <div className="overflow-x-auto">
            <table className="tabular w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Area</th>
                  {fwd.months.map((mo) => (
                    <th key={mo} className={`${th} text-center`}>
                      {monthLabel(mo)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fwd.rows.map((r) => (
                  <tr key={r.area}>
                    <td className={td}>{r.area}</td>
                    {r.values.map((v, i) => (
                      <td
                        key={i}
                        className="px-1 py-1 text-center text-xs"
                        style={{ background: heat(v), color: heatText(v) }}
                      >
                        {pct(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
