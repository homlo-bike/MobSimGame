/**
 * Proof-of-concept octilinear schematic layout.
 *
 * Algorithm (deterministic):
 * 1. Project stations to local metres around the network centroid and scale so
 *    the median stop spacing is STEPS_PER_SPACING grid steps.
 * 2. Snap each station to the grid; a station whose cell is taken moves to the
 *    nearest free cell. Shared stations are placed once, so interchange
 *    relationships are kept; lines keep their geographic stop order.
 * 3. Manual offsets (user corrections) are applied.
 * 4. Between consecutive stations that are not on a 0°/45°/90° bearing, an elbow
 *    is inserted (diagonal then straight), so every drawn segment is octilinear.
 *
 * It does not yet minimise crossings globally or route parallel lines side by
 * side on shared segments; that is planned for Phase 5.
 */
import type { LngLat, Scenario } from '../domain/schema';
import { isRing, orderedStops } from '../domain/network';
import { toLocalMetres, distanceM } from '../geo/geometry';

export interface SchematicStation {
  id: string;
  name: string;
  x: number;
  y: number;
  interchange: boolean;
  terminal: boolean;
  lineIds: string[];
}

export interface SchematicLine {
  id: string;
  name: string;
  shortName: string;
  color: string;
  ring: boolean;
  stationIds: string[];
  points: { x: number; y: number }[];
  crossovers: { stationId: string; side: 'before' | 'after' }[];
}

export interface SchematicLayout {
  stations: SchematicStation[];
  lines: SchematicLine[];
  width: number;
  height: number;
}

export const GRID = 40;
/** Grid steps for a typical stop spacing; larger values leave room for labels. */
const STEPS_PER_SPACING = 3;
const DIRECTIONS = [...Array(8).keys()].map((i) => (i * Math.PI) / 4);

