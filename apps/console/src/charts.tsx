/**
 * Small SVG charts for the console: sparkline, donut, columns, line, horizontal bars, meter.
 * One accent colour for single series, status colours only for states (always with a label), thin
 * marks, hairline grid, a tooltip on hover and keyboard focus, and the numbers in a table as well.
 */
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";

/** Width of an element, kept up to date. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Rounded axis steps (1, 2, 5 × 10ⁿ) covering 0…max. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

/** 1,284 · 12.9K · 4.2M */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, "")}K`;
  return Math.round(n).toLocaleString("en-LK");
}

function Tip({ x, y, children, width }: { x: number; y: number; children: ReactNode; width: number }) {
  const left = Math.min(Math.max(x, 70), Math.max(70, width - 70));
  return (
    <div className="chart-tip" style={{ left, top: y }} role="presentation">
      {children}
    </div>
  );
}

// ───────────────────────────── Sparkline ─────────────────────────────

export function Sparkline({ values, label, height = 40 }: { values: number[]; label: string; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const id = useId();
  const pts = values.length === 1 ? [values[0]!, values[0]!] : values;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const pad = 4;
  const xy = pts.map((v, i) => [pad + (i / Math.max(1, pts.length - 1)) * (w - pad * 2), pad + (1 - (v - min) / span) * (height - pad * 2)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const last = xy[xy.length - 1];
  return (
    <div ref={ref} className="spark" role="img" aria-label={label}>
      {w > 0 && pts.length ? (
        <svg width={w} height={height} aria-hidden="true">
          <defs>
            <linearGradient id={`sg${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.18" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line}L${last![0]},${height}L${xy[0]![0]},${height}Z`} fill={`url(#sg${id})`} />
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={last![0]} cy={last![1]} r="3.5" fill="var(--accent)" stroke="var(--panel)" strokeWidth="2" />
        </svg>
      ) : null}
    </div>
  );
}

// ───────────────────────────── Donut ─────────────────────────────

export interface Slice {
  label: string;
  value: number;
  /** A CSS colour (use the status variables for states). */
  color: string;
}

export function Donut({ slices, center, sub, size = 168 }: { slices: Slice[]; center: string; sub: string; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((n, s) => n + s.value, 0);
  const r = size / 2 - 12;
  const c = size / 2;
  const gap = total && slices.filter((s) => s.value > 0).length > 1 ? 0.035 : 0;
  let a0 = -Math.PI / 2;
  const arcs = slices.map((s, i) => {
    const a = total ? (s.value / total) * Math.PI * 2 : 0;
    const start = a0 + gap / 2;
    const end = a0 + a - gap / 2;
    a0 += a;
    if (s.value <= 0 || end <= start) return null;
    const large = end - start > Math.PI ? 1 : 0;
    const p = (ang: number) => `${(c + r * Math.cos(ang)).toFixed(2)},${(c + r * Math.sin(ang)).toFixed(2)}`;
    const d = end - start >= Math.PI * 2 - 0.001 ? `M${c},${c - r}A${r},${r} 0 1 1 ${c - 0.01},${c - r}` : `M${p(start)}A${r},${r} 0 ${large} 1 ${p(end)}`;
    return (
      <path
        key={s.label}
        d={d}
        fill="none"
        stroke={s.color}
        strokeWidth={hover === i ? 16 : 13}
        strokeLinecap="butt"
        tabIndex={0}
        onPointerEnter={() => setHover(i)}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover(i)}
        onBlur={() => setHover(null)}
      >
        <title>{`${s.label}: ${s.value}`}</title>
      </path>
    );
  });
  const h = hover !== null ? slices[hover] : null;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`${center} ${sub}. ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--track)" strokeWidth="13" />
        {arcs}
      </svg>
      <div className="donut-center" aria-hidden="true">
        <strong>{h ? h.value : center}</strong>
        <span>{h ? h.label : sub}</span>
      </div>
    </div>
  );
}

// ───────────────────────────── Columns ─────────────────────────────

export interface Point {
  label: string;
  value: number;
  /** Longer label for the tooltip (e.g. the full month). */
  title?: string;
}

const AXIS_W = 46;

export function Columns({ data, format, height = 220, label }: { data: Point[]; format: (n: number) => string; height?: number; label: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const plotH = height - 28;
  const plotW = Math.max(0, w - AXIS_W);
  const band = data.length ? plotW / data.length : 0;
  const bw = Math.min(24, band * 0.62);
  const y = (v: number) => 8 + (1 - v / top) * (plotH - 8);
  const every = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 48)));
  return (
    <div ref={ref} className="chart" style={{ height }}>
      {w > 0 ? (
        <svg width={w} height={height} role="img" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={AXIS_W} x2={w} y1={y(t)} y2={y(t)} className="grid" />
              <text x={AXIS_W - 8} y={y(t) + 4} textAnchor="end" className="tick">{compact(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = AXIS_W + i * band + (band - bw) / 2;
            const h = Math.max(0, plotH - y(d.value));
            const r = Math.min(4, h, bw / 2);
            const yTop = y(d.value);
            const path = h > 0 ? `M${x},${plotH}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + bw - r}Q${x + bw},${yTop} ${x + bw},${yTop + r}V${plotH}Z` : "";
            return (
              <g key={d.label + i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${d.title ?? d.label}: ${format(d.value)}`}>
                <rect x={AXIS_W + i * band} y={0} width={band} height={plotH} fill="transparent" />
                {path ? <path d={path} className={`bar ${hover === i ? "on" : ""}`} /> : null}
                {i % every === 0 ? <text x={x + bw / 2} y={height - 8} textAnchor="middle" className="tick">{d.label}</text> : null}
              </g>
            );
          })}
          <line x1={AXIS_W} x2={w} y1={plotH} y2={plotH} className="axis" />
        </svg>
      ) : null}
      {hover !== null && data[hover] ? (
        <Tip x={AXIS_W + hover * band + band / 2} y={y(data[hover]!.value) - 8} width={w}>
          <strong>{format(data[hover]!.value)}</strong>
          <span>{data[hover]!.title ?? data[hover]!.label}</span>
        </Tip>
      ) : null}
    </div>
  );
}

