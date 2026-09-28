import { connection } from "next/server";
import { ListingMap } from "@/components/listing-map";
import { PageTitle } from "@/components/ui";
import { loadMarket, pool } from "@/lib/data";
import { loadExplore } from "@/lib/explore";
import { AREAS } from "../../../src/areas";

export default async function MapPage() {
  await connection();
  const [m, explore, bk] = await Promise.all([
    loadMarket(),
    loadExplore(),
    // Places only on Booking.com (ones also on Airbnb are already on the map).
    pool.query(
      `select id, lat, lng from listings where platform = 'booking' and active
          and id not in (select booking_id from listing_links)`,
    ),
  ]);
  const points = m.stats.map((s) => ({
    id: s.id,
    name: s.name,
    area: s.area,
    lat: s.lat,
    lng: s.lng,
    blocked30: s.blocked30,
    beds: s.bedrooms,
    url: `/listings/${s.id}`,
    platform: "Airbnb",
  }));
  const byId = new Map((explore?.listings ?? []).filter((l) => l.platform === "booking").map((l) => [l.id, l]));
  for (const r of bk.rows) {
    const l = byId.get(r.id);
    if (!l) continue;
    const known = [...l.nights.slice(0, 30)].filter((c) => c !== "?");
    points.push({
      id: `b${r.id}`,
      name: l.name,
      area: l.area,
      lat: r.lat,
      lng: r.lng,
      blocked30: known.length ? known.filter((c) => c === "0").length / known.length : null,
      beds: l.bedrooms,
      url: l.url,
      platform: "Booking.com",
    });
  }
  return (
    <>
      <PageTitle sub="Airbnb and Booking.com (places on both shown once). Colour = area (nearest ✕). Darker = more of the next 30 nights booked. Bigger = more bedrooms.">
        Map
      </PageTitle>
      <ListingMap points={points} areas={AREAS.map((a) => ({ ...a }))} />
    </>
  );
}
