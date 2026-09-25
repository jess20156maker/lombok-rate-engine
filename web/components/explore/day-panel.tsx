"use client";

import { useState } from "react";
import type { DayStat, Insight } from "@/lib/explore-calc";
import { occFill } from "./year-heatmap";

// Small line icons, one per insight kind. Colour stays in ink; the tone arrow carries direction.
const ICONS: Record<Insight["kind"], string> = {
  event: "M4 20V4m0 0h11l-2 4 2 4H4",
  holiday: "M12 3v2m0 14v2M3 12h2m14 0h2M6 6l1.5 1.5m9 9L18 18M6 18l1.5-1.5m9-9L18 6M12 8a4 4 0 100 8 4 4 0 000-8z",
  school: "M3 9l9-5 9 5-9 5-9-5zm4 2.5V16c0 1 2.5 3 5 3s5-2 5-3v-4.5",
  season: "M3 17c3-2 6 2 9 0s6-2 9 0M3 12c3-2 6 2 9 0s6-2 9 0",
  rank: "M4 20h16M7 16V9m5 7V5m5 11v-4",
  weekend: "M4 7h16v13H4zM4 11h16M8 3v4m8-4v4",
  price: "M12 3v18m4-14H10a2.5 2.5 0 000 5h4a2.5 2.5 0 010 5H7",
  minstay: "M5 12h14M12 5v14M8 8l-3 4 3 4m8-8l3 4-3 4",
  momentum: "M4 16l5-5 4 4 7-7m0 0h-5m5 0v5",
  timing: "M12 7v5l3 2M12 3a9 9 0 110 18 9 9 0 010-18z",
};

function Icon({ kind }: { kind: Insight["kind"] }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[kind]} />
    </svg>
  );
}

const TONE = {
  up: { sign: "▲", label: "pushes demand up", color: "var(--up)" },
  down: { sign: "▼", label: "holds demand down", color: "var(--down)" },
  neutral: { sign: "•", label: "context", color: "var(--faint)" },
};

export function DayPanel({
  day,
  insights,
  scope,
  shareUrl,
}: {
  day: DayStat | null;
  insights: Insight[];
  scope: string;
  shareUrl: () => string;
}) {
  const [copied, setCopied] = useState(false);

  if (!day || day.occ == null) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">
        Click any day on the calendar to see how booked it is, and why.
      </div>
    );
  }

  const label = new Date(day.date + "T00:00:00Z").toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const pctBooked = Math.round(day.occ * 100);

  const share = async () => {
    const lines = [
      `${label}, ${scope}: ${pctBooked}% booked (${day.total - day.blocked} of ${day.total} places open).`,
      ...insights.map((i) => `• ${i.title}${i.detail ? `: ${i.detail}` : ""}`),
      shareUrl(),
    ];
    const text = lines.join("\n");
    try {
      if (navigator.share) await navigator.share({ title: `${label}: ${pctBooked}% booked`, text });
      else await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* share sheet dismissed */
    }
  };

  return (
    <div key={day.i} className="rise rounded-lg border border-line bg-panel p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 flex items-end gap-3">
        <div className="text-5xl font-semibold tracking-tight">{pctBooked}%</div>
        <div className="pb-1.5 text-sm text-muted">booked · {scope}</div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pctBooked}%`, background: occFill(day.occ) }} />
      </div>
      <div className="mt-1 text-xs text-muted">
        {day.total - day.blocked} of {day.total} places still open
      </div>

      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-faint">Why</h3>
      {insights.length === 0 ? (
        <p className="text-sm text-muted">Nothing unusual about this night: close to typical for this selection.</p>
      ) : (
        <ul className="grid gap-3">
          {insights.map((ins, i) => (
            <li key={i} className="rise flex gap-3" style={{ animationDelay: `${i * 60}ms` }}>
              <span className="mt-0.5 text-muted">
                <Icon kind={ins.kind} />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  <span className="mr-1.5 text-xs" style={{ color: TONE[ins.tone].color }} title={TONE[ins.tone].label}>
                    {TONE[ins.tone].sign}
                  </span>
                  {ins.title}
                </div>
                {ins.detail && <div className="mt-0.5 text-sm text-muted">{ins.detail}</div>}
                {ins.source && (
                  <a href={ins.source} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                    source ↗
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={share}
        className="mt-5 w-full rounded-md border border-line py-2 text-sm font-medium transition-colors hover:border-accent hover:text-accent"
      >
        {copied ? "Copied ✓" : "Share this insight"}
      </button>
    </div>
  );
}