// ───────────────────────────── Line ─────────────────────────────

export function LineChart({ data, format, height = 220, label }: { data: Point[]; format: (n: number) => string; height?: number; label: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const plotH = height - 28;
  const plotW = Math.max(0, w - AXIS_W - 12);
  const x = (i: number) => AXIS_W + 6 + (data.length > 1 ? (i / (data.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => 8 + (1 - v / top) * (plotH - 8);
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join("");
  const every = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 56)));
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = 0;
    for (let i = 1; i < data.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };
  const last = data.length - 1;
  return (
    <div ref={ref} className="chart" style={{ height }}>
      {w > 0 && data.length ? (
        <svg width={w} height={height} role="img" aria-label={label} onPointerMove={move} onPointerLeave={() => setHover(null)} tabIndex={0} onKeyDown={(e) => {
          if (e.key === "ArrowRight") setHover((h) => Math.min(last, (h ?? -1) + 1));
          if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? last + 1) - 1));
        }} onBlur={() => setHover(null)}>
          <defs>
            <linearGradient id={`lg${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.14" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={AXIS_W} x2={w} y1={y(t)} y2={y(t)} className="grid" />
              <text x={AXIS_W - 8} y={y(t) + 4} textAnchor="end" className="tick">{compact(t)}</text>
            </g>
          ))}
          {data.map((d, i) => (i % every === 0 || i === last ? <text key={d.label + i} x={x(i)} y={height - 8} textAnchor="middle" className="tick">{d.label}</text> : null))}
          <path d={`${line}L${x(last)},${plotH}L${x(0)},${plotH}Z`} fill={`url(#lg${id})`} />
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <line x1={AXIS_W} x2={w} y1={plotH} y2={plotH} className="axis" />
          {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={8} y2={plotH} className="crosshair" /> : null}
          <circle cx={x(hover ?? last)} cy={y(data[hover ?? last]!.value)} r="4.5" fill="var(--accent)" stroke="var(--panel)" strokeWidth="2" />
        </svg>
      ) : null}
      {hover !== null && data[hover] ? (
        <Tip x={x(hover)} y={y(data[hover]!.value) - 10} width={w}>
          <strong>{format(data[hover]!.value)}</strong>
          <span>{data[hover]!.title ?? data[hover]!.label}</span>
        </Tip>
      ) : null}
    </div>
  );
}

// ───────────────────────────── Horizontal bars ─────────────────────────────

export function HBars({ data, format = (n) => String(n), empty = "Nothing yet" }: { data: Point[]; format?: (n: number) => string; empty?: string }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  if (!data.length) return <div className="empty">{empty}</div>;
  return (
    <div className="hbars">
      {data.map((d) => (
        <div key={d.label} className="hbar" title={`${d.title ?? d.label}: ${format(d.value)}`}>
          <span className="hbar-label">{d.label}</span>
          <span className="hbar-track"><span className="hbar-fill" style={{ width: `${max ? Math.max(2, (d.value / max) * 100) : 0}%` }} /></span>
          <span className="hbar-value">{format(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────── Meter ─────────────────────────────

export function Meter({ ratio, tone = "accent", label }: { ratio: number; tone?: "accent" | "good" | "warn" | "bad"; label: string }) {
  const pct = Math.max(0, Math.min(1, ratio));
  return (
    <span className={`meter ${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} aria-label={label}>
      <span style={{ width: `${pct * 100}%` }} />
    </span>
  );
}

/** "Show as table" under a chart: the same numbers, for reading and copying. */
export function ChartTable({ rows, head }: { rows: [string, string][]; head: [string, string] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="chart-table">
      <button className="btn link sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide table" : "Show as table"}</button>
      {open ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{head[0]}</th><th className="num">{head[1]}</th></tr></thead>
            <tbody>{rows.map(([a, b]) => <tr key={a}><td>{a}</td><td className="num">{b}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
