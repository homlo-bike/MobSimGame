import { describe, expect, it } from 'vitest';
import { dayDepartures, inPeak, periodAt, serviceSpanS } from '../domain/timetable';
import { PLACEHOLDER_PEAK_PERIODS } from '../domain/schema';
import { buildLineModel, roundTripS, vehicleStates } from './engine';
import { updateLine } from '../domain/network';
import { railLine, xy } from '../test/fixtures/tracks';

const peaks = PLACEHOLDER_PEAK_PERIODS;

describe('service day timetable', () => {
  it('runs peak headways in the peak periods, off-peak otherwise, nothing outside the span', () => {
    const pattern = { serviceStart: '05:00', serviceEnd: '00:30' };
    expect(serviceSpanS(pattern)).toEqual([5 * 3600, 24.5 * 3600]);
    const deps = dayDepartures(pattern, peaks, { peak: 300, offPeak: 900 });
    expect(deps[0]).toBe(5 * 3600);
    expect(deps[deps.length - 1]!).toBeLessThan(24.5 * 3600);
    const gaps = deps.slice(1).map((d, i) => [deps[i]!, d - deps[i]!] as const);
    for (const [at, gap] of gaps) expect(gap).toBe(inPeak(peaks, at) ? 300 : 900);
    expect(periodAt(pattern, peaks, 8 * 3600)).toBe('peak');
    expect(periodAt(pattern, peaks, 12 * 3600)).toBe('off_peak');
    expect(periodAt(pattern, peaks, 3 * 3600)).toBe('no_service');
    expect(periodAt(pattern, peaks, 0.25 * 3600)).toBe('off_peak');
  });

  it('keeps every vehicle somewhere all day: fewer in service off-peak, none at night', () => {
    const { s, line } = railLine([xy(0, 0), xy(3000, 0)], 'tram', [xy(0, 0), xy(1500, 0), xy(3000, 0)]);
    const sc = updateLine(s, line.id, {
      direction: 'bidirectional',
      servicePatterns: [
        {
          ...line.servicePatterns[0]!,
          peakHeadwayMin: 5,
          offPeakHeadwayMin: 15,
          serviceStart: '05:00',
          serviceEnd: '23:00',
        },
      ],
    });
    const m = buildLineModel(sc.lines[0]!, sc, { timetable: { peakPeriods: peaks } })!;
    expect(m.fleet).toBe(Math.ceil(roundTripS(m) / 300 - 1e-6));
    const moving = (t: number) =>
      vehicleStates(m, t).filter((v) => v.state !== 'parked' && v.state !== 'layover').length;
    const ids = (t: number) =>
      vehicleStates(m, t)
        .map((v) => v.id)
        .sort();
    const all = ids(8 * 3600);
    expect(all).toHaveLength(m.fleet);
    for (const t of [3 * 3600, 6 * 3600, 8 * 3600, 12 * 3600, 17 * 3600, 23.9 * 3600])
      expect(ids(t)).toEqual(all);
    // Night: nobody runs.
    expect(moving(3 * 3600)).toBe(0);
    // Peak runs more vehicles than off-peak.
    const avg = (from: number) => {
      let n = 0;
      for (let t = from; t < from + 3600; t += 60) n += moving(t);
      return n / 60;
    };
    expect(avg(7 * 3600)).toBeGreaterThan(avg(12 * 3600));
  });
});
