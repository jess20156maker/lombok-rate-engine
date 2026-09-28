"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { StarButton } from "@/components/star-button";
import { dateOf } from "@/lib/explore-calc";
import type { ExploreData } from "@/lib/explore-types";
import { fmt } from "@/lib/money";
import { TooltipProvider, tipProps, useTooltip } from "./explore/tooltip";

type Platform = "airbnb" | "booking" | "web" | "all";
type Sort = "reviews" | "price" | "booked" | "name";
const GROUPS = ["1", "2", "3", "4+"];
const RANGES = [
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "6 months" },
];

type Row = {
  key: string;
  platform: "airbnb" | "booking" | "web";
  id: string;
  name: string;
  area: string;
  beds: string;
  rating: string | null;
  reviews: number;
  href: string;
  external: boolean;
  /** dayIndex -> per-night price */
  prices: Map<number, number>;
  /** dayIndex -> true if booked/unavailable, false if open, undefined if unknown */
  status: (i: number) => boolean | undefined;
};

const reviewCount = (r: string | null) => Number(/\((\d+)\)/.exec(r ?? "")?.[1] ?? 0);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors ${
        on ? "border-accent bg-accent text-white dark:text-black" : "border-line bg-panel text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function RatesTable({ data, initialQuery = "" }: { data: ExploreData; initialQuery?: string }) {
  return (
    <TooltipProvider>
      <Rates data={data} initialQuery={initialQuery} />
    </TooltipProvider>
  );
}

