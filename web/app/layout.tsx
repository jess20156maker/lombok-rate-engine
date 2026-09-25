import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Lombok Rate Engine",
  description: "Market data, pricing and bookings for south Lombok",
};

const NAV = [
  { href: "/", label: "Explore" },
  { href: "/market", label: "Tables" },
  { href: "/listings", label: "Listings" },
  { href: "/watchlist", label: "★ Watchlist" },
  { href: "/map", label: "Map" },
  { href: "/collection", label: "Collection" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <header className="border-b border-line bg-panel">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              Lombok Rate Engine
            </Link>
            <nav className="flex gap-5 overflow-x-auto text-sm text-muted [scrollbar-width:none]">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="shrink-0 hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </nav>
            <form action="/listings" className="ml-auto w-full sm:w-64">
              <input
                name="q"
                type="search"
                placeholder="Search villas by name…"
                aria-label="Search villas by name"
                className="w-full rounded-full border border-line bg-bg px-4 py-1.5 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
              />
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
