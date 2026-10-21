/**
 * Vehicle profiles and their compatibility with transport modes. A line may
 * only use a vehicle whose profile lists the line's mode; the inspector offers
 * nothing else. Numbers in default profiles are placeholders (see modes.ts).
 */
import type { Scenario, TransportLine, TransportMode, VehicleCategory, VehicleType } from './schema';
import { newId, nowIso } from '../util/id';

export const VEHICLE_CATEGORY_LABELS: Record<VehicleCategory, string> = {
  standard_bus: 'Standard bus',
  articulated_bus: 'Articulated bus',
  double_articulated_bus: 'Double-articulated bus',
  double_decker_bus: 'Double-decker bus',
  minibus: 'Minibus',
  trolleybus: 'Trolleybus',
  brt_standard_bus: 'Standard BRT bus',
  brt_articulated_bus: 'Articulated BRT bus',
  brt_double_articulated_bus: 'Double-articulated BRT bus',
  brt_trolleybus: 'BRT trolleybus',
  tram_single: 'Single tram',
  tram_articulated: 'Articulated tram',
  tram_coupled_set: 'Coupled tram set',
  tram_low_floor: 'Low-floor tram',
  tram_high_floor: 'High-floor tram',
  lrv_single: 'Single light-rail vehicle',
  lrv_coupled_consist: 'Coupled light-rail consist',
  lrv_custom: 'User-defined light-rail vehicle',
  metro_consist: 'Metro consist',
  metro_automated: 'Automated metro consist',
  light_metro: 'Light metro',
  metro_custom: 'User-defined metro vehicle',
  emu: 'Electric multiple unit',
  dmu: 'Diesel multiple unit',
  locomotive_hauled: 'Locomotive-hauled consist',
  commuter_train: 'Commuter train',
  regional_train: 'Regional train',
  train_custom: 'User-defined train',
  custom: 'User-defined vehicle',
};

/** Vehicle categories a mode may use. */
export const MODE_VEHICLE_CATEGORIES: Record<TransportMode, VehicleCategory[]> = {
  bus: ['standard_bus', 'articulated_bus', 'double_articulated_bus', 'double_decker_bus', 'minibus'],
  brt: ['brt_standard_bus', 'brt_articulated_bus', 'brt_double_articulated_bus'],
  // Trolleybuses need overhead wire: their own mode and infrastructure.
  trolleybus: ['trolleybus', 'brt_trolleybus'],
  tram: ['tram_single', 'tram_articulated', 'tram_coupled_set', 'tram_low_floor', 'tram_high_floor'],
  light_rail: ['lrv_single', 'lrv_coupled_consist', 'lrv_custom'],
  metro: ['metro_consist', 'metro_automated', 'light_metro', 'metro_custom'],
  elevated_metro: ['metro_consist', 'metro_automated', 'light_metro', 'metro_custom'],
  commuter_rail: ['emu', 'dmu', 'locomotive_hauled', 'commuter_train', 'regional_train', 'train_custom'],
  cycling: [],
  pedestrian: [],
  custom: ['custom'],
};

/** Service modes that may use a vehicle: its own mode plus any listed compatible modes. */
export function vehicleModes(v: Pick<VehicleType, 'mode' | 'compatibleModes'>): TransportMode[] {
  return [...new Set([v.mode, ...v.compatibleModes])];
}

export function isVehicleCompatible(
  v: Pick<VehicleType, 'mode' | 'compatibleModes'>,
  mode: TransportMode,
): boolean {
  return vehicleModes(v).includes(mode);
}

/** The vehicle types a line of this mode may use. */
export function compatibleVehicles(vehicles: readonly VehicleType[], mode: TransportMode): VehicleType[] {
  return vehicles.filter((v) => isVehicleCompatible(v, mode));
}

/** Whether a mode uses vehicles at all (walking and cycling corridors do not). */
export const usesVehicles = (mode: TransportMode) => MODE_VEHICLE_CATEGORIES[mode].length > 0;

/** Length of the consist a line runs, metres (null without a vehicle). */
export function consistLengthM(
  line: Pick<TransportLine, 'consistUnits'>,
  v: VehicleType | undefined,
): number | null {
  if (!v) return null;
  return v.lengthM * (line.consistUnits ?? v.unitsPerConsist);
}

