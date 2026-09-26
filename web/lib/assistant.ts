// The assistant: answers questions about prices, bookings and the market, and
// PROPOSES changes. It never changes anything itself: proposals come back to
// the page, which shows an "Apply" button that calls the normal actions.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { dayStats, eventsOn, filterListings, summarize } from "./explore-calc";
import { loadExplore } from "./explore";
import { fmt } from "./money";
import { loadVilla } from "./villa";

export type Proposal =
  | { kind: "price"; from: string; to: string; priceIdr: number | null; minStay: number | null; note: string; summary: string }
  | { kind: "clear"; from: string; to: string; summary: string }
  | { kind: "block"; from: string; to: string; reason: string; summary: string };

export type ChatTurn = { role: "user" | "assistant"; text: string };

const MODEL = "claude-opus-5";
const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_prices",
    description:
      "The villa's suggested nightly price, minimum stay and booked status for each night in a date range (max 62 nights). Prices in IDR with an AUD conversion.",
    input_schema: {
      type: "object",
      properties: { from: DATE, to: DATE },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "explain_night",
    description:
      "Why one night is priced the way it is: every pricing reason with its effect, comparable villas' price and occupancy that night, events and holidays, any manual override, and whether it's booked.",
    input_schema: { type: "object", properties: { date: DATE }, required: ["date"], additionalProperties: false },
  },
  {
    name: "list_bookings",
    description: "The villa's stays and blocked dates from every channel (Airbnb, Booking.com, direct, blocks) in a date range.",
    input_schema: { type: "object", properties: { from: DATE, to: DATE }, required: ["from", "to"], additionalProperties: false },
  },
  {
    name: "market_snapshot",
    description:
      "South Lombok market figures from the nightly Airbnb data for a date range: share of nights booked, typical nightly price, busiest night, and events. Optionally for particular beaches and bedroom counts.",
    input_schema: {
      type: "object",
      properties: {
        from: DATE,
        to: DATE,
        beaches: {
          type: "array",
          items: { type: "string", enum: ["Serangan", "Selong Belanak", "Mawi", "Tampah", "Mawun", "Are Guling", "Kuta", "Gerupuk"] },
        },
        bedrooms: { type: "array", items: { type: "string", enum: ["1", "2", "3", "4+"] } },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_price",
    description:
      "Propose setting the nightly price and/or minimum stay for a range of nights (inclusive). Does NOT change anything: the owner sees an Apply button. Give price in AUD.",
    input_schema: {
      type: "object",
      properties: {
        from: DATE,
        to: DATE,
        price_aud: { type: ["number", "null"], description: "Nightly price in AUD, or null to leave the price to the engine" },
        min_stay: { type: ["integer", "null"], description: "Minimum nights, or null to leave it to the engine" },
        note: { type: "string", description: "Short reason shown next to the price" },
      },
      required: ["from", "to", "price_aud", "min_stay", "note"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_clear_price",
    description: "Propose removing manual price/minimum-stay changes in a range so the engine's suggestion applies again. Does NOT change anything.",
    input_schema: { type: "object", properties: { from: DATE, to: DATE }, required: ["from", "to"], additionalProperties: false },
  },
  {
    name: "propose_block",
    description:
      "Propose blocking dates on every channel (e.g. maintenance, personal use). `until` is the morning the block ends (like a check-out). Does NOT change anything.",
    input_schema: {
      type: "object",
      properties: { from: DATE, until: DATE, reason: { type: "string" } },
      required: ["from", "until", "reason"],
      additionalProperties: false,
    },
  },
];

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Tool inputs come from the model: check them before use. */
function validate(name: string, input: any): string | null {
  const need = (...keys: string[]) => keys.find((k) => !isDate(input?.[k]));
  const bad =
    name === "explain_night" ? need("date") : name === "propose_block" ? need("from", "until") : need("from", "to");
  if (bad) return `"${bad}" must be a date like 2026-11-03`;
  if ("to" in (input ?? {}) && input.to < input.from) return "the end date is before the start date";
  if (name === "propose_block" && input.until <= input.from) return "until must be after from";
  if (name === "propose_price") {
    if (input.price_aud != null && !(typeof input.price_aud === "number" && input.price_aud > 0 && input.price_aud < 100000)) return "price_aud must be a positive number";
    if (input.min_stay != null && !(Number.isInteger(input.min_stay) && input.min_stay >= 1 && input.min_stay <= 30)) return "min_stay must be 1–30";
    if (input.price_aud == null && input.min_stay == null) return "give a price or a minimum stay";
  }
  return null;
}

function nightsBetween(from: string, to: string, max: number) {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to) && out.length < max; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

type Client = { beta: { messages: { create: (params: any) => Promise<Anthropic.Beta.BetaMessage> } } };

export async function runAssistant(history: ChatTurn[], client: Client = new Anthropic()) {
  const villa = await loadVilla();
  if (!villa) throw new Error("No villa set up yet.");
  const p = villa.property;
  const rate = villa.audRate;
  const money = (idr: number | null) =>
    idr == null ? null : `${fmt(idr, { currency: "AUD", audRate: rate, rateDate: "" })} (${fmt(idr, { currency: "IDR", audRate: rate, rateDate: "" })})`;
  const recBy = new Map(villa.recommendations.map((r) => [r.date, r]));
  const overrideBy = new Map(villa.overrides.map((o) => [o.date, o]));
  const confirmed = villa.reservations.filter((r) => r.status === "confirmed");
  const bookedOn = (d: string) => confirmed.find((r) => r.checkin <= d && d < r.checkout) ?? null;
  const proposals: Proposal[] = [];

  async function run(name: string, input: any): Promise<unknown> {
    switch (name) {
      case "get_prices":
        return nightsBetween(input.from, input.to, 62).map((d) => {
          const r = recBy.get(d);
          const b = bookedOn(d);
          return r
            ? { date: d, price: money(r.price), min_stay: r.minStay, booked: b ? b.source : false, manual: overrideBy.has(d) }
            : { date: d, price: null, note: "outside the priced range" };
        });
      case "explain_night": {
        const r = recBy.get(input.date);
        if (!r) return { error: "No price for that night (only today to one year ahead are priced)." };
        const explore = await loadExplore();
        return {
          date: r.date,
          price: money(r.price),
          min_stay: r.minStay,
          reasons: r.reasons.map((x) => ({ reason: x.label, effect: x.effect == null ? null : `${Math.round((x.effect - 1) * 100)}%` })),
          comparable_villas: { median_price: money(r.marketPrice), share_booked: r.marketOcc, how_many: r.compCount },
          events: explore ? eventsOn(explore.events, r.date).map((e) => `${e.name}: ${e.why}`) : [],
          manual_override: overrideBy.get(r.date) ?? null,
          booked: bookedOn(r.date)?.source ?? false,
        };
      }
      case "list_bookings":
        return confirmed
          .filter((r) => r.checkout > input.from && r.checkin <= input.to)
          .map((r) => ({ from: r.checkin, until: r.checkout, channel: r.source, guest: r.guestName, total: money(r.total), notes: r.notes }))
          .slice(0, 100);
      case "market_snapshot": {
        const data = await loadExplore();
        if (!data) return { error: "No market data yet." };
        const idx = filterListings(data, { areas: input.beaches ?? [], beds: input.bedrooms ?? [], window: "365", includeDormant: false });
        const stats = dayStats(data, idx);
        const start = Math.max(0, Math.round((Date.parse(input.from) - Date.parse(data.from)) / 86_400_000));
        const end = Math.min(data.days, Math.round((Date.parse(input.to) - Date.parse(data.from)) / 86_400_000) + 1);
        const s = summarize(stats, [start, end]);
        return {
          places: idx.length,
          share_of_nights_booked: s.occ,
          typical_nightly_price: money(s.price),
          busiest_night: s.busiest ? { date: s.busiest.date, share_booked: s.busiest.occ } : null,
          nearly_sold_out_nights: s.soldOutDays,
          events: data.events
            .filter((e) => (e.category === "event" || e.category === "holiday") && e.end >= input.from && e.start <= input.to)
            .map((e) => `${e.name} (${e.start} to ${e.end})`),
          data_collected: data.snapshot,
        };
      }
      case "propose_price": {
        const priceIdr = input.price_aud == null ? null : Math.round(input.price_aud * rate);
        const summary = [
          `${input.from === input.to ? input.from : `${input.from} to ${input.to}`}:`,
          priceIdr != null ? `price ${money(priceIdr)} a night` : null,
          input.min_stay != null ? `minimum ${input.min_stay} nights` : null,
        ]
          .filter(Boolean)
          .join(" ");
        proposals.push({ kind: "price", from: input.from, to: input.to, priceIdr, minStay: input.min_stay ?? null, note: String(input.note ?? "").slice(0, 200), summary });
        return { proposed: summary, status: "waiting for the owner to tap Apply" };
      }
      case "propose_clear_price": {
        const summary = `Remove manual prices from ${input.from} to ${input.to} (back to suggested prices)`;
        proposals.push({ kind: "clear", from: input.from, to: input.to, summary });
        return { proposed: summary, status: "waiting for the owner to tap Apply" };
      }
      case "propose_block": {
        const summary = `Block ${input.from} until the morning of ${input.until} on every channel (${input.reason})`;
        proposals.push({ kind: "block", from: input.from, to: input.until, reason: String(input.reason ?? "").slice(0, 200), summary });
        return { proposed: summary, status: "waiting for the owner to tap Apply" };
      }
      default:
        return { error: `Unknown tool ${name}` };
    }
  }

  const system = `You are the pricing and bookings assistant for ${p.name}, a ${p.bedrooms}-bedroom private villa at ${p.area}, south Lombok. The owner is not technical: answer in plain, friendly English, briefly (a few sentences or a short list). Always show money as A$ first then Rupiah, e.g. "A$390 (Rp 4.9m)".

What you can see: the villa's suggested price for every night (set by a pricing engine from nightly market data on ~950 Airbnb and ~400 Booking.com listings nearby), the reasons behind each price, the villa's bookings from every channel, and market figures. Use the tools rather than guessing; say so when data is thin (e.g. far-future nights have few market prices yet).

Changes: you cannot change anything yourself. When the owner asks for a change, call the matching propose_ tool and tell them to tap Apply to confirm. Never say a change is done. Price limits: the villa is kept between ${money(p.min_rate)} and ${money(p.max_rate)} unless the owner sets a price by hand. A$1 = Rp ${Math.round(rate)}.

Today in Lombok is ${villa.today}.`;

  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({ role: t.role, content: t.text }));

  for (let i = 0; i < 8; i++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // if a request is declined, Anthropic's recommended model answers instead
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "refusal") {
      return { reply: "Sorry, I can't help with that one.", proposals, propertyId: p.id };
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (response.stop_reason !== "tool_use") {
      return { reply: text || "Done.", proposals, propertyId: p.id };
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const problem = validate(block.name, block.input);
      if (problem) {
        results.push({ type: "tool_result", tool_use_id: block.id, content: `Invalid input: ${problem}`, is_error: true });
        continue;
      }
      try {
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(await run(block.name, block.input)) });
      } catch (err) {
        results.push({ type: "tool_result", tool_use_id: block.id, content: `Error: ${(err as Error).message}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { reply: "That took more steps than I allow. Could you ask a narrower question?", proposals, propertyId: p.id };
}
