// Market definition: the south-west Lombok coast from Serangan to Gerupuk.

export type BBox = { north: number; east: number; south: number; west: number };

// Whole market. Discovery splits this into tiles automatically when a tile
// has more listings than one Airbnb search will page through (~270).
export const MARKET: BBox = { north: -8.83, east: 116.37, south: -8.95, west: 116.02 };

export { AREAS } from "./areas.js";

export const CURRENCY = "IDR";

// Only whole-property rentals compete with a private villa.
export const AIRBNB_ROOM_TYPE = "Entire home/apt";

// Politeness: pause between requests so we look like one person browsing.
export const REQUEST_DELAY_MS = { min: 1500, max: 4000 };

// Price sampling: which check-in dates to price each day (2-night stays).
// Dense for the next month (where pricing moves), weekly out to 6 months.
export const PRICE_SAMPLE = {
  nights: 2,
  denseDays: 30,
  denseStep: 3,
  sparseUntilDays: 180,
  sparseStep: 7,
};

export const DATA_DIR = process.env.DATA_DIR ?? new URL("../data/", import.meta.url).pathname;
