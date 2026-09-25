// Booking.com reads through a real (headless) browser.
//
// Plain HTTP requests are stopped by an AWS WAF JavaScript check, which a real
// browser passes by itself. Once a search page has loaded, we capture the
// FullSearch GraphQL request the page makes while scrolling, then replay it
// from inside the page with other dates and bigger pages (100 results at a
// time). One page load serves every date in a run.
//
// If Booking changes its site and this stops working, the fix usually starts
// with re-capturing FullSearch: open a search in a browser, scroll, and look for
// POST /dml/graphql with operationName FullSearch.

import { chromium, type Browser, type Page } from "playwright";
import { CURRENCY } from "../config.js";

export type BookingResult = {
  id: string;
  name: string;
  pageName: string; // booking.com/hotel/id/<pageName>.html
  unitType: string; // "Entire villa"
  lat: number;
  lng: number;
  bedrooms: number | null;
  rating: string | null; // "8.7 (10)"
  total: number | null; // IDR for the whole stay, INCLUDING taxes and fees
  soldOut: boolean;
};

type Captured = { url: string; headers: Record<string, string>; body: any };

export type BookingSession = { browser: Browser; page: Page; template: Captured };

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** A south-Lombok point; Booking ignores the radius and returns the surrounding region. */
const CENTRE = { latitude: -8.8701, longitude: 116.1607 };

/** Open a session, retrying: the page doesn't always fetch a second batch on the first try. */
export async function openSession(checkin: string, checkout: string, attempts = 3): Promise<BookingSession> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await openOnce(checkin, checkout);
    } catch (err) {
      last = err;
      console.warn(`  Booking session attempt ${i} failed: ${(err as Error).message}`);
    }
  }
  throw last;
}

async function openOnce(checkin: string, checkout: string): Promise<BookingSession> {
  const browser = await chromium.launch({ headless: true });
  try {
    return await prepare(browser, checkin, checkout);
  } catch (err) {
    await browser.close();
    throw err;
  }
}

async function prepare(browser: Browser, checkin: string, checkout: string): Promise<BookingSession> {
  const ctx = await browser.newContext({ locale: "en-US", userAgent: UA, viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  let template: Captured | null = null;
  page.on("request", (r) => {
    const body = r.postData() ?? "";
    if (!template && r.url().includes("/dml/graphql") && body.includes('"FullSearch"')) {
      template = { url: r.url(), headers: r.headers(), body: JSON.parse(body) };
    }
  });

  const params = new URLSearchParams({
    checkin,
    checkout,
    group_adults: "2",
    no_rooms: "1",
    selected_currency: CURRENCY,
    lang: "en-us",
    nflt: "privacy_type=3", // entire places only
    dest_type: "latlong",
    latitude: String(CENTRE.latitude),
    longitude: String(CENTRE.longitude),
  });
  await page.goto(`https://www.booking.com/searchresults.html?${params}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[data-testid="property-card"]', { timeout: 45_000 });
  await page.waitForTimeout(2500);

  // Bringing the last result into view makes the page fetch the next batch.
  const cards = page.locator('[data-testid="property-card"]');
  for (let i = 0; i < 15 && !template; i++) {
    await cards.last().scrollIntoViewIfNeeded().catch(() => {});
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(1200);
  }
  if (!template) {
    const more = page.locator('button:has-text("Load more results")');
    if (await more.count()) {
      await more.first().click();
      await page.waitForTimeout(3000);
    }
  }
  if (!template) throw new Error("Booking.com: couldn't capture the FullSearch request (site changed?)");
  return { browser, page, template };
}

function parse(r: any): BookingResult | null {
  const b = r?.basicPropertyData;
  if (!b?.id || !b.location) return null;
  const unit = r.matchingUnitConfigurations?.commonConfiguration;
  // Booking scores out of 10: "9.7 (11)".
  const rv = b.reviews;
  const scoreText = rv?.totalScore > 0 && rv?.reviewsCount > 0 ? `${Number(rv.totalScore).toFixed(1)} (${rv.reviewsCount})` : null;
  const amount = r.priceDisplayInfoIrene?.displayPrice?.amountPerStay?.amountUnformatted;
  return {
    id: String(b.id),
    name: r.displayName?.text ?? "",
    pageName: b.pageName ?? "",
    unitType: unit?.unitTypeNames?.[0]?.translation ?? "",
    lat: b.location.latitude,
    lng: b.location.longitude,
    bedrooms: unit?.nbBedrooms ?? null,
    rating: scoreText,
    total: typeof amount === "number" && amount > 0 ? Math.round(amount) : null,
    soldOut: !!r.soldOutInfo?.isSoldOut,
  };
}

/** Every entire-place result for one stay, paging 100 at a time. */
export async function searchStay(s: BookingSession, checkin: string, checkout: string): Promise<BookingResult[]> {
  const out: BookingResult[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await s.page.evaluate(
      async ({ t, checkin, checkout, offset }) => {
        const body = structuredClone(t.body);
        body.variables.input.dates = { ...body.variables.input.dates, checkin, checkout };
        body.variables.input.pagination = { ...body.variables.input.pagination, offset, rowsPerPage: 100 };
        const headers = { ...t.headers };
        delete headers["content-length"];
        const res = await fetch(t.url, { method: "POST", headers, body: JSON.stringify(body), credentials: "include" });
        const j = await res.json();
        const search = j?.data?.searchQueries?.search;
        return {
          status: res.status,
          error: j?.errors?.[0]?.message ?? null,
          total: search?.pagination?.nbResultsTotal ?? 0,
          results: search?.results ?? [],
        };
      },
      { t: s.template, checkin, checkout, offset },
    );
    if (page.status !== 200 || page.error) throw new Error(`Booking FullSearch ${page.status}: ${page.error ?? "no data"}`);
    out.push(...(page.results.map(parse).filter(Boolean) as BookingResult[]));
    if (offset + 100 >= page.total || page.results.length === 0) break;
    await s.page.waitForTimeout(800 + Math.random() * 1200); // pace like a person paging
  }
  return out;
}

export async function closeSession(s: BookingSession) {
  await s.browser.close();
}
