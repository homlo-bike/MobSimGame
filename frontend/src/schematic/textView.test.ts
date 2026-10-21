import { describe, expect, it } from 'vitest';
import { buildDemoScenario } from '../test/fixtures/demoProject';
import { computeSchematic } from './layout';
import { schematicTextView, schematicWalks } from './textView';

describe('schematic text view', () => {
  it('lists every line with its stations in order and what passengers find there', () => {
    let s = buildDemoScenario();
    const [l1, l2] = s.lines;
    const a = l1!.stops[0]!.stationId;
    const b = l2!.stops.find((x) => !l1!.stops.some((y) => y.stationId === x.stationId))!.stationId;
    s = {
      ...s,
      interchanges: [
        ...s.interchanges,
        { id: 'walk-test', stationIds: [a, b], walkTimeMin: null, notes: '' },
      ],
      stations: s.stations.map((st) =>
        st.id === a ? { ...st, accessibility: { ...st.accessibility, elevators: 2, ramp: true } } : st,
      ),
    };
    const layout = computeSchematic(s, {});
    const view = schematicTextView(s, layout);
    expect(view.map((v) => v.lineId)).toEqual(layout.lines.map((l) => l.id));
    const line1 = view.find((v) => v.lineId === l1!.id)!;
    expect(line1.stops.map((x) => x.stationId)).toEqual(
      layout.lines.find((l) => l.id === l1!.id)!.stationIds,
    );
    const first = line1.stops.find((x) => x.stationId === a)!;
    expect(first.access).toEqual(['Elevator', 'Ramp']);
    expect(first.walks).toHaveLength(1);
    expect(first.walks[0]!.minutes).toBeGreaterThan(0);
    expect(first.walks[0]!.calculated).toBe(true);
    // Interchanges name the other lines calling there.
    const shared = line1.stops.find((x) => x.otherLines.length > 0);
    if (shared) expect(shared.otherLines).not.toContain(l1!.shortName || l1!.name);
    expect(schematicWalks(s, layout).some((w) => w.id === 'walk-test')).toBe(true);
  });
});
