import { describe, expect, it } from 'vitest';
import {
  initialSegments,
  joinSegments,
  mergeWithNext,
  moveBoundary,
  normalizeSegments,
  sliceSegments,
  splitSegmentsAt,
  updateSegment,
  validateSegments,
  type SegmentAttributes,
} from './segments';

const attrs: SegmentAttributes = {
  structure: 'at_grade',
  rightOfWay: 'dedicated_track',
  tracks: 'double',
  speedLimitKmh: null,
  notes: '',
};

describe('segment splitting', () => {
  it('splits one segment into two contiguous ones', () => {
    const segs = splitSegmentsAt(initialSegments(attrs), 0.4);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.toFraction).toBe(0.4);
    expect(segs[1]!.fromFraction).toBe(0.4);
    expect(validateSegments(segs)).toEqual([]);
  });

  it('ignores splits at the ends', () => {
    expect(splitSegmentsAt(initialSegments(attrs), 0)).toHaveLength(1);
    expect(splitSegmentsAt(initialSegments(attrs), 1)).toHaveLength(1);
  });

  it('supports mixed structure along one line', () => {
    let segs = splitSegmentsAt(splitSegmentsAt(initialSegments(attrs), 0.3), 0.7);
    segs = updateSegment(segs, segs[1]!.id, { structure: 'tunnel' });
    segs = updateSegment(segs, segs[2]!.id, { structure: 'elevated', tracks: 'single' });
    expect(segs.map((s) => s.structure)).toEqual(['at_grade', 'tunnel', 'elevated']);
    expect(segs.map((s) => s.tracks)).toEqual(['double', 'double', 'single']);
  });

  it('merges and moves boundaries while keeping coverage', () => {
    const segs = splitSegmentsAt(initialSegments(attrs), 0.5);
    const moved = moveBoundary(segs, segs[0]!.id, 0.6);
    expect(moved[0]!.toFraction).toBeCloseTo(0.6);
    expect(validateSegments(moved)).toEqual([]);
    expect(mergeWithNext(moved, moved[0]!.id)).toHaveLength(1);
  });

  it('normalises gaps and overlaps', () => {
    const [s] = initialSegments(attrs);
    const broken = [
      { ...s!, id: 'a', fromFraction: 0.1, toFraction: 0.5 },
      { ...s!, id: 'b', fromFraction: 0.4, toFraction: 0.9 },
    ];
    expect(validateSegments(broken).length).toBeGreaterThan(0);
    expect(validateSegments(normalizeSegments(broken, attrs))).toEqual([]);
  });

  it('slices and joins segment tables', () => {
    const segs = splitSegmentsAt(initialSegments(attrs), 0.5);
    const right = sliceSegments(segs, 0.25, 1);
    expect(right[0]!.toFraction).toBeCloseTo(1 / 3);
    const joined = joinSegments(segs, 1000, initialSegments({ ...attrs, structure: 'bridge' }), 1000);
    expect(validateSegments(joined)).toEqual([]);
    expect(joined[joined.length - 1]!.structure).toBe('bridge');
    expect(joined[joined.length - 1]!.fromFraction).toBeCloseTo(0.5);
  });
});
