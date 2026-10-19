/**
 * Deterministic preliminary calculations.
 *
 * Every function takes all inputs explicitly (no hidden defaults) and returns
 * ranges. Formulas are mirrored in docs/METHODOLOGY.md; keep both in sync.
 */
import type { Range } from '../domain/schema';
import { add, div, mul, point, scale, sub } from './ranges';

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Round-trip (cycle) time in minutes.
 * cycle = 2 × (length / running speed + stops × dwell) + 2 × layover  (bidirectional, two ends)
 * cycle = length / running speed + stops × dwell + layover            (ring or one-way loop)
 */
export function cycleTimeMin(input: {
  lengthM: number;
  runningSpeedKmh: number;
  stops: number;
  dwellS: number;
  layoverMin: number;
  ring: boolean;
}): number {
  if (input.runningSpeedKmh <= 0) throw new RangeError('runningSpeedKmh must be positive');
  const runMin = (input.lengthM / 1000 / input.runningSpeedKmh) * 60;
  const dwellMin = (input.stops * input.dwellS) / 60;
  return input.ring ? runMin + dwellMin + input.layoverMin : 2 * (runMin + dwellMin) + 2 * input.layoverMin;
}

/** Vehicles (or trains) required in service: ceil(cycle time / headway). */
export function vehiclesRequired(cycleMin: number, headwayMin: number, spareFraction = 0): number {
  if (headwayMin <= 0) throw new RangeError('headwayMin must be positive');
  return Math.ceil((cycleMin / headwayMin) * (1 + spareFraction));
}

/** Passengers per hour per direction offered: (60 / headway) × vehicle capacity. */
export function capacityPphpd(headwayMin: number, vehicleCapacity: number): number {
  if (headwayMin <= 0) throw new RangeError('headwayMin must be positive');
  return (60 / headwayMin) * vehicleCapacity;
}

/** Peak load / capacity. Values above 1 mean the service is over capacity under the assumptions. */
export function capacityUtilisation(peakLoad: Range, capacity: number): Range {
  if (capacity <= 0) throw new RangeError('capacity must be positive');
  return scale(peakLoad, 1 / capacity);
}

// ---------------------------------------------------------------------------
// Demand (exploratory)
// ---------------------------------------------------------------------------

/**
 * Exploratory weekday boardings at a station:
 * boardings = catchment population × trip rate × transit share
 * (+ catchment jobs × trip rate × transit share). Uncalibrated.
 */
export function stationBoardings(input: {
  catchmentPopulation: Range;
  catchmentJobs: Range;
  tripsPerPersonPerDay: Range;
  tripsPerJobPerDay: Range;
  transitShare: Range;
}): Range {
  return mul(
    add(
      mul(input.catchmentPopulation, input.tripsPerPersonPerDay),
      mul(input.catchmentJobs, input.tripsPerJobPerDay),
    ),
    input.transitShare,
  );
}

/** Annual boardings = weekday boardings × annualisation factor (weekday-equivalent days per year). */
export function annualise(weekday: Range, annualisationFactor: Range): Range {
  return mul(weekday, annualisationFactor);
}

