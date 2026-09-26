import { headers } from "next/headers";
import { connection } from "next/server";
import { CalendarView } from "@/components/calendar-view";
import { loadVilla } from "@/lib/villa";

export default async function CalendarPage() {
  await connection();
  const [villa, h] = await Promise.all([loadVilla(), headers()]);
  if (!villa) return <p className="text-muted">No villa set up yet.</p>;
  // The public address the channels will fetch the feed from.
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "lombok-rate-engine.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return <CalendarView villa={villa} origin={`${proto}://${host}`} />;
}
