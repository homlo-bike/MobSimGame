import { describe, expect, it } from 'vitest';
import { createFrame, type Vec } from './projection';
import {
  arcFromCenter,
  arcLength,
  arcSweep,
  continuity,
  dist,
  headingAt,
  join,
  length,
  line,
  lineLength,
  nearest,
  offset,
  pointAt,
  radiusViolations,
  sample,
  split,
  tangentArc,
  tangentDeviation,
  totalLength,
  type ArcPrimitive,
  type LinePrimitive,
} from './primitives';
import {
  buildPrimitives,
  deserializeAlignment,
  innerOuterRadii,
  moveVertex,
  parallel,
  serializeAlignment,
  setRadius,
  type PiAlignment,
} from './alignment';
import { distanceM } from '../geometry';
import { fitPiAlignment } from './fit';

const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);
const closeVec = (a: Vec, b: Vec, tol = 1e-6) => {
  close(a[0], b[0], tol);
  close(a[1], b[1], tol);
};

describe('project metric frame (transverse Mercator)', () => {
  const frame = createFrame([13.405, 52.52]);

  it('puts the origin at (0, 0) and round-trips positions to well under a millimetre', () => {
    closeVec(frame.toMetres([13.405, 52.52]), [0, 0], 1e-6);
    for (const p of [
      [13.5, 52.6],
      [13.2, 52.4],
      [13.405, 52.9],
    ] as [number, number][]) {
      const back = frame.toLngLat(frame.toMetres(p));
      close(back[0], p[0], 1e-9);
      close(back[1], p[1], 1e-9);
    }
  });

  it('measures ground distances in metres (not degrees)', () => {
    const a: [number, number] = [13.405, 52.52];
    const b: [number, number] = [13.505, 52.52];
    const d = dist(frame.toMetres(a), frame.toMetres(b));
    // ~6.78 km east at 52.5° N; spherical haversine agrees to ~0.3 % (sphere vs ellipsoid).
    expect(Math.abs(d - distanceM(a, b)) / d).toBeLessThan(0.004);
    // North-south: one minute of latitude ≈ 1853 m at this latitude.
    const ns = dist(frame.toMetres([13.405, 52.52]), frame.toMetres([13.405, 52.52 + 1 / 60]));
    expect(ns).toBeGreaterThan(1850);
    expect(ns).toBeLessThan(1856);
  });

  it('rejects an invalid origin', () => {
    expect(() => createFrame([Number.NaN, 0])).toThrow();
    expect(() => createFrame([0, 89.5])).toThrow();
  });
});