/** Passenger-km = boardings × average trip length (km). */
export function passengerKm(boardings: Range, avgTripKm: Range): Range {
  return mul(boardings, avgTripKm);
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

export interface CostItem {
  label: string;
  quantity: number;
  unit: string;
  unitCost: Range;
  /** ISO 4217 currency code and price base year: items must agree before summing. */
  currency: string;
  priceYear: number;
}

export interface CostTotal {
  total: Range;
  currency: string;
  priceYear: number;
  items: { label: string; cost: Range }[];
}

/**
 * Sum cost items. Throws if currencies or price years differ: conversion must be
 * explicit (see convertCost) — never mix them silently.
 */
export function aggregateCosts(items: readonly CostItem[], contingencyFraction: Range = point(0)): CostTotal {
  if (items.length === 0) throw new RangeError('No cost items');
  const { currency, priceYear } = items[0]!;
  for (const i of items) {
    if (i.currency !== currency || i.priceYear !== priceYear) {
      throw new Error(
        `Cannot aggregate ${i.currency} ${i.priceYear} with ${currency} ${priceYear}; convert to one currency and price year first`,
      );
    }
  }
  const lines = items.map((i) => ({ label: i.label, cost: scale(i.unitCost, i.quantity) }));
  const subtotal = add(...lines.map((l) => l.cost));
  return { total: mul(subtotal, add(point(1), contingencyFraction)), currency, priceYear, items: lines };
}

/** Convert a cost with an explicit price index ratio and exchange rate. */
export function convertCost(
  cost: Range,
  input: { priceIndexFrom: number; priceIndexTo: number; exchangeRate: number },
): Range {
  if (input.priceIndexFrom <= 0 || input.priceIndexTo <= 0 || input.exchangeRate <= 0) {
    throw new RangeError('Indices and exchange rate must be positive');
  }
  return scale(cost, (input.priceIndexTo / input.priceIndexFrom) * input.exchangeRate);
}

/** Annual operating cost = vehicle-km × cost per vehicle-km + vehicle-hours × cost per vehicle-hour. */
export function operatingCost(input: {
  vehicleKmPerYear: number;
  vehicleHoursPerYear: number;
  costPerVehicleKm: Range;
  costPerVehicleHour: Range;
}): Range {
  return add(
    scale(input.costPerVehicleKm, input.vehicleKmPerYear),
    scale(input.costPerVehicleHour, input.vehicleHoursPerYear),
  );
}

/** Capital recovery factor: annualised cost = capex × r(1+r)^n / ((1+r)^n − 1). */
export function annualisedCapital(capex: Range, discountRate: number, years: number): Range {
  if (years <= 0) throw new RangeError('years must be positive');
  if (discountRate === 0) return scale(capex, 1 / years);
  const f = (discountRate * (1 + discountRate) ** years) / ((1 + discountRate) ** years - 1);
  return scale(capex, f);
}

// ---------------------------------------------------------------------------
// Car reduction, space, emissions
// ---------------------------------------------------------------------------

/**
 * Car trips shifted = boardings × share of riders who previously drove.
 * Car vehicle trips = car trips shifted / average car occupancy.
 * Not every passenger previously drove; the share must be supplied.
 */
export function carTripsShifted(input: {
  boardings: Range;
  previouslyDroveShare: Range;
  carOccupancy: Range;
}) {
  const personTrips = mul(input.boardings, input.previouslyDroveShare);
  return { personTrips, vehicleTrips: div(personTrips, input.carOccupancy) };
}

/** Vehicle-km avoided = vehicle trips × average car trip length (km). */
export function vehicleKmAvoided(vehicleTrips: Range, avgCarTripKm: Range): Range {
  return mul(vehicleTrips, avgCarTripKm);
}

/**
 * Theoretical parking area equivalent: cars no longer parked × area per space.
 * This is a theoretical equivalent, not reclaimable or redesigned space.
 */
export function parkingAreaEquivalentM2(carsNoLongerParked: Range, areaPerSpaceM2: Range): Range {
  return mul(carsNoLongerParked, areaPerSpaceM2);
}

/** Lane area = lane length × lane width. */
export function laneAreaM2(laneLengthM: number, laneWidthM: Range): Range {
  return scale(laneWidthM, laneLengthM);
}

/**
 * Net operational emissions change (g) = transit emissions − avoided car emissions.
 * Negative means a reduction under the selected assumptions.
 */
export function netOperationalEmissions(input: {
  carVehicleKmAvoided: Range;
  carEmissionFactorGPerKm: Range;
  transitVehicleKm: number;
  transitEnergyKwhPerVehicleKm: Range;
  gridIntensityGPerKwh: Range;
}) {
  const avoided = mul(input.carVehicleKmAvoided, input.carEmissionFactorGPerKm);
  const transit = mul(
    scale(input.transitEnergyKwhPerVehicleKm, input.transitVehicleKm),
    input.gridIntensityGPerKwh,
  );
  return { avoidedCarG: avoided, transitG: transit, netG: sub(transit, avoided) };
}

/** Fare needed to recover a cost with given boardings (policy scenario, not a recommendation). */
export function breakEvenFare(annualCost: Range, annualBoardings: Range): Range {
  return div(annualCost, annualBoardings);
}
