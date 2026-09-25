"use client";

import type { Filters, WindowKey } from "@/lib/explore-calc";

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: "30", label: "Next 30 days" },
  { key: "90", label: "Next 90 days" },
  { key: "180", label: "Next 6 months" },
  { key: "365", label: "Next 12 months" },
];

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors ${
        on ? "border-accent bg-accent text-white dark:text-black" : "border-line bg-panel text-muted hover:border-faint hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function FilterBar({
  filters,
  setFilters,
  areas,
  areaCounts,
  months,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  areas: string[];
  areaCounts: Record<string, number>;
  months: { key: string; label: string }[];
}) {
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="z-30 -mx-4 mb-6 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur lg:sticky lg:top-0">
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
        <Chip on={filters.areas.length === 0} onClick={() => setFilters({ ...filters, areas: [] })}>
          All beaches
        </Chip>
        {areas.map((a) => (
          <Chip
            key={a}
            on={filters.areas.includes(a)}
            onClick={() => setFilters({ ...filters, areas: toggle(filters.areas, a) })}
            title={`${areaCounts[a] ?? 0} places`}
          >
            {a} <span className="opacity-60">{areaCounts[a] ?? 0}</span>
          </Chip>
        ))}
      </div>
      <div className="-mx-4 mt-2 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
        <span className="mr-1 shrink-0 text-xs text-faint">Bedrooms</span>
        {["1", "2", "3", "4+"].map((b) => (
          <Chip key={b} on={filters.beds.includes(b)} onClick={() => setFilters({ ...filters, beds: toggle(filters.beds, b) })}>
            {b}
          </Chip>
        ))}
        <span className="ml-3 mr-1 shrink-0 text-xs text-faint">When</span>
        {WINDOWS.map((w) => (
          <Chip key={w.key} on={filters.window === w.key} onClick={() => setFilters({ ...filters, window: w.key })}>
            {w.label}
          </Chip>
        ))}
        <select
          aria-label="Pick a month"
          value={filters.window.startsWith("m:") ? filters.window : ""}
          onChange={(e) => e.target.value && setFilters({ ...filters, window: e.target.value as WindowKey })}
          className={`shrink-0 rounded-full border px-3 py-1 text-sm ${
            filters.window.startsWith("m:") ? "border-accent bg-accent text-white dark:text-black" : "border-line bg-panel text-muted"
          }`}
        >
          <option value="">A month…</option>
          {months.map((m) => (
            <option key={m.key} value={`m:${m.key}`}>
              {m.label}
            </option>
          ))}
        </select>
        <label className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-muted">
          <input
            type="checkbox"
            checked={filters.includeDormant}
            onChange={(e) => setFilters({ ...filters, includeDormant: e.target.checked })}
          />
          Include places closed all year
        </label>
      </div>
    </div>
  );
}
