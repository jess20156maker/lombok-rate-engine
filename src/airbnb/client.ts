// Airbnb reads the same public endpoints its own website uses.
//
// - Search: the /s/ page embeds its results as JSON (data-deferred-state-0).
// - Calendar: the PdpAvailabilityCalendar GraphQL query, 12 months per call.
//
// When Airbnb ships a new site build, CALENDAR_HASH can stop working (HTTP 400).
// calendar() then finds the new one by itself (discoverCalendarHashes) and logs
// it; copy it into CALENDAR_HASH so later runs skip the search. By hand: open a
// listing page, scroll to the calendar, and read the PdpAvailabilityCalendar/<hash>
// request in the browser's network tab.

import { AIRBNB_ROOM_TYPE, CURRENCY, type BBox } from "../config.js";
import { get, HttpError, USER_AGENT } from "../lib/http.js";

const API_KEY = "d306zoyjsyarp7ifhu67rjxn52tv0t20"; // public key embedded in airbnb.com
const CALENDAR_HASH = "be60714ead0a30db42ce6471ddad6a8f3855df0ed400b79282dd0bb8cecdf201";
let calendarHash = CALENDAR_HASH;
let searchedForHash = false;

export type SearchListing = {
  id: string;
  name: string;
  kind: string; // "Villa in Praya Barat"
  lat: number;
  lng: number;
  bedrooms: number | null;
  rating: string | null;
  // Present only when the search had dates.
  total: number | null; // after discounts, before taxes
  nightly: number | null; // listed nightly rate before discounts
  nights: number | null;
};

export type SearchPage = { listings: SearchListing[]; cursors: string[] };

export type CalendarDay = {
  date: string;
  available: boolean;
  checkin: boolean;
  minNights: number;
};

const rupiah = (s: string | null | undefined) =>
  s ? Number(s.replace(/[^\d.]/g, "").replace(/\.\d{2}$/, "")) || null : null;

function parseListing(r: any): SearchListing | null {
  const l = r.demandStayListing;
  if (!l) return null;
  const id = Buffer.from(l.id, "base64").toString().split(":")[1];

  const primary = r.structuredDisplayPrice?.primaryLine;
  const total = rupiah(primary?.discountedPrice ?? primary?.price);
  const nightsMatch = /for (\d+) nights?/.exec(primary?.qualifier ?? "");
  // "3 nights x Rp 1,822,394.00" in the price breakdown gives the nightly rate.
  let nightly: number | null = null;
  for (const group of r.structuredDisplayPrice?.explanationData?.priceDetails ?? []) {
    for (const item of group.items ?? []) {
      const m = /nights? x (Rp [\d,.]+)/.exec(item.description ?? "");
      if (m) nightly = rupiah(m[1]);
    }
  }
  const bedLine = (r.structuredContent?.primaryLine ?? []).find((x: any) =>
    /bedroom|studio/i.test(x.body ?? ""),
  );
  const bedrooms = bedLine ? (/studio/i.test(bedLine.body) ? 0 : parseInt(bedLine.body, 10)) : null;

  return {
    id,
    name: l.description?.name?.localizedStringWithTranslationPreference ?? r.subtitle ?? "",
    kind: r.title ?? "",
    lat: l.location.coordinate.latitude,
    lng: l.location.coordinate.longitude,
    bedrooms,
    rating: r.avgRatingLocalized ?? null,
    total,
    nightly,
    nights: nightsMatch ? Number(nightsMatch[1]) : null,
  };
}

export async function search(
  box: BBox,
  opts: { checkin?: string; checkout?: string; cursor?: string } = {},
): Promise<SearchPage> {
  const params = new URLSearchParams({
    ne_lat: String(box.north),
    ne_lng: String(box.east),
    sw_lat: String(box.south),
    sw_lng: String(box.west),
    search_by_map: "true",
    search_type: "user_map_move",
    "room_types[]": AIRBNB_ROOM_TYPE,
    adults: "2",
    currency: CURRENCY,
    locale: "en",
  });
  if (opts.checkin && opts.checkout) {
    params.set("checkin", opts.checkin);
    params.set("checkout", opts.checkout);
  }
  if (opts.cursor) params.set("cursor", opts.cursor);

  const html = await get(`https://www.airbnb.com/s/Lombok/homes?${params}`);
  const m = /<script id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("Airbnb search: embedded results not found (page layout changed?)");
  const results = JSON.parse(m[1]).niobeClientData[0][1].data.presentation.staysSearch.results;

  return {
    listings: results.searchResults.map(parseListing).filter(Boolean) as SearchListing[],
    cursors: results.paginationInfo?.pageCursors ?? [],
  };
}

/** Every page of a search. Returns hitCap when Airbnb stopped paginating early. */
export async function searchAll(box: BBox, opts: { checkin?: string; checkout?: string } = {}) {
  const first = await search(box, opts);
  const listings = [...first.listings];
  for (const cursor of first.cursors.slice(1)) {
    listings.push(...(await search(box, { ...opts, cursor })).listings);
  }
  // Airbnb serves at most 15 pages; a full set of pages means there may be more.
  return { listings, hitCap: first.cursors.length >= 15 };
}

