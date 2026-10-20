/**
 * Ramps between levels (R6). Pure.
 *
 * Every track node has a level (0 = street, −1 underground, +1 elevated …). A track whose
 * two ends are on different levels is a ramp: it climbs or descends the height difference
 * between the levels over its own length. The heights of the levels are project
 * parameters; the steepest gradient a ramp may have comes from the mode's validation
 * profile (cited for railways, placeholders otherwise). The terrain is not used yet: the
 * street level is taken as flat.
 */
import type { LngLat, PhysicalTrack, Scenario, TrackNetwork, TransportLine, TransportMode } from './schema';
import { MODE_PROFILES } from './modeProfiles';
import { parameterValue } from './trackParameters';
import { levelOfStructure, nodeMap, trackGeometry } from './tracks';
import { lineLengthM } from './network';
import { positionAtFraction } from '../geo/geometry';

/** Height of the track (m) on a level, relative to the street (negative below ground). */
export function levelHeightM(net: Pick<TrackNetwork, 'parameterOverrides'>, level: number): number {
  if (level < 0) return level * parameterValue(net, 'levelDepthM');
  if (level > 0) return level * parameterValue(net, 'levelHeightM');
  return 0;
}

/** Steepest gradient a ramp of the mode may have (percent), and whether it is cited. */
export function maxRampGradient(mode: TransportMode): { percent: number; cited: boolean; source: string } {
  const cited = RAMP_GRADIENT_CITED[mode];
  if (cited) return { ...cited, cited: true };
  const p = MODE_PROFILES[mode];
  return { percent: p.maxGradePercent.warning, cited: false, source: p.source };
}

const EBO_7 =
  'Eisenbahn-Bau- und Betriebsordnung (EBO) § 7 (1) (Germany): the gradient on open line should not exceed 12.5 per mille on new main lines (40 per mille on branch lines). https://www.gesetze-im-internet.de/ebo/__7.html';

const RAMP_GRADIENT_CITED: Partial<Record<TransportMode, { percent: number; source: string }>> = {
  commuter_rail: { percent: 1.25, source: EBO_7 },
};

const EBO_7_2 =
  'Eisenbahn-Bau- und Betriebsordnung (EBO) § 7 (2) (Germany): the gradient of station tracks should not exceed 2.5 per mille on new construction. https://www.gesetze-im-internet.de/ebo/__7.html';

/** Steepest gradient of track at a platform (percent): EBO for railways, else the project parameter. */
export function stationMaxGradient(
  net: Pick<TrackNetwork, 'parameterOverrides'>,
  mode: TransportMode,
): { percent: number; cited: boolean; source: string } {
  if (mode === 'commuter_rail') return { percent: 0.25, cited: true, source: EBO_7_2 };
  return {
    percent: parameterValue(net, 'stationMaxGradientPercent'),
    cited: false,
    source: 'Project parameter',
  };
}

export interface Ramp {
  trackId: string;
  fromLevel: number;
  toLevel: number;
  /** Height difference from the from-end to the to-end (m). */
  riseM: number;
  lengthM: number;
  /** Gradient along the track (percent, absolute). */
  gradientPercent: number;
  maxGradientPercent: number;
  cited: boolean;
  /** Shortest ramp that keeps within the gradient (m). */
  requiredLengthM: number;
  fits: boolean;
  /** Where the ramp leaves or meets the street (at the street-level end), if one end is at street level. */
  portal: LngLat | null;
}

/** The ramp a track forms, or null when both ends are on the same level. */
export function trackRamp(net: TrackNetwork, track: PhysicalTrack): Ramp | null {
  const nodes = nodeMap(net);
  const a = nodes.get(track.fromNodeId);
  const b = nodes.get(track.toNodeId);
  if (!a || !b || a.level === b.level) return null;
  const riseM = levelHeightM(net, b.level) - levelHeightM(net, a.level);
  const lengthM = trackGeometry(net, track).lengthM;
  const max = maxRampGradient(track.designMode);
  const gradientPercent = lengthM > 0 ? (Math.abs(riseM) / lengthM) * 100 : Infinity;
  const requiredLengthM = (Math.abs(riseM) / max.percent) * 100;
  return {
    trackId: track.id,
    fromLevel: a.level,
    toLevel: b.level,
    riseM,
    lengthM,
    gradientPercent,
    maxGradientPercent: max.percent,
    cited: max.cited,
    requiredLengthM,
    fits: gradientPercent <= max.percent + 1e-9,
    portal: a.level === 0 ? a.position : b.level === 0 ? b.position : null,
  };
}

export function ramps(scenario: Pick<Scenario, 'trackNetwork'>): Ramp[] {
  const net = scenario.trackNetwork;
  return net.tracks.map((t) => trackRamp(net, t)).filter((r): r is Ramp => r !== null);
}

