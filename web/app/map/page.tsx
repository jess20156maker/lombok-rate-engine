import { connection } from "next/server";
import { ListingMap } from "@/components/listing-map";
import { PageTitle } from "@/components/ui";
import { loadMarket } from "@/lib/data";
import { AREAS } from "../../../src/areas";

export default async function MapPage() {
  await connection();
  const m = await loadMarket();
  const points = m.stats.map((s) => ({
    id: s.id,
    name: s.name,
    area: s.area,
    lat: s.lat,
    lng: s.lng,
    blocked30: s.blocked30,
    beds: s.bedrooms,
  }));
  return (
    <>
      <PageTitle sub="Colour = area (each listing is assigned to the nearest ✕). Darker = more of the next 30 nights blocked. Bigger = more bedrooms.">
        Map
      </PageTitle>
      <ListingMap points={points} areas={AREAS.map((a) => ({ ...a }))} />
    </>
  );
}
