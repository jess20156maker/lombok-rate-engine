import assert from "node:assert/strict";
import { test } from "node:test";
import { buildICal, parseICal } from "./ical.js";

// Shapes of what Airbnb and Booking.com export (details changed).
const AIRBNB = [
  "BEGIN:VCALENDAR",
  "PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 1.0//EN",
  "CALSCALE:GREGORIAN",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20261108",
  "DTSTART;VALUE=DATE:20261103",
  "UID:1418fb94e984-8f7a1c0b5b7e3a2d0e6f@airbnb.com",
  "DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABC123\\nPhone Number (Last 4 Digits): 1234",
  "SUMMARY:Reserved",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20261201",
  "DTSTART;VALUE=DATE:20261128",
  "UID:7f0e1d2c3b4a-5968778695a4b3c2@airbnb.com",
  "SUMMARY:Airbnb (Not available)",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const BOOKING = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Booking.com//NONSGML Booking.com Calendar//EN",
  "BEGIN:VEVENT",
  "UID:f3a9c2e1b8d74a5f9e0c1b2a3d4e5f60",
  "DTSTART;VALUE=DATE:20261215",
  "DTEND;VALUE=DATE:20261220",
  "SUMMARY:CLOSED - Not available",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\n");

test("reads Airbnb reservations and blocks", () => {
  const ev = parseICal(AIRBNB);
  assert.equal(ev.length, 2);
  assert.deepEqual([ev[0].start, ev[0].end, ev[0].summary], ["2026-11-03", "2026-11-08", "Reserved"]);
  assert.match(ev[0].description ?? "", /HMABC123\nPhone/);
  assert.equal(ev[1].summary, "Airbnb (Not available)");
});

test("reads Booking.com closures", () => {
  const ev = parseICal(BOOKING);
  assert.deepEqual([ev[0].uid, ev[0].start, ev[0].end], ["f3a9c2e1b8d74a5f9e0c1b2a3d4e5f60", "2026-12-15", "2026-12-20"]);
});

test("writes a calendar that reads back identically", () => {
  const events = [
    { uid: "a@lombok", start: "2027-01-02", end: "2027-01-05", summary: "Booked; direct, via website" },
    { uid: "b@lombok", start: "2027-02-10", end: "2027-02-11", summary: "Blocked " + "x".repeat(120) },
  ];
  const text = buildICal("Mulai Villa", events, new Date("2026-09-26T00:00:00Z"));
  assert.ok(text.split("\r\n").every((l) => l.length <= 75), "lines must be folded");
  assert.deepEqual(
    parseICal(text).map(({ uid, start, end, summary }) => ({ uid, start, end, summary })),
    events,
  );
});

import { findConflicts } from "./calendar-sync.js";

test("spots overlapping stays from different channels, not back-to-back ones", () => {
  const stays = [
    { id: "1", source: "airbnb", checkin: "2026-11-03", checkout: "2026-11-08", guest_name: null },
    { id: "2", source: "booking", checkin: "2026-11-07", checkout: "2026-11-09", guest_name: null }, // overlaps night of 7th
    { id: "3", source: "direct", checkin: "2026-11-09", checkout: "2026-11-12", guest_name: null }, // back-to-back, fine
  ];
  const c = findConflicts(stays);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0][0].id, c[0][1].id], ["1", "2"]);
});
