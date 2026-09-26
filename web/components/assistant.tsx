"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { addReservation, clearOverride, setOverride } from "@/app/villa-actions";
import type { Proposal } from "@/lib/assistant";

type Turn = { role: "user" | "assistant"; text: string; proposals?: Proposal[]; propertyId?: string };

const SUGGESTIONS = [
  "Why is 10 October priced so high?",
  "How full is Selong Belanak next month?",
  "What should I charge over Christmas?",
  "Block 1–4 December for maintenance",
];

function ProposalCard({ p, propertyId }: { p: Proposal; propertyId: string }) {
  const [state, setState] = useState<"new" | "done" | "error">("new");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const apply = () =>
    start(async () => {
      try {
        if (p.kind === "price") await setOverride(propertyId, p.from, p.to, p.priceIdr, p.minStay, p.note);
        else if (p.kind === "clear") await clearOverride(propertyId, p.from, p.to);
        else await addReservation(propertyId, { kind: "block", checkin: p.from, checkout: p.to, guestName: "", total: null, notes: p.reason });
        setState("done");
      } catch (e) {
        setErr((e as Error).message);
        setState("error");
      }
    });
  return (
    <div className="mt-2 rounded-md border border-line bg-bg p-2.5 text-xs">
      <div className="font-medium">Proposed: {p.summary}</div>
      {state === "done" ? (
        <div className="mt-1.5" style={{ color: "var(--up)" }}>
          ✓ Applied
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-2">
          <button type="button" disabled={pending} onClick={apply} className="rounded bg-accent px-3 py-1 font-medium text-white disabled:opacity-50 dark:text-black">
            {pending ? "Applying…" : "Apply"}
          </button>
          <span className="text-faint">Nothing changes until you tap Apply.</span>
        </div>
      )}
      {state === "error" && <div className="mt-1 text-[#d03b3b]">{err}</div>}
    </div>
  );
}

export function Assistant() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  async function ask(text: string) {
    if (!text.trim() || busy) return;
    const next: Turn[] = [...turns, { role: "user", text: text.trim() }];
    setTurns(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: next.map(({ role, text }) => ({ role, text })) }),
      });
      const data = await res.json();
      if (data.setup) setSetup(true);
      setTurns([...next, { role: "assistant", text: data.reply, proposals: data.proposals, propertyId: data.propertyId }]);
    } catch {
      setTurns([...next, { role: "assistant", text: "I couldn't reach the server. Check your connection and try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-medium text-white shadow-lg transition-transform hover:scale-105 dark:text-black"
      >
        <span aria-hidden>✦</span> {open ? "Close" : "Ask"}
      </button>
      {open && (
        <div className="rise fixed bottom-20 right-5 z-40 flex max-h-[75vh] w-[min(26rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
          <div className="border-b border-line px-4 py-3">
            <div className="text-sm font-semibold">Ask about prices, bookings and the market</div>
            <div className="text-xs text-muted">It can look anything up and suggest changes; you approve each one.</div>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            {turns.length === 0 && (
              <div className="grid gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} className="rounded-md border border-line px-3 py-2 text-left text-xs text-muted hover:border-accent hover:text-ink">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={t.role === "user" ? "ml-8 rounded-lg bg-accent-soft px-3 py-2" : "mr-4"}>
                <div className="whitespace-pre-wrap">{t.text}</div>
                {t.proposals?.map((p, j) => (
                  <ProposalCard key={j} p={p} propertyId={t.propertyId!} />
                ))}
              </div>
            ))}
            {busy && <div className="animate-pulse text-xs text-muted">Looking into it…</div>}
            {setup && (
              <div className="rounded-md border border-[#eda100] bg-[#eda100]/10 p-3 text-xs">
                To switch the assistant on, add an Anthropic API key to the website&apos;s settings (Claude can do this for you once you have a
                key from console.anthropic.com).
              </div>
            )}
            <div ref={end} />
          </div>
          <form
            className="flex gap-2 border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. What should I charge in March?"
              className="min-w-0 flex-1 rounded-full border border-line bg-bg px-4 py-2 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
            />
            <button disabled={busy || !input.trim()} className="rounded-full bg-accent px-4 text-sm font-medium text-white disabled:opacity-40 dark:text-black">
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
