-- Lombok Rate Engine schema. Safe to re-run: `npm run db:migrate`.
--
-- Row level security is enabled on every table with no policies, which shuts
-- Supabase's public REST API out completely. The collector and dashboard connect
-- as the database owner, which bypasses RLS.

create table if not exists listings (
  platform    text not null,               -- 'airbnb' | 'booking'
  id          text not null,
  name        text not null default '',
  kind        text not null default '',    -- "Villa in Praya Barat"
  area        text not null,
  lat         double precision not null,
  lng         double precision not null,
  bedrooms    smallint,
  rating      text,
  first_seen  date not null,
  last_seen   date not null,
  active      boolean not null default true,
  primary key (platform, id)
);

-- One row per listing per collection day: the whole forward calendar,
-- one character per night starting at from_date ('1' open, 'c' open but no
-- check-in, '0' blocked). About 400 bytes a row.
create table if not exists calendar_snapshots (
  snapshot_date date not null,
  platform      text not null,
  listing_id    text not null,
  from_date     date not null,
  nights        text not null,
  min_stay      jsonb not null default '[]', -- [[date, nights], ...] where it changes
  primary key (snapshot_date, platform, listing_id)
);

-- Prices found by searching with dates. Missing rows mean "not available then".
create table if not exists price_samples (
  snapshot_date date not null,
  platform      text not null,
  listing_id    text not null,
  checkin       date not null,
  nights        smallint not null,
  total         bigint not null,   -- IDR, after discounts, before taxes
  nightly       bigint,            -- IDR, listed nightly rate before discounts
  primary key (snapshot_date, platform, listing_id, checkin, nights)
);
create index if not exists price_samples_listing on price_samples (platform, listing_id, checkin);

-- Which check-in dates were fully searched on a given day (so gaps are meaningful).
create table if not exists price_sample_dates (
  snapshot_date date not null,
  platform      text not null,
  checkin       date not null,
  primary key (snapshot_date, platform, checkin)
);

-- Inferred from comparing consecutive calendar snapshots.
create table if not exists calendar_changes (
  snapshot_date date not null,
  compared_to   date not null,
  platform      text not null,
  listing_id    text not null,
  kind          text not null,     -- 'booking' | 'owner-block' | 'reopened'
  checkin       date not null,
  nights        smallint not null,
  lead_days     smallint not null,
  primary key (snapshot_date, platform, listing_id, checkin, kind)
);
create index if not exists calendar_changes_listing on calendar_changes (platform, listing_id);

alter table listings           enable row level security;
alter table calendar_snapshots enable row level security;
alter table price_samples      enable row level security;
alter table price_sample_dates enable row level security;
alter table calendar_changes   enable row level security;

-- Map tiles from the last discovery sweep; the daily price sampling searches these.
create table if not exists market_tiles (
  platform text not null,
  north    double precision not null,
  east     double precision not null,
  south    double precision not null,
  west     double precision not null,
  primary key (platform, north, east, south, west)
);
alter table market_tiles enable row level security;

-- Villas you've starred to follow closely.
create table if not exists watchlist (
  platform   text not null,
  listing_id text not null,
  added_at   timestamptz not null default now(),
  note       text,
  primary key (platform, listing_id)
);
alter table watchlist enable row level security;

-- Daily direct price checks for watched villas: one row per check-in date looked at.
-- available = false means the villa was booked/blocked for that stay (no price).
create table if not exists watch_prices (
  snapshot_date date not null,
  platform      text not null,
  listing_id    text not null,
  checkin       date not null,
  nights        smallint not null,
  available     boolean not null,
  total         bigint,   -- IDR, after discounts, before taxes
  nightly       bigint,   -- IDR, listed nightly rate before discounts
  primary key (snapshot_date, platform, listing_id, checkin, nights)
);
create index if not exists watch_prices_listing on watch_prices (platform, listing_id, checkin);
alter table watch_prices enable row level security;

-- Booking.com support.
alter table listings add column if not exists slug text; -- booking.com/hotel/id/<slug>.html
-- Booking.com shows prices with taxes and fees; Airbnb search prices are before taxes.
alter table price_samples add column if not exists includes_taxes boolean not null default false;

-- The same property listed on both platforms (matched by location and name).
create table if not exists listing_links (
  airbnb_id   text not null,
  booking_id  text not null,
  distance_m  real not null,
  name_score  real not null,
  primary key (airbnb_id, booking_id)
);
alter table listing_links enable row level security;

-- Compact price history: one row per listing per collection day, instead of one
-- row per check-in date. per_night[k] is the per-night price for a stay starting
-- from_date + k (null = not open / not found). `npm run finish` moves days older
-- than the last few out of price_samples into here.
create table if not exists price_grid (
  snapshot_date  date not null,
  platform       text not null,
  listing_id     text not null,
  nights         smallint not null,
  from_date      date not null,
  per_night      int[] not null,
  includes_taxes boolean not null default false,
  primary key (snapshot_date, platform, listing_id, nights)
);
create index if not exists price_grid_listing on price_grid (platform, listing_id);
alter table price_grid enable row level security;