/** Passengers per consist. */
export function consistCapacity(
  line: Pick<TransportLine, 'consistUnits'>,
  v: VehicleType | undefined,
): number | null {
  if (!v) return null;
  return v.capacity * (line.consistUnits ?? v.unitsPerConsist);
}

export interface VehicleProfileInput {
  name: string;
  mode: TransportMode;
  category: VehicleCategory;
  capacity: number;
  maxSpeedKmh: number;
  lengthM: number;
  source: string;
}

export function validateProfileInput(i: VehicleProfileInput): string[] {
  const errors: string[] = [];
  if (!i.name.trim()) errors.push('Enter a name');
  if (!MODE_VEHICLE_CATEGORIES[i.mode].includes(i.category))
    errors.push(`${VEHICLE_CATEGORY_LABELS[i.category]} is not a ${i.mode} vehicle category`);
  if (!(Number.isInteger(i.capacity) && i.capacity > 0))
    errors.push('Capacity must be a whole number above 0');
  if (!(i.maxSpeedKmh > 0)) errors.push('Maximum speed must be above 0');
  if (!(i.lengthM > 0)) errors.push('Length must be above 0');
  return errors;
}

type Required_ = Pick<
  VehicleType,
  'id' | 'name' | 'mode' | 'capacity' | 'maxSpeedKmh' | 'lengthM' | 'status' | 'source'
>;

/** A complete profile from the required fields; everything not given is unknown (null), not guessed. */
export function vehicleProfile(v: Required_ & Partial<VehicleType>): VehicleType {
  return {
    category: MODE_VEHICLE_CATEGORIES[v.mode][0] ?? 'custom',
    compatibleModes: [],
    seatedCapacity: null,
    widthM: null,
    unitsPerConsist: 1,
    gaugeMm: null,
    accelerationMs2: null,
    serviceBrakingMs2: null,
    massT: null,
    tractionPowerKw: null,
    startingTractiveEffortKn: null,
    davisAKn: null,
    davisBKnPerMs: null,
    davisCKnPerMs2: null,
    tractionEfficiency: null,
    regenerationShare: null,
    auxiliaryPowerKw: null,
    minRadiusM: null,
    maxGradePercent: null,
    doorCount: null,
    energy: 'unknown',
    compatiblePlatforms: [],
    notes: '',
    ...v,
  };
}

/** Add a user-defined vehicle profile (status user_override). */
export function addVehicleProfile(
  scenario: Scenario,
  input: VehicleProfileInput,
): { scenario: Scenario; vehicle: VehicleType | null; errors: string[] } {
  const errors = validateProfileInput(input);
  if (errors.length) return { scenario, vehicle: null, errors };
  const vehicle = vehicleProfile({
    id: newId('vt'),
    name: input.name.trim(),
    mode: input.mode,
    category: input.category,
    capacity: input.capacity,
    maxSpeedKmh: input.maxSpeedKmh,
    lengthM: input.lengthM,
    status: 'user_override',
    source: input.source.trim() || 'Entered by the user',
  });
  return {
    scenario: { ...scenario, vehicleTypes: [...scenario.vehicleTypes, vehicle], updatedAt: nowIso() },
    vehicle,
    errors: [],
  };
}

export function updateVehicleProfile(scenario: Scenario, id: string, patch: Partial<VehicleType>): Scenario {
  return {
    ...scenario,
    vehicleTypes: scenario.vehicleTypes.map((v) =>
      v.id === id ? { ...v, ...patch, id: v.id, status: 'user_override' as const } : v,
    ),
    updatedAt: nowIso(),
  };
}

export function linesUsingVehicle(scenario: Scenario, id: string): string[] {
  return scenario.lines.filter((l) => l.vehicleTypeId === id).map((l) => l.id);
}

/** Delete a profile that no line uses; returns the scenario unchanged otherwise. */
export function deleteVehicleProfile(scenario: Scenario, id: string): Scenario {
  if (linesUsingVehicle(scenario, id).length) return scenario;
  return { ...scenario, vehicleTypes: scenario.vehicleTypes.filter((v) => v.id !== id), updatedAt: nowIso() };
}
