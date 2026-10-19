/**
 * Validation engine for conceptual alignments.
 *
 * Findings are advisory. Thresholds come from versioned mode profiles
 * (domain/modeProfiles.ts); in Phase 1 those are uncited placeholders, which is
 * stated on every threshold-based finding. Nothing here declares an alignment
 * safe, buildable or construction-ready.
 */
import type { LngLat, Scenario, TransportLine } from '../domain/schema';
import { MODE_PROFILES, type ModeProfile } from '../domain/modeProfiles';
import { MODES } from '../domain/modes';
import { isRing, lineLengthM, orderedStops, STATION_ON_LINE_TOLERANCE_M } from '../domain/network';
import {
  distanceM,
  isValidPath,
  pathCoordinates,
  positionAtFraction,
  snapToPath,
  vertexCurvatures,
} from '../geo/geometry';
import { validateSegments } from '../geo/segments';
import { STRUCTURE_LABELS } from '../domain/modes';

export type Severity = 'info' | 'recommendation' | 'warning' | 'blocking';

export const SEVERITY_LABELS: Record<Severity, string> = {
  info: 'Information',
  recommendation: 'Recommendation',
  warning: 'Warning',
  blocking: 'Blocking geometry error',
};

/** Text symbols so severity is never conveyed by colour alone. */
export const SEVERITY_SYMBOLS: Record<Severity, string> = {
  info: 'ℹ',
  recommendation: '◇',
  warning: '⚠',
  blocking: '⛔',
};

export type FindingCategory =
  | 'geometry'
  | 'termination'
  | 'curve_radius'
  | 'grade'
  | 'stop_spacing'
  | 'station_alignment'
  | 'structure_transition'
  | 'road_compatibility'
  | 'operations'
  | 'short_segment';

export interface Finding {
  id: string;
  severity: Severity;
  category: FindingCategory;
  message: string;
  lineId?: string;
  stationId?: string;
  segmentId?: string;
  position?: LngLat;
  profile?: { id: string; version: string; cited: boolean };
}

/** Elevation samples along a line: chainage (m) and elevation (m). */
export type ElevationProfile = { chainageM: number; elevationM: number }[];

export interface ValidationOptions {
  /** Distance within which a stop counts as being at the end of a line. */
  terminalToleranceM?: number;
  elevation?: Record<string, ElevationProfile>;
  profiles?: Record<string, ModeProfile>;
}

const profileRef = (p: ModeProfile) => ({ id: p.id, version: p.version, cited: p.cited });
const profileNote = (p: ModeProfile) =>
  p.cited ? `(${p.source})` : '(uncited placeholder profile, advisory only)';

