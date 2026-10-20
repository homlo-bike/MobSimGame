import { describe, expect, it } from 'vitest';
import { drawingGuides, snapToGuides, straightsNear } from './guides';

const deg = (d: number) => (d * Math.PI) / 180;

describe('drawing guides', () => {
  it('are relative to the previous leg, not to north', () => {
    // Previous leg heading 30°: the straight-on guide is at 30°, the square one at 120°.
    const prev: [number, number] = [0, 0];
    const last: [number, number] = [Math.cos(deg(30)) * 100, Math.sin(deg(30)) * 100];
    const g = drawingGuides({ last, prev, startHeading: null, straights: [] });
    const headings = g.map((x) => Math.round(((((x.heading * 180) / Math.PI) % 360) + 360) % 360));
    expect(headings).toContain(30);
    expect(headings).toContain(120);
    expect(headings).not.toContain(0);
    expect(headings).not.toContain(90);
    // A cursor near the straight-on ray snaps onto it.
    const cursor: [number, number] = [last[0] + Math.cos(deg(30)) * 50 + 1, last[1] + Math.sin(deg(30)) * 50];
    const snap = snapToGuides(cursor, g, 3)!;
    expect(snap.guide.label).toBe('straight on');
    expect(Math.hypot(snap.point[0] - last[0], snap.point[1] - last[1])).toBeCloseTo(50.87, 1);
  });

  it('continue the track the first point starts from', () => {
    const g = drawingGuides({ last: [0, 0], prev: null, startHeading: deg(90), straights: [] });
    const snap = snapToGuides([0.5, 40], g, 2)!;
    expect(snap.point[0]).toBeCloseTo(0, 6);
    expect(snap.guide.label).toBe('straight on');
  });

  it('offer parallels to straight track within 100 m only', () => {
    const near = { start: [0, 50] as [number, number], end: [200, 50] as [number, number] };
    const far = { start: [0, 500] as [number, number], end: [200, 700] as [number, number] };
    expect(straightsNear([near, far], [100, 0], 100)).toEqual([near]);
    const g = drawingGuides({ last: [0, 0], prev: [-100, -17.6], startHeading: null, straights: [near] });
    expect(g.some((x) => x.label === 'parallel to track')).toBe(true);
    // A cursor next to the parallel ray snaps onto it; one between the rays snaps to none.
    const snap = snapToGuides([80, 1], g, 2)!;
    expect(snap.point[1]).toBeCloseTo(0, 6);
    expect(snapToGuides([80, 30], g, 2)).toBeNull();
  });

  it('have nothing to offer before the first point', () => {
    expect(drawingGuides({ last: null, prev: null, startHeading: null, straights: [] })).toEqual([]);
  });
});
