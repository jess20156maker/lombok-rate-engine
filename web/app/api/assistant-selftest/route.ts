// Development-only check of the assistant's tool loop with a scripted stand-in
// for the model (no API calls, no cost). Returns 404 in production.

import { runAssistant } from "@/lib/assistant";

export async function GET() {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const script = [
    [
      { type: "tool_use", id: "t1", name: "explain_night", input: { date: "2026-10-10" } },
      { type: "tool_use", id: "t2", name: "get_prices", input: { from: "2026-10-08", to: "2026-10-12" } },
      { type: "tool_use", id: "t3", name: "market_snapshot", input: { from: "2026-11-01", to: "2026-11-30", beaches: ["Selong Belanak"] } },
      { type: "tool_use", id: "t4", name: "list_bookings", input: { from: "2026-09-26", to: "2027-09-26" } },
    ],
    [
      { type: "tool_use", id: "t5", name: "propose_block", input: { from: "2026-12-01", until: "2026-12-04", reason: "maintenance" } },
      { type: "tool_use", id: "t6", name: "propose_price", input: { from: "2026-12-24", to: "2026-12-26", price_aud: 650, min_stay: 3, note: "Christmas" } },
      { type: "tool_use", id: "t7", name: "propose_price", input: { from: "not-a-date", to: "2026-12-26", price_aud: 650, min_stay: null, note: "x" } },
    ],
    [{ type: "text", text: "Here you go." }],
  ];
  const seen: unknown[] = [];
  let turn = 0;
  const fake = {
    beta: {
      messages: {
        create: async (params: any) => {
          const last = params.messages.at(-1);
          if (Array.isArray(last?.content)) seen.push(...last.content.map((c: any) => ({ tool: c.tool_use_id, error: !!c.is_error, content: String(c.content).slice(0, 300) })));
          const content = script[turn++];
          return { content, stop_reason: content[0].type === "tool_use" ? "tool_use" : "end_turn" } as any;
        },
      },
    },
  };
  const result = await runAssistant([{ role: "user", text: "test" }], fake);
  return Response.json({ result, toolResults: seen });
}