-- ============================================================================
-- Your villa: pricing engine + central calendar
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists properties (
  id              text primary key,                 -- slug, e.g. 'mulai-villa'
  name            text not null,
  area            text not null,                    -- beach, as in src/areas.ts
  bedrooms        smallint not null,
  lat             double precision,
  lng             double precision,
  -- Where the villa sits in its comparable set: 0.5 = median, 0.75 = upper quartile.
  position        real not null default 0.6,
  min_rate        bigint not null,                  -- IDR per night, never price below
  max_rate        bigint not null,                  -- IDR per night, never price above
  base_min_stay   smallint not null default 2,
  settings        jsonb not null default '{}',      -- optional engine tweaks
  -- Calendar sync. ical_token keeps the export link unguessable.
  ical_token      text not null default encode(gen_random_bytes(18), 'hex'),
  airbnb_ical_url  text,                            -- Airbnb's "export calendar" link
  booking_ical_url text,                            -- Booking.com's "export calendar" link
  draft           boolean not null default true,    -- true until the owner confirms the details
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table properties enable row level security;

-- Every stay or block, from every channel, in one place.
create table if not exists reservations (
  id            uuid primary key default gen_random_uuid(),
  property_id   text not null references properties(id) on delete cascade,
  source        text not null,          -- 'direct' | 'airbnb' | 'booking' | 'manual' | 'block'
  external_uid  text,                   -- the channel's own event id (iCal UID)
  checkin       date not null,
  checkout      date not null,          -- the morning they leave (not a night stayed)
  guest_name    text,
  status        text not null default 'confirmed',  -- 'confirmed' | 'cancelled'
  total         bigint,                 -- IDR, when known
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (checkout > checkin)
);
-- Unique per channel event. (Rows without an external_uid, e.g. direct bookings,
-- never collide: NULLs are distinct.) Not a partial index, so ON CONFLICT can use it.
drop index if exists reservations_external;
create unique index if not exists reservations_external_uid on reservations (property_id, source, external_uid);
create index if not exists reservations_dates on reservations (property_id, checkin, checkout);
alter table reservations enable row level security;

-- Prices or minimum stays you set by hand win over the engine.
create table if not exists rate_overrides (
  property_id text not null references properties(id) on delete cascade,
  date        date not null,
  price       bigint,       -- IDR per night; null = let the engine decide the price
  min_stay    smallint,     -- null = let the engine decide
  note        text,
  primary key (property_id, date)
);
alter table rate_overrides enable row level security;

-- The engine's latest suggestion for every night, with its reasons.
create table if not exists price_recommendations (
  property_id   text not null references properties(id) on delete cascade,
  date          date not null,
  price         bigint not null,       -- IDR per night
  min_stay      smallint not null,
  market_price  bigint,                -- the comparable villas' reference price that night
  market_occ    real,                  -- share of comparable villas booked that night
  comp_count    int,
  reasons       jsonb not null default '[]',
  computed_at   timestamptz not null default now(),
  primary key (property_id, date)
);
alter table price_recommendations enable row level security;

-- One compact row per property per engine run, so you can see how prices moved.
create table if not exists price_history (
  property_id text not null references properties(id) on delete cascade,
  run_date    date not null,
  from_date   date not null,
  prices      bigint[] not null,       -- prices[k] = price for from_date + k
  primary key (property_id, run_date)
);
alter table price_history enable row level security;

-- ============================================================================
-- Monitoring
-- ============================================================================

-- One row per run of a scheduled job, so the health check can see it happened.
create table if not exists job_runs (
  job     text not null,
  ran_at  timestamptz not null default now(),
  ok      boolean not null,
  detail  text not null default '',
  primary key (job, ran_at)
);
alter table job_runs enable row level security;

-- The twice-daily health check's results (src/jobs/health.ts).
create table if not exists health_checks (
  checked_at timestamptz primary key default now(),
  ok         boolean not null,
  checks     jsonb not null,
  healed     text
);
alter table health_checks enable row level security;

-- Each villa's rating and review count, once a day. New reviews arrive after
-- stays, so a rising count is the best public sign of real bookings.
create table if not exists listing_reviews (
  snapshot_date date not null,
  platform      text not null,
  listing_id    text not null,
  rating        real,          -- Airbnb out of 5, Booking.com out of 10
  reviews       int not null,
  primary key (snapshot_date, platform, listing_id)
);
create index if not exists listing_reviews_listing on listing_reviews (platform, listing_id, snapshot_date);
alter table listing_reviews enable row level security;
