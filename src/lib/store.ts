// Raw data lives on disk as plain JSON: one folder per day, never overwritten
// once the day is complete. This is the permanent history; summaries go to Airtable.
//
//   data/listings.json                            registry of every listing ever seen
//   data/snapshots/<date>/airbnb-calendars.json   365-day availability per listing
//   data/snapshots/<date>/airbnb-prices.json      sampled stay prices
//   data/snapshots/<date>/airbnb-events.json      what changed since the previous snapshot

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.js";

export function readJson<T>(path: string, fallback: T): T {
  const full = join(DATA_DIR, path);
  return existsSync(full) ? (JSON.parse(readFileSync(full, "utf8")) as T) : fallback;
}

export function writeJson(path: string, value: unknown) {
  const full = join(DATA_DIR, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, JSON.stringify(value, null, 1));
}

/** Snapshot dates on disk, oldest first. */
export function snapshotDates(): string[] {
  const dir = join(DATA_DIR, "snapshots");
  return existsSync(dir) ? readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
}

export type Listing = {
  platform: "airbnb" | "booking";
  id: string;
  name: string;
  kind: string;
  area: string;
  lat: number;
  lng: number;
  bedrooms: number | null;
  rating: string | null;
  firstSeen: string;
  lastSeen: string;
  active: boolean; // false once it stops appearing in discovery
};

export const listings = {
  load: () => readJson<Record<string, Listing>>("listings.json", {}),
  save: (all: Record<string, Listing>) => writeJson("listings.json", all),
  key: (platform: string, id: string) => `${platform}:${id}`,
};
