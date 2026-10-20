import { describe, expect, it } from 'vitest';
import { createLine, emptyScenario, updateLine } from '../domain/network';
import { setLegManual } from '../domain/alignment';
import { routeStatusCollection, segmentsCollection } from './overlays';

describe('map overlays', () => {
  it('marks bus sections that do not follow streets', () => {
    const { scenario, line } = createLine(emptyScenario(), {
      coordinates: [
        [0, 0],
        [0.01, 0],
        [0.02, 0.01],
      ],
      mode: 'bus',
    });
    const sc = updateLine(scenario, line.id, setLegManual(line, 1, true, false));
    const fc = routeStatusCollection(sc);
    expect(fc.features.map((f) => f.properties?.status)).toEqual(['unrouted', 'manual']);
  });

  it('draws smooth track lines from the sampled curve, as two tracks', () => {
    const { scenario } = createLine(emptyScenario(), {
      coordinates: [
        [0, 0],
        [0.01, 0.01],
        [0.02, 0],
      ],
      mode: 'tram',
    });
    const fc = segmentsCollection(scenario, null);
    expect(fc.features).toHaveLength(2);
    const coords = (fc.features[0]!.geometry as { coordinates: number[][] }).coordinates;
    expect(coords.length).toBeGreaterThan(50);
    expect(routeStatusCollection(scenario).features).toHaveLength(0);
  });
});
