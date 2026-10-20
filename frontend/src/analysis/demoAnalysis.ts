/**
 * Phase 1 exploratory analysis using the DEMONSTRATION assumption set and the
 * synthetic population provider. All results are labelled `demonstration`.
 *
 * The calculations themselves are deterministic (analysis/calculations.ts);
 * only the inputs are synthetic. Phase 4 swaps in real providers and
 * user-reviewed assumption sets.
 */
import { runningSpeedKmh } from './fleet';
import { consistCapacity } from '../domain/vehicles';
import type { AnalysisResult, AssumptionSet, LngLat, Range, Scenario, Station } from '../domain/schema';
import { isRing, lineLengthM, orderedStops } from '../domain/network';
import { toLocalMetres } from '../geo/geometry';
import { demoProvenance } from '../providers/provenance';
import { MockPopulationProvider } from '../providers/mock';
import { add, mul, point, scale } from './ranges';
import {
  aggregateCosts,
  annualise,
  capacityPphpd,
  carTripsShifted,
  cycleTimeMin,
  netOperationalEmissions,
  operatingCost,
  parkingAreaEquivalentM2,
  passengerKm,
  stationBoardings,
  vehicleKmAvoided,
  vehiclesRequired,
  type CostItem,
} from './calculations';
import { assumption, DEMO_ASSUMPTIONS, DEMO_CURRENCY, DEMO_PRICE_YEAR } from './demoAssumptions';

export type DensityFn = (p: LngLat) => number;

/**
 * Population per station with overlapping catchments de-duplicated: the area is
 * sampled on a grid and each cell is assigned only to its nearest station.
 * Returns central population; low/high apply ±30 % (synthetic density uncertainty).
 */
export function catchmentPopulations(
  stations: readonly Station[],
  density: DensityFn,
  cellM = 100,
): Map<string, Range> {
  const out = new Map<string, Range>(stations.map((s) => [s.id, point(0)]));
  if (stations.length === 0) return out;
  const ref = stations[0]!.position;
  const local = stations.map((s) => ({ s, xy: toLocalMetres(s.position, ref) }));
  const maxR = Math.max(...stations.map((s) => s.catchmentRadiusM));
  const xs = local.map((l) => l.xy[0]);
  const ys = local.map((l) => l.xy[1]);
  const mPerDegLat = 111_195;
  const mPerDegLng = mPerDegLat * Math.cos((ref[1] * Math.PI) / 180);
  const cellKm2 = (cellM / 1000) ** 2;
  const totals = new Map<string, number>();
  for (let x = Math.min(...xs) - maxR; x <= Math.max(...xs) + maxR; x += cellM) {
    for (let y = Math.min(...ys) - maxR; y <= Math.max(...ys) + maxR; y += cellM) {
      let best: { id: string; d: number } | null = null;
      for (const l of local) {
        const d = Math.hypot(l.xy[0] - x, l.xy[1] - y);
        if (d <= l.s.catchmentRadiusM && (!best || d < best.d)) best = { id: l.s.id, d };
      }
      if (!best) continue;
      const p: LngLat = [ref[0] + x / mPerDegLng, ref[1] + y / mPerDegLat];
      totals.set(best.id, (totals.get(best.id) ?? 0) + density(p) * cellKm2);
    }
  }
  for (const [id, v] of totals) out.set(id, { low: v * 0.7, central: v, high: v * 1.3 });
  return out;
}

export interface LineMetrics {
  lineId: string;
  lengthM: number;
  stations: number;
  interchanges: number;
  runningSpeedKmh: number;
  cycleTimeMin: number;
  vehiclesRequired: number;
  capacityPphpd: number;
  weekdayBoardings: Range;
  annualBoardings: Range;
  annualPassengerKm: Range;
  peakLoadPphpd: Range;
  capacityUtilisation: Range;
  capex: Range;
  annualOpex: Range;
  carTripsShiftedPerDay: Range;
  carVehicleKmAvoidedPerYear: Range;
  netCo2eTonnesPerYear: Range;
  parkingAreaEquivalentM2: Range;
}

export interface StationMetrics {
  stationId: string;
  catchmentPopulation: Range;
  weekdayBoardings: Range;
}

export interface ScenarioAnalysis {
  scenarioId: string;
  assumptionSet: AssumptionSet;
  lines: LineMetrics[];
  stations: StationMetrics[];
  totals: {
    lengthM: number;
    stations: number;
    interchanges: number;
    vehicles: number;
    capex: Range;
    annualOpex: Range;
    annualBoardings: Range;
    netCo2eTonnesPerYear: Range;
  };
  results: AnalysisResult[];
  currency: string;
  priceYear: number;
  demonstration: true;
}

/** Length-weighted mean running speed of a line. */
const runningSpeed = runningSpeedKmh;

