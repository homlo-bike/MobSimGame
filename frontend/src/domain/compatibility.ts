/**
 * Infrastructure classes and compatibility: which service modes and vehicles may
 * use which tracks. Pure.
 *
 * The defaults are modelling conventions of this project, not cited engineering
 * rules. They are deliberately sparse (each mode uses its own class, plus the
 * closest relative such as tram ↔ light rail) and can be changed per project, for
 * example to allow tram-trains on railway track.
 */
import type {
  Electrification,
  InfrastructureClass,
  PhysicalTrack,
  Scenario,
  TrackNetwork,
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
  cycling: 'cycling',
  pedestrian: 'walking',
  custom: 'light_rail',
};

/** Default service compatibility (project convention, editable per project). */
export const DEFAULT_SERVICE_COMPATIBILITY: Record<TransportMode, readonly InfrastructureClass[]> = {
  tram: ['tram', 'light_rail'],
  light_rail: ['light_rail', 'tram'],
  metro: ['metro'],
  elevated_metro: ['metro'],
  commuter_rail: ['railway'],
  bus: ['bus', 'brt'],
  brt: ['brt', 'bus'],
  cycling: ['cycling'],
  pedestrian: ['walking'],
  custom: ['tram', 'light_rail', 'metro', 'railway'],
};

export function trackClass(
  t: Pick<PhysicalTrack, 'infrastructureClass' | 'designMode'>,
): InfrastructureClass {
  return t.infrastructureClass ?? DEFAULT_CLASS_FOR_MODE[t.designMode];
}

/** Classes the mode may use in this network (project override, else the default). */
export function allowedClasses(
  net: Pick<TrackNetwork, 'serviceCompatibility'>,
  mode: TransportMode,
): readonly InfrastructureClass[] {
  return net.serviceCompatibility?.[mode] ?? DEFAULT_SERVICE_COMPATIBILITY[mode];
}

export function isCompatibilityOverridden(
  net: Pick<TrackNetwork, 'serviceCompatibility'>,
  mode: TransportMode,
) {
  return net.serviceCompatibility?.[mode] !== undefined;
}

export function serviceCanUse(
  net: Pick<TrackNetwork, 'serviceCompatibility'>,
  mode: TransportMode,
  track: Pick<PhysicalTrack, 'infrastructureClass' | 'designMode'>,
): boolean {
  return allowedClasses(net, mode).includes(trackClass(track));
}

/** Set (or with `null` reset) the classes a mode may use. The mode's own class always stays allowed. */
export function setServiceCompatibility(
  scenario: Scenario,
  mode: TransportMode,
  classes: readonly InfrastructureClass[] | null,
): Scenario {
  const next = { ...scenario.trackNetwork.serviceCompatibility };
  if (classes === null) delete next[mode];
  else {
    const own = DEFAULT_CLASS_FOR_MODE[mode];
    next[mode] = INFRASTRUCTURE_CLASSES.filter((c) => c === own || classes.includes(c));
  }
  return { ...scenario, trackNetwork: { ...scenario.trackNetwork, serviceCompatibility: next } };
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
