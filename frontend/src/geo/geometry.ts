/**
 * Geometry helpers on WGS84 [lng, lat] coordinates.
 *
 * Distances use Turf's haversine-based measures (spherical earth). That is
 * adequate for sketch-level lengths (well under 1 % error at city scale) but is
 * not survey accuracy; precise local measures will use a projected CRS in PostGIS
 * (Phase 2, see docs/ARCHITECTURE.md).
 */
import { along, distance, length, lineString, nearestPointOnLine, lineSliceAlong, point } from '@turf/turf';
import type { LngLat } from '../domain/schema';

/** Alignment as drawn, closed when it is a ring (first coordinate appended). */
export function pathCoordinates(coords: readonly LngLat[], ring: boolean): LngLat[] {
  const out = coords.map((c) => [c[0], c[1]] as LngLat);
  if (ring && out.length >= 3) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  }
  return out;
}

export function isValidPath(coords: readonly LngLat[]): boolean {
  if (coords.length < 2) return false;
  for (const c of coords) {
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return false;
    if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) return false;
  }
  // Needs at least two distinct positions.
  return coords.some((c) => c[0] !== coords[0]![0] || c[1] !== coords[0]![1]);
}

/** Length of a path in metres. */
export function pathLengthM(coords: readonly LngLat[], ring = false): number {
  const path = pathCoordinates(coords, ring);
  if (!isValidPath(path)) return 0;
  return length(lineString(path), { units: 'kilometers' }) * 1000;
}

export function distanceM(a: LngLat, b: LngLat): number {
  return distance(point(a), point(b), { units: 'kilometers' }) * 1000;
}

export interface SnapResult {
  position: LngLat;
  /** 0..1 along the path. */
  fraction: number;
  chainageM: number;
  /** Distance from the input point to the path. */
  offsetM: number;
}

/** Project a point onto a path (nearest point). */
export function snapToPath(coords: readonly LngLat[], ring: boolean, p: LngLat): SnapResult | null {
  const path = pathCoordinates(coords, ring);
  if (!isValidPath(path)) return null;
  const total = pathLengthM(path);
  const snapped = nearestPointOnLine(lineString(path), point(p), { units: 'kilometers' });
  const chainageM = (snapped.properties.location ?? 0) * 1000;
  const offsetM = (snapped.properties.dist ?? 0) * 1000;
  const [lng, lat] = snapped.geometry.coordinates as [number, number];
  return {
    position: [lng, lat],
    chainageM,
    fraction: total > 0 ? Math.min(1, Math.max(0, chainageM / total)) : 0,
    offsetM,
  };
}

/** Position at a fraction (0..1) of the path length. */
export function positionAtFraction(coords: readonly LngLat[], ring: boolean, fraction: number): LngLat {
  const path = pathCoordinates(coords, ring);
  const total = pathLengthM(path);
  const f = Math.min(1, Math.max(0, fraction));
  const p = along(lineString(path), (total * f) / 1000, { units: 'kilometers' });
  const [lng, lat] = p.geometry.coordinates as [number, number];
  return [lng, lat];
}

/** Sub-path between two fractions, for rendering segment structure. */
export function slicePath(coords: readonly LngLat[], ring: boolean, from: number, to: number): LngLat[] {
  const path = pathCoordinates(coords, ring);
  const total = pathLengthM(path);
  if (total === 0 || to <= from) return [];
  const sliced = lineSliceAlong(lineString(path), (from * total) / 1000, (to * total) / 1000, {
    units: 'kilometers',
  });
  return sliced.geometry.coordinates.map((c) => [c[0]!, c[1]!] as LngLat);
}

/** True when the first and last coordinates are within `toleranceM`. */
export function endsMeet(coords: readonly LngLat[], toleranceM = 30): boolean {
  if (coords.length < 3) return false;
  return distanceM(coords[0]!, coords[coords.length - 1]!) <= toleranceM;
}

