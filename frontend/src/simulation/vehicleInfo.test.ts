import { describe, expect, it } from 'vitest';
import { updateLine } from '../domain/network';
import { railLine, xy } from '../test/fixtures/tracks';
import { PLACEHOLDER_PEAK_PERIODS } from '../domain/schema';
import { buildScenarioModels, vehicleStates } from './engine';
import { vehicleInfo } from './vehicleInfo';

function setup(demand: { peak: number | null; off: number | null }) {
  const { s, line } = railLine([xy(0, 0), xy(3000, 0)], 'tram', [xy(0, 0), xy(1500, 0), xy(3000, 0)]);
  const sc = updateLine(s, line.id, {
    direction: 'bidirectional',
    peakDemandPphpd: demand.peak,
    offPeakDemandPphpd: demand.off,
  });
  const m = buildScenarioModels(sc, { timetable: { peakPeriods: PLACEHOLDER_PEAK_PERIODS } })[0]!;
  return { sc, m };
}

describe('vehicle info window', () => {
  it('names the next stop ahead and estimates the load from the entered demand', () => {
    const { sc, m } = setup({ peak: 600, off: null });
    const t = 8 * 3600 + 120;
    const running = vehicleStates(m, t).find((v) => v.state === 'running')!;
    const info = vehicleInfo(sc, m, running, t);
    expect(info.nextStop).toBeTruthy();
    const names = sc.stations.map((s) => s.name);
    expect(names).toContain(info.nextStop);
    // 600 passengers/hour every peak headway: demand × headway / 3600 per vehicle.
    expect(info.load.kind).toBe('estimate');
    if (info.load.kind === 'estimate') {
      expect(info.load.passengers).toBe(Math.round((600 * m.headwayS) / 3600));
      expect(info.load.basis).toBe('peak');
    }
  });

  it('says what is missing instead of inventing a load', () => {
    const { sc, m } = setup({ peak: 600, off: null });
    const t = 12 * 3600;
    const v = vehicleStates(m, t).find((x) => x.state === 'running' || x.state === 'dwelling')!;
    const info = vehicleInfo(sc, m, v, t);
    expect(info.load.kind).toBe('none');
    if (info.load.kind === 'none') expect(info.load.reason).toMatch(/off-peak demand/);
  });
});
