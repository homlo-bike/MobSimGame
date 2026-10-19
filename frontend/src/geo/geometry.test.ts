import { describe, expect, it } from 'vitest';
import type { LngLat } from '../domain/schema';
import {
  circumradiusM,
  distanceM,
  endsMeet,
  isValidPath,
  overlapRanges,
  pathCoordinates,
  pathLengthM,
  positionAtFraction,
  samplePath,
  slicePath,
  snapToPath,
  vertexCurvatures,
} from './geometry';

// One degree of longitude at the equator ≈ 111.195 km on Turf's sphere.
const KM_PER_DEG = 111.195;

describe('coordinate order', () => {
  it('treats coordinates as [longitude, latitude]', () => {
    // Moving 1° east at 60° N is about half as long as 1° north.
    const east = distanceM([0, 60], [1, 60]);
    const north = distanceM([0, 60], [0, 61]);
    expect(east / north).toBeCloseTo(0.5, 1);
  });

  it('rejects out-of-range latitude (swapped order)', () => {
    expect(isValidPath([[10, 95] as LngLat, [11, 95] as LngLat])).toBe(false);
  });
});

describe('route length', () => {
  it('measures a straight line along the equator', () => {
    expect(
      pathLengthM([
        [0, 0],
        [1, 0],
      ]) / 1000,
    ).toBeCloseTo(KM_PER_DEG, 0);
  });

  it('closes rings for length', () => {
    const square: LngLat[] = [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01],
    ];
    expect(pathLengthM(square, true)).toBeCloseTo(4 * 0.01 * KM_PER_DEG * 1000, -1);
    expect(pathCoordinates(square, true)).toHaveLength(5);
  });

  it('returns 0 for invalid geometry', () => {
    expect(pathLengthM([[0, 0]])).toBe(0);
    expect(
      pathLengthM([
        [0, 0],
        [0, 0],
      ]),
    ).toBe(0);
  });
});

describe('station snapping', () => {
  it('projects a point onto the nearest position of the line', () => {
    const snap = snapToPath(
      [
        [0, 0],
        [0.02, 0],
      ],
      false,
      [0.01, 0.001],
    )!;
    expect(snap.position[0]).toBeCloseTo(0.01, 5);
    expect(snap.position[1]).toBeCloseTo(0, 5);
    expect(snap.fraction).toBeCloseTo(0.5, 3);
    expect(snap.offsetM).toBeCloseTo(0.001 * KM_PER_DEG * 1000, -1);
  });

  it('position at fraction is the inverse of snapping', () => {
    const coords: LngLat[] = [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
    ];
    const p = positionAtFraction(coords, false, 0.75);
    expect(snapToPath(coords, false, p)!.fraction).toBeCloseTo(0.75, 3);
  });
});

describe('slicing and sampling', () => {
  it('slices a sub-path by fraction', () => {
    const s = slicePath(
      [
        [0, 0],
        [0.04, 0],
      ],
      false,
      0.25,
      0.5,
    );
    expect(s[0]![0]).toBeCloseTo(0.01, 5);
    expect(s[s.length - 1]![0]).toBeCloseTo(0.02, 5);
  });

  it('samples include both ends', () => {
    const samples = samplePath(
      [
        [0, 0],
        [0.01, 0],
      ],
      false,
      100,
    );
    expect(samples[0]!.chainageM).toBe(0);
    expect(samples[samples.length - 1]!.chainageM).toBeCloseTo(1112, -1);
  });
});

describe('loop detection', () => {
  it('detects ends that meet', () => {
    expect(
      endsMeet(
        [
          [0, 0],
          [0.01, 0],
          [0.01, 0.01],
          [0, 0.00001],
        ],
        5,
      ),
    ).toBe(true);
    expect(
      endsMeet(
        [
          [0, 0],
          [0.01, 0],
          [0.01, 0.01],
        ],
        5,
      ),
    ).toBe(false);
  });
});

describe('curvature', () => {
  it('is infinite for collinear points', () => {
    expect(circumradiusM([0, 0], [0.01, 0], [0.02, 0])).toBe(Infinity);
  });

  it('matches the radius of points on a known circle', () => {
    const r = 0.005; // degrees at the equator ≈ 556 m
    const pts = [0, 30, 60].map(
      (d) => [r * Math.cos((d * Math.PI) / 180), r * Math.sin((d * Math.PI) / 180)] as LngLat,
    );
    expect(circumradiusM(pts[0]!, pts[1]!, pts[2]!)).toBeCloseTo(r * KM_PER_DEG * 1000, -1);
  });

  it('reports interior vertices for open lines and all vertices for rings', () => {
    const sq: LngLat[] = [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01],
    ];
    expect(vertexCurvatures(sq, false)).toHaveLength(2);
    expect(vertexCurvatures(sq, true)).toHaveLength(4);
  });
});

describe('overlap detection (shared track)', () => {
  it('finds the shared part of two lines', () => {
    const a: LngLat[] = [
      [0, 0],
      [0.02, 0],
    ];
    const b: LngLat[] = [
      [0.01, 0],
      [0.02, 0],
      [0.03, 0.01],
    ];
    const ranges = overlapRanges(a, false, b, false, 5, 20);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.fromFraction).toBeCloseTo(0.5, 1);
    expect(ranges[0]!.toFraction).toBeCloseTo(1, 1);
  });
});