export function validateLine(
  line: TransportLine,
  scenario: Scenario,
  options: ValidationOptions = {},
): Finding[] {
  const findings: Finding[] = [];
  const profile = options.profiles?.[line.mode] ?? MODE_PROFILES[line.mode];
  const terminalTol = options.terminalToleranceM ?? 60;
  const ring = isRing(line);
  let n = 0;
  const add = (f: Omit<Finding, 'id' | 'lineId'>) =>
    findings.push({ id: `${line.id}-${n++}`, lineId: line.id, ...f });

  // --- Geometry ------------------------------------------------------------
  const path = pathCoordinates(line.coordinates, ring);
  if (!isValidPath(path) || (ring && line.coordinates.length < 3)) {
    add({
      severity: 'blocking',
      category: 'geometry',
      message: ring
        ? 'A ring line needs at least three distinct vertices.'
        : 'The line needs at least two distinct vertices with valid [longitude, latitude] coordinates.',
    });
    return findings;
  }
  const total = lineLengthM(line);
  if (total < 100) {
    add({
      severity: 'warning',
      category: 'short_segment',
      message: `The line is very short (${Math.round(total)} m).`,
    });
  }
  for (const err of validateSegments(line.segments)) {
    add({ severity: 'blocking', category: 'geometry', message: `Segment table: ${err}.` });
  }

  // --- Stops and termination -------------------------------------------------
  const stops = orderedStops(line, scenario.stations);
  const transitMode = !['cycling', 'pedestrian'].includes(line.mode);
  if (transitMode && stops.length < 2) {
    add({
      severity: 'blocking',
      category: 'termination',
      message: `The line has ${stops.length} station(s); at least two are needed before it can be considered complete.`,
    });
  }
  if (transitMode && line.termination.kind === 'ends') {
    const first = stops[0];
    const last = stops[stops.length - 1];
    const start = path[0]!;
    const end = path[path.length - 1]!;
    if (!first || distanceM(first.station.position, start) > terminalTol) {
      add({
        severity: 'blocking',
        category: 'termination',
        position: start,
        message:
          'The start of the line has no terminal station. A line must end at a terminal station or be closed as a loop or ring.',
      });
    }
    if (!last || distanceM(last.station.position, end) > terminalTol) {
      add({
        severity: 'blocking',
        category: 'termination',
        position: end,
        message:
          'The end of the line has no terminal station. A line must end at a terminal station or be closed as a loop or ring.',
      });
    }
  }
  if (line.termination.kind === 'loop') {
    // A user-defined loop: the alignment's end must return to an earlier part of itself.
    const end = path[path.length - 1]!;
    const head = path.slice(0, Math.max(2, path.length - 2));
    const snap = snapToPath(head, false, end);
    if (!snap || snap.offsetM > terminalTol || snap.chainageM > total - 150) {
      add({
        severity: 'blocking',
        category: 'termination',
        position: end,
        message:
          'The line is marked as ending in a loop, but its end does not return to an earlier part of the alignment.',
      });
    }
  }
  if (ring && path.length >= 2 && line.direction === 'one_way') {
    add({
      severity: 'info',
      category: 'operations',
      message: 'One-way ring: vehicles circulate in the drawn direction only.',
    });
  } else if (line.direction === 'one_way' && line.termination.kind === 'ends') {
    add({
      severity: 'info',
      category: 'operations',
      message:
        'One-way line with two ends: describe how vehicles return (another line, a loop, or empty running).',
    });
  }

  // --- Station alignment and spacing --------------------------------------
  for (const s of stops) {
    if (s.offsetM > STATION_ON_LINE_TOLERANCE_M) {
      add({
        severity: 'warning',
        category: 'station_alignment',
        stationId: s.station.id,
        position: s.station.position,
        message: `Station "${s.station.name}" is ${Math.round(s.offsetM)} m from the alignment.`,
      });
    }
  }
  const spacingPairs: [number, number, string, string][] = [];
  for (let i = 1; i < stops.length; i++) {
    spacingPairs.push([
      stops[i - 1]!.chainageM,
      stops[i]!.chainageM,
      stops[i - 1]!.station.name,
      stops[i]!.station.name,
    ]);
  }
  if (ring && stops.length >= 2) {
    const a = stops[stops.length - 1]!;
    const b = stops[0]!;
    spacingPairs.push([a.chainageM, b.chainageM + total, a.station.name, b.station.name]);
  }
  for (const [from, to, an, bn] of spacingPairs) {
    const d = to - from;
    const min = profile.minStopSpacingM;
    const max = profile.maxStopSpacingM;
    if (d < min.warning) {
      add({
        severity: 'warning',
        category: 'stop_spacing',
        message: `Stops "${an}" and "${bn}" are ${Math.round(d)} m apart, below ${min.warning} m ${profileNote(profile)}.`,
        profile: profileRef(profile),
      });
    } else if (d < min.preferred) {
      add({
        severity: 'recommendation',
        category: 'stop_spacing',
        message: `Stops "${an}" and "${bn}" are ${Math.round(d)} m apart; ${min.preferred} m or more is preferred ${profileNote(profile)}.`,
        profile: profileRef(profile),
      });
    }
    if (d > max.warning) {
      add({
        severity: 'warning',
        category: 'stop_spacing',
        message: `Stops "${an}" and "${bn}" are ${(d / 1000).toFixed(2)} km apart, above ${max.warning} m ${profileNote(profile)}.`,
        profile: profileRef(profile),
      });
    }
  }

  // --- Curvature --------------------------------------------------------------
  for (const c of vertexCurvatures(line.coordinates, ring)) {
    const r = profile.minCurveRadiusM;
    if (c.radiusM < r.warning) {
      add({
        severity: 'warning',
        category: 'curve_radius',
        position: c.position,
        message: `Estimated curve radius ≈${Math.round(c.radiusM)} m at vertex ${c.index + 1}, below ${r.warning} m ${profileNote(profile)}. Vertex-based estimate of a sketched polyline.`,
        profile: profileRef(profile),
      });
    } else if (c.radiusM < r.preferred) {
      add({
        severity: 'recommendation',
        category: 'curve_radius',
        position: c.position,
        message: `Estimated curve radius ≈${Math.round(c.radiusM)} m at vertex ${c.index + 1}; ${r.preferred} m or more is preferred ${profileNote(profile)}.`,
        profile: profileRef(profile),
      });
    }
  }

  // --- Grade (only with elevation data) ---------------------------------------
  const elevation = options.elevation?.[line.id];
  if (elevation && elevation.length >= 2) {
    for (const g of segmentGrades(elevation)) {
      const abs = Math.abs(g.gradePercent);
      const lim = profile.maxGradePercent;
      if (abs > lim.warning) {
        add({
          severity: 'warning',
          category: 'grade',
          position: positionAtFraction(line.coordinates, ring, g.toChainageM / total),
          message: `Surface grade ≈${abs.toFixed(1)} % between ${Math.round(g.fromChainageM)} m and ${Math.round(g.toChainageM)} m, above ${lim.warning} % ${profileNote(profile)}. Based on ground elevation, not a designed vertical alignment.`,
          profile: profileRef(profile),
        });
      }
    }
  } else if (MODES[line.mode].guided) {
    add({
      severity: 'info',
      category: 'grade',
      message: 'Grades were not checked: no elevation data has been loaded for this line.',
    });
  }

  // --- Structure transitions --------------------------------------------------
  for (let i = 0; i < line.segments.length; i++) {
    const seg = line.segments[i]!;
    const lenM = (seg.toFraction - seg.fromFraction) * total;
    if (line.segments.length > 1 && lenM < profile.minStructureSegmentM.warning) {
      add({
        severity: 'warning',
        category: 'short_segment',
        segmentId: seg.id,
        message: `${STRUCTURE_LABELS[seg.structure]} segment ${i + 1} is only ${Math.round(lenM)} m long ${profileNote(profile)}.`,
        profile: profileRef(profile),
      });
    }
    const next = line.segments[i + 1];
    if (next) {
      const below = (s: string) => ['underground', 'tunnel', 'cut_and_cover'].includes(s);
      const above = (s: string) => ['elevated', 'bridge'].includes(s);
      const changes =
        below(seg.structure) !== below(next.structure) || above(seg.structure) !== above(next.structure);
      if (changes && !(seg.notes || next.notes)) {
        add({
          severity: 'recommendation',
          category: 'structure_transition',
          segmentId: next.id,
          position: positionAtFraction(line.coordinates, ring, next.fromFraction),
          message: `Structure changes from ${STRUCTURE_LABELS[seg.structure]} to ${STRUCTURE_LABELS[next.structure]}: define the portal or ramp location and transition length in the segment notes.`,
        });
      }
    }
    if (seg.tracks === 'single' && line.direction === 'bidirectional' && MODES[line.mode].guided) {
      add({
        severity: 'info',
        category: 'operations',
        segmentId: seg.id,
        message: `Segment ${i + 1} is single track with bidirectional service: passing places limit the achievable frequency.`,
      });
    }
    if (
      !MODES[line.mode].guided &&
      ['underground', 'tunnel', 'cut_and_cover', 'elevated'].includes(seg.structure)
    ) {
      add({
        severity: 'info',
        category: 'road_compatibility',
        segmentId: seg.id,
        message: `${STRUCTURE_LABELS[seg.structure]} segment on a road-based mode: confirm vehicle, ventilation and access assumptions.`,
      });
    }
  }

  // --- Street network ----------------------------------------------------------
  if (MODES[line.mode].prefersStreetNetwork && ['bus', 'brt'].includes(line.mode)) {
    add({
      severity: 'warning',
      category: 'road_compatibility',
      message:
        'This road-vehicle alignment has not been routed on the street network. It is a conceptual sketch, not a drivable route (street routing is planned for Phase 2).',
    });
  }

  // --- Station construction vs segment structure -----------------------------
  for (const s of stops) {
    const seg = line.segments.find((x) => s.fraction >= x.fromFraction && s.fraction <= x.toFraction);
    if (!seg) continue;
    const below = ['underground', 'tunnel', 'cut_and_cover'].includes(seg.structure);
    const above = ['elevated', 'bridge'].includes(seg.structure);
    const expected = below ? 'underground' : above ? 'elevated' : 'surface';
    if (s.station.construction !== expected) {
      add({
        severity: 'recommendation',
        category: 'station_alignment',
        stationId: s.station.id,
        message: `Station "${s.station.name}" is set to ${s.station.construction} but lies on a ${STRUCTURE_LABELS[seg.structure].toLowerCase()} segment of this line.`,
      });
    }
  }

  return findings;
}

