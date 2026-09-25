// Direct price checks for watched villas.
//
// Busy villas rarely show up in the market-wide price sampling (they're booked),
// so for each watched villa we search a tiny map box around it with specific
// dates: if it's open, the result carries its exact price for that stay.
//
//   npm run watch            (also runs at the end of `npm run daily`)

import "dotenv/config";
import { search } from "../airbnb/client.js";
import { decode, type StoredCalendar } from "../lib/calendar-codec.js";
import { addDays, today } from "../lib/dates.js";
import { db, upsert } from "../lib/db.js";
import { listings as registry, readJson } from "../lib/store.js";

// Every 2 days for the next month, then weekly out to 3 months.
function watchCheckins(date: string): string[] {
  const out: string[] = [];
  for (let d = 1; d <= 30; d += 2) out.push(addDays(date, d));
  for (let d = 35; d <= 91; d += 7) out.push(addDays(date, d));
  return out;
}

const BOX = 0.003; // ~330 m either side of the villa

export async function runWatch(date = today()) {
  const { rows } = await db.query("select listing_id from watchlist where platform = 'airbnb'");
  if (rows.length === 0) {
    console.log("Watchlist: empty");
    return;
  }
  const all = registry.load();
  const cals = readJson<Record<string, StoredCalendar>>(`snapshots/${date}/airbnb-calendars.json`, {});

  for (const { listing_id: id } of rows) {
    const l = all[registry.key("airbnb", id)];
    const cal = cals[id] ? decode(cals[id]) : [];
    const byDate = new Map(cal.map((d) => [d.date, d]));
    const out: Record<string, unknown>[] = [];
    let priced = 0;

    for (const checkin of watchCheckins(date)) {
      const day = byDate.get(checkin);
      const nights = Math.max(2, day?.minNights ?? 2);
      const checkout = addDays(checkin, nights);
      // The calendar already says whether the stay is possible; don't search booked dates.
      const stayOpen =
        !!day?.checkin &&
        Array.from({ length: nights }, (_, i) => byDate.get(addDays(checkin, i))?.available ?? false).every(Boolean);
      const row = { snapshot_date: date, platform: "airbnb", listing_id: id, checkin, nights, available: false, total: null as number | null, nightly: null as number | null };

      if (stayOpen && l) {
        try {
          const box = { north: l.lat + BOX, south: l.lat - BOX, east: l.lng + BOX, west: l.lng - BOX };
          const hit = (await search(box, { checkin, checkout })).listings.find((x) => x.id === id);
          if (hit?.total != null) {
            Object.assign(row, { available: true, total: hit.total, nightly: hit.nightly });
            priced++;
          } else {
            continue; // open on the calendar but not returned: no reliable reading today
          }
        } catch (err) {
          console.warn(`  watch ${id} ${checkin}: ${(err as Error).message}`);
          continue;
        }
      }
      out.push(row);
    }
    await upsert("watch_prices", ["snapshot_date", "platform", "listing_id", "checkin", "nights"], out);
    console.log(`  watch ${l?.name?.slice(0, 40) ?? id}: ${priced} prices, ${out.length - priced} booked dates`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runWatch(process.argv[2]);
  await db.end();
}
