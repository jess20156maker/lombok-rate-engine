"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export type MapPoint = { id: string; name: string; area: string; lat: number; lng: number; blocked30: number | null; beds: number | null };
export type MapArea = { name: string; lat: number; lng: number };

// Eight distinguishable hues, assigned to areas in a fixed order.
const PALETTE = ["#0f766e", "#b45309", "#7c3aed", "#be123c", "#1d4ed8", "#4d7c0f", "#c2410c", "#0e7490"];

export function ListingMap({ points, areas }: { points: MapPoint[]; areas: MapArea[] }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import("leaflet").Map | undefined;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      // React may unmount before the import resolves (and re-run in dev).
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: true }).setView([-8.89, 116.2], 11);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "© OpenStreetMap",
      }).addTo(map);

      const color = new Map(areas.map((a, i) => [a.name, PALETTE[i % PALETTE.length]]));
      for (const p of points) {
        L.circleMarker([p.lat, p.lng], {
          radius: 4 + Math.min(p.beds ?? 1, 5),
          color: color.get(p.area),
          weight: 1,
          fillOpacity: 0.25 + 0.65 * (p.blocked30 ?? 0),
        })
          .bindPopup(
            `<a href="/listings/${p.id}"><b>${p.name.replace(/</g, "&lt;")}</b></a><br>${p.area} · ${p.beds ?? "?"} bed · ` +
              `${p.blocked30 == null ? "–" : Math.round(p.blocked30 * 100) + "%"} blocked next 30 nights`,
          )
          .addTo(map);
      }
      for (const a of areas) {
        L.marker([a.lat, a.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;font:600 12px system-ui;color:${color.get(a.name)};text-shadow:0 0 3px #fff,0 0 3px #fff">✕ ${a.name}</div>`,
          }),
        }).addTo(map);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [points, areas]);

  return <div ref={el} className="h-[70vh] w-full rounded-lg border border-line" />;
}
