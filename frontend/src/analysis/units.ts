/** Unit conversions. Metric is the default everywhere in the UI. */

export const M_PER_KM = 1000;
export const M_PER_MILE = 1609.344;
export const M_PER_FOOT = 0.3048;
export const SQM_PER_HECTARE = 10_000;
export const SQM_PER_ACRE = 4046.8564224;

export const kmhToMs = (kmh: number) => kmh / 3.6;
export const msToKmh = (ms: number) => ms * 3.6;
export const kmToMiles = (km: number) => (km * M_PER_KM) / M_PER_MILE;
export const milesToKm = (mi: number) => (mi * M_PER_MILE) / M_PER_KM;
export const metresToFeet = (m: number) => m / M_PER_FOOT;
export const sqmToHectares = (m2: number) => m2 / SQM_PER_HECTARE;
export const sqmToAcres = (m2: number) => m2 / SQM_PER_ACRE;
export const gramsToTonnes = (g: number) => g / 1_000_000;

export type UnitSystem = 'metric' | 'imperial';

export function formatDistance(m: number, system: UnitSystem = 'metric'): string {
  if (system === 'imperial') {
    const mi = m / M_PER_MILE;
    return mi >= 0.2 ? `${mi.toFixed(2)} mi` : `${Math.round(metresToFeet(m))} ft`;
  }
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export function formatArea(m2: number, system: UnitSystem = 'metric'): string {
  if (system === 'imperial') return `${sqmToAcres(m2).toFixed(2)} acres`;
  return m2 >= SQM_PER_HECTARE ? `${sqmToHectares(m2).toFixed(2)} ha` : `${Math.round(m2)} m²`;
}
