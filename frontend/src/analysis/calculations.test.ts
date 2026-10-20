import { describe, expect, it } from 'vitest';
import { add, div, formatRange, mul, point, range, scale, sub } from './ranges';
import {
  aggregateCosts,
  annualisedCapital,
  breakEvenFare,
  capacityPphpd,
  capacityUtilisation,
  carTripsShifted,
  convertCost,
  cycleTimeMin,
  laneAreaM2,
  netOperationalEmissions,
  operatingCost,
  parkingAreaEquivalentM2,
  stationBoardings,
  vehicleKmAvoided,
  vehiclesRequired,
} from './calculations';
import { formatArea, formatDistance, kmhToMs, kmToMiles, milesToKm, msToKmh, sqmToHectares } from './units';
import { analyseScenario, catchmentPopulations } from './demoAnalysis';
import { buildDemoScenario } from '../test/fixtures/demoProject';
import type { Station } from '../domain/schema';

describe('unit conversions', () => {
  it('converts speed, distance and area', () => {
    expect(kmhToMs(36)).toBeCloseTo(10);
    expect(msToKmh(10)).toBeCloseTo(36);
    expect(milesToKm(kmToMiles(5))).toBeCloseTo(5);
    expect(sqmToHectares(25_000)).toBe(2.5);
    expect(formatDistance(1500)).toBe('1.50 km');
    expect(formatDistance(250)).toBe('250 m');
    expect(formatArea(20_000)).toBe('2.00 ha');
  });
});

describe('low/central/high ranges', () => {
  it('validates ordering', () => {
    expect(() => range(3, 2, 1)).toThrow();
    expect(range(1, 2, 3)).toEqual({ low: 1, central: 2, high: 3 });
  });

  it('adds, multiplies, subtracts and divides case-wise', () => {
    expect(add(range(1, 2, 3), range(10, 20, 30))).toEqual({ low: 11, central: 22, high: 33 });
    expect(mul(range(1, 2, 3), range(2, 2, 2))).toEqual({ low: 2, central: 4, high: 6 });
    expect(sub(range(10, 20, 30), range(1, 2, 3))).toEqual({ low: 7, central: 18, high: 29 });
    expect(div(range(10, 20, 30), range(2, 4, 5))).toEqual({ low: 2, central: 5, high: 15 });
    expect(scale(range(1, 2, 3), -1)).toEqual({ low: -3, central: -2, high: -1 });
    expect(() => div(point(1), range(0, 1, 2))).toThrow();
  });

  it('formats with units and the central case', () => {
    expect(formatRange(range(1, 2, 3), 'km')).toBe('1 – 3 km (central 2)');
    expect(formatRange(point(5), 'km')).toBe('5 km');
  });
});

describe('operations', () => {
  it('computes cycle time and vehicle requirement', () => {
    // 10 km at 30 km/h = 20 min each way, 10 stops × 30 s = 5 min, layover 5 min each end.
    const cycle = cycleTimeMin({
      lengthM: 10_000,
      runningSpeedKmh: 30,
      stops: 10,
      dwellS: 30,
      layoverMin: 5,
      ring: false,
    });
    expect(cycle).toBeCloseTo(60);
    expect(vehiclesRequired(cycle, 10)).toBe(6);
    expect(vehiclesRequired(cycle, 7)).toBe(9);
    expect(vehiclesRequired(cycle, 10, 0.1)).toBe(7);
    const ringCycle = cycleTimeMin({
      lengthM: 10_000,
      runningSpeedKmh: 30,
      stops: 10,
      dwellS: 30,
      layoverMin: 5,
      ring: true,
    });
    expect(ringCycle).toBeCloseTo(30);
  });

  it('computes passenger capacity and utilisation', () => {
    expect(capacityPphpd(5, 200)).toBe(2400);
    expect(capacityUtilisation(range(1200, 2400, 3600), 2400)).toEqual({ low: 0.5, central: 1, high: 1.5 });
    expect(() => capacityPphpd(0, 200)).toThrow();
  });
});

