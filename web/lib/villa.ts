// Server-side data for the Pricing and Calendar pages.

import "server-only";
import { findConflicts, syncProperty } from "../../src/lib/calendar-sync";
import type { EventInput } from "../../src/pricing/engine";
import { loadMarketInput } from "../../src/pricing/load";
import { priceProperty } from "../../src/pricing/run";
import type { Query } from "../../src/lib/sql";
// Imported (not read from disk) so it ships with the deployed app.
import eventsFile from "../../db/events.json";
import { pool } from "./data";
import { MINUTE, cached } from "./cache";
import { audRate } from "./fx";

export const q: Query = (text, params) => pool.query(text, params);

/** Today in Lombok (UTC+8), matching the collector. */
export function lombokToday() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

export type PropertyRow = {
  id: string;
  name: string;
  area: string;
  bedrooms: number;
  position: number;
  min_rate: number;
  max_rate: number;
  base_min_stay: number;
  ical_token: string;
  airbnb_ical_url: string | null;
  booking_ical_url: string | null;
  draft: boolean;
};

export type Recommendation = {
  date: string;
  price: number;
  minStay: number;
  marketPrice: number | null;
  marketOcc: number | null;
  compCount: number | null;
  reasons: { kind: string; label: string; effect: number | null }[];
  computedAt: string;
};

export type Reservation = {
  id: string;
  source: string;
  checkin: string;
  checkout: string;
  guestName: string | null;
  status: string;
  total: number | null;
  notes: string | null;
};

export type Override = { date: string; price: number | null; minStay: number | null; note: string | null };

export async function loadProperty(id?: string): Promise<PropertyRow | null> {
  const { rows } = await pool.query(
    `select id, name, area, bedrooms, position, min_rate::float8 min_rate, max_rate::float8 max_rate, base_min_stay,
            ical_token, airbnb_ical_url, booking_ical_url, draft
       from properties ${id ? "where id = $1" : ""} order by created_at limit 1`,
    id ? [id] : [],
  );
  return rows[0] ?? null;
}

export async function loadVilla(id?: string) {
  const p = await loadProperty(id);
  if (!p) return null;
  const today = lombokToday();
  const [recs, res, ovs, fx] = await Promise.all([
    pool.query(
      `select date::text, price::float8 price, min_stay, market_price::float8 market_price, market_occ, comp_count, reasons, computed_at
         from price_recommendations where property_id = $1 and date >= $2 order by date`,
      [p.id, today],
    ),
    pool.query(
      `select id, source, checkin::text, checkout::text, guest_name, status, total::float8 total, notes
         from reservations where property_id = $1 and checkout >= ($2::date - 60) order by checkin`,
      [p.id, today],
    ),
    pool.query("select date::text, price::float8 price, min_stay, note from rate_overrides where property_id = $1 and date >= $2", [p.id, today]),
    audRate(),
  ]);
  const reservations: Reservation[] = res.rows.map((r) => ({
    id: r.id,
    source: r.source,
    checkin: r.checkin,
    checkout: r.checkout,
    guestName: r.guest_name,
    status: r.status,
    total: r.total,
    notes: r.notes,
  }));
  const confirmed = reservations.filter((r) => r.status === "confirmed");
  return {
    property: p,
    today,
    audRate: fx.rate,
    rateDate: fx.date,
    recommendations: recs.rows.map(
      (r): Recommendation => ({
        date: r.date,
        price: r.price,
        minStay: r.min_stay,
        marketPrice: r.market_price,
        marketOcc: r.market_occ,
        compCount: r.comp_count,
        reasons: r.reasons,
        computedAt: new Date(r.computed_at).toISOString(),
      }),
    ),
    reservations,
    overrides: ovs.rows.map((o): Override => ({ date: o.date, price: o.price, minStay: o.min_stay, note: o.note })),
    conflicts: findConflicts(
      confirmed.map((r) => ({ id: r.id, source: r.source, checkin: r.checkin, checkout: r.checkout, guest_name: r.guestName })),
    ).map(([a, b]) => [a.id, b.id] as [string, string]),
  };
}

export type Villa = NonNullable<Awaited<ReturnType<typeof loadVilla>>>;

export async function repriceProperty(id: string) {
  const p = await loadProperty(id);
  if (!p) throw new Error("No such property");
  const today = lombokToday();
  // The market side only changes when the nightly run lands; keep it for 30 minutes.
  const market = await cached(`market:${p.area}:${p.bedrooms}:${today}`, 30 * MINUTE, () => loadMarketInput(q, p, today));
  return priceProperty(q, p, today, eventsFile as EventInput[], market);
}

export async function syncNow(id: string) {
  return syncProperty(q, id, lombokToday());
}
