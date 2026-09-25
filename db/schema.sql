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
