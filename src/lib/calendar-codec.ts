// Compact on-disk form of a 365-day calendar: one character per night.
//
//   "1" available (and a check-in is allowed)
//   "c" available but no check-in that day (mid-stay only)
//   "0" unavailable
//
// Minimum stay is stored only where it changes, as [date, nights] pairs.

import type { CalendarDay } from "../airbnb/client.js";
import { addDays } from "./dates.js";

export type StoredCalendar = { from: string; nights: string; minStay: [string, number][] };

export function encode(days: CalendarDay[]): StoredCalendar {
  const minStay: [string, number][] = [];
  let lastMin = -1;
  for (const d of days) {
    if (d.minNights !== lastMin) minStay.push([d.date, (lastMin = d.minNights)]);
  }
  return {
    from: days[0]?.date ?? "",
    nights: days.map((d) => (!d.available ? "0" : d.checkin ? "1" : "c")).join(""),
    minStay,
  };
}

export function decode(c: StoredCalendar): CalendarDay[] {
  let m = 0;
  return [...c.nights].map((ch, i) => {
    const date = addDays(c.from, i);
    while (m + 1 < c.minStay.length && c.minStay[m + 1][0] <= date) m++;
    return { date, available: ch !== "0", checkin: ch === "1", minNights: c.minStay[m]?.[1] ?? 1 };
  });
}
