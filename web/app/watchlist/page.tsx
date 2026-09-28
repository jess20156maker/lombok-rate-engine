import Link from "next/link";
import { connection } from "next/server";
import { StarButton } from "@/components/star-button";
import { WatchFormat } from "@/components/watch-format";
import { loadWatchlist } from "@/lib/watch";

const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);
const dayLabel = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export default async function WatchlistPage() {
  await connection();
  const { villas, audRate, rateDate } = await loadWatchlist();
  const aud = (n: number | null) => (n == null ? "–" : `A$${Math.round(n / audRate).toLocaleString("en-AU")}`);
  const idr = (n: number | null) =>
    n == null ? "–" : n >= 1_000_000 ? `Rp ${(n / 1_000_000).toFixed(1)}m` : `Rp ${Math.round(n / 1000)}k`;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
          <p className="mt-1 text-sm text-muted">
            Villas you&apos;ve starred. Every night their prices are checked for the next three months, so you can see how
            they move.
          </p>
        </div>
        <div className="text-[11px] text-faint">
          A$1 = Rp {Math.round(audRate).toLocaleString("en-AU")} (European Central Bank, {rateDate})
        </div>
      </div>

      {villas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted">
          Nothing saved yet. Tap the <span className="text-[#eda100]">☆</span> next to any villa (in{" "}
          <Link href="/" className="text-accent hover:underline">
            Explore
          </Link>{" "}
          or{" "}
          <Link href="/listings" className="text-accent hover:underline">
            Listings
          </Link>
          ) to follow it here.
        </div>
      ) : (
        <div className="grid gap-6">
          {villas.map((v) => (
            <section key={`${v.platform}:${v.id}`} className="min-w-0 overflow-hidden rounded-lg border border-line bg-panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {v.platform === "airbnb" ? (
                    <Link href={`/listings/${v.id}`} className="break-words text-lg font-semibold hover:text-accent">
                      {v.name}
                    </Link>
                  ) : (
                    <a href={v.url} target="_blank" rel="noreferrer" className="break-words text-lg font-semibold hover:text-accent">
                      {v.name}
                    </a>
                  )}
                  <div className="mt-0.5 text-sm text-muted">
                    {v.area} · {v.bedrooms == null ? "" : `${v.bedrooms} bed · `}
                    {v.rating ? `★ ${v.rating}` : "no reviews"} · watching since {dayLabel(v.addedAt)} ·{" "}
                    <a href={v.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {v.platform === "airbnb" ? "Airbnb" : v.platform === "booking" ? "Booking.com" : "Website"} ↗
                    </a>
                  </div>
                </div>
                <StarButton id={v.id} platform={v.platform as "airbnb" | "booking" | "web"} watched label />
              </div>

              <div className="mt-5 grid gap-6 md:grid-cols-[10rem_1fr_1fr]">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-1">
                  <div>
                    <div className="text-xs text-muted">Booked, next 30 nights</div>
                    <div className="text-2xl font-semibold">{pct(v.blocked30)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Booked, next 90 nights</div>
                    <div className="text-2xl font-semibold">{pct(v.blocked90)}</div>
                  </div>
                </div>
                <WatchFormat kind="money" audRate={audRate} points={v.priceHistory} title="Typical asking price, open dates in the next 90 days" />
                <WatchFormat kind="pct" audRate={audRate} points={v.bookedHistory} title="Share of the next 90 nights booked" />
              </div>

              <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-faint">Prices by check-in date</h3>
              {v.prices.length === 0 ? (
                <p className="text-sm text-muted">First prices arrive after tonight&apos;s run.</p>
              ) : (
                <div className="-mx-5 overflow-x-auto px-5">
                  <div className="flex gap-2 pb-1">
                    {v.prices.map((p) => {
                      const change = p.perNight != null && p.firstPerNight ? p.perNight / p.firstPerNight - 1 : null;
                      return (
                        <div
                          key={p.checkin}
                          className={`w-24 shrink-0 rounded-md border px-2 py-2 text-center ${
                            p.available ? "border-line" : "border-transparent bg-[var(--seq-5)] text-white"
                          }`}
                          title={p.available ? `${p.nights}-night stay from ${p.checkin}` : "Booked or closed"}
                        >
                          <div className={`text-[11px] ${p.available ? "text-muted" : "opacity-80"}`}>{dayLabel(p.checkin)}</div>
                          {p.available && p.perNight != null ? (
                            <>
                              <div className="tabular mt-0.5 text-sm font-semibold">{aud(p.perNight)}</div>
                              <div className="tabular text-[10px] text-faint">{idr(p.perNight)}</div>
                              {change != null && Math.abs(change) >= 0.01 && (
                                <div className="tabular text-[10px]" style={{ color: change > 0 ? "var(--up)" : "var(--down)" }}>
                                  {change > 0 ? "▲" : "▼"} {Math.abs(Math.round(change * 100))}%
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="mt-1 text-xs font-medium">Booked</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="mt-2 text-[11px] text-faint">
                Per night, before taxes. ▲▼ = change since the first price we saw for that date.
              </p>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
