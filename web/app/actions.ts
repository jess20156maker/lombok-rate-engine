"use server";

import { refresh } from "next/cache";
import { pool } from "@/lib/data";

/** Star or unstar a villa on any site. Returns the new state. */
export async function toggleWatch(listingId: string, platform: "airbnb" | "booking" | "web" = "airbnb"): Promise<boolean> {
  if (!/^[a-z0-9:-]{1,80}$/.test(listingId) || !["airbnb", "booking", "web"].includes(platform)) throw new Error("Bad listing");
  const del = await pool.query("delete from watchlist where platform = $1 and listing_id = $2", [platform, listingId]);
  let watched = false;
  if (del.rowCount === 0) {
    await pool.query("insert into watchlist (platform, listing_id) values ($1, $2) on conflict do nothing", [platform, listingId]);
    watched = true;
  }
  refresh();
  return watched;
}

export async function saveNote(listingId: string, note: string) {
  if (!/^\d{1,25}$/.test(listingId)) throw new Error("Bad listing id");
  await pool.query("update watchlist set note = $2 where platform = 'airbnb' and listing_id = $1", [
    listingId,
    note.slice(0, 500),
  ]);
  refresh();
}
