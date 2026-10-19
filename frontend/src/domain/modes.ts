/**
 * Transport-mode metadata used by the editor.
 *
 * The numbers here are editor defaults so a new line starts in a usable state.
 * They are NOT benchmarks. Each value carries `status` and `source` so the UI can
 * show that it is a placeholder the user should replace with local data.
 */
import type { StructureType, TransportMode, RightOfWay, VehicleType } from './schema';

export interface ModeDefaults {
  label: string;
  color: string;
  /** Rail-like modes can use tunnels/elevated structures; road modes start in mixed traffic. */
  guided: boolean;
  defaultStructure: StructureType;
  defaultRightOfWay: RightOfWay;
  defaultCatchmentRadiusM: number;
  catchmentSource: string;
  defaultDwellTimeS: number;
  defaultMaxSpeedKmh: number;
  /** Whether alignments should follow the street network (bus, BRT). */
  prefersStreetNetwork: boolean;
}

const CATCHMENT_SOURCE =
  'Common walking-catchment rule of thumb (≈400 m bus, ≈800 m rail). See Guerra, Cervero & Tischler (2012), ' +
  '"Half-Mile Circle", Transportation Research Record 2276. Adjust to local walking evidence.';

const PLACEHOLDER = 'Editor placeholder, not a benchmark. Replace with local or manufacturer data.';

export const MODES: Record<TransportMode, ModeDefaults> = {
  bus: {
    label: 'Bus',
    color: '#c2410c',
    guided: false,
    defaultStructure: 'at_grade',
    defaultRightOfWay: 'mixed_traffic',
    defaultCatchmentRadiusM: 400,
    catchmentSource: CATCHMENT_SOURCE,
    defaultDwellTimeS: 20,
    defaultMaxSpeedKmh: 50,
    prefersStreetNetwork: true,
  },
  brt: {
    label: 'Bus rapid transit',
    color: '#b91c1c',
    guided: false,
    defaultStructure: 'at_grade',
    defaultRightOfWay: 'dedicated_lane',
    defaultCatchmentRadiusM: 600,
    catchmentSource: CATCHMENT_SOURCE,
    defaultDwellTimeS: 25,
    defaultMaxSpeedKmh: 60,
    prefersStreetNetwork: true,
  },
  tram: {
    label: 'Tram / streetcar',
    color: '#15803d',
    guided: true,
    defaultStructure: 'at_grade',
    defaultRightOfWay: 'dedicated_track',
    defaultCatchmentRadiusM: 500,
    catchmentSource: CATCHMENT_SOURCE,
    defaultDwellTimeS: 25,
    defaultMaxSpeedKmh: 60,
    prefersStreetNetwork: false,
  },
  light_rail: {
    label: 'Light rail',
    color: '#0e7490',
    guided: true,
    defaultStructure: 'at_grade',
    defaultRightOfWay: 'dedicated_track',
    defaultCatchmentRadiusM: 800,
    catchmentSource: CATCHMENT_SOURCE,
    defaultDwellTimeS: 30,
    defaultMaxSpeedKmh: 80,
    prefersStreetNetwork: false,
  },
  metro: {
    label: 'Metro / subway',
    color: '#1d4ed8',
    guided: true,
    defaultStructure: 'underground',
    defaultRightOfWay: 'dedicated_track',
    defaultCatchmentRadiusM: 800,
    catchmentSource: CATCHMENT_SOURCE,
    defaultDwellTimeS: 30,
    defaultMaxSpeedKmh: 80,
    prefersStreetNetwork: false,
  },
  elevated_metro: {
    label: 'Elevated rail',
    color: '#7c3aed',
    guided: true,
    defaultStructure: 'elevated',
    defaultRightOfWay: 'dedicated_track',
    defaultCatchmentRadiusM: 800,
    catchmentSource: CATCHMENT_SOURCE,
    defaultDwellTimeS: 30,
    defaultMaxSpeedKmh: 80,
    prefersStreetNetwork: false,
  },
  commuter_rail: {
    label: 'Commuter rail',
    color: '#4d7c0f',
    guided: true,
    defaultStructure: 'at_grade',
    defaultRightOfWay: 'dedicated_track',
    defaultCatchmentRadiusM: 1000,
    catchmentSource: CATCHMENT_SOURCE,
    defaultDwellTimeS: 45,
    defaultMaxSpeedKmh: 120,
    prefersStreetNetwork: false,
  },
  cycling: {
    label: 'Protected cycling corridor',
    color: '#0f766e',
    guided: false,
    defaultStructure: 'at_grade',
    defaultRightOfWay: 'dedicated_lane',
    defaultCatchmentRadiusM: 300,
    catchmentSource: PLACEHOLDER,
    defaultDwellTimeS: 0,
    defaultMaxSpeedKmh: 25,
    prefersStreetNetwork: true,
  },
  pedestrian: {
    label: 'Pedestrian corridor',
    color: '#a16207',
    guided: false,
    defaultStructure: 'at_grade',
    defaultRightOfWay: 'dedicated_lane',
    defaultCatchmentRadiusM: 200,
    catchmentSource: PLACEHOLDER,
    defaultDwellTimeS: 0,
    defaultMaxSpeedKmh: 5,
    prefersStreetNetwork: true,
  },
  custom: {
    label: 'Custom mode',
    color: '#475569',
    guided: true,
    defaultStructure: 'at_grade',
    defaultRightOfWay: 'dedicated_track',
    defaultCatchmentRadiusM: 500,
    catchmentSource: PLACEHOLDER,
    defaultDwellTimeS: 30,
    defaultMaxSpeedKmh: 60,
    prefersStreetNetwork: false,
  },
};

