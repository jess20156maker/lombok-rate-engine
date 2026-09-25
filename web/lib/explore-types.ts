// Shapes shared by the server loader and the interactive Explore page.

export type ExploreListing = {
  id: string;
  name: string;
  area: string;
  kind: string; // "Villa in Praya Barat"
  bedrooms: number | null;
  rating: string | null; // "4.93 (76)"
  beds: string; // bedroom group: "1" | "2" | "3" | "4+"
  bookingSlug: string | null; // also on Booking.com: booking.com/hotel/id/<slug>.html
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

export type BookingListing = {
  id: string;
  name: string;
  area: string;
  beds: string;
  rating: string | null; // out of 10
  slug: string;
  airbnbId: string | null; // the same place on Airbnb, if matched
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
  booking: {
    snapshot: string | null;
    listings: BookingListing[];
    /** Sampled check-in dayIndex -> [bookingListingIndex, perNight incl. taxes][] (places open that night). */
    prices: Record<number, [number, number][]>;
  };
  watched: string[]; // listing ids on the watchlist
  audRate: number; // IDR per AUD
  rateDate: string;
};
