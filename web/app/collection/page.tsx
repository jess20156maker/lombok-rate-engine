import { connection } from "next/server";
import { Card, PageTitle, Stat, td, th } from "@/components/ui";
import { loadMarket } from "@/lib/data";
import { dateLabel } from "@/lib/format";

export default async function CollectionPage() {
  await connection();
  const m = await loadMarket();
  const withPrices = m.stats.filter((s) => s.priceSamples.length).length;

  return (
    <>
      <PageTitle sub="Is the collector healthy? Check this if numbers look off.">Collection</PageTitle>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Latest snapshot" value={m.date ? dateLabel(m.date) : "–"} />
        <Stat label="Calendars collected" value={`${m.calendarsCollected} / ${m.stats.length}`} />
        <Stat label="Check-in dates priced" value={m.priceDates.length} sub="31 per full run" />
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
