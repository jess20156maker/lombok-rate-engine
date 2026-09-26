import { connection } from "next/server";
import { RatesTable } from "@/components/rates-table";
import { loadExplore } from "@/lib/explore";

export default async function RatesPage() {
  await connection();
  const data = await loadExplore();
  if (!data) return <p className="text-muted">No data collected yet.</p>;
  return <RatesTable data={data} />;
}
