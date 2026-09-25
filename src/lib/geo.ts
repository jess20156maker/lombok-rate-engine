import { AREAS, type BBox } from "../config.js";

export function nearestArea(lat: number, lng: number): string {
  let best: string = AREAS[0].name;
  let bestD = Infinity;
  for (const a of AREAS) {
    const d = (a.lat - lat) ** 2 + (a.lng - lng) ** 2;
    if (d < bestD) [best, bestD] = [a.name, d];
  }
  return best;
}

export function quarter(b: BBox): BBox[] {
  const midLat = (b.north + b.south) / 2;
  const midLng = (b.east + b.west) / 2;
  return [
    { north: b.north, east: midLng, south: midLat, west: b.west },
    { north: b.north, east: b.east, south: midLat, west: midLng },
    { north: midLat, east: midLng, south: b.south, west: b.west },
    { north: midLat, east: b.east, south: b.south, west: midLng },
  ];
}
