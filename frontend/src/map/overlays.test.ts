import { describe, expect, it } from 'vitest';
import { createLine, emptyScenario, updateLine } from '../domain/network';
import { setLegManual } from '../domain/alignment';
import {
  routeStatusCollection,
  segmentsCollection,
  trackNodesCollection,
  tracksCollection,
} from './overlays';
import { railLine, xy } from '../test/fixtures/tracks';

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

  it('draws physical double track as two tracks and the service over them, out and back', () => {
    const { s } = railLine([xy(0, 0), xy(800, 0), xy(800, 800)], 'tram', [xy(0, 0), xy(800, 800)]);
    const tracks = tracksCollection(s, null);
    expect(tracks.features).toHaveLength(2);
    // Arrows follow each track's own running direction.
    expect(new Set(tracks.features.map((f) => f.properties?.arrow))).toEqual(new Set(['›']));
    const curve = (tracks.features[0]!.geometry as { coordinates: number[][] }).coordinates;
    expect(curve.length).toBeGreaterThan(5);
    const service = segmentsCollection(s, null).features;
    expect(service.map((f) => f.properties?.track)).toEqual(['band', 'band']);
    expect(trackNodesCollection(s, null).features.map((f) => f.properties?.kind)).toEqual([
      'end',
      'end',
      'end',
      'end',
    ]);
    expect(routeStatusCollection(s).features).toHaveLength(0);
  });
});
