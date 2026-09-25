// Shared by the collector and the dashboard; keep free of Node-only code.

// Beach centres from OpenStreetMap (Nominatim), west to east.
// Each listing is labelled with the nearest one; check the result on the dashboard's Map page.
export const AREAS = [
  { name: "Serangan", lat: -8.8594, lng: 116.1369 }, // Torok / Serangan
  { name: "Selong Belanak", lat: -8.8701, lng: 116.1607 },
  { name: "Mawi", lat: -8.8835, lng: 116.1598 },
  { name: "Tampah", lat: -8.9024, lng: 116.2 },
  { name: "Mawun", lat: -8.9022, lng: 116.2323 },
  { name: "Are Guling", lat: -8.905, lng: 116.2434 },
  { name: "Kuta", lat: -8.8958, lng: 116.2892 },
  { name: "Gerupuk", lat: -8.9109, lng: 116.3443 },
] as const;
