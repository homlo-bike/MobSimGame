import { describe, expect, it } from 'vitest';
import {
  ACCESS_COMBINATIONS,
  accessFacilities,
  accessIconId,
  accessSummary,
  facilitiesOfIconId,
} from './stationAccess';
import { accessImage } from '../map/accessIcons';

const unknown = { stepFree: null, elevators: null, escalators: null, ramp: null, tactilePaving: null };

describe('station access facilities', () => {
  it('lists known facilities in a fixed order and treats unknown as absent', () => {
    expect(accessFacilities(unknown)).toEqual([]);
    expect(accessFacilities({ ...unknown, ramp: true, elevators: 2, escalators: 0 })).toEqual([
      'elevator',
      'ramp',
    ]);
  });

  it('round-trips the map image id', () => {
    expect(accessIconId([])).toBeNull();
    const id = accessIconId(['elevator', 'escalator']);
    expect(id).toBe('msg-access-elevator+escalator');
    expect(facilitiesOfIconId(id!)).toEqual(['elevator', 'escalator']);
    expect(facilitiesOfIconId('msg-access-lift')).toBeNull();
    expect(facilitiesOfIconId('msg-arrow')).toBeNull();
    expect(ACCESS_COMBINATIONS).toHaveLength(7);
    expect(ACCESS_COMBINATIONS).toContainEqual(['elevator', 'escalator', 'ramp']);
  });

  it('summarises access in words', () => {
    expect(accessSummary(unknown)).toBe('');
    expect(accessSummary({ ...unknown, elevators: 1, escalators: 3, ramp: true, stepFree: true })).toBe(
      '1 elevator, 3 escalators, ramp, step-free',
    );
  });

  it('draws one bordered tile per facility', () => {
    const img = accessImage(['elevator', 'ramp']);
    expect(img.height).toBe(16);
    expect(img.width).toBe(34);
    expect(img.data.length).toBe(34 * 16 * 4);
    // Top-left corner is the dark border; the gap between tiles stays transparent.
    expect(img.data[3]).toBe(255);
    expect(img.data[(0 * 34 + 16) * 4 + 3]).toBe(0);
  });
});
