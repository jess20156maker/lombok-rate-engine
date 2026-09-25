import type { ReactNode } from "react";

export function Card({ title, children, note }: { title?: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      {title && <h2 className="mb-3 text-sm font-semibold">{title}</h2>}
      {children}
      {note && <p className="mt-3 text-xs text-muted">{note}</p>}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Background for a 0..1 blocked share on the shared five-step scale. */
export function heat(share: number | null) {
  if (share == null) return "transparent";
  const step = Math.min(4, Math.floor(share * 5));
  return `var(--heat-${step})`;
}

export function heatText(share: number | null) {
  return share != null && share >= 0.6 ? "#fff" : undefined;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold tracking-tight">{children}</h1>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </div>
  );
}

export const th = "px-3 py-2 text-left text-xs font-medium text-muted whitespace-nowrap";
export const td = "px-3 py-2 whitespace-nowrap";
