import { connection } from "next/server";
import { Explore, type InitialState } from "@/components/explore/explore";
import { loadExplore } from "@/lib/explore";
import type { WindowKey } from "@/lib/explore-calc";

export default async function ExplorePage(props: PageProps<"/">) {
  await connection();
  const [data, sp] = await Promise.all([loadExplore(), props.searchParams]);
  if (!data) {
    return <p className="text-muted">No data collected yet. The nightly run fills this in.</p>;
  }

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const list = (v: string) => (v ? v.split(",").filter(Boolean) : []);
  const when = one(sp.when);
  const validWindow = ["30", "90", "180", "365"].includes(when) || /^m:\d{4}-\d{2}$/.test(when);
  const dayDate = one(sp.day);
  const dayIdx = dayDate ? Math.round((Date.parse(dayDate) - Date.parse(data.from)) / 86_400_000) : null;

  const initial: InitialState = {
    areas: list(one(sp.areas)).filter((a) => data.areas.includes(a)),
    beds: list(one(sp.beds)).filter((b) => ["1", "2", "3", "4+"].includes(b)),
    window: (validWindow ? when : "90") as WindowKey,
    includeDormant: one(sp.dormant) === "1",
    day: dayIdx != null && dayIdx >= 0 && dayIdx < data.days ? dayIdx : null,
    currency: one(sp.cur) === "AUD" ? "AUD" : one(sp.cur) === "IDR" ? "IDR" : null,
  };

  return <Explore data={data} initial={initial} />;
}
