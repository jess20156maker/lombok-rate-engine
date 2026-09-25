# Handoff (2026-09-25)

## Proven working
- Airbnb search by map area (prices, IDs, GPS, bedrooms) via plain HTTP (`src/airbnb/client.ts`)
- Airbnb 12-month availability calendar, 1 request per listing (`PdpAvailabilityCalendar`)
- Booking.com search works in a real browser (AWS WAF JS check blocks plain HTTP → needs Playwright).
  The Booking property calendar has no per-day availability → sample prices and availability with date-based searches instead.

## Built
- `src/config.ts` market bbox + beach areas (approximate centres)
- `src/jobs/discover.ts` sweeps the market, auto-splits tiles, saves listings + tiles
- `src/analysis/changes.ts` infers bookings from yesterday-vs-today calendar diffs

## Next
1. DONE `src/jobs/daily.ts`: calendars for all listings → snapshot → diffCalendars → events; price sampling over tiles.json
2. Run `npm run discover` once, sanity-check counts per area
3. Airtable sync (summaries only; see note below)
4. Booking.com collector (Playwright)
5. Pricing engine → booking site

## Database
Supabase (Postgres), project in ap-south-1 (Mumbai), Session pooler URL in .env (web/.env.local symlinks it).
Schema: db/schema.sql (`npm run db:migrate`); RLS on with no policies = public API locked out.
Collector writes data/ files (resumable), then `daily` syncs that day to Supabase (`npm run sync` does it by hand).
Dashboard reads Supabase only.

## First run (2026-09-25)
Discovery: 959 entire-home Airbnb listings (Kuta 708, Selong Belanak 130, Gerupuk 50, Mawun 45,
Are Guling 19, Mawi 6, Serangan 1, Tampah 0). The Tampah/Serangan centroids in config.ts need checking.

## Dashboard (web/, Next.js 16)
`cd web && npx next dev --port 3100` → Market, Listings (+ per-listing 12-month calendar), Map, Collection.
Reads ../data through web/lib/data.ts, the only file to change when moving to Supabase.
Beach centres fixed from OpenStreetMap on 2026-09-25 (src/areas.ts); `npm run relabel` re-assigns areas.
