/**
 * Timetables from headways across the service day (F2). Pure.
 *
 * A line runs from its service start to its service end (after midnight when the end is
 * earlier than the start). A departure inside a peak period of the project follows the
 * peak headway, any other the off-peak headway: the next departure is the current one
 * plus the headway in force at it (the usual headway-based timetabling, e.g. Ceder,
 * Public Transit Planning and Operation, 2nd ed., CRC Press 2016). Outside the service
 * span there are no departures.
 */
import type { ServicePattern, ServicePeriod } from './schema';

export const DAY_S = 86400;

/** "HH:MM" → seconds after midnight. */
export function clockToS(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return (h || 0) * 3600 + (m || 0) * 60;
}

/** The service span in seconds after midnight; the end may be past 24:00. */
export function serviceSpanS(pattern: Pick<ServicePattern, 'serviceStart' | 'serviceEnd'>): [number, number] {
  const a = clockToS(pattern.serviceStart);
  let b = clockToS(pattern.serviceEnd);
  if (b <= a) b += DAY_S;
  return [a, b];
}

/** True when a time of day (s, any day) lies in one of the peak periods. */
export function inPeak(periods: readonly ServicePeriod[], tS: number): boolean {
  const tod = ((tS % DAY_S) + DAY_S) % DAY_S;
  return periods.some((p) => {
    const a = clockToS(p.start);
    const b = clockToS(p.end);
    return a <= b ? tod >= a && tod < b : tod >= a || tod < b;
  });
}

export type DayPeriod = 'peak' | 'off_peak' | 'no_service';

/** What a line runs at a time of day. */
export function periodAt(
  pattern: Pick<ServicePattern, 'serviceStart' | 'serviceEnd'>,
  periods: readonly ServicePeriod[],
  tS: number,
): DayPeriod {
  const [a, b] = serviceSpanS(pattern);
  const tod = ((tS % DAY_S) + DAY_S) % DAY_S;
  const running = (tod >= a && tod < b) || (tod + DAY_S >= a && tod + DAY_S < b);
  if (!running) return 'no_service';
  return inPeak(periods, tod) ? 'peak' : 'off_peak';
}

/**
 * Departures of one service day (seconds after midnight, ascending; past 24:00 for a
 * service running after midnight), with headways in seconds for peak and off-peak.
 */
export function dayDepartures(
  pattern: Pick<ServicePattern, 'serviceStart' | 'serviceEnd'>,
  periods: readonly ServicePeriod[],
  headwayS: { peak: number; offPeak: number },
): number[] {
  const [a, b] = serviceSpanS(pattern);
  const out: number[] = [];
  for (let t = a; t < b && out.length < 5000;) {
    out.push(t);
    t += Math.max(30, inPeak(periods, t) ? headwayS.peak : headwayS.offPeak);
  }
  return out;
}
