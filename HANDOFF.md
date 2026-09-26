# Handoff

Last updated 2026-09-25. Built and owned by jess20156maker; code at
github.com/jess20156maker/lombok-rate-engine (private).

## What runs where

| Piece | Where | How |
|---|---|---|
| Airbnb + Booking.com collection | GitHub Actions, nightly 01:00 Lombok (17:00 UTC) | `.github/workflows/nightly.yml`: check-env, hydrate, daily, Booking.com |
| New/removed listing sweep | GitHub Actions, Sundays 00:00 Lombok | `.github/workflows/weekly-discover.yml` |
| Database | Supabase Postgres, ap-south-1 (Mumbai) | `db/schema.sql`, `npm run db:migrate`; RLS on, no policies (public API locked out) |
| Dashboard | https://lombok-rate-engine.vercel.app (Vercel team seqnce-ops = the user's personal Hobby account), auto-deploys on push to main; locally `cd web && npx next dev --port 3100` | Next.js 16 in `web/` (Vercel root dir `web`, source outside root on); password gate in `web/proxy.ts` via `DASHBOARD_PASSWORD` env; read `web/AGENTS.md` first |

Secrets: `DATABASE_URL` (Session pooler URI) in `.env` locally (web/.env.local symlinks it) and as a GitHub
Actions secret. Never print it. Code strips invisible characters from it (`src/lib/env.ts`).
Vercel CLI for the personal account: `./tools/vercel` (config in ~/.config/vercel-personal). The Vercel MCP connector can't see this project.
GitHub CLI for the personal account: `GH_CONFIG_DIR=~/.config/gh-personal ./tools/gh ...` (tools/ is gitignored).
Git remote uses SSH host alias `github-personal` (key `~/.ssh/id_ed25519_personal`).

## Collectors

**Airbnb** (`src/airbnb/client.ts`), plain HTTP:
- Search: `/s/Lombok/homes` with a map box; results embedded as JSON (`data-deferred-state-0`). 15 pages max,
  so discovery splits the market into tiles (`src/jobs/discover.ts`, tiles in `market_tiles`).
- Calendar: `PdpAvailabilityCalendar` persisted query, 12 months per call. If the hash stops working, open any
  listing in a browser, scroll to the calendar, and copy the new hash from the network tab.
- Bookings are inferred from day-to-day calendar diffs (`src/analysis/changes.ts`).
- Watchlist prices (`src/jobs/watch.ts`): a dated search of a ~330 m box around each starred villa.
  (The PDP BookIt query returns ValidationError for open dates without a browser session; the box search works.)

**Booking.com** (`src/booking/client.ts`), headless Chromium via Playwright:
- Plain HTTP is blocked by an AWS WAF JS challenge; a real browser passes it.
- Load one search page (lat/long in south Lombok; the radius is ignored and the whole region comes back),
  scroll so the page fires its `FullSearch` GraphQL POST, capture it, then replay it from inside the page with
  other dates and `rowsPerPage: 100`. ~368-420 entire places, 4 requests per date, ~3 min per night for 16 dates.
- Capture is occasionally flaky; `openSession` retries 5 times and opens on a date 6 weeks out.
- Prices INCLUDE taxes and fees (`price_samples.includes_taxes = true`); Airbnb's are before taxes.
- No per-listing calendar: occupancy = known places minus places open on sampled dates.
- `npm run booking -- --force` re-collects today's dates; the workflow has a `force_booking` input for that.

**Cross-platform matching** (`src/jobs/link.ts`): within 150 m and 2+ distinctive shared name words, or a
one-word name plus same bedrooms, or within 25 m with same bedrooms. Results in `listing_links`.

## Dashboard pages
- `/` Explore: filters (beach, bedrooms, window), year heatmap, day panel with plain-English insights
  (`web/lib/explore-calc.ts`), Airbnb vs Booking.com, top 10 per beach, months, events.
- `/watchlist`: starred villas with daily price checks and trends. `/listings`, `/listings/[id]`, `/map`,
  `/market` (tables), `/collection`.
- Data is cached in memory per snapshot (`web/lib/cache.ts`). Bump `PAYLOAD_VERSION` in `web/lib/explore.ts`
  when the Explore payload shape changes.
- Events calendar: `db/events.json` (65 researched entries with sources). Bau Nyale 2027 and Ramadan 2027 are
  estimates: update when official dates are announced (Bau Nyale is set in early Dec 2026).
- Currency: A$ and Rp both shown; ECB rate via frankfurter.dev (`web/lib/fx.ts`).

## Next
1. Pricing engine: rules on top of explore-calc signals (events, pace vs market, lead time, min-stay moves).
2. Booking site + booking engine (Next.js in web/, Supabase for bookings, iCal sync with OTAs).
