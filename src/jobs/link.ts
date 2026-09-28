// Find properties listed on both Airbnb and Booking.com, so the dashboard can
// count them once and compare their prices across platforms.
//
//   npm run link

import "dotenv/config";
import { db, upsert } from "../lib/db.js";

// Words every listing uses; they say nothing about which property it is.
const GENERIC = new Set(
  (
    "villa villas lombok selong belanak kuta mawun mawi gerupuk tampah serangan torok are guling beach private pool " +
    "bedroom bedrooms br bed room rooms with the and by in at near to of a an ocean sea view views luxury luxurious " +
    "new tropical house home apartment studio entire walk walking min mins minutes from garden family indonesia " +
    "one two three four five 1 2 3 4 5 1br 2br 3br 4br 5br bdr bdrm & | - ·"
  ).split(" "),
);

function tokens(name: string) {
  return new Set(
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !GENERIC.has(w)),
  );
}

function nameMatch(a: string, b: string) {
  const x = tokens(a);
  const y = tokens(b);
  const shortest = Math.min(x.size, y.size);
  const shared = shortest ? [...x].filter((w) => y.has(w)).length : 0;
  // Overlap relative to the shorter name.
  return { score: shortest ? shared / shortest : 0, shared, shortest };
}

function metres(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dLat = (aLat - bLat) * 111_320;
  const dLng = (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

export async function linkPlatforms() {
  const { rows } = await db.query(
    "select platform, id, name, lat, lng, bedrooms from listings where active and platform in ('airbnb','booking')",
  );
  const air = rows.filter((r) => r.platform === "airbnb");
  const bk = rows.filter((r) => r.platform === "booking");

  // How many listings use each word: a word only a few places use ("Kirikan",
  // "Deia") is strong evidence two listings are the same property.
  const df = new Map<string, number>();
  for (const r of rows) for (const w of tokens(r.name)) df.set(w, (df.get(w) ?? 0) + 1);

  type Pair = { airbnb_id: string; booking_id: string; distance_m: number; name_score: number; rank: number };
  const pairs: Pair[] = [];
  for (const b of bk) {
    const bt = tokens(b.name);
    for (const a of air) {
      const d = metres(a.lat, a.lng, b.lat, b.lng);
      if (d > 500) continue;
      const { score: s, shared, shortest } = nameMatch(a.name, b.name);
      const rareShared = [...bt].filter((w) => tokens(a.name).has(w) && (df.get(w) ?? 0) <= 4).length;
      const sameBeds = a.bedrooms != null && a.bedrooms === b.bedrooms;
      const ok =
        // Two or more distinctive words in common ("Villa Deia" / "Villa Deia - Calm Oasis").
        (d <= 150 && shared >= 2 && s >= 0.5) ||
        // A one-word name that matches, with the same bedrooms ("Akarai Villa").
        (d <= 150 && shortest === 1 && shared === 1 && sameBeds) ||
        // A rare word in common and the same size nearby ("Kirikan Villas" / "Kirikan Villas - Jungle Paradise").
        (d <= 500 && rareShared >= 1 && sameBeds) ||
        // Essentially the same spot and the same size, whatever the names say.
        (d <= 30 && sameBeds);
      if (!ok) continue;
      const rank = s * 2 + rareShared + (sameBeds ? 0.5 : 0) + (1 - d / 500);
      pairs.push({ airbnb_id: a.id, booking_id: b.id, distance_m: Math.round(d), name_score: Math.round(s * 100) / 100, rank });
    }
  }
  // Most confident pairs first, each listing used once.
  pairs.sort((x, y) => y.rank - x.rank);
  const usedA = new Set<string>();
  const usedB = new Set<string>();
  const links: Omit<Pair, "rank">[] = [];
  for (const { rank: _rank, ...p } of pairs) {
    if (usedA.has(p.airbnb_id) || usedB.has(p.booking_id)) continue;
    usedA.add(p.airbnb_id);
    usedB.add(p.booking_id);
    links.push(p);
  }

  await db.query("delete from listing_links");
  await upsert("listing_links", ["airbnb_id", "booking_id"], links);
  console.log(`Linked ${links.length} places listed on both Airbnb and Booking.com`);
  return links.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await linkPlatforms();
  await db.end();
}
