import Link from "next/link";
import { Card, PageTitle, heat, heatText, td, th } from "@/components/ui";
import { StarButton } from "@/components/star-button";
import { BEDROOM_GROUPS, bedroomGroup, loadMarket, type ListingStats } from "@/lib/data";
import { watchedIds } from "@/lib/watch";
import { pct, rupiah } from "@/lib/format";

const SORTS: Record<string, { label: string; key: (l: ListingStats) => number | string | null; desc?: boolean }> = {
  blocked30: { label: "Blocked 30d", key: (l) => l.blocked30, desc: true },
  blocked90: { label: "Blocked 90d", key: (l) => l.blocked90, desc: true },
  price: { label: "Nightly", key: (l) => l.medianNightly, desc: true },
  bedrooms: { label: "Beds", key: (l) => l.bedrooms, desc: true },
  name: { label: "Name", key: (l) => l.name.toLowerCase() },
};

export default async function ListingsPage(props: PageProps<"/listings">) {
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const area = one(sp.area);
  const beds = one(sp.beds);
  const q = one(sp.q).toLowerCase();
  const sort = SORTS[one(sp.sort)] ? one(sp.sort) : "blocked30";
  const showDormant = one(sp.dormant) === "1";

  const [m, watched] = await Promise.all([loadMarket(), watchedIds()]);
  const areas = [...new Set(m.stats.map((s) => s.area))].sort();
  const s = SORTS[sort];
  const rows = m.stats
    .filter((l) => !area || l.area === area)
    .filter((l) => !beds || bedroomGroup(l.bedrooms) === beds)
    .filter((l) => !q || l.name.toLowerCase().includes(q))
    .filter((l) => showDormant || q !== "" || !l.dormant)
    .sort((a, b) => {
      const x = s.key(a), y = s.key(b);
      if (x == null) return 1;
      if (y == null) return -1;
      const c = x < y ? -1 : x > y ? 1 : 0;
      return s.desc ? -c : c;
    });

  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ area, beds, q, sort, dormant: showDormant ? "1" : "", ...patch });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/listings?${p}`;
  };

  return (
    <>
      <PageTitle sub={`${rows.length} of ${m.stats.length} listings`}>Listings</PageTitle>

      <form className="mb-4 flex flex-wrap items-end gap-3 text-sm" action="/listings">
        <label className="grid gap-1">
          <span className="text-xs text-muted">Area</span>
          <select name="area" defaultValue={area} className="rounded border border-line bg-panel px-2 py-1.5">
            <option value="">All areas</option>
            {areas.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted">Bedrooms</span>
          <select name="beds" defaultValue={beds} className="rounded border border-line bg-panel px-2 py-1.5">
            <option value="">Any</option>
            {BEDROOM_GROUPS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted">Name contains</span>
          <input name="q" defaultValue={q} className="rounded border border-line bg-panel px-2 py-1.5" />
        </label>
        <label className="flex items-center gap-2 pb-1.5">
          <input type="checkbox" name="dormant" value="1" defaultChecked={showDormant} />
          <span>Include dormant</span>
        </label>
        <input type="hidden" name="sort" value={sort} />
        <button className="rounded bg-accent px-3 py-1.5 font-medium text-white dark:text-black">Filter</button>
      </form>

      <Card>
        <div className="overflow-x-auto">
          <table className="tabular w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>
                  <Link href={link({ sort: "name" })}>Name</Link>
                </th>
                <th className={th}>Area</th>
                {(["bedrooms", "blocked30", "blocked90", "price"] as const).map((k) => (
                  <th key={k} className={th}>
                    <Link href={link({ sort: k })} className={sort === k ? "text-ink" : ""}>
                      {SORTS[k].label}
                      {sort === k ? " ↓" : ""}
                    </Link>
                  </th>
                ))}
                <th className={th}>Rating</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className={`${td} max-w-[22rem] truncate`}>
                    <span className="mr-1.5 align-middle">
                      <StarButton id={l.id} watched={watched.has(l.id)} />
                    </span>
                    <Link href={`/listings/${l.id}`} className="text-accent hover:underline">
                      {l.name || l.id}
                    </Link>
                    {l.dormant && <span className="ml-2 text-xs text-muted">dormant</span>}
                  </td>
                  <td className={td}>{l.area}</td>
                  <td className={td}>{l.bedrooms ?? "–"}</td>
                  <td className={td} style={{ background: heat(l.blocked30), color: heatText(l.blocked30) }}>
                    {pct(l.blocked30)}
                  </td>
                  <td className={td} style={{ background: heat(l.blocked90), color: heatText(l.blocked90) }}>
                    {pct(l.blocked90)}
                  </td>
                  <td className={td}>{rupiah(l.medianNightly)}</td>
                  <td className={`${td} text-muted`}>{l.rating ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
