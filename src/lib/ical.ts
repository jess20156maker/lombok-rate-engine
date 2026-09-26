// Minimal iCalendar (RFC 5545) reading and writing for availability sync.
// Airbnb and Booking.com both export and import all-day VEVENTs: DTSTART is
// the first night, DTEND the checkout morning. No dependencies.

export type CalEvent = {
  uid: string;
  start: string; // YYYY-MM-DD, first night
  end: string; // YYYY-MM-DD, checkout (exclusive)
  summary: string;
  description?: string;
};

/** Undo line folding: a line starting with a space or tab continues the previous one. */
function unfold(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function unescape(v: string) {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

/** 20261103, 20261103T140000Z, or TZID-qualified values → YYYY-MM-DD. */
function toDate(v: string) {
  const m = /(\d{4})(\d{2})(\d{2})/.exec(v);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function parseICal(text: string): CalEvent[] {
  const out: CalEvent[] = [];
  let cur: Partial<CalEvent> | null = null;
  for (const line of unfold(text).split("\n")) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      if (cur?.start) {
        const end = cur.end && cur.end > cur.start ? cur.end : nextDay(cur.start);
        out.push({ uid: cur.uid ?? `${cur.start}-${end}`, start: cur.start, end, summary: cur.summary ?? "", description: cur.description });
      }
      cur = null;
    } else if (cur) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const name = line.slice(0, i).split(";")[0].toUpperCase();
      const value = line.slice(i + 1);
      if (name === "UID") cur.uid = value.trim();
      else if (name === "DTSTART") cur.start = toDate(value) ?? undefined;
      else if (name === "DTEND") cur.end = toDate(value) ?? undefined;
      else if (name === "SUMMARY") cur.summary = unescape(value).trim();
      else if (name === "DESCRIPTION") cur.description = unescape(value).trim();
    }
  }
  return out;
}

function nextDay(d: string) {
  return new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10);
}

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");
const compact = (d: string) => d.replace(/-/g, "");

/** Fold lines longer than 75 octets, as the standard requires. */
function fold(line: string) {
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 73) parts.push((i ? " " : "") + line.slice(i, i + 73));
  return parts.join("\r\n");
}

export function buildICal(calName: string, events: CalEvent[], stamp = new Date()): string {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lombok Rate Engine//Central Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(calName)}`,
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${esc(e.uid)}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${compact(e.start)}`,
      `DTEND;VALUE=DATE:${compact(e.end)}`,
      `SUMMARY:${esc(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