export const MODE_LIST = Object.keys(MODES) as TransportMode[];

export const STRUCTURE_LABELS: Record<StructureType, string> = {
  at_grade: 'Surface (at grade)',
  underground: 'Underground',
  elevated: 'Elevated',
  bridge: 'Bridge',
  tunnel: 'Bored tunnel',
  cut_and_cover: 'Cut and cover',
};

/** Line pattern used on the map and in the legend so structure is never conveyed by colour alone. */
export const STRUCTURE_DASH: Record<StructureType, number[] | null> = {
  at_grade: null,
  underground: [2, 1.5],
  tunnel: [2, 1.5],
  cut_and_cover: [3, 1, 1, 1],
  elevated: [0.5, 1],
  bridge: [4, 0.6],
};

export const RIGHT_OF_WAY_LABELS: Record<RightOfWay, string> = {
  mixed_traffic: 'Mixed traffic',
  dedicated_lane: 'Dedicated lane',
  dedicated_track: 'Dedicated track / right of way',
};

/** Placeholder vehicle types. Capacity values are illustrative and flagged as such. */
export function defaultVehicleTypes(): VehicleType[] {
  const v = (
    id: string,
    name: string,
    mode: TransportMode,
    capacity: number,
    maxSpeedKmh: number,
    lengthM: number,
  ): VehicleType => ({
    id,
    name,
    mode,
    capacity,
    maxSpeedKmh,
    lengthM,
    status: 'demonstration',
    source: PLACEHOLDER,
  });
  return [
    v('vt-bus-12m', 'Generic 12 m bus (placeholder)', 'bus', 70, 70, 12),
    v('vt-bus-18m', 'Generic 18 m articulated bus (placeholder)', 'brt', 110, 70, 18),
    v('vt-tram-30m', 'Generic 30 m tram (placeholder)', 'tram', 180, 70, 30),
    v('vt-lrv-40m', 'Generic 40 m light-rail vehicle (placeholder)', 'light_rail', 250, 80, 40),
    v('vt-metro-100m', 'Generic 100 m metro train (placeholder)', 'metro', 900, 80, 100),
    v('vt-emu-120m', 'Generic 120 m commuter train (placeholder)', 'commuter_rail', 1000, 140, 120),
  ];
}