describe('lines and circular arcs', () => {
  it('measures straight lines', () => {
    expect(lineLength(line([0, 0], [3, 4]))).toBe(5);
  });

  it('creates left and right arcs with the right radius, sweep and length', () => {
    const left = arcFromCenter([0, 0], 100, -Math.PI / 2, Math.PI / 2);
    expect(left.direction).toBe('left');
    close(arcSweep(left), Math.PI / 2);
    close(arcLength(left), (100 * Math.PI) / 2);
    const right = arcFromCenter([0, 0], 100, Math.PI / 2, -Math.PI / 2);
    expect(right.direction).toBe('right');
    close(arcSweep(right), -Math.PI / 2);
    // Headings follow the direction of travel.
    close(headingAt(left, 'start'), 0);
    close(headingAt(right, 'start'), 0);
  });

  it('finds the tangent arc from a heading to a point', () => {
    const arc = tangentArc([0, 0], 0, [100, 100]) as ArcPrimitive;
    expect(arc.kind).toBe('arc');
    expect(arc.direction).toBe('left');
    close(arc.radius, 100);
    closeVec(arc.center, [0, 100]);
    close(tangentDeviation(line([-50, 0], [0, 0]), arc), 0);
    expect(tangentArc([0, 0], 0, [100, 0]).kind).toBe('line');
    expect((tangentArc([0, 0], 0, [100, -100]) as ArcPrimitive).direction).toBe('right');
  });

  it('finds the nearest point on lines and arcs with a signed offset', () => {
    const l = line([0, 0], [100, 0]);
    expect(nearest(l, [30, 5])).toMatchObject({ point: [30, 0], along: 30, offset: 5 });
    expect(nearest(l, [30, -5]).offset).toBe(-5);
    expect(nearest(l, [-10, 0]).along).toBe(0);
    const arc = arcFromCenter([0, 100], 100, -Math.PI / 2, Math.PI / 2); // left turn from (0,0) to (100,100)
    const q = nearest(arc, [Math.SQRT1_2 * 90, 100 - Math.SQRT1_2 * 90]); // 10 m inside, at 45°
    close(q.along, (100 * Math.PI) / 4, 1e-6);
    close(q.offset, 10, 1e-6); // inside of a left curve is to the left
    close(nearest(arc, [Math.SQRT1_2 * 110, 100 - Math.SQRT1_2 * 110]).offset, -10, 1e-6);
  });

  it('splits lines and arcs and joins them back', () => {
    const l = line([0, 0], [100, 0]);
    const [a, b] = split(l, 40);
    expect(lineLength(a as LinePrimitive)).toBe(40);
    expect(join(a, b)).toEqual(l);
    const arc = arcFromCenter([0, 0], 50, 0, Math.PI);
    const [x, y] = split(arc, arcLength(arc) / 3);
    close(arcLength(x as ArcPrimitive) + arcLength(y as ArcPrimitive), arcLength(arc));
    closeVec(x.end, y.start);
    const back = join(x, y) as ArcPrimitive;
    close(arcLength(back), arcLength(arc));
    expect(join(l, arc)).toBeNull();
  });

  it('offsets arcs to inner and outer radii', () => {
    const left = arcFromCenter([0, 0], 100, -Math.PI / 2, Math.PI / 2);
    expect((offset(left, 2) as ArcPrimitive).radius).toBe(98); // left side of a left curve is inside
    expect((offset(left, -2) as ArcPrimitive).radius).toBe(102);
    const right = arcFromCenter([0, 0], 100, Math.PI / 2, -Math.PI / 2);
    expect((offset(right, 2) as ArcPrimitive).radius).toBe(102);
    expect(offset(left, 150)).toBeNull();
    expect(innerOuterRadii(100, 4)).toEqual({ inner: 98, outer: 102 });
  });

  it('samples arcs for display without changing the source', () => {
    const arc = arcFromCenter([0, 0], 100, 0, Math.PI / 2);
    const pts = sample([arc], 5);
    expect(pts.length).toBeGreaterThan(30);
    for (const p of pts) close(dist(p, [0, 0]), 100, 1e-9);
    expect(arc.radius).toBe(100);
  });
});

