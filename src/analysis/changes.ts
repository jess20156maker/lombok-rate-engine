// Infer bookings by comparing two calendar snapshots of the same listing.
//
// A night that was open yesterday and is closed today was most likely booked.
// Hosts also block nights themselves (personal use, maintenance, a booking taken
// on another platform), so each run of newly-closed nights is classified:
//
//   booking      short run with a plausible lead time
//   owner-block  long run (a month or more), or blocked very far ahead
//   reopened     closed yesterday, open today: a cancellation or an unblock

import type { CalendarDay } from "../airbnb/client.js";
import { daysBetween } from "../lib/dates.js";

export type ChangeKind = "booking" | "owner-block" | "reopened";

export type Change = {
  kind: ChangeKind;
  checkin: string;
  nights: number;
  leadDays: number; // days between detection and check-in
};

const MAX_BOOKING_NIGHTS = 28;
const MAX_BOOKING_LEAD_DAYS = 300;

export function diffCalendars(prev: CalendarDay[], curr: CalendarDay[], asOf: string): Change[] {
  const before = new Map(prev.map((d) => [d.date, d.available]));
  const changes: Change[] = [];
  type Run = { kind: "closed" | "opened"; start: string; nights: number };
  let run = null as Run | null;

  const flush = () => {
    if (!run) return;
    const leadDays = daysBetween(asOf, run.start);
    let kind: ChangeKind = "reopened";
    if (run.kind === "closed") {
      kind = run.nights > MAX_BOOKING_NIGHTS || leadDays > MAX_BOOKING_LEAD_DAYS ? "owner-block" : "booking";
    }
    changes.push({ kind, checkin: run.start, nights: run.nights, leadDays });
    run = null;
  };

  for (const day of curr) {
    // Today's night closes on its own once same-day check-in cuts off; skip it.
    if (day.date <= asOf || !before.has(day.date)) {
      flush();
      continue;
    }
    const was = before.get(day.date)!;
    const change = was && !day.available ? "closed" : !was && day.available ? "opened" : null;
    if (change && run?.kind === change) {
      run.nights++;
    } else {
      flush();
      if (change) run = { kind: change, start: day.date, nights: 1 };
    }
  }
  flush();
  return changes;
}
