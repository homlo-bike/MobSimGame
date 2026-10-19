/**
 * DEMONSTRATION assumption set.
 *
 * Every value below is synthetic. It exists so the Phase 1 dashboard can show
 * how ranges, formulas and provenance are presented. None of these numbers is a
 * benchmark, a typical value or a recommendation. Costs are in fictional
 * "demo units" (DU) precisely so they cannot be read as money.
 */
import type { Assumption, AssumptionSet } from '../domain/schema';

const SRC = 'Synthetic demonstration value (MobSimGame Phase 1). Not derived from evidence.';

const a = (
  id: string,
  label: string,
  unit: string,
  low: number,
  central: number,
  high: number,
  sensitivity: Assumption['sensitivity'] = 'unknown',
): Assumption => ({
  id,
  label,
  unit,
  value: { low, central, high },
  status: 'demonstration',
  source: SRC,
  sourceDate: null,
  notes: '',
  sensitivity,
});

export const DEMO_CURRENCY = 'DU';
export const DEMO_PRICE_YEAR = 2026;

export const DEMO_ASSUMPTIONS: AssumptionSet = {
  id: 'demo-assumptions',
  name: 'Demonstration assumptions (synthetic)',
  version: '0.1.0-demo',
  assumptions: [
    a('trips_per_person', 'Trips per resident per weekday', 'trips/person/day', 2, 2.5, 3),
    a('jobs_per_resident', 'Jobs per resident in catchment', 'jobs/person', 0.2, 0.4, 0.6),
    a('trips_per_job', 'Trips attracted per job per weekday', 'trips/job/day', 1, 1.5, 2),
    a('transit_share', 'Share of catchment trips using the line', 'fraction', 0.04, 0.08, 0.14, 'high'),
    a('annualisation', 'Weekday-equivalent days per year', 'days/year', 280, 300, 320, 'medium'),
    a('avg_trip_km', 'Average passenger trip length on the line', 'km', 3, 5, 7, 'medium'),
    a('previously_drove', 'Share of riders who previously drove', 'fraction', 0.1, 0.2, 0.3, 'high'),
    a('car_occupancy', 'Average car occupancy', 'persons/vehicle', 1.2, 1.3, 1.5),
    a('car_trip_km', 'Average replaced car trip length', 'km', 4, 6, 9),
    a('car_ef_co2e', 'Car CO₂e emission factor', 'g/vehicle-km', 120, 160, 210, 'medium'),
    a('transit_energy', 'Transit energy use', 'kWh/vehicle-km', 2, 4, 7),
    a('grid_intensity', 'Electricity CO₂e intensity', 'g/kWh', 50, 250, 500, 'high'),
    a('parking_area', 'Area per parking space incl. access', 'm²/space', 12, 20, 28),
    a(
      'cars_per_shifted_trip',
      'Parked cars no longer needed per daily car round trip shifted',
      'cars/trip',
      0.05,
      0.15,
      0.3,
      'high',
    ),
    a('capex_at_grade', 'Surface alignment cost', `${DEMO_CURRENCY}/route-km`, 20, 30, 45),
    a('capex_elevated', 'Elevated alignment cost', `${DEMO_CURRENCY}/route-km`, 60, 90, 130),
    a('capex_bridge', 'Bridge cost', `${DEMO_CURRENCY}/route-km`, 80, 120, 180),
    a('capex_tunnel', 'Bored tunnel / underground cost', `${DEMO_CURRENCY}/route-km`, 150, 220, 320, 'high'),
    a('capex_cut_cover', 'Cut-and-cover cost', `${DEMO_CURRENCY}/route-km`, 100, 150, 220),
    a('station_surface', 'Surface station / stop cost', `${DEMO_CURRENCY}/station`, 1, 3, 6),
    a('station_elevated', 'Elevated station cost', `${DEMO_CURRENCY}/station`, 10, 15, 25),
    a('station_underground', 'Underground station cost', `${DEMO_CURRENCY}/station`, 30, 50, 80, 'high'),
    a('contingency', 'Contingency', 'fraction of base cost', 0.2, 0.3, 0.5),
    a('opex_per_vkm', 'Operating cost per vehicle-km', `${DEMO_CURRENCY}/vehicle-km`, 0.004, 0.006, 0.009),
    a('opex_per_vh', 'Operating cost per vehicle-hour', `${DEMO_CURRENCY}/vehicle-hour`, 0.05, 0.08, 0.12),
  ],
};

export function assumption(set: AssumptionSet, id: string): Assumption {
  const found = set.assumptions.find((x) => x.id === id);
  if (!found) throw new Error(`Assumption "${id}" missing from set "${set.name}"`);
  return found;
}
