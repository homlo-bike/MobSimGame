/**
 * Vehicles drawn to scale: the outline of every unit of a consist, following the path
 * (each unit a rectangle from its front to its rear point on the path, so a train bends
 * through curves unit by unit). Pure.
 */
import type { LngLat, Scenario, TransportLine } from '../domain/schema';
import { parameterValue } from '../domain/trackParameters';
import { toLocalMetres } from '../geo/geometry';

/** Size of one consist of a line, for drawing. */
export interface ConsistShape {
  unitLengthM: number;
  units: number;
  widthM: number;
  /** True when the length or width is the placeholder (no vehicle type or no width given). */
  placeholder: boolean;
}

export function consistShape(line: TransportLine, scenario: Scenario): ConsistShape {
  const net = scenario.trackNetwork;
  const v = scenario.vehicleTypes.find((x) => x.id === line.vehicleTypeId);
  const units = v ? (line.consistUnits ?? v.unitsPerConsist) : 1;
  return {
    unitLengthM: v?.lengthM ?? parameterValue(net, 'unknownVehicleLengthM'),
    units: Math.max(1, units),
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

function pointAt(path: PathLike, c: number): LngLat {
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
 * `direction` (+1 towards higher chainage); the units follow the leading one. On a ring the consist wraps around the start; elsewhere it is cut at the
 * path ends (a vehicle turning at a terminal).
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
  const out: LngLat[][] = [];
  for (let k = 0; k < shape.units; k++) {
    const front = at(frontM - direction * k * shape.unitLengthM);
    const rear = at(frontM - direction * (k + 1) * shape.unitLengthM);
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
