"use client";

import { useMemo, useState, useTransition } from "react";
import { addReservation, cancelReservation, saveChannelLinks, syncCalendarsNow } from "@/app/villa-actions";
import type { Reservation, Villa } from "@/lib/villa";
import { fmt } from "@/lib/money";
import { TooltipProvider, tipProps, useTooltip } from "./explore/tooltip";

// Categorical colours in fixed order; blocks are neutral, not a series.
const SOURCES: Record<string, { label: string; color: string }> = {
  airbnb: { label: "Airbnb", color: "var(--series-1)" },
  booking: { label: "Booking.com", color: "var(--series-2)" },
  direct: { label: "Direct", color: "var(--series-3)" },
  manual: { label: "Booked", color: "var(--series-4)" },
  block: { label: "Blocked", color: "var(--faint)" },
};
const src = (s: string) => SOURCES[s] ?? { label: s, color: "var(--faint)" };

const DAY = 86_400_000;
const dayLabel = (d: string, o: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(d + "T00:00:00Z").toLocaleString("en-GB", { ...o, timeZone: "UTC" });
const nights = (r: Reservation) => Math.round((Date.parse(r.checkout) - Date.parse(r.checkin)) / DAY);

export function CalendarView({ villa, origin }: { villa: Villa; origin: string }) {
  return (
    <TooltipProvider>
      <Cal villa={villa} origin={origin} />
    </TooltipProvider>
  );
}

function Cal({ villa, origin }: { villa: Villa; origin: string }) {
  const t = useTooltip();
  const p = villa.property;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const money = (n: number | null) =>
    n == null ? "–" : `${fmt(n, { currency: "AUD", audRate: villa.audRate, rateDate: "" })} · ${fmt(n, { currency: "IDR", audRate: villa.audRate, rateDate: "" })}`;

  const confirmed = villa.reservations.filter((r) => r.status === "confirmed");
  const conflictIds = new Set(villa.conflicts.flat());
  const byNight = useMemo(() => {
    const m = new Map<string, Reservation[]>();
    for (const r of confirmed)
      for (let x = Date.parse(r.checkin); x < Date.parse(r.checkout); x += DAY) {
        const d = new Date(x).toISOString().slice(0, 10);
        m.set(d, [...(m.get(d) ?? []), r]);
      }
    return m;
  }, [confirmed]);
  const priceBy = useMemo(() => new Map(villa.recommendations.map((r) => [r.date, r])), [villa.recommendations]);

  const months = useMemo(() => {
    const out: { key: string; label: string; lead: number; days: string[] }[] = [];
    for (let i = 0; i < 365; i++) {
      const d = new Date(Date.parse(villa.today) + i * DAY).toISOString().slice(0, 10);
      const key = d.slice(0, 7);
      if (out.at(-1)?.key !== key)
        out.push({ key, label: dayLabel(d, { month: "long", year: "numeric" }), lead: (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7, days: [] });
      out.at(-1)!.days.push(d);
    }
    return out;
  }, [villa.today]);

  const upcoming = confirmed.filter((r) => r.checkout >= villa.today);
  const bookedNext90 = Array.from({ length: 90 }, (_, i) => new Date(Date.parse(villa.today) + i * DAY).toISOString().slice(0, 10)).filter(
    (d) => byNight.get(d)?.some((r) => r.source !== "block"),
  ).length;

  const run = (fn: () => Promise<unknown>, ok: (r: any) => string) =>
    start(async () => {
      setMsg(null);
      try {
        setMsg(ok(await fn()));
      } catch (e) {
        setMsg((e as Error).message);
      }
    });
  const syncSummary = (rs: { channel: string; ok: boolean; events: number; added: number; cancelled: number; error?: string }[]) =>
    rs.length === 0
      ? "No channel calendars linked yet: add them under “Connect Airbnb and Booking.com”."
      : rs
          .map((r) => (r.ok ? `${src(r.channel).label}: ${r.events} stays/blocks (${r.added} new, ${r.cancelled} cancelled)` : `${src(r.channel).label}: failed (${r.error})`))
          .join(" · ");

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar · {p.name}</h1>
          <p className="mt-1 text-sm text-muted">
            Every stay and block from every channel, in one place. Checked against Airbnb and Booking.com every 20 minutes. {bookedNext90} of
            the next 90 nights booked.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => syncCalendarsNow(p.id), syncSummary)}
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {pending ? "Working…" : "Sync now"}
        </button>
      </div>

      {msg && <div className="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm">{msg}</div>}

      {villa.conflicts.length > 0 && (
        <div className="mb-5 rounded-lg border p-4 text-sm" style={{ borderColor: "#d03b3b", background: "color-mix(in srgb, #d03b3b 8%, transparent)" }}>
          <strong>⚠ Double booking.</strong>{" "}
          {villa.conflicts.map(([a, b]) => {
            const ra = confirmed.find((r) => r.id === a)!;
            const rb = confirmed.find((r) => r.id === b)!;
            return (
              <span key={a + b} className="block">
                {src(ra.source).label} {dayLabel(ra.checkin)}–{dayLabel(ra.checkout)} overlaps {src(rb.source).label} {dayLabel(rb.checkin)}–
                {dayLabel(rb.checkout)}. Contact one guest and cancel on that channel.
              </span>
            );
          })}
        </div>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="rounded-lg border border-line bg-panel p-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            {Object.entries(SOURCES).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className="inline-block size-3 rounded-sm" style={{ background: v.color }} />
                {v.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-sm border border-line" /> Open (suggested price)
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-4">
            {months.map((m) => (
              <div key={m.key}>
                <div className="mb-1 text-sm font-medium">{m.label}</div>
                <div className="grid grid-cols-7 gap-[2px]">
                  {Array.from({ length: m.lead }).map((_, i) => (
                    <div key={i} />
                  ))}
                  {m.days.map((d) => {
                    const stays = byNight.get(d) ?? [];
                    const clash = stays.length > 1 || stays.some((r) => conflictIds.has(r.id));
                    const rec = priceBy.get(d);
                    const s = stays[0];
                    return (
                      <div
                        key={d}
                        tabIndex={0}
                        {...tipProps(t, () => (
                          <div>
                            <div className="font-semibold">{dayLabel(d)}</div>
                            {stays.length ? (
                              stays.map((r) => (
                                <div key={r.id}>
                                  {src(r.source).label}
                                  {r.guestName ? ` · ${r.guestName}` : ""} ({dayLabel(r.checkin)}–{dayLabel(r.checkout)})
                                </div>
                              ))
                            ) : (
                              <div className="opacity-80">Open{rec ? ` · suggested ${money(rec.price)}` : ""}</div>
                            )}
                          </div>
                        ))}
                        className="relative flex aspect-square items-center justify-center rounded-[3px] text-[9px]"
                        style={
                          s
                            ? { background: src(s.source).color, color: "#fff", outline: clash ? "2px solid #d03b3b" : undefined }
                            : { border: "1px solid var(--line)", color: "var(--faint)" }
                        }
                      >
                        {Number(d.slice(8))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid content-start gap-6">
          <AddForm villa={villa} run={run} />
        </div>
      </div>

      <section className="mb-6 rounded-lg border border-line bg-panel p-5">
        <h2 className="text-sm font-semibold">Upcoming stays and blocks</h2>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing booked yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {upcoming.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="inline-block h-8 w-1 rounded" style={{ background: src(r.source).color }} />
                <span className="w-44 font-medium">
                  {dayLabel(r.checkin)} – {dayLabel(r.checkout)}
                </span>
                <span className="w-20 text-muted">
                  {nights(r)} night{nights(r) === 1 ? "" : "s"}
                </span>
                <span className="w-28">{src(r.source).label}</span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {[r.guestName, r.total != null ? money(r.total) : null, r.notes].filter(Boolean).join(" · ")}
                </span>
                {conflictIds.has(r.id) && <span className="text-xs font-semibold text-[#d03b3b]">double booking</span>}
                {["direct", "manual", "block"].includes(r.source) && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => confirm("Cancel this and free the dates on every channel?") && run(() => cancelReservation(p.id, r.id), () => "Cancelled: the dates are free again everywhere within about 20 minutes.")}
                    className="text-xs text-accent hover:underline"
                  >
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Connect villa={villa} origin={origin} run={run} syncSummary={syncSummary} pending={pending} />
    </div>
  );
}

function AddForm({ villa, run }: { villa: Villa; run: (fn: () => Promise<unknown>, ok: (r: any) => string) => void }) {
  const [kind, setKind] = useState<"direct" | "block">("direct");
  const [checkin, setCheckin] = useState("");
  const [checkout, setCheckout] = useState("");
  const [guest, setGuest] = useState("");
  const [total, setTotal] = useState("");
  const [notes, setNotes] = useState("");
  const input = "rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink";
  return (
    <section className="rounded-lg border border-line bg-panel p-5">
      <h2 className="text-sm font-semibold">Add a booking or block dates</h2>
      <p className="mt-0.5 text-xs text-muted">Saved here, then Airbnb and Booking.com close those dates when they next check (usually within the hour).</p>
      <div className="mt-3 flex gap-1 rounded-full border border-line p-0.5 text-xs">
        {(
          [
            ["direct", "Direct booking"],
            ["block", "Block dates"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`flex-1 rounded-full px-3 py-1 ${kind === k ? "bg-accent text-white dark:text-black" : "text-muted"}`}>
            {l}
          </button>
        ))}
      </div>
      <form
        className="mt-3 grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () =>
              addReservation(villa.property.id, {
                kind,
                checkin,
                checkout,
                guestName: guest,
                total: total.trim() ? Number(total) * villa.audRate : null,
                notes,
              }),
            () => (kind === "block" ? "Dates blocked everywhere." : "Booking saved and dates closed everywhere."),
          );
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs text-muted">
            {kind === "block" ? "From" : "Check-in"}
            <input type="date" required value={checkin} min={villa.today} onChange={(e) => setCheckin(e.target.value)} className={input} />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            {kind === "block" ? "Until (morning)" : "Check-out"}
            <input type="date" required value={checkout} min={checkin || villa.today} onChange={(e) => setCheckout(e.target.value)} className={input} />
          </label>
        </div>
        {kind === "direct" && (
          <>
            <input value={guest} onChange={(e) => setGuest(e.target.value)} placeholder="Guest name" className={input} />
            <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="Total paid (A$), optional" className={input} />
          </>
        )}
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={kind === "block" ? "Reason, e.g. maintenance" : "Notes (optional)"} className={input} />
        <button className="rounded-md bg-accent py-2 text-sm font-medium text-white dark:text-black">{kind === "block" ? "Block these dates" : "Save booking"}</button>
      </form>
    </section>
  );
}

function CopyLink({ label, url, where }: { label: string; url: string; where: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-line p-3">
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-0.5 text-xs text-muted">{where}</div>
      <div className="mt-2 flex gap-2">
        <input readOnly value={url} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 font-mono text-[11px]" />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded border border-line px-2 text-xs hover:border-accent"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function Connect({
  villa,
  origin,
  run,
  syncSummary,
  pending,
}: {
  villa: Villa;
  origin: string;
  run: (fn: () => Promise<unknown>, ok: (r: any) => string) => void;
  syncSummary: (rs: any[]) => string;
  pending: boolean;
}) {
  const p = villa.property;
  const [airbnb, setAirbnb] = useState(p.airbnb_ical_url ?? "");
  const [booking, setBooking] = useState(p.booking_ical_url ?? "");
  const feed = (ch: string) => `${origin}/api/ical/${p.ical_token}/${ch}.ics`;
  return (
    <section className="rounded-lg border border-line bg-panel p-5">
      <h2 className="text-sm font-semibold">Connect Airbnb and Booking.com</h2>
      <p className="mt-0.5 text-xs text-muted">
        Two-way calendar sync: each site sends its bookings here, and reads everyone else&apos;s from here, so a booking anywhere closes the dates
        everywhere. It covers dates only; prices are set on each site. Keep these links private.
      </p>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">1 · Their calendars → here</h3>
          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted">
            <li>
              <strong>Airbnb:</strong> Calendar → your listing → Availability → Connect calendars → Export calendar. Copy the link.
            </li>
            <li>
              <strong>Booking.com:</strong> Extranet → Rates &amp; Availability → Sync calendars → Export calendar. Copy the link.
            </li>
            <li>Paste them below and save.</li>
          </ol>
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => saveChannelLinks(p.id, airbnb, booking), (r) => `Saved. ${syncSummary(r)}`);
            }}
          >
            <input value={airbnb} onChange={(e) => setAirbnb(e.target.value)} placeholder="Airbnb export link (https://www.airbnb.com/calendar/ical/…)" className="rounded border border-line bg-bg px-2 py-1.5 text-xs" />
            <input value={booking} onChange={(e) => setBooking(e.target.value)} placeholder="Booking.com export link (https://ical.booking.com/…)" className="rounded border border-line bg-bg px-2 py-1.5 text-xs" />
            <button disabled={pending} className="rounded-md bg-accent py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-black">
              Save and sync
            </button>
          </form>
        </div>
        <div className="grid content-start gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">2 · Here → their calendars</h3>
          <CopyLink label="Paste into Airbnb" url={feed("airbnb")} where="Airbnb: Availability → Connect calendars → Import calendar. Name it “Mulai central”." />
          <CopyLink label="Paste into Booking.com" url={feed("booking")} where="Booking.com Extranet: Sync calendars → Import calendar." />
          <CopyLink label="Your phone's calendar (optional)" url={feed("all")} where="Subscribe to see every stay on your phone." />
        </div>
      </div>
    </section>
  );
}
