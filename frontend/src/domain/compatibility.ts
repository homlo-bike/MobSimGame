/**
 * Infrastructure classes and compatibility: which service modes and vehicles may
 * use which tracks. Pure.
 *
 * Every mode uses only its own class (owner decision): a tram never runs on light
 * rail or metro track, a bus never on a BRT busway or trolleybus wire. Where modes
 * meet on the same level they cross (crossings with priority), they never share.
 */
import type {
  Electrification,
  InfrastructureClass,
  PhysicalTrack,
  TransportMode,
  VehicleType,
} from './schema';

export const INFRASTRUCTURE_CLASSES: readonly InfrastructureClass[] = [
  'tram',
  'light_rail',
  'metro',
  'railway',
  'bus',
  'brt',
  'trolleybus',
  'cycling',
  'walking',
];

export const INFRASTRUCTURE_CLASS_LABELS: Record<InfrastructureClass, string> = {
  tram: 'Tram track',
  light_rail: 'Light rail track',
  metro: 'Metro track',
  railway: 'Railway track',
  bus: 'Bus lane or road',
  brt: 'BRT busway',
  trolleybus: 'Trolleybus overhead wire',
  cycling: 'Cycle track',
  walking: 'Footway',
};

export const ELECTRIFICATION_LABELS: Record<Electrification, string> = {
  overhead: 'Overhead line',
  third_rail: 'Third rail',
  none: 'Not electrified',
  unknown: 'Not specified',
};

/** Rail classes form the track graph; the others are street-routed or not modelled as track. */
export const RAIL_CLASSES: readonly InfrastructureClass[] = ['tram', 'light_rail', 'metro', 'railway'];

/** Class a track has when none is set: the one its design mode is built for. */
export const DEFAULT_CLASS_FOR_MODE: Record<TransportMode, InfrastructureClass> = {
  tram: 'tram',
  light_rail: 'light_rail',
  metro: 'metro',
  elevated_metro: 'metro',
  commuter_rail: 'railway',
  bus: 'bus',
  brt: 'brt',
  trolleybus: 'trolleybus',
  cycling: 'cycling',
  pedestrian: 'walking',
  custom: 'light_rail',
};

/** The class each mode may use: only its own. */
export const DEFAULT_SERVICE_COMPATIBILITY: Record<TransportMode, readonly InfrastructureClass[]> = {
  tram: ['tram'],
  light_rail: ['light_rail'],
  metro: ['metro'],
  elevated_metro: ['metro'],
  commuter_rail: ['railway'],
  bus: ['bus'],
  brt: ['brt'],
  trolleybus: ['trolleybus'],
  cycling: ['cycling'],
  pedestrian: ['walking'],
  custom: ['light_rail'],
};

export function trackClass(
  t: Pick<PhysicalTrack, 'infrastructureClass' | 'designMode'>,
): InfrastructureClass {
  return t.infrastructureClass ?? DEFAULT_CLASS_FOR_MODE[t.designMode];
}

/**
 * Classes a mode may use. Every mode keeps to its own infrastructure (owner decision: modes
 * need different track, power supply, sensors and speeds); there are no project overrides.
 */
export function allowedClasses(mode: TransportMode): readonly InfrastructureClass[] {
  return DEFAULT_SERVICE_COMPATIBILITY[mode];
}

export function serviceCanUse(
  mode: TransportMode,
  track: Pick<PhysicalTrack, 'infrastructureClass' | 'designMode'>,
): boolean {
  return allowedClasses(mode).includes(trackClass(track));
}

export interface CompatibilityIssue {
  kind: 'class' | 'gauge' | 'electrification';
  message: string;
}

/**
 * Why a vehicle cannot run on a track, if it cannot. Unknown values (gauge or
 * electrification not specified) are never treated as a conflict.
 */
export function vehicleTrackIssues(
  vehicle: Pick<VehicleType, 'name' | 'gaugeMm' | 'energy'>,
  track: Pick<PhysicalTrack, 'gaugeMm' | 'electrification'>,
): CompatibilityIssue[] {
  const out: CompatibilityIssue[] = [];
  if (vehicle.gaugeMm && track.gaugeMm && vehicle.gaugeMm !== track.gaugeMm)
    out.push({
      kind: 'gauge',
      message: `${vehicle.name} runs on ${vehicle.gaugeMm} mm gauge; the track is ${track.gaugeMm} mm`,
    });
  const e = track.electrification;
  if (vehicle.energy === 'electric_overhead' && (e === 'none' || e === 'third_rail'))
    out.push({
      kind: 'electrification',
      message: `${vehicle.name} needs an overhead line; the track has ${ELECTRIFICATION_LABELS[e].toLowerCase()}`,
    });
  if (vehicle.energy === 'electric_third_rail' && (e === 'none' || e === 'overhead'))
    out.push({
      kind: 'electrification',
      message: `${vehicle.name} needs a third rail; the track has ${ELECTRIFICATION_LABELS[e].toLowerCase()}`,
    });
  return out;
}