const HASH = "[0-9a-f]{64}";

/** Calendar hashes named in Airbnb's site scripts, likeliest first. */
async function hashesFromScripts(listingId: string): Promise<string[]> {
  const html = await get(`https://www.airbnb.com/rooms/${listingId}`);
  const scripts = [...new Set(html.match(/https:\/\/a0\.muscache\.com\/[^"'\s\\<>]+?\.js/g) ?? [])].slice(0, 150);
  const patterns = [
    new RegExp(`PdpAvailabilityCalendar["'][^{}]{0,200}?["'](${HASH})["']`, "g"),
    new RegExp(`["'](${HASH})["'][^{}]{0,200}?["']PdpAvailabilityCalendar["']`, "g"),
  ];
  const found: string[] = [];
  for (let i = 0; i < scripts.length; i += 10) {
    const texts = await Promise.all(
      scripts.slice(i, i + 10).map((u) =>
        fetch(u, { headers: { "User-Agent": USER_AGENT } })
          .then((r) => (r.ok ? r.text() : ""))
          .catch(() => ""),
      ),
    );
    for (const text of texts) {
      if (!text.includes("PdpAvailabilityCalendar")) continue;
      for (const re of patterns) for (const m of text.matchAll(re)) found.push(m[1]);
    }
  }
  console.log(`  calendar ID search: ${scripts.length} site scripts read, ${new Set(found).size} candidates`);
  return found;
}

/** The hash Airbnb's own page uses, read from a real browser's network requests. */
async function hashFromBrowser(listingId: string): Promise<string[]> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT, viewport: { width: 1280, height: 900 } });
    let seen: string | null = null;
    page.on("request", (r) => {
      const m = new RegExp(`/api/v3/PdpAvailabilityCalendar/(${HASH})`).exec(r.url());
      if (m && !seen) {
        seen = m[1];
        console.log(`  calendar ID search: the browser asked for ${r.url().slice(0, 600)}`);
      }
    });
    await page.goto(`https://www.airbnb.com/rooms/${listingId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    for (let i = 0; i < 30 && !seen; i++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(1000);
    }
    return seen ? [seen] : [];
  } finally {
    await browser.close();
  }
}

async function discoverCalendarHashes(listingId: string): Promise<string[]> {
  const found: string[] = [];
  for (const [how, find] of [["site scripts", hashesFromScripts], ["browser", hashFromBrowser]] as const) {
    try {
      found.push(...(await find(listingId)));
    } catch (err) {
      console.warn(`  calendar ID search (${how}) failed: ${(err as Error).message.split("\n")[0]}`);
    }
    if (found.some((h) => h !== calendarHash)) break;
  }
  return [...new Set(found)].filter((h) => h !== calendarHash);
}

export async function calendar(listingId: string, from: string): Promise<CalendarDay[]> {
  try {
    return await fetchCalendar(listingId, from, calendarHash);
  } catch (err) {
    // HTTP 400 usually means Airbnb replaced the query hash: look for the new one, once per run.
    if (!(err instanceof HttpError && err.status === 400) || searchedForHash) throw err;
    searchedForHash = true;
    console.warn(`  Airbnb refused the calendar request (${err.message}); looking for its new calendar ID`);
    for (const hash of await discoverCalendarHashes(listingId)) {
      try {
        const days = await fetchCalendar(listingId, from, hash);
        calendarHash = hash;
        console.warn(`  Airbnb's calendar ID changed. New CALENDAR_HASH for src/airbnb/client.ts: ${hash}`);
        return days;
      } catch {
        // Not this one.
      }
    }
    throw err;
  }
}

async function fetchCalendar(listingId: string, from: string, hash: string): Promise<CalendarDay[]> {
  const [year, month] = from.split("-").map(Number);
  const variables = {
    request: { count: 12, listingId, month, year, returnPropertyLevelCalendarIfApplicable: false },
  };
  const extensions = { persistedQuery: { version: 1, sha256Hash: hash } };
  const url =
    `https://www.airbnb.com/api/v3/PdpAvailabilityCalendar/${hash}` +
    `?operationName=PdpAvailabilityCalendar&locale=en&currency=${CURRENCY}` +
    `&variables=${encodeURIComponent(JSON.stringify(variables))}` +
    `&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;

  const json = JSON.parse(await get(url, { "X-Airbnb-API-Key": API_KEY }));
  const months = json?.data?.merlin?.pdpAvailabilityCalendar?.calendarMonths;
  if (!months) {
    throw new Error(`Airbnb calendar ${listingId}: ${JSON.stringify(json?.errors ?? json).slice(0, 200)}`);
  }
  return months
    .flatMap((m: any) => m.days)
    .filter((d: any) => d.calendarDate >= from)
    .map((d: any) => ({
      date: d.calendarDate,
      available: !!d.available,
      checkin: !!d.availableForCheckin,
      minNights: d.minNights ?? 1,
    }));
}