/** Snap an angle (radians, maths convention) to the nearest multiple of 45°. */
export function snapAngle(theta: number): number {
  let best = 0;
  let bestDiff = Infinity;
  for (const d of DIRECTIONS) {
    const diff = Math.abs(Math.atan2(Math.sin(theta - d), Math.cos(theta - d)));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  return best;
}

export function isOctilinear(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const dx = Math.round(b.x - a.x);
  const dy = Math.round(b.y - a.y);
  return dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
}

export function computeSchematic(
  scenario: Scenario,
  manualOffsets: Record<string, { dx: number; dy: number }> = {},
): SchematicLayout {
  const stationsById = new Map(scenario.stations.map((s) => [s.id, s]));
  const lineOrders = scenario.lines
    .map((l) => ({ line: l, stops: orderedStops(l, scenario.stations) }))
    .filter((x) => x.stops.length >= 1)
    .sort((a, b) => b.stops.length - a.stops.length);

  const all = lineOrders.flatMap((x) => x.stops.map((s) => s.station.position));
  if (all.length === 0) return { stations: [], lines: [], width: 400, height: 200 };
  const ref: LngLat = [
    all.reduce((s, p) => s + p[0], 0) / all.length,
    all.reduce((s, p) => s + p[1], 0) / all.length,
  ];

  // Median spacing sets the scale so a typical stop spacing is one grid step.
  const spacings: number[] = [];
  for (const { stops } of lineOrders) {
    for (let i = 1; i < stops.length; i++)
      spacings.push(distanceM(stops[i - 1]!.station.position, stops[i]!.station.position));
  }
  spacings.sort((a, b) => a - b);
  const typical = spacings[Math.floor(spacings.length / 2)] ?? 1000;
  const metresPerStep = Math.max(1, typical);

  const placed = new Map<string, { x: number; y: number }>();
  const occupied = new Set<string>();
  const key = (p: { x: number; y: number }) => `${Math.round(p.x)},${Math.round(p.y)}`;
  const local = (p: LngLat) => {
    const [x, y] = toLocalMetres(p, ref);
    return {
      x: (x / metresPerStep) * GRID * STEPS_PER_SPACING,
      y: (-y / metresPerStep) * GRID * STEPS_PER_SPACING,
    };
  };
  const snapGrid = (p: { x: number; y: number }) => ({
    x: Math.round(p.x / GRID) * GRID,
    y: Math.round(p.y / GRID) * GRID,
  });

  // Place every station once at its scaled geographic position snapped to the grid;
  // collisions move to the nearest free grid cell (spiral search).
  const ordered = lineOrders.flatMap((x) => x.stops.map((s) => s.station));
  for (const st of ordered) {
    if (placed.has(st.id)) continue;
    const base = snapGrid(local(st.position));
    let p = base;
    for (let r = 1; occupied.has(key(p)) && r < 6; r++) {
      const ring = [...DIRECTIONS].map((d) => ({
        x: base.x + Math.round(Math.cos(d)) * GRID * r,
        y: base.y - Math.round(Math.sin(d)) * GRID * r,
      }));
      p = ring.find((c) => !occupied.has(key(c))) ?? p;
    }
    placed.set(st.id, p);
    occupied.add(key(p));
  }

  const lines: SchematicLine[] = lineOrders.map(({ line, stops }) => ({
    id: line.id,
    name: line.name,
    shortName: line.shortName,
    color: line.color,
    ring: isRing(line),
    stationIds: stops.map((s) => s.station.id),
    points: [],
    crossovers: line.crossovers.map((c) => ({ stationId: c.stationId, side: c.side })),
  }));

  for (const [id, off] of Object.entries(manualOffsets)) {
    const p = placed.get(id);
    if (p) placed.set(id, { x: p.x + off.dx, y: p.y + off.dy });
  }

  // Line paths: insert an elbow where two consecutive stations are not octilinear.
  for (const l of lines) {
    const pts: { x: number; y: number }[] = [];
    const seq = l.ring && l.stationIds.length > 2 ? [...l.stationIds, l.stationIds[0]!] : l.stationIds;
    for (let i = 0; i < seq.length; i++) {
      const p = placed.get(seq[i]!)!;
      if (i > 0) {
        const a = pts[pts.length - 1]!;
        if (!isOctilinear(a, p)) {
          const dx = p.x - a.x;
          const dy = p.y - a.y;
          const d = Math.min(Math.abs(dx), Math.abs(dy));
          pts.push({ x: a.x + Math.sign(dx) * d, y: a.y + Math.sign(dy) * d });
        }
      }
      pts.push(p);
    }
    l.points = pts;
  }

  const lineIdsByStation = new Map<string, string[]>();
  for (const l of lines)
    for (const id of l.stationIds) lineIdsByStation.set(id, [...(lineIdsByStation.get(id) ?? []), l.id]);
  const terminals = new Set(
    lines
      .filter((l) => !l.ring && l.stationIds.length)
      .flatMap((l) => [l.stationIds[0]!, l.stationIds[l.stationIds.length - 1]!]),
  );

  const stations: SchematicStation[] = [...placed.entries()].map(([id, p]) => ({
    id,
    name: stationsById.get(id)?.name ?? id,
    x: p.x,
    y: p.y,
    interchange: (lineIdsByStation.get(id)?.length ?? 0) >= 2,
    terminal: terminals.has(id),
    lineIds: lineIdsByStation.get(id) ?? [],
  }));

  // Normalise to a positive viewport with margins for labels.
  const xs = stations.map((s) => s.x);
  const ys = stations.map((s) => s.y);
  const minX = Math.min(...xs) - GRID * 2;
  const minY = Math.min(...ys) - GRID * 4;
  for (const s of stations) {
    s.x -= minX;
    s.y -= minY;
  }
  for (const l of lines) l.points = l.points.map((p) => ({ x: p.x - minX, y: p.y - minY }));
  return {
    stations,
    lines,
    width: Math.max(...xs) - minX + GRID * 9,
    height: Math.max(...ys) - minY + GRID * 2,
  };
}

/** Position of a crossover marker: a third of the way from its station toward the neighbour. */
export function crossoverPoint(
  layout: SchematicLayout,
  line: SchematicLine,
  c: { stationId: string; side: 'before' | 'after' },
): { x: number; y: number } | null {
  const i = line.stationIds.indexOf(c.stationId);
  const s = layout.stations.find((x) => x.id === c.stationId);
  if (i < 0 || !s) return null;
  const n = line.stationIds.length;
  const j = c.side === 'before' ? i - 1 : i + 1;
  const neighbourId = line.ring ? line.stationIds[(j + n) % n] : line.stationIds[j];
  const nb = layout.stations.find((x) => x.id === neighbourId);
  if (!nb) {
    // Beyond a terminal: place the marker just past the end along the line's last direction.
    return { x: s.x + (c.side === 'before' ? -GRID / 2 : GRID / 2), y: s.y };
  }
  return { x: s.x + (nb.x - s.x) / 3, y: s.y + (nb.y - s.y) / 3 };
}

/** Plain-text alternative describing the schematic for screen readers and reports. */
export function describeSchematic(layout: SchematicLayout): string {
  const byId = new Map(layout.stations.map((s) => [s.id, s]));
  const parts = layout.lines.map((l) => {
    const names = l.stationIds.map((id) => {
      const s = byId.get(id)!;
      return s.interchange ? `${s.name} (interchange)` : s.name;
    });
    const xo = l.crossovers.map((c) => `${c.side} ${byId.get(c.stationId)?.name ?? '?'}`);
    return `${l.name}${l.ring ? ' (ring)' : ''}: ${names.join(' → ')}${l.ring ? ' → back to start' : ''}.${
      xo.length ? ` Crossovers ${xo.join(', ')}.` : ''
    }`;
  });
  return parts.join(' ');
}