describe('costs', () => {
  const item = (label: string, quantity: number, c: number, currency = 'EUR', priceYear = 2025) => ({
    label,
    quantity,
    unit: 'km',
    unitCost: range(c * 0.8, c, c * 1.5),
    currency,
    priceYear,
  });

  it('aggregates construction costs with contingency', () => {
    const t = aggregateCosts([item('surface', 2, 10), item('tunnel', 1, 100)], range(0.1, 0.2, 0.3));
    expect(t.total.central).toBeCloseTo((20 + 100) * 1.2);
    expect(t.total.low).toBeCloseTo((16 + 80) * 1.1);
    expect(t.items).toHaveLength(2);
  });

  it('aggregates station costs', () => {
    const t = aggregateCosts([item('st1', 1, 5), item('st2', 1, 50), item('st3', 1, 5)]);
    expect(t.total.central).toBe(60);
  });

  it('refuses to mix currencies or price years', () => {
    expect(() => aggregateCosts([item('a', 1, 1, 'EUR'), item('b', 1, 1, 'USD')])).toThrow(/convert/);
    expect(() => aggregateCosts([item('a', 1, 1, 'EUR', 2020), item('b', 1, 1, 'EUR', 2025)])).toThrow(
      /price year/,
    );
  });

  it('converts with explicit index and exchange rate', () => {
    expect(
      convertCost(point(100), { priceIndexFrom: 100, priceIndexTo: 110, exchangeRate: 2 }).central,
    ).toBeCloseTo(220);
  });

  it('aggregates operating costs', () => {
    const o = operatingCost({
      vehicleKmPerYear: 1000,
      vehicleHoursPerYear: 100,
      costPerVehicleKm: range(1, 2, 3),
      costPerVehicleHour: range(10, 20, 30),
    });
    expect(o).toEqual({ low: 2000, central: 4000, high: 6000 });
  });

  it('annualises capital with the capital recovery factor', () => {
    expect(annualisedCapital(point(1000), 0, 10).central).toBe(100);
    expect(annualisedCapital(point(1000), 0.05, 20).central).toBeCloseTo(80.24, 1);
  });

  it('computes break-even fares as a range', () => {
    expect(breakEvenFare(range(100, 200, 300), range(50, 100, 200))).toEqual({
      low: 0.5,
      central: 2,
      high: 6,
    });
  });
});

describe('car reduction, space and emissions', () => {
  it('does not assume every passenger previously drove', () => {
    const r = carTripsShifted({
      boardings: point(1000),
      previouslyDroveShare: range(0.1, 0.2, 0.3),
      carOccupancy: range(1.2, 1.25, 1.5),
    });
    expect(r.personTrips).toEqual({ low: 100, central: 200, high: 300 });
    expect(r.vehicleTrips.central).toBeCloseTo(160);
    expect(r.vehicleTrips.low).toBeCloseTo(100 / 1.5);
    expect(vehicleKmAvoided(r.vehicleTrips, point(5)).central).toBeCloseTo(800);
  });

  it('computes space equivalents in m²', () => {
    expect(parkingAreaEquivalentM2(range(10, 20, 30), range(12, 20, 25))).toEqual({
      low: 120,
      central: 400,
      high: 750,
    });
    expect(laneAreaM2(1000, range(3, 3.25, 3.5)).central).toBe(3250);
  });

  it('computes net operational emissions with separate components', () => {
    const e = netOperationalEmissions({
      carVehicleKmAvoided: point(10_000),
      carEmissionFactorGPerKm: point(150),
      transitVehicleKm: 1000,
      transitEnergyKwhPerVehicleKm: point(4),
      gridIntensityGPerKwh: point(200),
    });
    expect(e.avoidedCarG.central).toBe(1_500_000);
    expect(e.transitG.central).toBe(800_000);
    expect(e.netG.central).toBe(-700_000);
  });
});

describe('exploratory demand', () => {
  it('combines residents and jobs with a transit share', () => {
    const b = stationBoardings({
      catchmentPopulation: point(1000),
      catchmentJobs: point(500),
      tripsPerPersonPerDay: point(2),
      tripsPerJobPerDay: point(2),
      transitShare: range(0.05, 0.1, 0.2),
    });
    expect(b).toEqual({ low: 150, central: 300, high: 600 });
  });

  it('does not double-count overlapping catchments', () => {
    const st = (id: string, lng: number): Station => ({
      id,
      name: id,
      nameSource: 'user',
      nameSuggestion: null,
      position: [lng, 0],
      construction: 'surface',
      platformType: 'unknown',
      busStopType: 'unknown',
      layout: null,
      verticalOffsetM: null,
      entrances: [],
      accessibility: { stepFree: null, elevators: null, tactilePaving: null },
      catchmentRadiusM: 500,
      notes: '',
      trackRefs: [],
      metadata: {},
      imageUrls: [],
    });
    const uniform = () => 1000; // people per km²
    const single = catchmentPopulations([st('a', 0)], uniform, 25);
    const overlapping = catchmentPopulations([st('a', 0), st('b', 0.002)], uniform, 25);
    const sumOverlap = overlapping.get('a')!.central + overlapping.get('b')!.central;
    const area = Math.PI * 0.5 ** 2 * 1000;
    expect(single.get('a')!.central).toBeCloseTo(area, -1);
    // Two circles ~222 m apart overlap substantially; their union is far below 2× one circle.
    expect(sumOverlap).toBeLessThan(2 * area * 0.9);
    expect(sumOverlap).toBeGreaterThan(area);
  });

  it('labels the demo analysis as demonstration data', () => {
    const a = analyseScenario(buildDemoScenario());
    expect(a.demonstration).toBe(true);
    expect(a.assumptionSet.assumptions.every((x) => x.status === 'demonstration')).toBe(true);
    expect(a.results.every((r) => r.provenance.status === 'demonstration')).toBe(true);
    expect(a.lines.length).toBe(3);
    for (const l of a.lines) {
      expect(l.weekdayBoardings.low).toBeLessThanOrEqual(l.weekdayBoardings.central);
      expect(l.weekdayBoardings.central).toBeLessThanOrEqual(l.weekdayBoardings.high);
      expect(l.vehiclesRequired).toBeGreaterThan(0);
    }
  });
});
