"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { StarButton } from "@/components/star-button";
import type { ExploreData } from "@/lib/explore-types";
import { fmt } from "@/lib/money";

type SortKey = "booked30" | "booked90" | "price" | "beds" | "name" | "reviews";
type Site = "all" | "airbnb" | "booking";

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};
const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);
const reviewCount = (r: string | null) => Number(/\((\d+)\)/.exec(r ?? "")?.[1] ?? 0);

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

export function ListingsTable({ data, initial }: { data: ExploreData; initial: { area: string; q: string } }) {
  const [areas, setAreas] = useState<string[]>(initial.area ? [initial.area] : []);
  const [beds, setBeds] = useState<string[]>([]);
  const [site, setSite] = useState<Site>("all");
  const [q, setQ] = useState(initial.q);
  const [dormant, setDormant] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "booked30", desc: true });
  const [limit, setLimit] = useState(100);
  const aud = (n: number | null) => fmt(n, { currency: "AUD", audRate: data.audRate, rateDate: "" });
  const idr = (n: number | null) => fmt(n, { currency: "IDR", audRate: data.audRate, rateDate: "" });
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  // One row per place (Airbnb and Booking.com-only), figures computed once.
  const rows = useMemo(() => {
    const priceBy = new Map<number, number[]>();
    for (const [d, arr] of Object.entries(data.prices))
      if (Number(d) < 90) for (const [li, p] of arr) priceBy.set(li, [...(priceBy.get(li) ?? []), p]);
    const share = (s: string, n: number) => {
      const known = [...s.slice(0, n)].filter((c) => c !== "?");
      return known.length ? known.filter((c) => c === "0").length / known.length : null;
    };
    return data.listings.map((l, li) => ({
      l,
      booked30: share(l.nights, 30),
      booked90: share(l.nights, 90),
      price: median(priceBy.get(li) ?? []),
      reviews: reviewCount(l.rating),
    }));
  }, [data]);

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const val = (r: (typeof rows)[number]): number | string | null =>
      sort.key === "name" ? r.l.name.toLowerCase() : sort.key === "beds" ? r.l.bedrooms : r[sort.key];
    return rows
      .filter((r) => site === "all" || r.l.platform === site)
      .filter((r) => !areas.length || areas.includes(r.l.area))
      .filter((r) => !beds.length || beds.includes(r.l.beds))
      .filter((r) => !ql || r.l.name.toLowerCase().includes(ql))
      .filter((r) => dormant || ql || !r.l.dormant)
      .sort((a, b) => {
        const x = val(a);
        const y = val(b);
        if (x == null) return 1;
        if (y == null) return -1;
        const c = x < y ? -1 : x > y ? 1 : 0;
        return sort.desc ? -c : c;
      });
  }, [rows, site, areas, beds, q, dormant, sort]);

  const head = (key: SortKey, label: string, right = false) => (
    <th className={`whitespace-nowrap px-3 py-2 text-xs font-medium text-muted ${right ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : key !== "name" })}
        className={sort.key === key ? "text-ink" : "hover:text-ink"}
      >
        {label}
        {sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Listings</h1>
        <p className="mt-1 text-sm text-muted">
          {shown.length} of {rows.length} places · Airbnb and Booking.com (a place on both is listed once, as its Airbnb listing). Tap a
          heading to sort.
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
          {["1", "2", "3", "4+"].map((b) => (
            <Chip key={b} on={beds.includes(b)} onClick={() => setBeds(toggle(beds, b))}>
              {b}
            </Chip>
          ))}
          <span className="ml-3 shrink-0 text-xs text-faint">Site</span>
          {(
            [
              ["all", "Both"],
              ["airbnb", "Airbnb"],
              ["booking", "Booking.com only"],
            ] as const
          ).map(([k, label]) => (
            <Chip key={k} on={site === k} onClick={() => setSite(k)}>
              {label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a place by name…"
            className="w-64 rounded-full border border-line bg-panel px-4 py-1.5 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
          />
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={dormant} onChange={(e) => setDormant(e.target.checked)} />
            Include places closed all year
          </label>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="tabular w-full text-sm">
          <thead className="border-b border-line">
            <tr>
              {head("name", "Name")}
              <th className="px-3 py-2 text-left text-xs font-medium text-muted">Area</th>
              {head("beds", "Beds", true)}
              {head("booked30", "Booked 30d", true)}
              {head("booked90", "Booked 90d", true)}
              {head("price", "Typical nightly", true)}
              {head("reviews", "Rating", true)}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map(({ l, booked30, booked90, price }) => (
              <tr key={`${l.platform}:${l.id}`} className="border-b border-line last:border-0 hover:bg-accent-soft/50">
                <td className="max-w-[24rem] px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <StarButton id={l.id} platform={l.platform} watched={data.watched.includes(`${l.platform}:${l.id}`)} />
                    {l.platform === "airbnb" ? (
                      <Link href={`/listings/${l.id}`} className="truncate text-accent hover:underline">
                        {l.name || l.id}
                      </Link>
                    ) : (
                      <a href={l.url} target="_blank" rel="noreferrer" className="truncate text-accent hover:underline">
                        {l.name || l.id}
                      </a>
                    )}
                  </div>
                  <div className="pl-6 text-[11px] text-muted">
                    {l.platform === "airbnb" ? (l.bookingSlug ? "Airbnb + Booking.com" : "Airbnb") : "Booking.com only"}
                    {l.dormant ? " · closed all year" : ""}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{l.area}</td>
                <td className="px-3 py-2 text-right">{l.bedrooms ?? "–"}</td>
                <td className="px-3 py-2 text-right">{pct(booked30)}</td>
                <td className="px-3 py-2 text-right">{pct(booked90)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right" title={price != null ? `${aud(price)} · ${idr(price)} a night` : undefined}>
                  {aud(price)}
                  <span className="block text-[10px] text-faint">{price != null ? idr(price) : ""}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-muted">{l.rating ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > limit && (
        <button type="button" onClick={() => setLimit(limit + 200)} className="mt-3 text-sm text-accent hover:underline">
          Show more ({shown.length - limit} left)
        </button>
      )}
    </div>
  );
}
