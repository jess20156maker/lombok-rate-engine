"use server";

// Actions behind the Pricing and Calendar pages. Money arrives in IDR (the
// forms convert from A$), dates as YYYY-MM-DD.

import { refresh } from "next/cache";
import { pool } from "@/lib/data";
import { repriceProperty, syncNow } from "@/lib/villa";

const ID = /^[a-z0-9-]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AREAS = ["Serangan", "Selong Belanak", "Mawi", "Tampah", "Mawun", "Are Guling", "Kuta", "Gerupuk"];

function check(ok: boolean, msg: string): asserts ok {
  if (!ok) throw new Error(msg);
}

function eachDate(from: string, to: string) {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to) && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export type SettingsInput = {
  name: string;
  area: string;
  bedrooms: number;
  position: number;
  minRate: number;
  maxRate: number;
  baseMinStay: number;
  confirmed: boolean;
};

export async function saveSettings(id: string, s: SettingsInput) {
  check(ID.test(id), "Bad property");
  check(s.name.trim().length > 0 && s.name.length <= 80, "Name is required");
  check(AREAS.includes(s.area), "Unknown beach");
  check(Number.isInteger(s.bedrooms) && s.bedrooms >= 1 && s.bedrooms <= 12, "Bedrooms must be 1–12");
  check(s.position >= 0.05 && s.position <= 0.95, "Position out of range");
  check(s.minRate > 0 && s.maxRate > s.minRate, "Maximum must be above minimum");
  check(Number.isInteger(s.baseMinStay) && s.baseMinStay >= 1 && s.baseMinStay <= 14, "Minimum stay must be 1–14");
  await pool.query(
    `update properties set name = $2, area = $3, bedrooms = $4, position = $5, min_rate = $6, max_rate = $7,
            base_min_stay = $8, draft = $9, updated_at = now() where id = $1`,
    [id, s.name.trim(), s.area, s.bedrooms, s.position, Math.round(s.minRate), Math.round(s.maxRate), s.baseMinStay, !s.confirmed],
  );
  await repriceProperty(id);
  refresh();
}

export async function repriceNow(id: string) {
  check(ID.test(id), "Bad property");
  const r = await repriceProperty(id);
  refresh();
  return { nights: r.nights.length, comps: r.compCount };
}

/** Set a price and/or minimum stay for a range of nights (inclusive). */
export async function setOverride(id: string, from: string, to: string, price: number | null, minStay: number | null, note: string) {
  check(ID.test(id) && DATE.test(from) && DATE.test(to) && to >= from, "Bad dates");
  check(price == null || (price > 0 && price < 1e10), "Bad price");
  check(minStay == null || (Number.isInteger(minStay) && minStay >= 1 && minStay <= 30), "Bad minimum stay");
  check(price != null || minStay != null, "Set a price or a minimum stay");
  // All the dates in one statement.
  await pool.query(
    `insert into rate_overrides (property_id, date, price, min_stay, note)
     select $1, d, $3, $4, $5 from unnest($2::date[]) d
     on conflict (property_id, date) do update set price = excluded.price, min_stay = excluded.min_stay, note = excluded.note`,
    [id, eachDate(from, to), price == null ? null : Math.round(price), minStay, note.slice(0, 200) || null],
  );
  await repriceProperty(id);
  refresh();
}

export async function clearOverride(id: string, from: string, to: string) {
  check(ID.test(id) && DATE.test(from) && DATE.test(to), "Bad dates");
  await pool.query("delete from rate_overrides where property_id = $1 and date between $2 and $3", [id, from, to]);
  await repriceProperty(id);
  refresh();
}

export async function saveChannelLinks(id: string, airbnb: string, booking: string) {
  check(ID.test(id), "Bad property");
  const ok = (u: string) => u === "" || /^https:\/\/[^\s]+$/.test(u);
  check(ok(airbnb.trim()) && ok(booking.trim()), "Links must start with https://");
  await pool.query("update properties set airbnb_ical_url = $2, booking_ical_url = $3, updated_at = now() where id = $1", [
    id,
    airbnb.trim() || null,
    booking.trim() || null,
  ]);
  const results = await syncNow(id);
  refresh();
  return results;
}

export async function syncCalendarsNow(id: string) {
  check(ID.test(id), "Bad property");
  const results = await syncNow(id);
  await repriceProperty(id); // gaps and last-minute pricing depend on bookings
  refresh();
  return results;
}

export async function addReservation(
  id: string,
  r: { kind: "direct" | "block"; checkin: string; checkout: string; guestName: string; total: number | null; notes: string },
) {
  check(ID.test(id) && DATE.test(r.checkin) && DATE.test(r.checkout) && r.checkout > r.checkin, "Check-out must be after check-in");
  await pool.query(
    `insert into reservations (property_id, source, checkin, checkout, guest_name, total, notes)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, r.kind, r.checkin, r.checkout, r.kind === "block" ? null : r.guestName.slice(0, 80) || null, r.total, r.notes.slice(0, 500) || null],
  );
  await repriceProperty(id);
  refresh();
}

/** Only your own entries can be cancelled here; channel bookings are cancelled on the channel. */
export async function cancelReservation(id: string, reservationId: string) {
  check(ID.test(id) && /^[0-9a-f-]{36}$/.test(reservationId), "Bad reservation");
  const { rowCount } = await pool.query(
    `update reservations set status = 'cancelled', updated_at = now()
      where id = $2 and property_id = $1 and source in ('direct', 'manual', 'block')`,
    [id, reservationId],
  );
  check(rowCount === 1, "Only direct bookings and blocks can be cancelled here");
  await repriceProperty(id);
  refresh();
}
