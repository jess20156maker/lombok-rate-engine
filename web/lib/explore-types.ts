// Shapes shared by the server loader and the interactive Explore page.

export type ExploreListing = {
  id: string;
  name: string;
  area: string;
  beds: string; // bedroom group: "1" | "2" | "3" | "4+"
  dormant: boolean;
  /** One char per night from ExploreData.from: "1" open, "c" open no check-in, "0" blocked. */
  nights: string;
  /** Minimum stay where it changes, as [dayIndex, nights]. */
  minStay: [number, number][];
};

export type MarketEvent = {
  name: string;
  category: "event" | "holiday" | "school-holiday" | "season";
  start: string;
  end: string;
  markets: string[];
  impact: "high" | "medium" | "low";
  why: string;
  confidence: "confirmed" | "estimated" | "general";
  source?: string;
  /** Most periods raise demand; a few (Ramadan, wet season) lower it. */
  effect?: "up" | "down";
};

export type ExploreData = {
  snapshot: string; // date the calendars were collected
  from: string; // day index 0
  days: number;
  areas: string[]; // west to east
  listings: ExploreListing[];
  /** Per-night price samples: dayIndex -> [listingIndex, perNight][] */
  prices: Record<number, [number, number][]>;
  /** Likely bookings detected since the previous snapshot: dayIndex -> listing indexes newly booked that night */
  newBookings: Record<number, number[]>;
  comparedTo: string | null;
  events: MarketEvent[];
};
