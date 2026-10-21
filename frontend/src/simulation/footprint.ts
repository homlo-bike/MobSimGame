/**
 * Vehicles drawn to scale: the outline of every car or articulated section of every unit
 * of a consist, following the path (each section a rectangle from its front to its rear
 * point on the path, so a train bends through curves section by section). Pure.
 */
import type { LngLat, Scenario, TransportLine } from '../domain/schema';
import { parameterValue } from '../domain/trackParameters';
import { toLocalMetres } from '../geo/geometry';

/** Size of one consist of a line, for drawing. */
export interface ConsistShape {
  unitLengthM: number;
  units: number;
  /** Cars or articulated sections per unit (drawing). */
  sectionsPerUnit: number;
  widthM: number;
  /** True when the length or width is the placeholder (no vehicle type or no width given). */
  placeholder: boolean;
}

export function consistShape(line: TransportLine, scenario: Scenario): ConsistShape {
  const net = scenario.trackNetwork;
  const v = scenario.vehicleTypes.find((x) => x.id === line.vehicleTypeId);
  const units = v ? (line.consistUnits ?? v.unitsPerConsist) : 1;
  const unitLengthM = v?.lengthM ?? parameterValue(net, 'unknownVehicleLengthM');
  const sections =
    v?.sectionsPerUnit ?? Math.round(unitLengthM / parameterValue(net, 'vehicleSectionLengthM'));
  return {
    unitLengthM,
    units: Math.max(1, units),
    sectionsPerUnit: Math.max(1, sections),
    widthM: v?.widthM ?? parameterValue(net, 'unknownVehicleWidthM'),
    placeholder: !v || v.widthM == null,
  };
}

/** A path with cumulative chainage (same shape as the engine's MeasuredPath). */
export interface PathLike {
  coords: LngLat[];
  cumulative: number[];
  lengthM: number;
}

/**
 * Point at chainage `c`; beyond the ends the path continues straight along its first or
 * last segment, so a train standing at a terminal keeps its full length.
 */
function pointAt(path: PathLike, c: number): LngLat {
  const n = path.coords.length;
  if (c < 0 || c > path.lengthM) {
    const [i, j, over] = c < 0 ? [1, 0, -c] : [n - 2, n - 1, c - path.lengthM];
    const a = path.coords[i]!;
    const b = path.coords[j]!;
    const [dx, dy] = toLocalMetres(b, a);
    const len = Math.hypot(dx, dy);
    if (len > 0) return fromLocal([(dx / len) * (len + over), (dy / len) * (len + over)], a);
  }
  const s = Math.min(path.lengthM, Math.max(0, c));
  let lo = 0;
  let hi = path.cumulative.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.cumulative[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const a = path.coords[lo]!;
  const b = path.coords[hi] ?? a;
  const len = path.cumulative[hi]! - path.cumulative[lo]!;
  const t = len > 0 ? (s - path.cumulative[lo]!) / len : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function fromLocal(xy: [number, number], ref: LngLat): LngLat {
  const R = 6371008.8;
  return [
    ref[0] + (xy[0] * 180) / (Math.PI * R * Math.cos((ref[1] * Math.PI) / 180)),
    ref[1] + (xy[1] * 180) / (Math.PI * R),
  ];
}

/**
 * Outlines (closed rings) of the units of a consist centred at `centreM` along `path`
 * (so a train stopped at a station stands centred on the platform), travelling in
 * `direction` (+1 towards higher chainage); the units follow the leading one. On a ring
 * the consist wraps around the start; elsewhere the path is extended straight beyond its
 * ends, so a train at a terminal keeps its shape.
 */
export function consistFootprint(
  path: PathLike,
  centreM: number,
  direction: 1 | -1,
  shape: ConsistShape,
  ring: boolean,
): LngLat[][] {
  if (path.lengthM <= 0 || path.coords.length < 2) return [];
  const at = (c: number) => {
    if (ring) return pointAt(path, ((c % path.lengthM) + path.lengthM) % path.lengthM);
    return pointAt(path, c);
  };
  const half = shape.widthM / 2;
  const frontM = centreM + (direction * shape.units * shape.unitLengthM) / 2;
  const sectionM = shape.unitLengthM / shape.sectionsPerUnit;
  const out: LngLat[][] = [];
  for (let k = 0; k < shape.units * shape.sectionsPerUnit; k++) {
    const front = at(frontM - direction * k * sectionM);
    const rear = at(frontM - direction * (k + 1) * sectionM);
    const [dx, dy] = toLocalMetres(front, rear);
    const len = Math.hypot(dx, dy);
    if (len < 0.1) continue;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    out.push(
      [
        [nx, ny],
        [dx + nx, dy + ny],
        [dx - nx, dy - ny],
        [-nx, -ny],
        [nx, ny],
      ].map((p) => fromLocal(p as [number, number], rear)),
    );
  }
  return out;
}
