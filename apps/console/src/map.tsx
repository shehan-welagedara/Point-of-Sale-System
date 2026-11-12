/** Where clients are: the world, or Sri Lanka up close, with a dot per town and a list beside it. */
import { useState } from "react";
import { Link } from "react-router-dom";
import { type Place, placeOf, projectSriLanka, projectWorld } from "./geo";
import { SRI_LANKA, WORLD } from "./map-data";
import type { Client } from "./types";

interface Spot {
  key: string;
  label: string;
  x: number;
  y: number;
  clients: Client[];
}

function spots(clients: Client[], view: "world" | "lk"): Spot[] {
  const by = new Map<string, Spot>();
  for (const c of clients) {
    const p: Place = placeOf(c);
    if (Number.isNaN(p.lat)) continue;
    if (view === "lk" && p.country !== "LK") continue;
    const key = view === "world" ? p.country : `${p.lat},${p.lng}`;
    const [x, y] = view === "world" ? projectWorld(p.lat, p.lng) : projectSriLanka(p.lat, p.lng);
    const label = view === "world" ? p.countryName : p.city || "Sri Lanka";
    const s = by.get(key) ?? { key, label, x, y, clients: [] };
    s.clients.push(c);
    by.set(key, s);
  }
  return [...by.values()].sort((a, b) => b.clients.length - a.clients.length);
}

export function ClientMap({ clients }: { clients: Client[] }) {
  const inLk = clients.filter((c) => placeOf(c).country === "LK").length;
  const [view, setView] = useState<"world" | "lk">(inLk === clients.length && clients.length > 0 ? "lk" : "world");
  const [hover, setHover] = useState<string | null>(null);
  const map = view === "world" ? WORLD : SRI_LANKA;
  const list = spots(clients, view);
  const max = Math.max(1, ...list.map((s) => s.clients.length));
  const total = Math.max(1, view === "world" ? clients.length : inLk);
  const r = (n: number) => (view === "world" ? 5 : 6) + (n / max) * (view === "world" ? 7 : 6);
  const h = list.find((s) => s.key === hover);
  return (
    <div className="map-card">
      <div className="seg" role="tablist" aria-label="Map">
        <button role="tab" aria-selected={view === "world"} className={view === "world" ? "on" : ""} onClick={() => setView("world")}>World</button>
        <button role="tab" aria-selected={view === "lk"} className={view === "lk" ? "on" : ""} onClick={() => setView("lk")}>Sri Lanka</button>
      </div>
      <div className={`map-body ${view}`}>
        <div className="map-wrap">
          <svg viewBox={`0 0 ${map.width} ${map.height}`} className="map" role="img" aria-label={`Client locations: ${list.map((s) => `${s.label} ${s.clients.length}`).join(", ") || "none yet"}`}>
            <path d={map.path} className="land" />
            {list.map((s) => (
              <g key={s.key} onPointerEnter={() => setHover(s.key)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(s.key)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${s.label}: ${s.clients.length} client(s)`}>
                <circle cx={s.x} cy={s.y} r={r(s.clients.length) + (view === "world" ? 6 : 5)} className="halo" />
                <circle cx={s.x} cy={s.y} r={r(s.clients.length)} className="pin" />
              </g>
            ))}
          </svg>
          {h ? (
            <div className="chart-tip" style={{ left: `${(h.x / map.width) * 100}%`, top: `${(h.y / map.height) * 100}%` }}>
              <strong>{h.clients.length} client{h.clients.length === 1 ? "" : "s"}</strong>
              <span>{h.label}: {h.clients.slice(0, 3).map((c) => c.name).join(", ")}{h.clients.length > 3 ? "…" : ""}</span>
            </div>
          ) : null}
        </div>
        <ul className="place-list">
          {list.slice(0, 6).map((s) => (
            <li key={s.key}>
              <span className="code" aria-hidden="true">{view === "world" ? s.clients[0] ? placeOf(s.clients[0]).country : "" : s.label.slice(0, 2).toUpperCase()}</span>
              <span className="grow">
                {s.clients.length === 1 ? <Link to={`/clients/${s.clients[0]!.id}`}>{s.label}</Link> : s.label}
                <span className="bar-track" aria-hidden="true"><span style={{ width: `${(s.clients.length / total) * 100}%` }} /></span>
              </span>
              <span className="num">{s.clients.length}</span>
              <span className="tiny muted pct">{Math.round((s.clients.length / total) * 100)}%</span>
            </li>
          ))}
          {!list.length ? <li className="muted small">{view === "lk" ? "No clients in Sri Lanka yet." : "Add a client's town and country to see it here."}</li> : null}
        </ul>
      </div>
      <div className="map-facts">
        <div><strong>{new Set(clients.map((c) => placeOf(c).country)).size}</strong><span>Countries</span></div>
        <div><strong>{new Set(clients.filter((c) => c.city).map((c) => `${placeOf(c).country}:${c.city!.trim().toLowerCase()}`)).size}</strong><span>Towns</span></div>
        <div><strong>{clients.length ? Math.round((inLk / clients.length) * 100) : 0}%</strong><span>In Sri Lanka</span></div>
      </div>
    </div>
  );
}
