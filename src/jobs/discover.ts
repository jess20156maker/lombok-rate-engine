// Sweep the whole market on Airbnb and update the listings registry.
// Runs daily before the nightly collection; new villas appear and old ones disappear constantly.
//
//   npm run discover

import "dotenv/config";
import { MARKET, type BBox } from "../config.js";
import { searchAll } from "../airbnb/client.js";
import { nearestArea, quarter } from "../lib/geo.js";
import { today } from "../lib/dates.js";
import { listings, writeJson } from "../lib/store.js";

const MAX_DEPTH = 5;

async function sweep(box: BBox, depth: number, found: Map<string, any>, leaves: BBox[]) {
  const { listings: page, hitCap } = await searchAll(box);
  // Airbnb shows a few listings just outside the map; keep only ones inside.
  const inside = page.filter(
    (l) => l.lat <= box.north && l.lat >= box.south && l.lng <= box.east && l.lng >= box.west,
  );
  console.log(`${"  ".repeat(depth)}tile depth ${depth}: ${inside.length} listings${hitCap ? " (capped, splitting)" : ""}`);
  for (const l of inside) found.set(l.id, l);
  if (hitCap && depth < MAX_DEPTH) {
    for (const sub of quarter(box)) await sweep(sub, depth + 1, found, leaves);
  } else if (inside.length > 0) {
    leaves.push(box);
  }
}

const found = new Map();
const leaves: BBox[] = [];
await sweep(MARKET, 0, found, leaves);
// The daily price sampling searches these same tiles.
writeJson("tiles.json", leaves);

const date = today();
const all = listings.load();
const seen = new Set<string>();
for (const l of found.values()) {
  const key = listings.key("airbnb", l.id);
  seen.add(key);
  all[key] = {
    platform: "airbnb",
    id: l.id,
    name: l.name,
    kind: l.kind,
    area: nearestArea(l.lat, l.lng),
    lat: l.lat,
    lng: l.lng,
    bedrooms: l.bedrooms,
    rating: l.rating,
    firstSeen: all[key]?.firstSeen ?? date,
    lastSeen: date,
    active: true,
  };
}
// Searches miss a few places on any given day; retire only those not seen by
// the sweep or the nightly price searches for a week.
const weekAgo = new Date(Date.parse(date) - 7 * 86_400_000).toISOString().slice(0, 10);
for (const [key, l] of Object.entries(all)) {
  if (l.platform === "airbnb" && !seen.has(key) && l.lastSeen < weekAgo) l.active = false;
}
listings.save(all);

const byArea: Record<string, number> = {};
for (const l of Object.values(all)) if (l.active) byArea[l.area] = (byArea[l.area] ?? 0) + 1;
console.log(`\n${found.size} Airbnb listings in market`, byArea);

if (process.env.DATABASE_URL) {
  const { syncListings, syncTiles } = await import("./sync.js");
  const { db } = await import("../lib/db.js");
  await syncListings();
  await syncTiles();
  await db.end();
}
