// Collect rates and availability from competitor websites (src/web/sites.ts).
// Runs nightly in the collect job; each room type becomes a 'web' listing with
// a calendar snapshot and a price for every open night.
//
//   npm run websites

import "dotenv/config";
import { readNextCalendar } from "../web/next-calendar.js";
import { SITES } from "../web/sites.js";
import { today } from "../lib/dates.js";
import { db, upsert } from "../lib/db.js";

const date = today();
let failures = 0;

for (const site of SITES) {
  for (const room of site.rooms) {
    const id = `${site.id}:${room.slug}`;
    const url = site.roomUrl(room.slug);
    try {
      const { currency, days } = await readNextCalendar(url);
      const future = days.filter((d) => d.date >= date).sort((a, b) => a.date.localeCompare(b.date));
      if (!future.length) throw new Error("calendar has no future dates");

      await db.query(
        `insert into listings (platform, id, name, kind, area, lat, lng, bedrooms, rating, slug, first_seen, last_seen, active)
         values ('web', $1, $2, $3, $4, $5, $6, $7, null, $8, $9, $9, true)
         on conflict (platform, id) do update set name = excluded.name, kind = excluded.kind, area = excluded.area,
           lat = excluded.lat, lng = excluded.lng, bedrooms = excluded.bedrooms, slug = excluded.slug,
           last_seen = excluded.last_seen, active = true`,
        [id, `${site.name}: ${room.name}`, "Hotel room (own website)", site.area, site.lat, site.lng, room.bedrooms, url, date],
      );

      // One character per night from the first date: 0 sold out, c open but no arrival, 1 open.
      // Fill any gap in the site's list as unknown-but-open so positions stay aligned.
      const byDate = new Map(future.map((d) => [d.date, d]));
      let nights = "";
      for (let t = Date.parse(future[0].date); t <= Date.parse(future.at(-1)!.date); t += 86_400_000) {
        const d = byDate.get(new Date(t).toISOString().slice(0, 10));
        nights += !d ? "1" : d.soldOut ? "0" : d.closedToArrival ? "c" : "1";
      }
      await upsert("calendar_snapshots", ["snapshot_date", "platform", "listing_id"], [
        { snapshot_date: date, platform: "web", listing_id: id, from_date: future[0].date, nights, min_stay: "[]" },
      ]);

      if (currency !== "IDR") throw new Error(`rates are in ${currency}, expected IDR`);
      const open = future.filter((d) => !d.soldOut && d.rate != null);
      await upsert(
        "price_samples",
        ["snapshot_date", "platform", "listing_id", "checkin", "nights"],
        open.map((d) => ({
          snapshot_date: date,
          platform: "web",
          listing_id: id,
          checkin: d.date,
          nights: 1,
          total: d.rate,
          nightly: d.rate,
          includes_taxes: true,
        })),
      );
      await upsert(
        "price_sample_dates",
        ["snapshot_date", "platform", "checkin"],
        future.map((d) => ({ snapshot_date: date, platform: "web", checkin: d.date })),
      );
      const sold = future.filter((d) => d.soldOut).length;
      console.log(`${site.name} ${room.name}: ${future.length} nights, ${sold} sold out, ${open.length} priced`);
    } catch (err) {
      failures++;
      console.warn(`${site.name} ${room.name}: FAILED (${(err as Error).message})`);
    }
  }
}

await db.end();
if (failures) process.exitCode = 1;
