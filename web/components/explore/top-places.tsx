"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { StarButton } from "@/components/star-button";
import { rankPlaces, type RankBy } from "@/lib/explore-calc";
import type { ExploreData } from "@/lib/explore-types";
import { tipProps, useTooltip } from "./tooltip";
import { occFill } from "./year-heatmap";

const pct = (v: number) => `${Math.round(v * 100)}%`;

const SORTS: { key: RankBy; label: string }[] = [
  { key: "occ", label: "Most booked" },
  { key: "value", label: "Highest booked value" },
  { key: "price", label: "Highest price" },
];

/** A thin strip of the window's nights: dark = blocked. */
function NightStrip({ nights }: { nights: string }) {
  // Squash long windows into at most 90 buckets so the strip stays readable.
  const buckets = Math.min(90, nights.length);
  const per = nights.length / buckets;
  const cells = Array.from({ length: buckets }, (_, b) => {
    const part = nights.slice(Math.floor(b * per), Math.floor((b + 1) * per)) || nights[Math.floor(b * per)] || "";
    return part.length ? [...part].filter((c) => c === "0").length / part.length : 0;
  });
  return (
    <span className="flex h-3 w-full overflow-hidden rounded-sm" aria-hidden>
      {cells.map((c, i) => (
        <span key={i} className="h-full flex-1" style={{ background: c > 0 ? occFill(Math.max(c, 0.5)) : "var(--seq-0)" }} />
      ))}
    </span>
  );
}

export function TopPlaces({
  data,
  idx,
  range,
  areas,
  aud,
  idr,
  windowLabel,
}: {
  aud: (n: number | null) => string;
  idr: (n: number | null) => string;
  data: ExploreData;
  idx: number[];
  range: [number, number];
  areas: string[]; // areas in view, west to east
  windowLabel: string;
}) {
  const t = useTooltip();
  const [by, setBy] = useState<RankBy>("occ");
  const [picked, setPicked] = useState<string | null>(null);
  // New places with no reviews that show as fully blocked are often not live yet.
  const [reviewedOnly, setReviewedOnly] = useState(true);
  const area = picked && areas.includes(picked) ? picked : areas[0];

  const rows = useMemo(() => {
    const inArea = idx.filter((li) => data.listings[li].area === area && (!reviewedOnly || data.listings[li].rating));
    return { list: rankPlaces(data, inArea, range, by).slice(0, 10), total: inArea.length };
  }, [data, idx, range, by, area, reviewedOnly]);

  return (
    <section className="mb-6 rounded-lg border border-line bg-panel p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Top 10 places by beach</h2>
          <p className="mt-0.5 text-xs text-muted">
            Ranked on {windowLabel}. <strong className="font-medium text-ink">Booked value</strong> = nights already booked in{" "}
            {windowLabel} × the place&apos;s typical nightly price. It looks ahead, so it&apos;s what&apos;s on the books, not
            what&apos;s been earned. Change the time window at the top to see other periods.
          </p>
        </div>
        <div className="flex gap-1 rounded-full border border-line p-0.5 text-xs">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setBy(s.key)}
              aria-pressed={by === s.key}
              className={`rounded-full px-3 py-1 ${by === s.key ? "bg-accent text-white dark:text-black" : "text-muted hover:text-ink"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={reviewedOnly} onChange={(e) => setReviewedOnly(e.target.checked)} />
        Only places with reviews (new places that look fully booked are often not taking guests yet)
      </label>

      <div className="-mx-5 mt-3 flex gap-1 overflow-x-auto border-b border-line px-5 [scrollbar-width:none]">
        {areas.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setPicked(a)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 pb-2 text-sm transition-colors ${
              a === area ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {rows.list.length === 0 ? (
        <p className="py-6 text-sm text-muted">No places match these filters here.</p>
      ) : (
        <ol className="mt-2">
          {rows.list.map((r, rank) => {
            const l = data.listings[r.li];
            return (
              <li key={l.id} className="rise border-b border-line last:border-0" style={{ animationDelay: `${rank * 30}ms` }}>
                <div className="grid grid-cols-[1.75rem_1fr_auto] items-center gap-x-3 gap-y-1 py-3 sm:grid-cols-[1.75rem_minmax(0,1.6fr)_minmax(0,1fr)_4rem_6.5rem_7rem]">
                  <span className="tabular text-lg font-semibold text-faint">{rank + 1}</span>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <StarButton id={l.id} watched={data.watched.includes(l.id)} />
                      <Link href={`/listings/${l.id}`} className="block truncate text-sm font-medium hover:text-accent">
                        {l.name || "Untitled"}
                      </Link>
                    </div>
                    <div className="truncate text-xs text-muted">
                      {l.bedrooms == null ? "" : l.bedrooms === 0 ? "Studio · " : `${l.bedrooms} bed · `}
                      {l.rating ? `★ ${l.rating}` : "New / no reviews"}
                      {" · "}
                      <a href={`https://www.airbnb.com/rooms/${l.id}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                        Airbnb ↗
                      </a>
                    </div>
                  </div>

                  <div
                    className="col-span-3 col-start-2 row-start-2 sm:col-span-1 sm:col-start-auto sm:row-start-auto"
                    {...tipProps(t, () => `${r.bookedNights} of ${r.nights} nights blocked in ${windowLabel}`)}
                  >
                    <NightStrip nights={l.nights.slice(range[0], range[1])} />
                  </div>

                  <div className="tabular row-start-1 text-right sm:row-start-auto">
                    <div className="text-sm font-semibold">{pct(r.occ)}</div>
                    <div className="text-[10px] text-faint">booked</div>
                  </div>
                  <div className="tabular hidden text-right sm:block">
                    <div className="text-sm">{aud(r.price)}</div>
                    <div className="text-[10px] text-faint">{idr(r.price)} a night</div>
                  </div>
                  <div className="tabular hidden text-right sm:block">
                    <div className="text-sm">{aud(r.value)}</div>
                    <div className="text-[10px] text-faint">{idr(r.value)}</div>
                    <div className="text-[10px] text-faint">booked, {windowLabel.replace(/^the /, "")}</div>
                  </div>
                </div>
                {r.fullyBlocked && (
                  <p className="-mt-2 mb-2 pl-10 text-xs text-muted">
                    Blocked every night: could be fully booked, or closed by the host.
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-3 text-xs text-faint">
        Showing {Math.min(10, rows.total)} of {rows.total} places at {area} matching your filters
        {reviewedOnly ? " (with reviews)" : ""}.
      </p>
    </section>
  );
}