/**
 * Local equirectangular projection around a reference latitude.
 * Good enough for curvature estimates over a few hundred metres.
 */
export function toLocalMetres(p: LngLat, ref: LngLat): [number, number] {
  const R = 6371008.8;
  const x = ((p[0] - ref[0]) * Math.PI * R * Math.cos((ref[1] * Math.PI) / 180)) / 180;
  const y = ((p[1] - ref[1]) * Math.PI * R) / 180;
  return [x, y];
}

/**
 * Radius (m) of the circle through three consecutive vertices.
 * Returns Infinity for collinear points. This is a vertex-based approximation:
 * a sketched polyline has no designed transition curves.
 */
export function circumradiusM(a: LngLat, b: LngLat, c: LngLat): number {
  const [ax, ay] = toLocalMetres(a, b);
  const [cx, cy] = toLocalMetres(c, b);
  const bx = 0;
  const by = 0;
  const ab = Math.hypot(ax - bx, ay - by);
  const bc = Math.hypot(cx - bx, cy - by);
  const ca = Math.hypot(ax - cx, ay - cy);
  const cross = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  if (cross < 1e-9) return Infinity;
  return (ab * bc * ca) / (2 * cross);
}

export interface VertexCurvature {
  index: number;
  radiusM: number;
  position: LngLat;
}

/** Curvature at each interior vertex (and every vertex of a ring). */
export function vertexCurvatures(coords: readonly LngLat[], ring: boolean): VertexCurvature[] {
  const n = coords.length;
  const out: VertexCurvature[] = [];
  if (n < 3) return out;
  const indices = ring ? [...Array(n).keys()] : [...Array(n - 2).keys()].map((i) => i + 1);
  for (const i of indices) {
    const a = coords[(i - 1 + n) % n]!;
    const b = coords[i]!;
    const c = coords[(i + 1) % n]!;
    out.push({ index: i, radiusM: circumradiusM(a, b, c), position: b });
  }
  return out;
}

/** Sample a path every `stepM` metres (always includes both ends). */
export function samplePath(
  coords: readonly LngLat[],
  ring: boolean,
  stepM: number,
): { chainageM: number; position: LngLat }[] {
  const path = pathCoordinates(coords, ring);
  const total = pathLengthM(path);
  if (total === 0 || stepM <= 0) return [];
  const line = lineString(path);
  const out: { chainageM: number; position: LngLat }[] = [];
  for (let d = 0; d < total; d += stepM) {
    const c = along(line, d / 1000, { units: 'kilometers' }).geometry.coordinates;
    out.push({ chainageM: d, position: [c[0]!, c[1]!] });
  }
  const last = path[path.length - 1]!;
  out.push({ chainageM: total, position: [last[0], last[1]] });
  return out;
}

/**
 * Find ranges of `a` that run within `toleranceM` of `b` (candidate shared track).
 * Sampling-based; returns fractions of `a`.
 */
export function overlapRanges(
  a: readonly LngLat[],
  aRing: boolean,
  b: readonly LngLat[],
  bRing: boolean,
  toleranceM = 15,
  stepM = 25,
): { fromFraction: number; toFraction: number }[] {
  const total = pathLengthM(a, aRing);
  if (total === 0) return [];
  const samples = samplePath(a, aRing, stepM);
  const ranges: { fromFraction: number; toFraction: number }[] = [];
  let start: number | null = null;
  let prev = 0;
  for (const s of samples) {
    const snap = snapToPath(b, bRing, s.position);
    const inside = snap !== null && snap.offsetM <= toleranceM;
    if (inside && start === null) start = s.chainageM;
    if (!inside && start !== null) {
      if (prev - start >= stepM) ranges.push({ fromFraction: start / total, toFraction: prev / total });
      start = null;
    }
    prev = s.chainageM;
  }
  if (start !== null && prev - start >= stepM)
    ranges.push({ fromFraction: start / total, toFraction: prev / total });
  return ranges;
}
