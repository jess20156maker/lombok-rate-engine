"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Tip = { x: number; y: number; content: ReactNode } | null;
const Ctx = createContext<{ show: (e: { clientX: number; clientY: number }, c: ReactNode) => void; hide: () => void }>({
  show: () => {},
  hide: () => {},
});

/** One floating tooltip for the whole page; marks call show() on hover and focus. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<Tip>(null);
  const show = useCallback((e: { clientX: number; clientY: number }, content: ReactNode) => {
    setTip({ x: e.clientX, y: e.clientY, content });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  return (
    <Ctx.Provider value={{ show, hide }}>
      {children}
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-72 rounded-md px-3 py-2 text-xs shadow-lg"
          style={{
            left: Math.min(tip.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1000) - 300),
            top: tip.y + 14,
            background: "var(--tooltip-bg)",
            color: "var(--tooltip-ink)",
          }}
        >
          {tip.content}
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useTooltip = () => useContext(Ctx);

/** Tooltip handlers for a DOM mark, including keyboard focus. */
export function tipProps(t: ReturnType<typeof useTooltip>, content: () => ReactNode) {
  return {
    onPointerMove: (e: React.PointerEvent) => t.show(e, content()),
    onPointerLeave: t.hide,
    onFocus: (e: React.FocusEvent) => {
      const r = (e.target as HTMLElement).getBoundingClientRect();
      t.show({ clientX: r.right, clientY: r.top }, content());
    },
    onBlur: t.hide,
  };
}
