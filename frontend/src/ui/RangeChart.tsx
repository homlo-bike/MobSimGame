/**
 * Horizontal low–central–high range chart. One hue (ranges are one series);
 * row identity is carried by text labels, the line swatch is secondary.
 * Every chart has a caption, focusable marks with tooltips, and a data table.
 */
import { useState } from 'react';
import type { Range } from '../domain/schema';
import { formatRange } from '../analysis/ranges';

export interface RangeRow {
  id: string;
  label: string;
  swatch?: string;
  value: Range;
}

const BAND = '#99d5cc';
const MARK = '#0f5d55';
const INK = '#1f2937';
const MUTED = '#475569';
const GRID = '#e2e8f0';

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

export function RangeChart({
  title,
  unit,
  rows,
  digits = 0,
  note,
}: {
  title: string;
  unit: string;
  rows: RangeRow[];
  digits?: number;
  note?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const labelW = 170;
  const plotW = 340;
  const rowH = 30;
  const minV = Math.min(0, ...rows.map((r) => r.value.low));
  const maxV = niceMax(Math.max(0, ...rows.map((r) => r.value.high)));
  const lo = minV < 0 ? -niceMax(-minV) : 0;
  const x = (v: number) => labelW + ((v - lo) / (maxV - lo || 1)) * plotW;
  const h = rows.length * rowH + 30;
  const ticks = [lo, (lo + maxV) / 2, maxV];
  const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: digits });
  const summary = rows.map((r) => `${r.label}: ${formatRange(r.value, unit, digits)}`).join('; ');
  return (
    <figure className="mb-4 rounded border border-slate-300 bg-white p-2">
      <figcaption className="mb-1 text-sm font-semibold text-slate-900">
        {title} <span className="font-normal text-slate-600">({unit}; band = low–high, bar = central)</span>
      </figcaption>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">No data.</p>
      ) : (
        <svg
          viewBox={`0 0 ${labelW + plotW + 20} ${h}`}
          className="w-full max-w-xl"
          role="img"
          aria-label={`${title}. ${summary}`}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={0} y2={rows.length * rowH} stroke={GRID} strokeWidth={1} />
              <text x={x(t)} y={rows.length * rowH + 16} fontSize={11} fill={MUTED} textAnchor="middle">
                {fmt(t)}
              </text>
            </g>
          ))}
          {lo < 0 && (
            <line x1={x(0)} x2={x(0)} y1={0} y2={rows.length * rowH} stroke={MUTED} strokeWidth={1.5} />
          )}
          {rows.map((r, i) => {
            const y = i * rowH;
            const active = hover === r.id;
            return (
              <g
                key={r.id}
                tabIndex={0}
                onMouseEnter={() => setHover(r.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(r.id)}
                onBlur={() => setHover(null)}
                aria-label={`${r.label}: ${formatRange(r.value, unit, digits)}`}
                className="outline-none focus-visible:outline-2"
              >
                <rect
                  x={0}
                  y={y}
                  width={labelW + plotW + 20}
                  height={rowH}
                  fill={active ? '#f1f5f9' : 'transparent'}
                />
                {r.swatch && <rect x={0} y={y + 10} width={10} height={10} rx={2} fill={r.swatch} />}
                <text x={r.swatch ? 16 : 0} y={y + 19} fontSize={12} fill={INK}>
                  {r.label.length > 24 ? `${r.label.slice(0, 23)}…` : r.label}
                </text>
                <rect
                  x={x(r.value.low)}
                  y={y + 9}
                  width={Math.max(2, x(r.value.high) - x(r.value.low))}
                  height={12}
                  rx={4}
                  fill={BAND}
                />
                <rect x={x(r.value.central) - 1.5} y={y + 5} width={3} height={20} rx={1} fill={MARK} />
                {active && (
                  <text
                    x={labelW + plotW + 16}
                    y={y + 19}
                    fontSize={11}
                    fill={INK}
                    textAnchor="end"
                    fontWeight={600}
                  >
                    {fmt(r.value.low)}–{fmt(r.value.high)} (c. {fmt(r.value.central)})
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {note && <p className="mt-1 text-xs text-slate-600">{note}</p>}
      <button
        type="button"
        className="mt-1 text-xs underline"
        aria-expanded={showTable}
        onClick={() => setShowTable(!showTable)}
      >
        {showTable ? 'Hide' : 'Show'} data table
      </button>
      {showTable && (
        <table className="mt-1 w-full text-xs">
          <thead>
            <tr className="text-start">
              <th scope="col" className="text-start">
                Item
              </th>
              <th scope="col" className="text-end">
                Low
              </th>
              <th scope="col" className="text-end">
                Central
              </th>
              <th scope="col" className="text-end">
                High
              </th>
              <th scope="col" className="text-start ps-2">
                Unit
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row" className="text-start font-normal">
                  {r.label}
                </th>
                <td className="text-end">{fmt(r.value.low)}</td>
                <td className="text-end">{fmt(r.value.central)}</td>
                <td className="text-end">{fmt(r.value.high)}</td>
                <td className="ps-2">{unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
