/**
 * User-adjustable parameters of the track network, each with a default, an
 * allowed range, a status and a source. Values that no source supports are
 * labelled placeholder. Users override values per project
 * (`trackNetwork.parameterOverrides`); the override then has status
 * `user_override`.
 */
import type { TrackNetwork, TransportMode } from './schema';

export type ParameterStatus = 'documented_default' | 'user_override' | 'demonstration';

export interface ParameterDefinition {
  id: string;
  label: string;
  unit: string;
  defaultValue: number;
  min: number;
  max: number;
  status: Exclude<ParameterStatus, 'user_override'>;
  source: string;
  notes?: string;
}

const EBO_10 =
  'Eisenbahn-Bau- und Betriebsordnung (EBO) § 10 (Germany): track centre distance on open line at least 4.00 m for new construction (3.80 m where only urban rapid transit runs), 4.50 m in new stations; to be widened in curves below 250 m radius. https://www.gesetze-im-internet.de/ebo/__10.html';
const PLACEHOLDER = 'Placeholder, not from a cited source. Enter a local value.';

export const TRACK_PARAMETERS = {
  trackSpacingHeavyRailM: {
    id: 'trackSpacingHeavyRailM',
    label: 'Track centre distance, metro and commuter rail',
    unit: 'm',
    defaultValue: 4.0,
    min: 3.0,
    max: 6.0,
    status: 'documented_default',
    source: EBO_10,
    notes:
      'German mainline rule used as a default for heavy rail; metros built under other rules may differ.',
  },
  trackSpacingTramM: {
    id: 'trackSpacingTramM',
    label: 'Track centre distance, tram and light rail',
    unit: 'm',
    defaultValue: 3.2,
    min: 2.6,
    max: 6.0,
    status: 'demonstration',
    source: PLACEHOLDER,
    notes:
      'BOStrab § 34 limits tram vehicle width to 2.65 m, so the distance must exceed that plus clearances; the clearances depend on the vehicle and curve.',
  },
  stationTrackSearchM: {
    id: 'stationTrackSearchM',
    label: 'Distance for suggesting tracks at a station',
    unit: 'm',
    defaultValue: 20,
    min: 1,
    max: 200,
    status: 'documented_default',
    source:
      'Owner requirement for this project (2026-10-20): tracks within 20 m, measured in the projected frame.',
  },
  nodeSnapM: {
    id: 'nodeSnapM',
    label: 'Distance for joining a new track end to an existing node or track',
    unit: 'm',
    defaultValue: 5,
    min: 0.5,
    max: 50,
    status: 'demonstration',
    source: 'Editor tolerance, not an engineering value.',
  },
  minSeparationRailM: {
    id: 'minSeparationRailM',
    label: 'Minimum distance between following trains (simulation)',
    unit: 'm',
    defaultValue: 200,
    min: 0,
    max: 5000,
    status: 'demonstration',
    source: PLACEHOLDER,
    notes: 'The real value follows from braking distance and the signalling system.',
  },
  minSeparationTramM: {
    id: 'minSeparationTramM',
    label: 'Minimum distance between following trams (simulation)',
    unit: 'm',
    defaultValue: 50,
    min: 0,
    max: 1000,
    status: 'demonstration',
    source: PLACEHOLDER,
    notes: 'Trams usually run on sight; the real value depends on speed and braking.',
  },
  platformLengthTramM: {
    id: 'platformLengthTramM',
    label: 'Platform length, tram',
    unit: 'm',
    defaultValue: 45,
    min: 10,
    max: 150,
    status: 'demonstration',
    source: PLACEHOLDER,
    notes: 'Set it to the longest tram (all coupled units) plus a margin.',
  },
  platformLengthLightRailM: {
    id: 'platformLengthLightRailM',
    label: 'Platform length, light rail',
    unit: 'm',
    defaultValue: 75,
    min: 10,
    max: 250,
    status: 'demonstration',
    source: PLACEHOLDER,
  },
  platformLengthMetroM: {
    id: 'platformLengthMetroM',
    label: 'Platform length, metro',
    unit: 'm',
    defaultValue: 120,
    min: 20,
    max: 400,
    status: 'demonstration',
    source: PLACEHOLDER,
  },
  platformLengthRailM: {
    id: 'platformLengthRailM',
    label: 'Platform length, commuter rail',
    unit: 'm',
    defaultValue: 210,
    min: 20,
    max: 450,
    status: 'demonstration',
    source: PLACEHOLDER,
  },
  sidePlatformWidthM: {
    id: 'sidePlatformWidthM',
    label: 'Side platform width',
    unit: 'm',
    defaultValue: 3,
    min: 1,
    max: 15,
    status: 'demonstration',
    source: PLACEHOLDER,
  },
  islandPlatformWidthM: {
    id: 'islandPlatformWidthM',
    label: 'Island platform width',
    unit: 'm',
    defaultValue: 6,
    min: 2,
    max: 25,
    status: 'demonstration',
    source: PLACEHOLDER,
  },
  crossingClearanceM: {
    id: 'crossingClearanceM',
    label: 'Clearance before and after a crossing (simulation)',
    unit: 'm',
    defaultValue: 5,
    min: 0,
    max: 100,
    status: 'demonstration',
    source: PLACEHOLDER,
    notes: 'A vehicle occupies a crossing from this distance before it until its rear is this far past it.',
  },
  unknownVehicleLengthM: {
    id: 'unknownVehicleLengthM',
    label: 'Vehicle length when a line has no vehicle type (simulation)',
    unit: 'm',
    defaultValue: 20,
    min: 5,
    max: 400,
    status: 'demonstration',
    source: PLACEHOLDER,
  },
  walkingSpeedKmh: {
    id: 'walkingSpeedKmh',
    label: 'Walking speed for walking links between stations',
    unit: 'km/h',
    defaultValue: 4.5,
    min: 1,
    max: 8,
    status: 'demonstration',
    source: PLACEHOLDER,
    notes:
      'Applied to the straight-line distance; real paths are longer. Enter a measured time per link where known.',
  },
  minSeparationBusM: {
    id: 'minSeparationBusM',
    label: 'Minimum distance between following buses (simulation)',
    unit: 'm',
    defaultValue: 20,
    min: 0,
    max: 500,
    status: 'demonstration',
    source: PLACEHOLDER,
  },
} as const satisfies Record<string, ParameterDefinition>;

