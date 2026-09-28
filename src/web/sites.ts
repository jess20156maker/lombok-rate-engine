// Competitor websites tracked directly (places not on Airbnb or Booking.com).
// Each site names an adapter that knows how to read its rates.

export type TrackedRoom = { slug: string; name: string; bedrooms: number };
export type TrackedSite = {
  id: string; // stable prefix for listing ids
  name: string;
  area: string; // beach, as in src/areas.ts
  lat: number;
  lng: number;
  adapter: "next-calendar";
  /** Room page URL for a room slug. */
  roomUrl: (slug: string) => string;
  rooms: TrackedRoom[];
};

export const SITES: TrackedSite[] = [
  {
    id: "bonibeach",
    name: "Boni Beach",
    area: "Selong Belanak",
    lat: -8.8680141,
    lng: 116.1402682,
    adapter: "next-calendar",
    roomUrl: (slug) => `https://www.bonibeach.com/luxury-hotel-rooms-lombok/${slug}`,
    rooms: [
      { slug: "pool-side-suites", name: "Pool Side Suite", bedrooms: 1 },
      { slug: "bungalow", name: "Bungalow", bedrooms: 1 },
      { slug: "deluxe-bungalow", name: "Deluxe Bungalow", bedrooms: 1 },
    ],
  },
];
