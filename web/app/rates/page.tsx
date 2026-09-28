import { connection } from "next/server";
import { RatesTable } from "@/components/rates-table";
import { loadExplore } from "@/lib/explore";

export default async function RatesPage(props: PageProps<"/rates">) {
  await connection();
  const [data, sp] = await Promise.all([loadExplore(), props.searchParams]);
  if (!data) return <p className="text-muted">No data collected yet.</p>;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  return <RatesTable data={data} initialQuery={q} />;
}
