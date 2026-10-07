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

## Villa: pricing engine, central calendar, assistant

- `properties` holds the villa (draft Mulai Villa: 4 bed, double-storey, Twin Peaks / Serangan beach (map point = Serangan
  area centre until an exact pin), position 0.65, min Rp 2.5m, max Rp 15m, `settings.reviews` = 0 so it's held at the
  comparable median until 5 reviews; `draft = true` until the owner confirms on /pricing).
- Engine: `src/pricing/engine.ts` (pure, tested in `engine.test.ts`), inputs from `src/pricing/load.ts`
  (comparable villas = live places on all sites by distance + bedrooms, closed-all-year ones excluded; trailing closed
  calendar nights count as unknown, not booked), saved by
  `src/pricing/run.ts` into `price_recommendations` (+ `price_history`). Runs nightly in `npm run finish` and on
  every change from the website. The nightly run moves each night at most 10% a day beyond 14 days out (`MAX_DAILY_MOVE`);
  website changes apply in full. Overrides in `rate_overrides` win; min/max clamp otherwise.
- Calendar: `reservations` (sources airbnb/booking/direct/manual/block). `src/lib/calendar-sync.ts` imports each
  channel's iCal export (every 20 min: `.github/workflows/calendar-sync.yml`), cancels vanished events, flags
  overlaps. Feeds for the channels: `/api/ical/<ical_token>/{airbnb,booking,all}.ics` (exempt from the password;
  each channel's feed omits its own stays). Tested end to end with a temporary property (see git history).
- Prices can't be pushed to Airbnb/Booking.com (no public API): options are a channel manager API or copying.
- Assistant: `web/lib/assistant.ts` + `/api/assistant`, Claude Opus 5 with `fallbacks: "default"`; read-only tools
  plus propose_* tools whose proposals render Apply buttons (nothing changes without a tap). Needs
  `ANTHROPIC_API_KEY` in Vercel env. `/api/assistant-selftest` (dev only) runs the loop with a scripted model.
- Shared code between collector and website must be dependency-free with extensionless relative imports
  (`src/lib/sql.ts`, `ical.ts`, `calendar-sync.ts`, `env.ts`, `src/pricing/*`), taking a `Query` function.
- Database connections use Supabase's transaction pooler (port 6543, rewritten in `src/lib/env.ts`); the session
  pooler's 15-client cap broke the parallel nightly jobs.

## Monitoring
- `.github/workflows/health.yml` (03:00 + 09:00 UTC): `npm run health` (checks in `src/lib/health.ts`, tested in
  `health.test.ts`), re-runs the nightly job if collection is missing, opens/closes a `health`-labelled GitHub issue
  (emails the owner), and re-enables the schedules. Results in `health_checks`; `/collection` shows them; the header shows
  a red badge on failure or if checks stop. `/api/health` is public (pass/fail only).
- `.github/workflows/test.yml`: tests + type-checks on every push.
- `listing_reviews`: daily rating + review count per place (from `npm run finish`; Airbnb ratings refreshed by `prices`).

## Next
1. Owner: confirm villa details on /pricing; paste Airbnb/Booking.com export links on /calendar and our feed links
   into both sites; add ANTHROPIC_API_KEY to switch on the assistant.
2. Direct booking website + payments (Xendit/Midtrans or Stripe) writing `reservations` with source 'direct'.
3. Pushing prices to OTAs via a channel manager API, if wanted.
