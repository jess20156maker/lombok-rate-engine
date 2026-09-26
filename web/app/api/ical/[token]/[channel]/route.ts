// The central calendar as an iCal feed, for Airbnb and Booking.com to import.
//
//   /api/ical/<token>/airbnb.ics    everything except Airbnb's own stays (paste into Airbnb)
//   /api/ical/<token>/booking.ics   everything except Booking.com's own stays (paste into Booking.com)
//   /api/ical/<token>/all.ics       everything (for your phone's calendar)
//
// The token is the property's secret ical_token; channels can't send a password,
// so this path is exempt from the dashboard password (see proxy.ts).

import type { NextRequest } from "next/server";
import { buildICal } from "../../../../../../src/lib/ical";
import { pool } from "@/lib/data";

const LABEL: Record<string, string> = {
  direct: "Booked (direct)",
  manual: "Booked",
  block: "Not available",
  airbnb: "Booked (Airbnb)",
  booking: "Booked (Booking.com)",
};

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/ical/[token]/[channel]">) {
  const { token, channel: file } = await ctx.params;
  const channel = file.replace(/\.ics$/, "");
  if (!/^[a-f0-9]{36}$/.test(token) || !["airbnb", "booking", "all"].includes(channel)) {
    return new Response("Not found", { status: 404 });
  }
  const { rows: props } = await pool.query("select id, name from properties where ical_token = $1", [token]);
  if (!props.length) return new Response("Not found", { status: 404 });
  const p = props[0];

  const { rows } = await pool.query(
    `select id, source, checkin::text, checkout::text from reservations
      where property_id = $1 and status = 'confirmed' and checkout >= current_date - 30
        and ($2 = 'all' or source <> $2)
      order by checkin`,
    [p.id, channel],
  );
  // No guest details go out: the channels only need to know the dates are taken.
  const body = buildICal(
    p.name,
    rows.map((r) => ({ uid: `${r.id}@lombok-rate-engine`, start: r.checkin, end: r.checkout, summary: LABEL[r.source] ?? "Not available" })),
  );
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${p.id}-${channel}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
