import { NextResponse, type NextRequest } from "next/server";

// Password gate for the online dashboard. When DASHBOARD_PASSWORD is set
// (on Vercel), every request needs it: the browser shows its own sign-in box,
// and any username works. When it isn't set (local development), there's no gate.

function safeEqual(a: string, b: string) {
  // Compare without leaking how many characters matched.
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();
  // Calendar feeds for Airbnb/Booking.com: they can't send a password, so the
  // feed's own long secret token protects it instead.
  if (request.nextUrl.pathname.startsWith("/api/ical/")) return NextResponse.next();
  // Health status (pass/fail only), for the automatic checks.
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const given = decoded.slice(decoded.indexOf(":") + 1);
      if (safeEqual(given, password)) return NextResponse.next();
    } catch {
      /* malformed header: fall through to the challenge */
    }
  }
  return new NextResponse("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Lombok Rate Engine", charset="UTF-8"' },
  });
}
