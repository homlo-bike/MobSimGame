import { describe, expect, it } from 'vitest';
import { railLine, xy } from '../test/fixtures/tracks';
import { scenarioForMode, schematicModes } from './modeFilter';

describe('schematic per rail mode', () => {
  it('lists the rail modes with lines and keeps only that mode', () => {
    const tram = railLine([xy(0, 0), xy(1000, 0)], 'tram', [xy(0, 0), xy(1000, 0)]);
    const metro = railLine([xy(0, 500), xy(1000, 500)], 'metro', [xy(0, 500), xy(1000, 500)], {
      scenario: tram.s,
    });
    const s = metro.s;
    expect(schematicModes(s).sort()).toEqual(['metro', 'tram']);
    const only = scenarioForMode(s, 'metro');
    expect(only.lines.map((l) => l.mode)).toEqual(['metro']);
    expect(only.stations).toHaveLength(2);
  });
});
