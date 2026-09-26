import { connection } from "next/server";
import { PricingView } from "@/components/pricing-view";
import { loadVilla } from "@/lib/villa";

export default async function PricingPage() {
  await connection();
  const villa = await loadVilla();
  if (!villa) return <p className="text-muted">No villa set up yet.</p>;
  if (!villa.recommendations.length) return <p className="text-muted">No prices yet: they&apos;re worked out after the nightly collection.</p>;
  return <PricingView villa={villa} />;
}
