// POST { history: [{ role, text }] } → { reply, proposals }
// Behind the dashboard password (proxy.ts). Needs ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";
import { runAssistant, type ChatTurn } from "@/lib/assistant";

export const maxDuration = 120;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ setup: true, reply: "The assistant isn't switched on yet: it needs an Anthropic API key." }, { status: 503 });
  }
  let history: ChatTurn[];
  try {
    const body = await req.json();
    history = (body.history as ChatTurn[])
      .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text.trim())
      .slice(-20)
      .map((t) => ({ role: t.role, text: t.text.slice(0, 4000) }));
    if (!history.length || history[0].role !== "user") throw new Error();
  } catch {
    return Response.json({ reply: "I didn't get a question." }, { status: 400 });
  }
  try {
    return Response.json(await runAssistant(history));
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return Response.json({ setup: true, reply: "The Anthropic API key isn't valid." }, { status: 503 });
    if (err instanceof Anthropic.RateLimitError) return Response.json({ reply: "I'm getting too many questions right now; try again in a minute." }, { status: 429 });
    if (err instanceof Anthropic.APIError) return Response.json({ reply: `The AI service had a problem (${err.status}). Try again shortly.` }, { status: 502 });
    return Response.json({ reply: `Something went wrong: ${(err as Error).message}` }, { status: 500 });
  }
}