describe('PI alignments (lines tangent to arcs)', () => {
  // An L-shaped alignment: east 300 m, then north 300 m, with a 100 m radius at the corner.
  const L: PiAlignment = {
    points: [
      [0, 0],
      [300, 0],
      [300, 300],
    ],
    radii: [null, 100, null],
  };

  it('builds line–arc–line with position and tangent continuity', () => {
    const { primitives, warnings } = buildPrimitives(L);
    expect(warnings).toEqual([]);
    expect(primitives.map((p) => p.kind)).toEqual(['line', 'arc', 'line']);
    const arc = primitives[1] as ArcPrimitive;
    close(arc.radius, 100);
    expect(arc.direction).toBe('left');
    closeVec(arc.start, [200, 0]);
    closeVec(arc.end, [300, 100]);
    closeVec(arc.center, [200, 100]);
    expect(continuity(primitives)).toEqual({ gaps: [], kinks: [] });
    // Length = 200 + π·100/2 + 200.
    close(totalLength(primitives), 400 + 50 * Math.PI, 1e-6);
  });

  it('connects two arcs through a tangent (arc–line–arc and reverse curves)', () => {
    const S: PiAlignment = {
      points: [
        [0, 0],
        [300, 0],
        [300, 300],
        [600, 300],
      ],
      radii: [null, 100, 100, null],
    };
    const { primitives } = buildPrimitives(S);
    expect(primitives.map((p) => p.kind)).toEqual(['line', 'arc', 'line', 'arc', 'line']);
    expect((primitives[1] as ArcPrimitive).direction).toBe('left');
    expect((primitives[3] as ArcPrimitive).direction).toBe('right');
    expect(continuity(primitives).kinks).toEqual([]);
    // With radii that use the whole middle leg the arcs meet directly (arc–arc, tangent).
    const tight = buildPrimitives(setRadius(setRadius(S, 1, 150), 2, 150));
    expect(tight.primitives.map((p) => p.kind)).toEqual(['line', 'arc', 'arc', 'line']);
    expect(continuity(tight.primitives)).toEqual({ gaps: [], kinks: [] });
  });

  it('reduces a radius that does not fit and says so', () => {
    const { warnings, usedRadii, primitives } = buildPrimitives(setRadius(L, 1, 1000));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'radius_reduced', vertex: 1, requestedM: 1000 });
    expect(warnings[0]!.kind === 'radius_reduced' && warnings[0]!.usedM).toBeCloseTo(300, 9);
    expect(usedRadii[1]).toBeCloseTo(300, 9);
    expect(continuity(primitives).kinks).toEqual([]);
  });

  it('keeps connected geometry attached when a vertex moves', () => {
    const moved = buildPrimitives(moveVertex(L, 2, [400, 300])).primitives;
    expect(continuity(moved)).toEqual({ gaps: [], kinks: [] });
    closeVec(moved[0]!.start, [0, 0]);
    closeVec(moved[moved.length - 1]!.end, [400, 300]);
    close((moved[1] as ArcPrimitive).radius, 100);
  });

  it('generates a parallel track with concentric inner/outer arcs', () => {
    const { alignment, collapsed } = parallel(L, 2); // 2 m to the left = inside of this left curve
    expect(collapsed).toEqual([]);
    expect(alignment.radii[1]).toBe(98);
    const inner = buildPrimitives(alignment).primitives;
    const outer = buildPrimitives(parallel(L, -2).alignment).primitives;
    close((inner[1] as ArcPrimitive).radius, 98);
    close((outer[1] as ArcPrimitive).radius, 102);
    // Same centre, constant spacing along the whole curve.
    closeVec((inner[1] as ArcPrimitive).center, (outer[1] as ArcPrimitive).center);
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      const p = pointAt(inner[1]!, length(inner[1]!) * s).point;
      close(Math.abs(nearest(outer[1]!, p).offset), 4, 1e-6);
    }
    expect(parallel(L, 150).collapsed).toEqual([1]);
  });

  it('validates minimum radii on both tracks of a pair', () => {
    const centre = setRadius(L, 1, 26);
    const inner = buildPrimitives(parallel(centre, 2).alignment).primitives;
    expect(radiusViolations(inner, 25)).toEqual([{ index: 1, radiusM: 24, limitM: 25 }]);
    expect(radiusViolations(buildPrimitives(parallel(centre, -2).alignment).primitives, 25)).toEqual([]);
  });

  it('serializes and validates alignments', () => {
    const back = deserializeAlignment(serializeAlignment(L));
    expect(back).toEqual(L);
    expect(() => deserializeAlignment('{"points":[[0,0]],"radii":[null]}')).toThrow();
    expect(() => deserializeAlignment('{"points":[[0,0],[1,1]],"radii":[null,-5]}')).toThrow();
  });
});

describe('fitting old curves to lines and arcs', () => {
  it('recovers the radius of a sampled curve and keeps it close to the original', () => {
    // 200 m straight, quarter circle of 150 m, 200 m straight, sampled every ~5 m.
    const pts: Vec[] = [];
    for (let x = -200; x < 0; x += 5) pts.push([x, 0]);
    for (let a = 0; a <= 90; a += 2) {
      const r = (a * Math.PI) / 180;
      pts.push([150 * Math.sin(r), 150 - 150 * Math.cos(r)]);
    }
    for (let y = 155; y <= 350; y += 5) pts.push([150, y]);
    const fit = fitPiAlignment(pts, 1);
    const arcs = buildPrimitives(fit.alignment).primitives.filter((p) => p.kind === 'arc') as ArcPrimitive[];
    expect(arcs.length).toBeGreaterThanOrEqual(1);
    for (const a of arcs) expect(Math.abs(a.radius - 150)).toBeLessThan(15);
    expect(fit.maxDeviationM).toBeLessThan(6);
    expect(continuity(buildPrimitives(fit.alignment).primitives).kinks).toEqual([]);
  });

  it('keeps a straight line straight', () => {
    const fit = fitPiAlignment(
      [
        [0, 0],
        [50, 0],
        [100, 0],
      ],
      1,
    );
    expect(fit.alignment.points).toHaveLength(2);
    expect(fit.maxDeviationM).toBe(0);
  });
});
