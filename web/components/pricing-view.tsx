"use client";

import { useMemo, useState, useTransition } from "react";
import { clearOverride, repriceNow, saveSettings, setOverride } from "@/app/villa-actions";
import type { Recommendation, Villa } from "@/lib/villa";
import { fmt } from "@/lib/money";
import { TooltipProvider, tipProps, useTooltip } from "./explore/tooltip";

const AREAS = ["Serangan", "Selong Belanak", "Mawi", "Tampah", "Mawun", "Are Guling", "Kuta", "Gerupuk"];
const SOURCE_LABEL: Record<string, string> = { airbnb: "Airbnb", booking: "Booking.com", direct: "Direct", manual: "Booked", block: "Blocked" };

const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(d + "T00:00:00Z").toLocaleString("en-GB", { ...opts, timeZone: "UTC" });

export function PricingView({ villa }: { villa: Villa }) {
  return (
    <TooltipProvider>
      <Pricing villa={villa} />
    </TooltipProvider>
  );
}

function Pricing({ villa }: { villa: Villa }) {
  const t = useTooltip();
  const p = villa.property;
  const money = useMemo(() => {
    const m = { audRate: villa.audRate, rateDate: villa.rateDate };
    return {
      aud: (n: number | null) => fmt(n, { ...m, currency: "AUD" }),
      idr: (n: number | null) => fmt(n, { ...m, currency: "IDR" }),
    };
  }, [villa.audRate, villa.rateDate]);
  const [selected, setSelected] = useState<string>(villa.recommendations.find((r) => r.reasons.some((x) => x.kind === "event"))?.date ?? villa.today);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const byDate = useMemo(() => new Map(villa.recommendations.map((r) => [r.date, r])), [villa.recommendations]);
  const overrideDates = useMemo(() => new Map(villa.overrides.map((o) => [o.date, o])), [villa.overrides]);
  const booked = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of villa.reservations) {
      if (r.status !== "confirmed") continue;
      for (let t = Date.parse(r.checkin); t < Date.parse(r.checkout); t += 86_400_000) m.set(new Date(t).toISOString().slice(0, 10), r.source);
    }
    return m;
  }, [villa.reservations]);

  const prices = villa.recommendations.map((r) => r.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const shade = (price: number) => {
    const step = hi > lo ? Math.min(7, Math.floor(((price - lo) / (hi - lo)) * 8)) : 3;
    return { background: `var(--seq-${step})`, color: step >= 4 ? "#fff" : "var(--ink)" };
  };

  const months = useMemo(() => {
    const out: { key: string; label: string; lead: number; days: Recommendation[] }[] = [];
    for (const r of villa.recommendations) {
      const key = r.date.slice(0, 7);
      if (out.at(-1)?.key !== key) {
        const d = new Date(r.date + "T00:00:00Z");
        out.push({ key, label: dayLabel(r.date, { month: "long", year: "numeric" }), lead: (d.getUTCDay() + 6) % 7, days: [] });
      }
      out.at(-1)!.days.push(r);
    }
    return out;
  }, [villa.recommendations]);

  const avg = (days: number) => {
    const xs = villa.recommendations.slice(0, days).map((r) => r.price);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const sel = byDate.get(selected) ?? null;
  const run = (fn: () => Promise<unknown>, done: string) =>
    start(async () => {
      setMessage(null);
      try {
        await fn();
        setMessage(done);
      } catch (e) {
        setMessage((e as Error).message);
      }
    });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pricing · {p.name}</h1>
          <p className="mt-1 text-sm text-muted">
            A suggested price for every night, re-worked each night from the market. Compared against {sel?.compCount ?? "–"} similar
            villas. A$1 = Rp {Math.round(villa.audRate).toLocaleString("en-AU")}.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => repriceNow(p.id), "Prices updated.")}
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {pending ? "Working…" : "Re-price now"}
        </button>
      </div>

      {p.draft && (
        <div className="mb-5 rounded-lg border border-[#eda100] bg-[#eda100]/10 p-4 text-sm">
          <strong>Draft settings.</strong> {p.name} is set up as a {p.bedrooms}-bedroom at {p.area} with placeholder price limits. Check the
          settings at the bottom of the page and tick &ldquo;These details are right&rdquo;: the prices follow them.
        </div>
      )}
      {message && <div className="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm">{message}</div>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Tonight", villa.recommendations[0]?.price ?? null],
          ["Average, next 30 nights", avg(30)],
          ["Average, next 90 nights", avg(90)],
          ["Average, next 12 months", avg(365)],
        ].map(([label, v]) => (
          <div key={label as string} className="rounded-lg border border-line bg-panel p-4">
            <div className="text-xs text-muted">{label as string}</div>
            <div className="mt-1 text-2xl font-semibold">{money.aud(v as number | null)}</div>
            <div className="text-xs text-muted">{money.idr(v as number | null)} a night</div>
          </div>
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="rounded-lg border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">Suggested price, every night</h2>
          <p className="mt-0.5 text-xs text-muted">Darker = higher. Click a night for the reasons and to change it. ● = you set it by hand.</p>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-4">
            {months.map((m) => (
              <div key={m.key}>
                <div className="mb-1 text-sm font-medium">{m.label}</div>
                <div className="grid grid-cols-7 gap-[2px]">
                  {Array.from({ length: m.lead }).map((_, i) => (
                    <div key={i} />
                  ))}
                  {m.days.map((r) => {
                    const src = booked.get(r.date);
                    const ov = overrideDates.get(r.date);
                    return (
                      <button
                        key={r.date}
                        type="button"
                        aria-label={`${r.date}: ${src ? "booked" : money.aud(r.price)}`}
                        onClick={() => setSelected(r.date)}
                        {...tipProps(t, () => (
                          <div>
                            <div className="font-semibold">
                              {money.aud(r.price)} · {money.idr(r.price)}
                            </div>
                            <div className="opacity-80">
                              {dayLabel(r.date)} · min {r.minStay} night{r.minStay === 1 ? "" : "s"}
                              {src ? ` · booked (${SOURCE_LABEL[src] ?? src})` : ""}
                            </div>
                          </div>
                        ))}
                        className="relative flex aspect-square flex-col items-center justify-center rounded-[3px] text-[8px] leading-tight transition-transform hover:z-10 hover:scale-125"
                        style={{
                          ...(src ? { background: "var(--line)", color: "var(--faint)" } : shade(r.price)),
                          boxShadow: selected === r.date ? "0 0 0 2px var(--panel), 0 0 0 4px var(--ink)" : undefined,
                        }}
                      >
                        <span className="opacity-70">{Number(r.date.slice(8))}</span>
                        <span className="font-semibold">{src ? "booked" : money.aud(r.price).replace("A$", "")}</span>
                        {ov && <span className="absolute right-[1px] top-[1px] size-[4px] rounded-full bg-current" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid content-start gap-6 lg:sticky lg:top-4">
          {sel && <NightPanel villa={villa} rec={sel} money={money} override={overrideDates.get(sel.date) ?? null} bookedBy={booked.get(sel.date) ?? null} />}
        </div>
      </div>

      <Settings villa={villa} money={money} />
    </div>
  );
}

function NightPanel({
  villa,
  rec,
  money,
  override,
  bookedBy,
}: {
  villa: Villa;
  rec: Recommendation;
  money: { aud: (n: number | null) => string; idr: (n: number | null) => string };
  override: { price: number | null; minStay: number | null; note: string | null } | null;
  bookedBy: string | null;
}) {
  const [pending, start] = useTransition();
  const [price, setPrice] = useState("");
  const [minStay, setMinStay] = useState("");
  const [until, setUntil] = useState(rec.date);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const id = villa.property.id;

  return (
    <section key={rec.date} className="rise rounded-lg border border-line bg-panel p-5">
      <div className="text-sm text-muted">{dayLabel(rec.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
      <div className="mt-1 text-4xl font-semibold tracking-tight">{money.aud(rec.price)}</div>
      <div className="text-sm text-muted">
        {money.idr(rec.price)} a night · minimum {rec.minStay} night{rec.minStay === 1 ? "" : "s"}
      </div>
      {bookedBy && <div className="mt-2 rounded bg-line px-2 py-1 text-xs">Already booked ({SOURCE_LABEL[bookedBy] ?? bookedBy})</div>}
      <div className="mt-3 text-xs text-muted">
        Similar villas this night: {rec.marketPrice != null ? `${money.aud(rec.marketPrice)} median` : "no prices yet"}
        {rec.marketOcc != null ? ` · ${Math.round(rec.marketOcc * 100)}% booked` : ""}
      </div>

      <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-faint">How this price was set</h3>
      <ul className="grid gap-2 text-sm">
        {rec.reasons.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span
              className="tabular w-11 shrink-0 text-right text-xs font-semibold"
              style={{ color: r.effect == null ? "var(--faint)" : r.effect >= 1 ? "var(--up)" : "var(--down)" }}
            >
              {r.effect == null ? "•" : `${r.effect >= 1 ? "+" : "−"}${Math.abs(Math.round((r.effect - 1) * 100))}%`}
            </span>
            <span>{r.label}</span>
          </li>
        ))}
      </ul>

      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-faint">Change it</h3>
      <form
        className="grid gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const aud = price.trim() ? Number(price) : null;
          const ms = minStay.trim() ? Number(minStay) : null;
          start(async () => {
            try {
              await setOverride(id, rec.date, until, aud == null ? null : aud * villa.audRate, ms, note);
              setMsg("Saved and re-priced.");
              setPrice("");
              setMinStay("");
            } catch (err) {
              setMsg((err as Error).message);
            }
          });
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs text-muted">
            Price a night (A$)
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder={String(Math.round(rec.price / villa.audRate))} className="rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink" />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Minimum nights
            <input value={minStay} onChange={(e) => setMinStay(e.target.value)} inputMode="numeric" placeholder={String(rec.minStay)} className="rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink" />
          </label>
        </div>
        <label className="grid gap-1 text-xs text-muted">
          Apply through (inclusive)
          <input type="date" value={until} min={rec.date} onChange={(e) => setUntil(e.target.value)} className="rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink" />
        </label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. wedding enquiry" className="rounded border border-line bg-bg px-2 py-1.5 text-sm" />
        <button disabled={pending} className="rounded-md bg-accent py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-black">
          {pending ? "Saving…" : "Set price / minimum stay"}
        </button>
        {override && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await clearOverride(id, rec.date, until);
                setMsg("Back to the suggested price.");
              })
            }
            className="text-xs text-accent hover:underline"
          >
            Clear my change{until !== rec.date ? "s in this range" : ""} (use the suggested price)
          </button>
        )}
        {msg && <p className="text-xs text-muted">{msg}</p>}
      </form>
    </section>
  );
}

function Settings({ villa, money }: { villa: Villa; money: { aud: (n: number | null) => string; idr: (n: number | null) => string } }) {
  const p = villa.property;
  const rate = villa.audRate;
  const [s, setS] = useState({
    name: p.name,
    area: p.area,
    bedrooms: String(p.bedrooms),
    position: p.position,
    minAud: String(Math.round(p.min_rate / rate)),
    maxAud: String(Math.round(p.max_rate / rate)),
    baseMinStay: String(p.base_min_stay),
    confirmed: !p.draft,
  });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const positionLabel = s.position < 0.35 ? "Value" : s.position < 0.6 ? "Mid-market" : s.position < 0.8 ? "Premium" : "Top of market";

  return (
    <section className="rounded-lg border border-line bg-panel p-5">
      <h2 className="text-sm font-semibold">Villa settings</h2>
      <p className="mt-0.5 text-xs text-muted">These decide which villas yours is compared with and how it&apos;s positioned. Saving re-prices every night.</p>
      <form
        className="mt-4 grid gap-4 text-sm md:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            try {
              await saveSettings(p.id, {
                name: s.name,
                area: s.area,
                bedrooms: Number(s.bedrooms),
                position: s.position,
                minRate: Number(s.minAud) * rate,
                maxRate: Number(s.maxAud) * rate,
                baseMinStay: Number(s.baseMinStay),
                confirmed: s.confirmed,
              });
              setMsg("Saved. Every night has been re-priced.");
            } catch (err) {
              setMsg((err as Error).message);
            }
          });
        }}
      >
        <label className="grid gap-1 text-xs text-muted">
          Villa name
          <input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} className="rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink" />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Beach
          <select value={s.area} onChange={(e) => setS({ ...s, area: e.target.value })} className="rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink">
            {AREAS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Bedrooms
          <input value={s.bedrooms} onChange={(e) => setS({ ...s, bedrooms: e.target.value })} inputMode="numeric" className="rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink" />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Usual minimum stay (nights)
          <input value={s.baseMinStay} onChange={(e) => setS({ ...s, baseMinStay: e.target.value })} inputMode="numeric" className="rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink" />
        </label>
        <label className="grid gap-1 text-xs text-muted md:col-span-2">
          Position vs similar villas: <strong className="text-ink">{positionLabel}</strong> ({Math.round(s.position * 100)}th percentile)
          <input type="range" min={0.1} max={0.9} step={0.05} value={s.position} onChange={(e) => setS({ ...s, position: Number(e.target.value) })} />
          <span className="flex justify-between text-[10px]">
            <span>Cheaper, fills faster</span>
            <span>Pricier, fewer nights</span>
          </span>
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Never below (A$ a night)
          <input value={s.minAud} onChange={(e) => setS({ ...s, minAud: e.target.value })} inputMode="decimal" className="rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink" />
          <span className="text-[10px]">{money.idr(Number(s.minAud) * rate)}</span>
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Never above (A$ a night)
          <input value={s.maxAud} onChange={(e) => setS({ ...s, maxAud: e.target.value })} inputMode="decimal" className="rounded border border-line bg-bg px-2 py-1.5 text-sm text-ink" />
          <span className="text-[10px]">{money.idr(Number(s.maxAud) * rate)}</span>
        </label>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" checked={s.confirmed} onChange={(e) => setS({ ...s, confirmed: e.target.checked })} />
          These details are right
        </label>
        <div className="flex items-center gap-3 md:col-span-2 lg:justify-end">
          {msg && <span className="text-xs text-muted">{msg}</span>}
          <button disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-black">
            {pending ? "Saving and re-pricing…" : "Save settings"}
          </button>
        </div>
      </form>
    </section>
  );
}
