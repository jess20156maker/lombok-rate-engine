"use server";

import { refresh } from "next/cache";
import { pool } from "@/lib/data";

/** Star or unstar a villa. Returns the new state. */
export async function toggleWatch(listingId: string): Promise<boolean> {
  if (!/^\d{1,25}$/.test(listingId)) throw new Error("Bad listing id");
  const del = await pool.query("delete from watchlist where platform = 'airbnb' and listing_id = $1", [listingId]);
  let watched = false;
  if (del.rowCount === 0) {
    await pool.query("insert into watchlist (platform, listing_id) values ('airbnb', $1) on conflict do nothing", [listingId]);
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
