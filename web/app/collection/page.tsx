import { connection } from "next/server";
import { Card, PageTitle, Stat, td, th } from "@/components/ui";
import { loadMarket, pool } from "@/lib/data";
import { dateLabel } from "@/lib/format";
import { runHealth, type Check } from "../../../src/lib/health";

const mark = (c: Check) => (!c.ok ? "❌" : c.warn ? "⚠️" : "✅");
const when = (d: Date) =>
  new Date(d).toLocaleString("en-AU", { timeZone: "Asia/Makassar", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function CollectionPage() {
  await connection();
  const q = (text: string, params?: unknown[]) => pool.query(text, params);
  const [m, live, { rows: history }, { rows: runs }] = await Promise.all([
    loadMarket(),
    runHealth(q),
    q("select checked_at, ok, checks, healed from health_checks order by checked_at desc limit 20"),
    q("select job, ran_at, ok, detail from job_runs order by ran_at desc limit 1"),
  ]);
  const withPrices = m.stats.filter((s) => s.priceSamples.length).length;

  return (
    <>
      <PageTitle sub="Checked automatically twice a day (11:00 and 17:00 Lombok). Problems email you and re-run collection by themselves.">
        Collection
      </PageTitle>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title={live.ok ? "✅ Everything is working right now" : "❌ Something needs attention right now"}>
          <table className="w-full text-sm">
            <tbody>
              {live.checks.map((c) => (
                <tr key={c.name} className="border-b border-line last:border-0">
                  <td className="w-6 py-1.5">{mark(c)}</td>
                  <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{c.name}</td>
                  <td className="py-1.5 text-muted">{c.detail}</td>
                </tr>
              ))}
              {runs[0] && (
                <tr>
                  <td className="w-6 py-1.5">{runs[0].ok ? "✅" : "❌"}</td>
                  <td className="py-1.5 pr-3 font-medium whitespace-nowrap">Calendar sync</td>
                  <td className="py-1.5 text-muted">
                    {runs[0].detail} ({when(runs[0].ran_at)})
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <Card title="Automatic checks" note="Each row is one scheduled check, newest first. Lombok time.">
          {history.length === 0 ? (
            <p className="text-sm text-muted">The first scheduled check runs at 11:00 Lombok time.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {history.map((h) => {
                  const bad = (h.checks as Check[]).filter((c) => !c.ok);
                  return (
                    <tr key={String(h.checked_at)} className="border-b border-line last:border-0">
                      <td className="w-6 py-1.5">{h.ok ? "✅" : "❌"}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{when(h.checked_at)}</td>
                      <td className="py-1.5 text-muted">
                        {h.ok ? `all ${(h.checks as Check[]).length} checks passed` : bad.map((c) => `${c.name}: ${c.detail}`).join(" · ")}
                        {h.healed ? " · collection re-run automatically" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Latest snapshot" value={m.date ? dateLabel(m.date) : "–"} />
        <Stat label="Calendars collected" value={`${m.calendarsCollected} / ${m.stats.length}`} />
        <Stat label="Check-in dates priced" value={m.priceDates.length} sub="about 180 per full run" />
        <Stat label="Listings with a price" value={withPrices} />
      </div>
      <Card title="Snapshot history">
        <table className="tabular w-full text-sm">
          <thead className="border-b border-line">
            <tr>
              <th className={th}>Date</th>
            </tr>
          </thead>
          <tbody>
            {[...m.dates].reverse().map((d) => (
              <tr key={d} className="border-b border-line last:border-0">
                <td className={td}>{dateLabel(d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