/** Height of a track (m) at a fraction of its length: constant, or linear along a ramp. */
export function trackHeightAt(net: TrackNetwork, track: PhysicalTrack, fraction: number): number {
  const nodes = nodeMap(net);
  const a = nodes.get(track.fromNodeId);
  const b = nodes.get(track.toNodeId);
  const ha = levelHeightM(net, a?.level ?? track.level);
  const hb = levelHeightM(net, b?.level ?? track.level);
  return ha + (hb - ha) * Math.min(1, Math.max(0, fraction));
}

/** Middle of a ramp, for its label. */
export function rampLabelPosition(net: TrackNetwork, track: PhysicalTrack): LngLat {
  return positionAtFraction(trackGeometry(net, track).coordinates, false, 0.5);
}

/**
 * Set the level of a track end (its node): every track meeting there follows, so a track
 * running between two levels becomes a ramp.
 */
export function setNodeLevel(scenario: Scenario, nodeId: string, level: number): Scenario {
  const net = scenario.trackNetwork;
  if (!net.nodes.some((n) => n.id === nodeId)) return scenario;
  const nodes = net.nodes.map((n) => (n.id === nodeId ? { ...n, level } : n));
  const levels = new Map(nodes.map((n) => [n.id, n.level]));
  // A track whose ends are now on the same level lies on that level; a ramp keeps its own.
  const tracks = net.tracks.map((t) => {
    if (t.fromNodeId !== nodeId && t.toNodeId !== nodeId) return t;
    const a = levels.get(t.fromNodeId);
    return a !== undefined && a === levels.get(t.toNodeId) && a !== t.level ? { ...t, level: a } : t;
  });
  return { ...scenario, trackNetwork: { ...net, nodes, tracks } };
}

/** Height of a line (m, relative to the street) at fractions of its length. */
export type HeightProfile = { fraction: number; heightM: number }[];

/**
 * Height along a line. Services on track follow the heights of their tracks (rising and
 * falling along ramps); other lines take the level of each segment's structure and change
 * height linearly over the ramp length the mode's gradient needs, centred on the change.
 */
export function lineHeightProfile(
  scenario: Pick<Scenario, 'trackNetwork'>,
  line: TransportLine,
): HeightProfile {
  const net = scenario.trackNetwork;
  if (line.alignment.kind === 'track' && line.alignment.path.length) {
    const byId = new Map(net.tracks.map((t) => [t.id, t]));
    const parts = line.alignment.path
      .map((s) => {
        const t = byId.get(s.trackId);
        return t ? { t, s, len: Math.abs(s.to - s.from) * trackGeometry(net, t).lengthM } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const total = parts.reduce((a, p) => a + p.len, 0);
    if (total <= 0) return [{ fraction: 0, heightM: 0 }];
    const out: HeightProfile = [];
    let at = 0;
    for (const p of parts) {
      out.push({ fraction: at / total, heightM: trackHeightAt(net, p.t, p.s.from) });
      at += p.len;
      out.push({ fraction: at / total, heightM: trackHeightAt(net, p.t, p.s.to) });
    }
    return out;
  }
  const total = lineLengthM(line);
  const grade = maxRampGradient(line.mode).percent / 100;
  const segs = [...line.segments].sort((a, b) => a.fromFraction - b.fromFraction);
  const h = (i: number) => levelHeightM(net, levelOfStructure(segs[i]!.structure));
  const out: HeightProfile = [{ fraction: 0, heightM: segs.length ? h(0) : 0 }];
  for (let i = 1; i < segs.length; i++) {
    const dh = h(i) - h(i - 1);
    if (dh === 0) continue;
    const half = total > 0 ? Math.abs(dh) / grade / 2 / total : 0;
    const at = segs[i]!.fromFraction;
    out.push({ fraction: Math.max(0, at - half), heightM: h(i - 1) });
    out.push({ fraction: Math.min(1, at + half), heightM: h(i) });
  }
  out.push({ fraction: 1, heightM: segs.length ? h(segs.length - 1) : 0 });
  return out;
}

/** Height at a fraction of the line, interpolated in the profile. */
export function heightAtFraction(profile: HeightProfile, fraction: number): number {
  if (!profile.length) return 0;
  if (fraction <= profile[0]!.fraction) return profile[0]!.heightM;
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]!;
    const b = profile[i]!;
    if (fraction <= b.fraction) {
      const span = b.fraction - a.fraction;
      return span > 0 ? a.heightM + ((b.heightM - a.heightM) * (fraction - a.fraction)) / span : b.heightM;
    }
  }
  return profile[profile.length - 1]!.heightM;
}