export function analyseScenario(
  scenario: Scenario,
  density: DensityFn = (p) => new MockPopulationProvider().densityAt(p),
  set: AssumptionSet = DEMO_ASSUMPTIONS,
): ScenarioAnalysis {
  const A = (id: string) => assumption(set, id).value;
  const pops = catchmentPopulations(scenario.stations, density);
  const stationBoard = new Map<string, Range>();
  for (const st of scenario.stations) {
    const pop = pops.get(st.id) ?? point(0);
    stationBoard.set(
      st.id,
      stationBoardings({
        catchmentPopulation: pop,
        catchmentJobs: mul(pop, A('jobs_per_resident')),
        tripsPerPersonPerDay: A('trips_per_person'),
        tripsPerJobPerDay: A('trips_per_job'),
        transitShare: A('transit_share'),
      }),
    );
  }
  const linesAtStation = (id: string) =>
    scenario.lines.filter((l) => l.stops.some((s) => s.stationId === id)).length;

  const lines: LineMetrics[] = [];
  for (const line of scenario.lines) {
    const stops = orderedStops(line, scenario.stations);
    const lengthM = lineLengthM(line);
    const speed = runningSpeed(line);
    const pattern = line.servicePatterns[0];
    const headway = pattern?.peakHeadwayMin ?? 10;
    const cycle =
      lengthM > 0
        ? cycleTimeMin({
            lengthM,
            runningSpeedKmh: speed,
            stops: stops.length,
            dwellS: line.dwellTimeS,
            layoverMin: 2,
            ring: isRing(line),
          })
        : 0;
    const vehicles = cycle > 0 ? vehiclesRequired(cycle, headway) : 0;
    const vehicle = scenario.vehicleTypes.find((v) => v.id === line.vehicleTypeId);
    const perConsist = consistCapacity(line, vehicle);
    const capacity = perConsist ? capacityPphpd(headway, perConsist) : 0;
    // Boardings at an interchange are split equally between the lines serving it (simplification).
    const weekday = add(
      point(0),
      ...stops.map((s) =>
        scale(stationBoard.get(s.station.id) ?? point(0), 1 / Math.max(1, linesAtStation(s.station.id))),
      ),
    );
    const annual = annualise(weekday, A('annualisation'));
    const pkm = passengerKm(annual, A('avg_trip_km'));
    // Peak hour ≈ 10 % of weekday boardings, peak direction ≈ 60 % (synthetic factors).
    const peakLoad = scale(weekday, 0.1 * 0.6);
    const utilisation = capacity > 0 ? scale(peakLoad, 1 / capacity) : point(0);

    const structureKm: Record<string, number> = {};
    for (const seg of line.segments) {
      const key =
        seg.structure === 'underground' || seg.structure === 'tunnel'
          ? 'capex_tunnel'
          : seg.structure === 'cut_and_cover'
            ? 'capex_cut_cover'
            : seg.structure === 'elevated'
              ? 'capex_elevated'
              : seg.structure === 'bridge'
                ? 'capex_bridge'
                : 'capex_at_grade';
      structureKm[key] = (structureKm[key] ?? 0) + ((seg.toFraction - seg.fromFraction) * lengthM) / 1000;
    }
    const items: CostItem[] = Object.entries(structureKm).map(([id, km]) => ({
      label: assumption(set, id).label,
      quantity: km,
      unit: 'route-km',
      unitCost: A(id),
      currency: DEMO_CURRENCY,
      priceYear: DEMO_PRICE_YEAR,
    }));
    for (const s of stops) {
      // Shared stations are costed once, on the first line that serves them.
      const firstLine = scenario.lines.find((l) => l.stops.some((x) => x.stationId === s.station.id));
      if (firstLine?.id !== line.id) continue;
      const id =
        s.station.construction === 'underground'
          ? 'station_underground'
          : s.station.construction === 'elevated'
            ? 'station_elevated'
            : 'station_surface';
      items.push({
        label: `Station: ${s.station.name}`,
        quantity: 1,
        unit: 'station',
        unitCost: A(id),
        currency: DEMO_CURRENCY,
        priceYear: DEMO_PRICE_YEAR,
      });
    }
    const capex = items.length ? aggregateCosts(items, A('contingency')).total : point(0);

    const [startH, startM] = (pattern?.serviceStart ?? '06:00').split(':').map(Number) as [number, number];
    const [endH, endM] = (pattern?.serviceEnd ?? '22:00').split(':').map(Number) as [number, number];
    const serviceHours = Math.max(0, endH + endM / 60 - (startH + startM / 60));
    const tripsPerDay =
      ((serviceHours * 60) / ((pattern?.peakHeadwayMin ?? 10) + (pattern?.offPeakHeadwayMin ?? 15))) * 2;
    const vkmPerYear = tripsPerDay * (isRing(line) ? 1 : 2) * (lengthM / 1000) * A('annualisation').central;
    const vhPerYear = vehicles * serviceHours * A('annualisation').central;
    const opex = operatingCost({
      vehicleKmPerYear: vkmPerYear,
      vehicleHoursPerYear: vhPerYear,
      costPerVehicleKm: A('opex_per_vkm'),
      costPerVehicleHour: A('opex_per_vh'),
    });

    const shifted = carTripsShifted({
      boardings: weekday,
      previouslyDroveShare: A('previously_drove'),
      carOccupancy: A('car_occupancy'),
    });
    const vkmAvoided = vehicleKmAvoided(
      annualise(shifted.vehicleTrips, A('annualisation')),
      A('car_trip_km'),
    );
    const emissions = netOperationalEmissions({
      carVehicleKmAvoided: vkmAvoided,
      carEmissionFactorGPerKm: A('car_ef_co2e'),
      transitVehicleKm: vkmPerYear,
      transitEnergyKwhPerVehicleKm: A('transit_energy'),
      gridIntensityGPerKwh: A('grid_intensity'),
    });
    lines.push({
      lineId: line.id,
      lengthM,
      stations: stops.length,
      interchanges: stops.filter((s) => linesAtStation(s.station.id) >= 2).length,
      runningSpeedKmh: speed,
      cycleTimeMin: cycle,
      vehiclesRequired: vehicles,
      capacityPphpd: capacity,
      weekdayBoardings: weekday,
      annualBoardings: annual,
      annualPassengerKm: pkm,
      peakLoadPphpd: peakLoad,
      capacityUtilisation: utilisation,
      capex,
      annualOpex: opex,
      carTripsShiftedPerDay: shifted.vehicleTrips,
      carVehicleKmAvoidedPerYear: vkmAvoided,
      netCo2eTonnesPerYear: scale(emissions.netG, 1 / 1_000_000),
      parkingAreaEquivalentM2: parkingAreaEquivalentM2(
        mul(shifted.vehicleTrips, A('cars_per_shifted_trip')),
        A('parking_area'),
      ),
    });
  }

  const sum = (f: (l: LineMetrics) => Range) => add(point(0), ...lines.map(f));
  const prov = demoProvenance('Phase 1 exploratory analysis with synthetic assumptions', {
    status: 'demonstration',
  });
  const computedAt = new Date().toISOString();
  const results: AnalysisResult[] = lines.flatMap((l) => [
    {
      id: `${l.lineId}-boardings`,
      scenarioId: scenario.id,
      subject: { kind: 'line' as const, id: l.lineId },
      metric: 'weekday_boardings',
      label: 'Weekday boardings (exploratory, uncalibrated)',
      unit: 'boardings/weekday',
      value: l.weekdayBoardings,
      method: 'Catchment trip generation × transit share; overlapping catchments assigned to nearest station',
      formula: 'Σ stations (pop × trips/person + jobs × trips/job) × transit share ÷ lines at station',
      assumptionIds: ['trips_per_person', 'jobs_per_resident', 'trips_per_job', 'transit_share'],
      provenance: prov,
      computedAt,
    },
    {
      id: `${l.lineId}-capex`,
      scenarioId: scenario.id,
      subject: { kind: 'line' as const, id: l.lineId },
      metric: 'capex',
      label: 'Capital cost (demo units)',
      unit: DEMO_CURRENCY,
      value: l.capex,
      method: 'Route-km by structure × unit cost + stations × unit cost, plus contingency',
      formula: '(Σ km_structure × cost_structure + Σ station costs) × (1 + contingency)',
      assumptionIds: [
        'capex_at_grade',
        'capex_elevated',
        'capex_tunnel',
        'capex_cut_cover',
        'capex_bridge',
        'contingency',
      ],
      provenance: prov,
      computedAt,
    },
  ]);
  const interchangeIds = new Set(scenario.stations.filter((s) => linesAtStation(s.id) >= 2).map((s) => s.id));
  return {
    scenarioId: scenario.id,
    assumptionSet: set,
    lines,
    stations: scenario.stations.map((s) => ({
      stationId: s.id,
      catchmentPopulation: pops.get(s.id) ?? point(0),
      weekdayBoardings: stationBoard.get(s.id) ?? point(0),
    })),
    totals: {
      lengthM: lines.reduce((s, l) => s + l.lengthM, 0),
      stations: scenario.stations.length,
      interchanges: interchangeIds.size,
      vehicles: lines.reduce((s, l) => s + l.vehiclesRequired, 0),
      capex: sum((l) => l.capex),
      annualOpex: sum((l) => l.annualOpex),
      annualBoardings: sum((l) => l.annualBoardings),
      netCo2eTonnesPerYear: sum((l) => l.netCo2eTonnesPerYear),
    },
    results,
    currency: DEMO_CURRENCY,
    priceYear: DEMO_PRICE_YEAR,
    demonstration: true,
  };
}
