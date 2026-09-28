"use client";

import { useState, useTransition } from "react";
import { toggleWatch } from "@/app/actions";

/** ★ to follow a villa's prices and bookings day by day. */
export function StarButton({
  id,
  watched,
  label = false,
  platform = "airbnb",
}: {
  id: string;
  watched: boolean;
  label?: boolean;
  platform?: "airbnb" | "booking" | "web";
}) {
  const [on, setOn] = useState(watched);
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      aria-pressed={on}
      title={on ? "Remove from watchlist" : "Add to watchlist: track its prices every day"}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOn(!on); // optimistic
        start(async () => {
          try {
            setOn(await toggleWatch(id, platform));
          } catch {
            setOn(on);
          }
        });
      }}
      className={`inline-flex items-center gap-1 rounded-full text-base leading-none transition-transform hover:scale-110 disabled:opacity-60 ${
        on ? "text-[#eda100]" : "text-faint hover:text-ink"
      } ${label ? "border border-line px-3 py-1.5 text-sm" : ""}`}
    >
      <span aria-hidden>{on ? "★" : "☆"}</span>
      {label && <span>{on ? "Watching" : "Watch this villa"}</span>}
    </button>
  );
}
