/**
 * Segment running speeds for the illustrative simulation and exploratory
 * operating estimates.
 *
 * speed = min(segment speed limit, line max speed, vehicle max speed) × right-of-way factor
 *
 * The right-of-way factors are PLACEHOLDERS standing in for traffic interaction,
 * signals and acceleration; they are labelled as such in the UI and in
 * docs/METHODOLOGY.md and should be replaced with local observed speeds.
 */
import type { RightOfWay, TrackSegment, TransportLine } from '../domain/schema';

export const RIGHT_OF_WAY_SPEED_FACTOR: Record<RightOfWay, number> = {
  mixed_traffic: 0.4,
  dedicated_lane: 0.6,
  dedicated_track: 0.75,
};

export function segmentSpeedKmh(line: TransportLine, segment: TrackSegment, vehicleMaxKmh?: number): number {
  const caps = [line.maxSpeedKmh];
  if (segment.speedLimitKmh) caps.push(segment.speedLimitKmh);
  if (vehicleMaxKmh) caps.push(vehicleMaxKmh);
  return Math.max(1, Math.min(...caps) * RIGHT_OF_WAY_SPEED_FACTOR[segment.rightOfWay]);
}