export function segmentGrades(profile: ElevationProfile) {
  const out: { fromChainageM: number; toChainageM: number; gradePercent: number }[] = [];
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]!;
    const b = profile[i]!;
    const run = b.chainageM - a.chainageM;
    if (run <= 0) continue;
    out.push({
      fromChainageM: a.chainageM,
      toChainageM: b.chainageM,
      gradePercent: ((b.elevationM - a.elevationM) / run) * 100,
    });
  }
  return out;
}

export function gradeSummary(profile: ElevationProfile) {
  const grades = segmentGrades(profile);
  let gain = 0;
  for (let i = 1; i < profile.length; i++)
    gain += Math.max(0, profile[i]!.elevationM - profile[i - 1]!.elevationM);
  const totalRun = grades.reduce((s, g) => s + (g.toChainageM - g.fromChainageM), 0);
  const meanAbs = totalRun
    ? grades.reduce((s, g) => s + Math.abs(g.gradePercent) * (g.toChainageM - g.fromChainageM), 0) / totalRun
    : 0;
  const maxAbs = grades.reduce((m, g) => Math.max(m, Math.abs(g.gradePercent)), 0);
  return { maxGradePercent: maxAbs, meanGradePercent: meanAbs, cumulativeGainM: gain };
}

export function validateScenario(scenario: Scenario, options: ValidationOptions = {}): Finding[] {
  const findings = scenario.lines.flatMap((l) => validateLine(l, scenario, options));
  const served = new Set(scenario.lines.flatMap((l) => l.stops.map((s) => s.stationId)));
  for (const st of scenario.stations) {
    if (!served.has(st.id)) {
      findings.push({
        id: `orphan-${st.id}`,
        severity: 'warning',
        category: 'station_alignment',
        stationId: st.id,
        position: st.position,
        message: `Station "${st.name}" is not served by any line.`,
      });
    }
  }
  return findings;
}

export function isLineComplete(
  line: TransportLine,
  scenario: Scenario,
  options?: ValidationOptions,
): boolean {
  return !validateLine(line, scenario, options).some((f) => f.severity === 'blocking');
}
