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
const SUMO_TAU =
  'Eclipse SUMO documentation, "Definition of Vehicles, Vehicle Types, and Routes": default tau 1.0 s (desired minimum time headway); Intelligent Driver Model: Treiber, Hennecke & Helbing (2000), "Congested traffic states in empirical observations and microscopic simulations", Physical Review E 62, 1805.';
const SUMO_MINGAP =
  'Eclipse SUMO documentation, "Vehicle Type Parameter Defaults" (edited 12 October 2026): minGap 2.5 m for bus and tram.';

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
  spareRatio: {
    id: 'spareRatio',
    label: 'Spare vehicles, share of the vehicles in peak service (fleet)',
    unit: '',
    defaultValue: 0.2,
    min: 0,
    max: 0.5,
    status: 'documented_default',
    source:
      'US FTA guideline for bus fleets of 50 or more vehicles: spares should not exceed 20 % of the vehicles in maximum service (FTA Circular 9030.1C, ch. V §9.a.5), as reported in TCRP Synthesis 109 "System-Specific Spare Bus Ratios Update" (2014), doi:10.17226/22409. The circular text itself was not read.',
    notes:
      'A ceiling for US bus fleets, used here for every mode as a planning allowance; rail operators usually plan their own reserve. Set the local value.',
  },
  adhesionCoefficient: {
    id: 'adhesionCoefficient',
    label: 'Wheel–rail adhesion for starting, when a vehicle gives no starting tractive effort (simulation)',
    unit: '',
    defaultValue: 0.4,
    min: 0.05,
    max: 0.5,
    status: 'documented_default',
    source:
      'Aredah, Fadhloun and Rakha (2024), NeTrainSim, Railway Engineering Science 32(4), Table 2: coefficient of friction 0.4 in both validation scenarios (CC BY 4.0).',
    notes:
      'Value of freight-train scenarios on dry rail, applied to the whole vehicle mass (every axle driven). It overstates the starting force of vehicles with unpowered axles; enter the starting tractive effort in the vehicle profile instead.',
  },
  followingTimeGapS: {
    id: 'followingTimeGapS',
    label: 'Time gap to the vehicle ahead, buses and trams driving on sight (simulation)',
    unit: 's',
    defaultValue: 1.0,
    min: 0.3,
    max: 5,
    status: 'documented_default',
    source: SUMO_TAU,
    notes:
      'The desired gap is the minimum gap plus speed × time gap (Intelligent Driver Model, steady state).',
  },
  followingMinGapM: {
    id: 'followingMinGapM',
    label: 'Minimum gap to the vehicle ahead when stopped, buses and trams (simulation)',
    unit: 'm',
    defaultValue: 2.5,
    min: 0.5,
    max: 20,
    status: 'documented_default',
    source: SUMO_MINGAP,
  },
  minSeparationRailM: {
    id: 'minSeparationRailM',
    label: 'Minimum distance between following metro and commuter trains (simulation)',
    unit: 'm',
    defaultValue: 200,
    min: 0,
    max: 5000,
    status: 'demonstration',
    source: PLACEHOLDER,
    notes: 'The real value follows from braking distance and the signalling system.',
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
  unknownVehicleWidthM: {
    id: 'unknownVehicleWidthM',
    label: 'Vehicle width when the vehicle type gives none (drawing to scale)',
    unit: 'm',
    defaultValue: 2.5,
    min: 1,
    max: 5,
    status: 'demonstration',
    source: PLACEHOLDER,
    notes: 'Enter the width in the vehicle profile for a true-to-scale drawing.',
  },
  stopMergeRadiusM: {
    id: 'stopMergeRadiusM',
    label: 'Distance within which a new stop or station reuses an existing one',
    unit: 'm',
    defaultValue: 20,
    min: 1,
    max: 200,
    status: 'documented_default',
    source: 'Owner requirement for this project (2026-10-20): 20 m (previously 60 m).',
    notes: 'Only stops and stations of the same mode are reused; modes never share stations.',
  },
  levelDepthM: {
    id: 'levelDepthM',
    label: 'Depth of track per underground level, below the street (ramps)',
    unit: 'm',
    defaultValue: 10,
    min: 3,
    max: 60,
    status: 'documented_default',
    source: 'Owner decision for this project (2026-10-20): system default 10 m per underground level.',
    notes:
      'Depth of the top of rail; cut-and-cover tunnels are shallower than bored ones. Enter the design depth.',
  },
  levelHeightM: {
    id: 'levelHeightM',
    label: 'Height of track per elevated level, above the street (ramps)',
    unit: 'm',
    defaultValue: 7,
    min: 3,
    max: 40,
    status: 'documented_default',
    source: 'Owner decision for this project (2026-10-20): system default 7 m per elevated level.',
    notes: 'Height of the top of rail; it must clear road vehicles below. Enter the design height.',
  },
  stationMaxGradientPercent: {
    id: 'stationMaxGradientPercent',
    label: 'Steepest gradient of track at a station platform, tram, light rail and metro',
    unit: '%',
    defaultValue: 0.5,
    min: 0,
    max: 5,
    status: 'demonstration',
    source: PLACEHOLDER,
    notes:
      'For railways (commuter rail) EBO § 7 (2) applies instead: 2.5 per mille (0.25 %) for station tracks.',
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

/** Modes that drive on sight (road vehicles, trams, light rail): they follow the vehicle ahead. */
export const ON_SIGHT_MODES: readonly TransportMode[] = [
  'bus',
  'brt',
  'trolleybus',
  'tram',
  'light_rail',
  'custom',
];

/**
 * How a mode keeps its distance to the vehicle ahead: on sight with the Intelligent Driver
 * Model's steady-state gap (minimum gap + speed × time gap), or, for metro and commuter
 * rail under signalling, a fixed minimum distance.
 */
export type Following =
  { kind: 'on_sight'; minGapM: number; timeGapS: number } | { kind: 'signalled'; distanceM: number };

export function following(network: Pick<TrackNetwork, 'parameterOverrides'>, mode: TransportMode): Following {
  if (ON_SIGHT_MODES.includes(mode))
    return {
      kind: 'on_sight',
      minGapM: parameterValue(network, 'followingMinGapM'),
      timeGapS: parameterValue(network, 'followingTimeGapS'),
    };
  return { kind: 'signalled', distanceM: parameterValue(network, 'minSeparationRailM') };
}

/** Distance to the vehicle ahead at speed `vMs` (m/s), excluding its length. */
export function followingGapM(f: Following, vMs: number): number {
  return f.kind === 'on_sight' ? f.minGapM + vMs * f.timeGapS : f.distanceM;
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
