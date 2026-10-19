/**
 * Low/central/high range arithmetic.
 *
 * Ranges are combined case-by-case (low with low, high with high). This is a
 * simple bounding convention, not a probabilistic interval; it is documented in
 * docs/METHODOLOGY.md. For subtraction and division the opposite bound is used
 * so the result still brackets every case combination of monotonic inputs.
 */
import type { Range } from '../domain/schema';

export const range = (low: number, central: number, high: number): Range => {
  if (!(low <= central && central <= high)) {
    throw new RangeError(`Invalid range: expected low <= central <= high, got ${low}, ${central}, ${high}`);
  }
  return { low, central, high };
};

export const point = (v: number): Range => ({ low: v, central: v, high: v });

export function add(...rs: Range[]): Range {
  return rs.reduce(
    (acc, r) => ({ low: acc.low + r.low, central: acc.central + r.central, high: acc.high + r.high }),
    point(0),
  );
}

export function sub(a: Range, b: Range): Range {
  return { low: a.low - b.high, central: a.central - b.central, high: a.high - b.low };
}

/** Product of non-negative ranges. */
export function mul(...rs: Range[]): Range {
  for (const r of rs) {
    if (r.low < 0) throw new RangeError('mul() expects non-negative ranges');
  }
  return rs.reduce(
    (acc, r) => ({ low: acc.low * r.low, central: acc.central * r.central, high: acc.high * r.high }),
    point(1),
  );
}

export function scale(r: Range, k: number): Range {
  return k >= 0
    ? { low: r.low * k, central: r.central * k, high: r.high * k }
    : { low: r.high * k, central: r.central * k, high: r.low * k };
}

/** Division of non-negative ranges by a strictly positive range. */
export function div(a: Range, b: Range): Range {
  if (b.low <= 0) throw new RangeError('div() expects a strictly positive divisor range');
  return { low: a.low / b.high, central: a.central / b.central, high: a.high / b.low };
}

export function formatRange(r: Range, unit: string, digits = 0): string {
  const f = (v: number) =>
    v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  if (r.low === r.high) return `${f(r.central)} ${unit}`;
  return `${f(r.low)} – ${f(r.high)} ${unit} (central ${f(r.central)})`;
}

/** Relative spread used as a crude sensitivity indicator: (high - low) / central. */
export function relativeSpread(r: Range): number {
  return r.central === 0 ? 0 : (r.high - r.low) / Math.abs(r.central);
}