function Rates({ data, initialQuery }: { data: ExploreData; initialQuery: string }) {
  const t = useTooltip();
  const [areas, setAreas] = useState<string[]>([]);
  const [beds, setBeds] = useState<string[]>([]);
  // A search from the header looks across every site.
  const [platform, setPlatform] = useState<Platform>(initialQuery ? "all" : "airbnb");
  const [days, setDays] = useState(30);
  const [pricedOnly, setPricedOnly] = useState(true);
  const [sort, setSort] = useState<Sort>("reviews");
  const [q, setQ] = useState(initialQuery);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const aud = (n: number | null) => fmt(n, { currency: "AUD", audRate: data.audRate, rateDate: data.rateDate });
  const idr = (n: number | null) => fmt(n, { currency: "IDR", audRate: data.audRate, rateDate: data.rateDate });
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  // Every row, both platforms, built once.
  const allRows = useMemo(() => {
    const air = new Map<number, Map<number, number>>();
    for (const [di, arr] of Object.entries(data.prices))
      for (const [li, p] of arr) {
        if (!air.has(li)) air.set(li, new Map());
        air.get(li)!.set(Number(di), p);
      }
    const bk = new Map<number, Map<number, number>>();
    for (const [di, arr] of Object.entries(data.booking.prices))
      for (const [li, p] of arr) {
        if (!bk.has(li)) bk.set(li, new Map());
        bk.get(li)!.set(Number(di), p);
      }
    const bookingChecked = new Set(Object.keys(data.booking.prices).map(Number));

    const rows: Row[] = data.listings
      .filter((l) => !l.dormant)
      .map((l, li) => ({ l, li }))
      .map(({ l }) => {
        const li = data.listings.indexOf(l);
        return {
          key: `a${l.id}`,
          platform: "airbnb" as const,
          id: l.id,
          name: l.name,
          area: l.area,
          beds: l.beds,
          rating: l.rating,
          reviews: reviewCount(l.rating),
          href: `/listings/${l.id}`,
          external: false,
          prices: air.get(li) ?? new Map(),
          status: (i: number) => (l.nights[i] === undefined ? undefined : l.nights[i] === "0"),
        };
      });
    data.booking.listings.forEach((b, bi) => {
      const prices = bk.get(bi) ?? new Map<number, number>();
      rows.push({
        key: `b${b.id}`,
        platform: "booking",
        id: b.id,
        name: b.name,
        area: b.area,
        beds: b.beds,
        rating: b.rating,
        reviews: reviewCount(b.rating),
        href: `https://www.booking.com/hotel/id/${b.slug}.html`,
        external: true,
        prices,
        // Booking.com: only known on the dates we checked.
        status: (i: number) => (bookingChecked.has(i) ? !prices.has(i) : undefined),
      });
    });
    // Competitor websites: a rate and sold-out flag for every night.
    const webPrices = new Map<number, Map<number, number>>();
    for (const [di, arr] of Object.entries(data.web.prices))
      for (const [li, p] of arr) {
        if (!webPrices.has(li)) webPrices.set(li, new Map());
        webPrices.get(li)!.set(Number(di), p);
      }
    data.web.listings.forEach((w, wi) => {
      rows.push({
        key: `w${w.id}`,
        platform: "web",
        id: w.id,
        name: w.name,
        area: w.area,
        beds: w.beds,
        rating: null,
        reviews: 0,
        href: w.url,
        external: true,
        prices: webPrices.get(wi) ?? new Map(),
        status: (i: number) => (w.nights[i] === undefined || w.nights[i] === "?" ? undefined : w.nights[i] === "0"),
      });
    });
    return rows;
  }, [data]);

  const columns = useMemo(() => {
    const all = Array.from({ length: Math.min(days, data.days) }, (_, i) => i);
    if (!pricedOnly) return all;
    const priced = new Set<number>();
    for (const r of allRows) if (platform === "all" || r.platform === platform) for (const d of r.prices.keys()) priced.add(d);
    return all.filter((i) => priced.has(i));
  }, [days, data.days, pricedOnly, allRows, platform]);

  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const rows = allRows.filter(
      (r) =>
        (platform === "all" || r.platform === platform) &&
        (!areas.length || areas.includes(r.area)) &&
        (!beds.length || beds.includes(r.beds)) &&
        (!ql || r.name.toLowerCase().includes(ql)),
    );
    const avg = (r: Row) => median(columns.map((i) => r.prices.get(i)).filter((p): p is number => p != null)) ?? -1;
    const bookedShare = (r: Row) => {
      const known = columns.map((i) => r.status(i)).filter((s) => s !== undefined);
      return known.length ? known.filter(Boolean).length / known.length : -1;
    };
    const cmp: Record<Sort, (a: Row, b: Row) => number> = {
      reviews: (a, b) => b.reviews - a.reviews || a.name.localeCompare(b.name),
      price: (a, b) => avg(b) - avg(a),
      booked: (a, b) => bookedShare(b) - bookedShare(a),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return GROUPS.map((g) => {
      const list = rows.filter((r) => r.beds === g).sort(cmp[sort]);
      const typical = new Map(
        columns.map((i) => [i, median(list.map((r) => r.prices.get(i)).filter((p): p is number => p != null))] as const),
      );
      return { g, list, typical };
    }).filter((x) => x.list.length);
  }, [allRows, platform, areas, beds, q, sort, columns]);

  const colLabel = (i: number) => {
    const d = new Date(dateOf(data.from, i) + "T00:00:00Z");
    return {
      dow: d.toLocaleString("en-GB", { weekday: "short", timeZone: "UTC" }),
      day: d.toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
      weekend: [5, 6].includes(d.getUTCDay()),
    };
  };

  const cell = (r: Row, i: number) => {
    const p = r.prices.get(i);
    const s = r.status(i);
    const label = `${r.name} · ${colLabel(i).dow} ${colLabel(i).day}`;
    if (p != null)
      return (
        <td
          key={i}
          className="border-l border-line px-2 py-1 text-right"
          {...tipProps(t, () => (
            <div>
              <div className="font-semibold">
                {aud(p)} · {idr(p)} a night
              </div>
              <div className="opacity-80">{label}</div>
              <div className="opacity-60">
                {r.platform === "web" ? "1 night on this date, incl. taxes" : `2-night stay from this date${r.platform === "booking" ? ", incl. taxes and fees" : ", before taxes"}`}
              </div>
            </div>
          ))}
        >
          <div className="text-xs font-medium">{aud(p)}</div>
          <div className="text-[10px] text-faint">{idr(p)}</div>
        </td>
      );
    if (s === true)
      return (
        <td key={i} className="border-l border-line px-1 py-1" {...tipProps(t, () => `${label}: booked or unavailable`)}>
          <div className="rounded-sm py-1.5 text-center text-[10px] text-white" style={{ background: "var(--seq-5)" }}>
            booked
          </div>
        </td>
      );
    return (
      <td
        key={i}
        className="border-l border-line px-2 py-1 text-center text-[10px] text-faint"
        {...tipProps(t, () =>
          s === false ? `${label}: open, but its price wasn't checked for this date` : `${label}: not checked`,
        )}
      >
        {s === false ? "open" : "·"}
      </td>
    );
  };

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Nightly rates</h1>
        <p className="mt-1 text-sm text-muted">
          What every place charges a night, date by date, grouped by bedrooms. Prices are for a 2-night stay starting that
          date (1 night for websites). Airbnb is before taxes; Booking.com and websites include taxes. A$1 = Rp{" "}
          {Math.round(data.audRate).toLocaleString("en-AU")} ({data.rateDate}).
        </p>
      </div>

      <div className="mb-4 grid gap-2">
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:flex-wrap">
          <Chip on={areas.length === 0} onClick={() => setAreas([])}>
            All beaches
          </Chip>
          {data.areas.map((a) => (
            <Chip key={a} on={areas.includes(a)} onClick={() => setAreas(toggle(areas, a))}>
              {a}
            </Chip>
          ))}
        </div>
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:flex-wrap">
          <span className="shrink-0 text-xs text-faint">Bedrooms</span>
          {GROUPS.map((g) => (
            <Chip key={g} on={beds.includes(g)} onClick={() => setBeds(toggle(beds, g))}>
              {g}
            </Chip>
          ))}
          <span className="ml-3 shrink-0 text-xs text-faint">Site</span>
          {(
            [
              ["airbnb", "Airbnb"],
              ["booking", "Booking.com"],
              ["web", "Websites"],
              ["all", "All"],
            ] as const
          ).map(([k, l]) => (
            <Chip key={k} on={platform === k} onClick={() => setPlatform(k)}>
              {l}
            </Chip>
          ))}
          <span className="ml-3 shrink-0 text-xs text-faint">Dates</span>
          {RANGES.map((r) => (
            <Chip key={r.days} on={days === r.days} onClick={() => setDays(r.days)}>
              {r.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a place by name…"
            className="w-64 rounded-full border border-line bg-panel px-4 py-1.5 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded border border-line bg-panel px-2 py-1">
              <option value="reviews">Most reviewed</option>
              <option value="price">Highest price</option>
              <option value="booked">Most booked</option>
              <option value="name">Name</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={pricedOnly} onChange={(e) => setPricedOnly(e.target.checked)} />
            Only dates with prices checked
          </label>
          <span className="ml-auto flex items-center gap-3 text-xs text-muted">
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-5 rounded-sm" style={{ background: "var(--seq-5)" }} /> booked
            </span>
            <span>open = available, price not checked that date</span>
          </span>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted">No places match these filters.</p>
      ) : columns.length === 0 ? (
        <p className="text-sm text-muted">No prices checked in this date range yet. Untick &ldquo;Only dates with prices checked&rdquo; to see bookings.</p>
      ) : (
        <div className="max-h-[75vh] overflow-auto rounded-lg border border-line bg-panel">
          <table className="tabular border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20 bg-panel">
              <tr>
                <th className="sticky left-0 z-30 min-w-64 border-b border-line bg-panel px-3 py-2 text-left text-xs font-medium text-muted">
                  Place
                </th>
                {columns.map((i) => {
                  const c = colLabel(i);
                  return (
                    <th
                      key={i}
                      className={`min-w-[4.75rem] border-b border-l border-line px-2 py-1.5 text-right text-[11px] font-medium ${c.weekend ? "text-ink" : "text-muted"}`}
                    >
                      <div>{c.dow}</div>
                      <div className="whitespace-nowrap">{c.day}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {groups.map(({ g, list, typical }) => {
                const open = expanded[g];
                const shown = open ? list : list.slice(0, 25);
                return (
                  <Fragment key={g}>
                    <tr>
                      <th
                        className="sticky left-0 z-10 border-b border-t-2 border-line bg-accent-soft px-3 py-2 text-left text-sm font-semibold"
                        style={{ borderTopColor: "var(--axis)" }}
                      >
                        {g === "1" ? "1 bedroom" : `${g} bedrooms`}
                        <span className="ml-2 text-xs font-normal text-muted">{list.length} places · typical rate</span>
                      </th>
                      {columns.map((i) => {
                        const v = typical.get(i) ?? null;
                        return (
                          <td key={i} className="border-b border-l border-t-2 border-line bg-accent-soft px-2 py-1 text-right" style={{ borderTopColor: "var(--axis)" }}>
                            <div className="text-xs font-semibold">{aud(v)}</div>
                            <div className="text-[10px] text-faint">{v == null ? "" : idr(v)}</div>
                          </td>
                        );
                      })}
                    </tr>
                    {shown.map((r) => (
                      <tr key={r.key} className="hover:bg-accent-soft/60">
                        <td className="sticky left-0 z-10 max-w-72 border-b border-line bg-panel px-3 py-1.5">
                          <div className="flex items-center gap-1.5">
                            {r.platform === "airbnb" && <StarButton id={r.id} watched={data.watched.includes(r.id)} />}
                            {r.external ? (
                              <a href={r.href} target="_blank" rel="noreferrer" className="truncate text-sm hover:text-accent">
                                {r.name}
                              </a>
                            ) : (
                              <Link href={r.href} className="truncate text-sm hover:text-accent">
                                {r.name}
                              </Link>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-muted">
                            {r.area} · {r.platform === "airbnb" ? "Airbnb" : r.platform === "booking" ? "Booking.com" : "Own website"}
                            {r.rating ? ` · ★ ${r.rating}` : ""}
                          </div>
                        </td>
                        {columns.map((i) => cell(r, i))}
                      </tr>
                    ))}
                    {list.length > 25 && (
                      <tr>
                        <td className="sticky left-0 border-b border-line bg-panel px-3 py-2" colSpan={1}>
                          <button type="button" className="text-xs text-accent hover:underline" onClick={() => setExpanded({ ...expanded, [g]: !open })}>
                            {open ? "Show fewer" : `Show all ${list.length}`}
                          </button>
                        </td>
                        <td colSpan={columns.length} className="border-b border-line" />
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