export type TrackParameterId = keyof typeof TRACK_PARAMETERS;

export interface ParameterValue {
  value: number;
  status: ParameterStatus;
  definition: ParameterDefinition;
}

export function parameter(
  network: Pick<TrackNetwork, 'parameterOverrides'>,
  id: TrackParameterId,
): ParameterValue {
  const definition: ParameterDefinition = TRACK_PARAMETERS[id];
  const o = network.parameterOverrides[id];
  if (o !== undefined && Number.isFinite(o) && o >= definition.min && o <= definition.max)
    return { value: o, status: 'user_override', definition };
  return { value: definition.defaultValue, status: definition.status, definition };
}

export function parameterValue(
  network: Pick<TrackNetwork, 'parameterOverrides'>,
  id: TrackParameterId,
): number {
  return parameter(network, id).value;
}

const HEAVY: TransportMode[] = ['metro', 'elevated_metro', 'commuter_rail'];

export function trackSpacingM(
  network: Pick<TrackNetwork, 'parameterOverrides'>,
  mode: TransportMode,
): number {
  return parameterValue(network, HEAVY.includes(mode) ? 'trackSpacingHeavyRailM' : 'trackSpacingTramM');
}

export function minSeparationM(
  network: Pick<TrackNetwork, 'parameterOverrides'>,
  mode: TransportMode,
): number {
  if (mode === 'bus' || mode === 'brt') return parameterValue(network, 'minSeparationBusM');
  if (mode === 'tram' || mode === 'light_rail') return parameterValue(network, 'minSeparationTramM');
  return parameterValue(network, 'minSeparationRailM');
}

/** Default platform length of a station of this mode. */
export function platformLengthM(
  network: Pick<TrackNetwork, 'parameterOverrides'>,
  mode: TransportMode,
): number {
  const id: TrackParameterId =
    mode === 'tram'
      ? 'platformLengthTramM'
      : mode === 'light_rail' || mode === 'custom'
        ? 'platformLengthLightRailM'
        : mode === 'commuter_rail'
          ? 'platformLengthRailM'
          : 'platformLengthMetroM';
  return parameterValue(network, id);
}
