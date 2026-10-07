// Shapes shared by the server loader and the interactive Explore page.

export type ExploreListing = {
  /** Airbnb listings have full calendars; Booking.com-only places are built from the dates searched. */
  platform: "airbnb" | "booking";
  url: string;
  id: string;
  name: string;
  area: string;
  kind: string; // "Villa in Praya Barat"
  bedrooms: number | null;
  rating: string | null; // "4.93 (76)"
  beds: string; // bedroom group: "1" | "2" | "3" | "4+"
  bookingSlug: string | null; // also on Booking.com: booking.com/hotel/id/<slug>.html
  dormant: boolean;
  firstSeen: string; // when we first found it, YYYY-MM-DD
  /** One char per night from ExploreData.from: "1" open, "c" open no check-in, "0" blocked, "?" unknown. */
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

export type BookingListing = {
  id: string;
  name: string;
  area: string;
  bedrooms: number | null;
  beds: string;
  rating: string | null; // out of 10
  slug: string;
  airbnbId: string | null; // the same place on Airbnb, if matched
  firstSeen: string;
};

export type ExploreData = {
  snapshot: string; // date the calendars were collected
  from: string; // day index 0
  days: number;
  areas: string[]; // west to east
  listings: ExploreListing[];
  /** Per-night price samples: dayIndex -> [listingIndex, perNight][] */
  prices: Record<number, [number, number][]>;
  /** Nights with no price now (booked): the last price seen while still open. dayIndex -> [listingIndex, perNight, seenOn][] */
  wasPrices: Record<number, [number, number, string][]>;
  /** Likely bookings detected since the previous snapshot: dayIndex -> listing indexes newly booked that night */
  newBookings: Record<number, number[]>;
  comparedTo: string | null;
  events: MarketEvent[];
  booking: {
    snapshot: string | null;
    listings: BookingListing[];
    /** Sampled check-in dayIndex -> [bookingListingIndex, perNight incl. taxes][] (places open that night). */
    prices: Record<number, [number, number][]>;
    /** Last price seen before a night stopped being available. */
    wasPrices: Record<number, [number, number, string][]>;
    /** Day indexes searched on Booking.com in the latest collection. */
    checked: number[];
    /** Booking.com price ÷ Airbnb price for the same place and night (median of places on both). */
    ratio: number;
  };
  /** Competitor websites: a rate and availability for every night. */
  web: {
    listings: { id: string; name: string; area: string; beds: string; url: string; nights: string }[];
    /** dayIndex -> [webListingIndex, perNight incl. taxes][] (open nights only). */
    prices: Record<number, [number, number][]>;
    /** Last price seen before a night sold out. */
    wasPrices: Record<number, [number, number, string][]>;
  };
  watched: string[]; // "platform:id" for every listing on the watchlist
  audRate: number; // IDR per AUD
  rateDate: string;
};
