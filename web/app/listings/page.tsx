import { connection } from "next/server";
import { ListingsTable } from "@/components/listings-table";
import { loadExplore } from "@/lib/explore";

export default async function ListingsPage(props: PageProps<"/listings">) {
  await connection();
  const [data, sp] = await Promise.all([loadExplore(), props.searchParams]);
  if (!data) return <p className="text-muted">No data collected yet.</p>;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  // Links from other pages can pre-select a beach or a name search.
  return <ListingsTable data={data} initial={{ area: data.areas.includes(one(sp.area)) ? one(sp.area) : "", q: one(sp.q).slice(0, 80), onlyNew: one(sp.new) === "1" }} />;
}
