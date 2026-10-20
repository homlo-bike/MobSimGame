/**
 * Where a finding is and what it is about, so the validation panel and the map
 * can link to each other. Pure: no map or store access.
 */
import type { LngLat, Scenario, TransportMode } from '../domain/schema';
import { pathCoordinates, positionAtFraction } from '../geo/geometry';
import { isRing } from '../domain/network';
import { pointOnTrack } from '../domain/tracks';
import type { Finding, Severity } from './validate';
import { SEVERITY_ORDER } from './validate';

export type FindingSubject =
  | { kind: 'station'; id: string }
  | { kind: 'track'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'line'; id: string }
  | null;

/** The most specific object a finding is about. */
export function findingSubject(f: Finding): FindingSubject {
  if (f.stationId) return { kind: 'station', id: f.stationId };
  if (f.nodeId) return { kind: 'node', id: f.nodeId };
  if (f.trackId) return { kind: 'track', id: f.trackId };
  if (f.lineId) return { kind: 'line', id: f.lineId };
  return null;
}

/** A map position for the finding: its own, else its object's (line and track at mid-length). */
export function findingPosition(f: Finding, scenario: Scenario): LngLat | null {
  if (f.position) return f.position;
  if (f.stationId) {
    const st = scenario.stations.find((s) => s.id === f.stationId);
    if (st) return st.position;
  }
  const net = scenario.trackNetwork;
  if (f.nodeId) {
    const n = net.nodes.find((x) => x.id === f.nodeId);
    if (n) return n.position;
  }
  if (f.trackId) {
    const t = net.tracks.find((x) => x.id === f.trackId);
    if (t) return pointOnTrack(net, t, 0.5).position;
  }
  if (f.lineId) {
    const l = scenario.lines.find((x) => x.id === f.lineId);
    if (l && pathCoordinates(l.coordinates, isRing(l)).length >= 2) {
      const seg = f.segmentId ? l.segments.find((s) => s.id === f.segmentId) : undefined;
      const fraction = seg ? (seg.fromFraction + seg.toFraction) / 2 : 0.5;
      return positionAtFraction(l.coordinates, isRing(l), fraction);
    }
  }
  return null;
}

/** The transport mode a finding concerns (line mode, else the track's design mode). */
export function findingMode(f: Finding, scenario: Scenario): TransportMode | null {
  if (f.lineId) {
    const l = scenario.lines.find((x) => x.id === f.lineId);
    if (l) return l.mode;
  }
  if (f.trackId) {
    const t = scenario.trackNetwork.tracks.find((x) => x.id === f.trackId);
    if (t) return t.designMode;
  }
  return null;
}

export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { error: 0, warning: 0, recommendation: 0, info: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}

export type FindingSort = 'severity' | 'line' | 'station' | 'segment' | 'mode';

/** Stable sort for the validation panel; severity breaks ties. */
export function sortFindings(findings: readonly Finding[], by: FindingSort, scenario: Scenario): Finding[] {
  const sev = (f: Finding) => SEVERITY_ORDER.indexOf(f.severity);
  const lineName = (f: Finding) => scenario.lines.find((l) => l.id === f.lineId)?.name ?? '￿';
  const stationName = (f: Finding) => scenario.stations.find((s) => s.id === f.stationId)?.name ?? '￿';
  const segment = (f: Finding) => f.segmentId ?? f.trackId ?? '￿';
  const mode = (f: Finding) => findingMode(f, scenario) ?? '￿';
  const key: Record<FindingSort, (f: Finding) => string> = {
    severity: () => '',
    line: lineName,
    station: stationName,
    segment,
    mode,
  };
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => key[by](a.f).localeCompare(key[by](b.f)) || sev(a.f) - sev(b.f) || a.i - b.i)
    .map((x) => x.f);
}
