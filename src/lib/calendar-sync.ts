// Central calendar: pull each channel's iCal export into `reservations`, and
// spot double bookings. Shared by the scheduled job and the website's
// "Sync now" button; callers pass their own query function.

import { parseICal, type CalEvent } from "./ical.js";
import { asDate, upsertWith, type Query } from "./sql.js";

export type Channel = "airbnb" | "booking";

export type SyncResult = { channel: Channel; ok: boolean; events: number; added: number; cancelled: number; error?: string };

/** Only keep what's needed to recognise a stay; never phone numbers. */
function noteFor(channel: Channel, e: CalEvent) {
  const code = /reservations\/details\/([A-Z0-9]+)/.exec(e.description ?? "")?.[1];
  return [e.summary, code ? `Airbnb code ${code}` : null].filter(Boolean).join(" · ") || null;
}

/** Airbnb/Booking.com label owner blocks differently from real bookings. */
function isBlock(channel: Channel, e: CalEvent) {
  return /not available|closed|blocked/i.test(e.summary) && !/reserved/i.test(e.summary);
}

export async function syncChannel(q: Query, propertyId: string, channel: Channel, url: string, today: string): Promise<SyncResult> {
  let text: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "LombokRateEngine/1.0 (calendar sync)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("not an iCal calendar (check the link)");
  } catch (err) {
    return { channel, ok: false, events: 0, added: 0, cancelled: 0, error: (err as Error).message };
  }

  const events = parseICal(text).filter((e) => e.end >= today);
  const { rows: existing } = await q(
    "select external_uid from reservations where property_id = $1 and source = $2 and status = 'confirmed' and checkout >= $3",
    [propertyId, channel, today],
  );
  const known = new Set(existing.map((r) => r.external_uid as string));

  await upsertWith(
    q,
    "reservations",
    ["property_id", "source", "external_uid"],
    events.map((e) => ({
      property_id: propertyId,
      source: channel,
      external_uid: e.uid,
      checkin: e.start,
      checkout: e.end,
      guest_name: isBlock(channel, e) ? null : channel === "airbnb" ? "Airbnb guest" : "Booking.com guest",
      status: "confirmed",
      notes: noteFor(channel, e),
      updated_at: new Date().toISOString(),
    })),
  );

  // Anything from this channel that's no longer in its calendar was cancelled or unblocked.
  const current = events.map((e) => e.uid);
  const { rowCount } = await q(
    `update reservations set status = 'cancelled', updated_at = now()
      where property_id = $1 and source = $2 and status = 'confirmed' and checkout >= $3
        and external_uid is not null and not (external_uid = any($4))`,
    [propertyId, channel, today, current],
  );
  return { channel, ok: true, events: events.length, added: current.filter((u) => !known.has(u)).length, cancelled: rowCount ?? 0 };
}

export async function syncProperty(q: Query, propertyId: string, today: string) {
  const { rows } = await q("select airbnb_ical_url, booking_ical_url from properties where id = $1", [propertyId]);
  const p = rows[0];
  const results: SyncResult[] = [];
  if (p?.airbnb_ical_url) results.push(await syncChannel(q, propertyId, "airbnb", p.airbnb_ical_url, today));
  if (p?.booking_ical_url) results.push(await syncChannel(q, propertyId, "booking", p.booking_ical_url, today));
  return results;
}

export type Stay = { id: string; source: string; checkin: string; checkout: string; guest_name: string | null };

/** Overlapping confirmed stays from different sources: a double booking to sort out. */
export function findConflicts(stays: Stay[]): [Stay, Stay][] {
  const out: [Stay, Stay][] = [];
  const s = stays.map((x) => ({ ...x, checkin: asDate(x.checkin), checkout: asDate(x.checkout) })).sort((a, b) => a.checkin.localeCompare(b.checkin));
  for (let i = 0; i < s.length; i++)
    for (let j = i + 1; j < s.length && s[j].checkin < s[i].checkout; j++)
      if (s[i].source !== s[j].source) out.push([s[i], s[j]]);
  return out;
}
