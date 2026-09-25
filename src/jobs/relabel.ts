// Re-assign every listing's area after changing src/areas.ts.
//
//   npm run relabel

import { nearestArea } from "../lib/geo.js";
import { listings } from "../lib/store.js";

const all = listings.load();
const counts: Record<string, number> = {};
for (const l of Object.values(all)) {
  l.area = nearestArea(l.lat, l.lng);
  if (l.active) counts[l.area] = (counts[l.area] ?? 0) + 1;
}
listings.save(all);
console.log(counts);
