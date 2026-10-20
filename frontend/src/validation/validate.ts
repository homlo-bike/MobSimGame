/**
 * Validation engine for conceptual alignments.
 *
 * Findings are advisory. Thresholds come from versioned mode profiles
 * (domain/modeProfiles.ts): curve radii are cited documented defaults, the other
 * thresholds are uncited placeholders, which every such finding states. Nothing here declares an alignment
 * safe, buildable or construction-ready.
 */
import type { LngLat, Scenario, TransportLine } from '../domain/schema';
import { MODE_PROFILES, type CurveRadiusRule, type ModeProfile } from '../domain/modeProfiles';
import { MODES } from '../domain/modes';
import { isRing, lineLengthM, orderedStops, STATION_ON_LINE_TOLERANCE_M } from '../domain/network';
import {
  distanceM,
  isValidPath,
  pathCoordinates,
  positionAtFraction,
  slicePath,
  snapToPath,
  vertexCurvatures,
} from '../geo/geometry';
import { validateSegments } from '../geo/segments';
import { validateTrackNetwork } from './trackValidation';
import { servingLines } from '../domain/stationKinds';
import { isVehicleCompatible } from '../domain/vehicles';
import {
  INFRASTRUCTURE_CLASS_LABELS,
  serviceCanUse,
  trackClass,
  vehicleTrackIssues,
} from '../domain/compatibility';
import { lineFleet } from '../analysis/fleet';
import { trackGeometry } from '../domain/tracks';

interface CurvatureSample {
  index: number;
  chainageM: number;
  radiusM: number;
  position: LngLat;
}
import { routeStatus } from '../domain/alignment';
import { STRUCTURE_LABELS } from '../domain/modes';

export type Severity = 'info' | 'recommendation' | 'warning' | 'error';

export const SEVERITY_LABELS: Record<Severity, string> = {
  info: 'Information',
  recommendation: 'Recommendation',
  warning: 'Warning',
  error: 'Error',
};

export const SEVERITY_PLURALS: Record<Severity, string> = {
  error: 'Errors',
  warning: 'Warnings',
  recommendation: 'Recommendations',
  info: 'Information',
};

/** What each category means; shown as help wherever findings are summarised. */
export const SEVERITY_DEFINITIONS: Record<Severity, string> = {
  error: 'Prevents a valid route, service, simulation or export. Requires your action.',
  warning:
    'The project can continue, but the condition may be unrealistic, unsafe, incomplete or outside the configured preferred range.',
  recommendation: 'An optional improvement; it does not make the project invalid.',
  info: 'A neutral observation or calculated status.',
};

/** Most severe first. */
export const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'recommendation', 'info'];

/** Text symbols so severity is never conveyed by colour alone. */
export const SEVERITY_SYMBOLS: Record<Severity, string> = {
  info: 'ℹ',
  recommendation: '◇',
  warning: '⚠',
  error: '⛔',
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
  | 'short_segment'
  | 'connectivity';

export interface Finding {
  id: string;
  severity: Severity;
  category: FindingCategory;
  message: string;
  lineId?: string;
  stationId?: string;
  segmentId?: string;
  trackId?: string;
  nodeId?: string;
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
  const findings = checkLine(line, scenario, options);
  if (!existingInfrastructure(line)) return findings;
  // Imported, unedited lines describe what exists: report, but do not block or warn.
  return findings.map((f) =>
    f.severity === 'info'
      ? f
      : {
          ...f,
          severity: 'info',
          message: f.message.startsWith('Existing infrastructure')
            ? f.message
            : `Existing infrastructure: ${f.message}`,
        },
  );
}

function checkLine(line: TransportLine, scenario: Scenario, options: ValidationOptions): Finding[] {
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
      severity: 'error',
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
    add({ severity: 'error', category: 'geometry', message: `Segment table: ${err}.` });
  }

  // --- Stops and termination -------------------------------------------------
  const stops = orderedStops(line, scenario.stations);
  const transitMode = !['cycling', 'pedestrian'].includes(line.mode);
  if (transitMode && stops.length < 2) {
    add({
      severity: 'error',
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
        severity: 'error',
        category: 'termination',
        position: start,
        message:
          'The start of the line has no terminal station. A line must end at a terminal station or be closed as a loop or ring.',
      });
    }
    if (!last || distanceM(last.station.position, end) > terminalTol) {
      add({
        severity: 'error',
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
    // Everything except the last 150 m, so the end cannot "return" to itself.
    const head = total > 150 ? slicePath(path, false, 0, (total - 150) / total) : [];
    const snap = head.length >= 2 ? snapToPath(head, false, end) : null;
    if (!snap || snap.offsetM > terminalTol) {
      add({
        severity: 'error',
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
  findings.push(
    ...curveFindings(line, scenario, profile, total).map((f) => ({ ...f, id: `${line.id}-${n++}` })),
  );

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
    if (
      seg.tracks === 'single' &&
      line.direction === 'bidirectional' &&
      MODES[line.mode].guided &&
      line.alignment.kind !== 'track'
    ) {
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

  // --- Track services ----------------------------------------------------------
  if (line.alignment.kind === 'track' && line.alignment.status === 'unrouted') {
    add({
      severity: existingInfrastructure(line) ? 'info' : 'error',
      category: 'geometry',
      message: `The service is not routed over the tracks: ${line.alignment.message || 'add stations on tracks and connect them.'}`,
    });
  } else if (line.alignment.kind === 'track' && line.alignment.message) {
    add({ severity: 'warning', category: 'geometry', message: line.alignment.message });
  }

  // --- Vehicles and fleet ------------------------------------------------------
  const vehicle = scenario.vehicleTypes.find((v) => v.id === line.vehicleTypeId);
  if (line.vehicleTypeId && !vehicle)
    add({
      severity: 'error',
      category: 'operations',
      message: 'The selected vehicle type no longer exists.',
    });
  if (vehicle && !isVehicleCompatible(vehicle, line.mode))
    add({
      severity: 'error',
      category: 'operations',
      message: `Vehicle "${vehicle.name}" is not compatible with ${MODES[line.mode].label} lines. Choose a ${MODES[line.mode].label.toLowerCase()} vehicle.`,
    });
  if (vehicle?.minRadiusM && line.alignment.kind === 'track') {
    const net = scenario.trackNetwork;
    const used = new Set(line.alignment.path.concat(line.alignment.returnPath ?? []).map((s) => s.trackId));
    const tight = net.tracks
      .filter((t) => used.has(t.id))
      .flatMap((t) => trackGeometry(net, t).primitives)
      .filter((p) => p.kind === 'arc' && p.radius < vehicle.minRadiusM!);
    if (tight.length)
      add({
        severity: 'error',
        category: 'curve_radius',
        message: `Vehicle "${vehicle.name}" needs curves of at least ${vehicle.minRadiusM} m; the route has ${tight.length} tighter curve(s).`,
      });
  }
  if (line.alignment.kind === 'track') {
    // Infrastructure compatibility (domain/compatibility.ts): tracks the mode may not use, and
    // vehicle gauge or electrification conflicts. Unknown track values never conflict.
    const net = scenario.trackNetwork;
    const used = new Set(line.alignment.path.concat(line.alignment.returnPath ?? []).map((s) => s.trackId));
    const usedTracks = net.tracks.filter((t) => used.has(t.id));
    const wrong = usedTracks.filter((t) => !serviceCanUse(net, line.mode, t));
    if (wrong.length)
      add({
        severity: 'error',
        category: 'operations',
        message: `${MODES[line.mode].label} services may not use ${[...new Set(wrong.map((t) => INFRASTRUCTURE_CLASS_LABELS[trackClass(t)].toLowerCase()))].join(', ')} (${wrong.length} track(s)). Route the service again or change the infrastructure compatibility.`,
      });
    if (vehicle) {
      const issues = new Map<string, number>();
      for (const t of usedTracks)
        for (const i of vehicleTrackIssues(vehicle, t))
          issues.set(i.message, (issues.get(i.message) ?? 0) + 1);
      for (const [msg, n] of issues)
        add({ severity: 'error', category: 'operations', message: `${msg} (${n} track(s)).` });
    }
  }
  const fleet = transitMode ? lineFleet(line, scenario) : null;
  if (fleet && fleet.assigned !== null && fleet.shortfall > 0)
    add({
      severity: 'error',
      category: 'operations',
      message: `${fleet.assigned} vehicle(s) assigned, but ${fleet.peakRequired} are needed for the ${line.servicePatterns[0]!.peakHeadwayMin}-minute peak headway (cycle ≈ ${Math.round(fleet.cycleMin)} min with placeholder speeds). Add vehicles or lengthen the headway.`,
    });

  // --- Street network ----------------------------------------------------------
  const route = routeStatus(line);
  if (route && route.unrouted > 0) {
    add({
      severity: existingInfrastructure(line) ? 'info' : 'error',
      category: 'road_compatibility',
      message: `${route.unrouted} of ${route.total} section(s) between waypoints are not routed on the street network. Route them, or mark them as manual sketches, before the line counts as complete.`,
    });
  } else if (route && route.manual > 0) {
    add({
      severity: 'info',
      category: 'road_compatibility',
      message: `${route.manual} section(s) are manual sketches that do not follow the street network.`,
    });
  } else if (!route && ['bus', 'brt'].includes(line.mode)) {
    add({
      severity: 'warning',
      category: 'road_compatibility',
      message:
        'This bus alignment uses straight segments instead of following streets. Switch the alignment to "Follows streets" to route it.',
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

/** Imported, unedited lines describe existing infrastructure: findings are informational. */
export function existingInfrastructure(line: TransportLine): boolean {
  return line.origin.source === 'osm' && !line.origin.edited;
}

function ruleSource(rule: CurveRadiusRule): string {
  return rule.sources.map((s) => `${s.publisher}, ${s.title} (${s.year}) ${s.section}`).join('; ');
}

type CurveClass = 'below_minimum' | 'below_recommended';

/** Curve-radius findings from the cited rule of the line's mode. */
function curveFindings(
  line: TransportLine,
  scenario: Scenario,
  profile: ModeProfile,
  totalM: number,
): Omit<Finding, 'id'>[] {
  const rule = profile.curveRadius;
  // Track services are checked on their physical tracks (trackValidation.ts).
  if (!rule || totalM <= 0 || line.alignment.kind !== 'polyline') return [];
  const ring = isRing(line);
  const polyline = true;
  const samples: CurvatureSample[] = vertexCurvatures(line.coordinates, ring).map((v) => ({
    index: v.index,
    chainageM: 0,
    radiusM: v.radiusM,
    position: v.position,
  }));
  {
    // Chainage of each vertex, for segment lookup.
    let acc = 0;
    const chain = [0];
    for (let i = 1; i < line.coordinates.length; i++) {
      acc += distanceM(line.coordinates[i - 1]!, line.coordinates[i]!);
      chain.push(acc);
    }
    for (const s of samples) s.chainageM = chain[s.index] ?? 0;
  }
  const minimumAt = (chainageM: number) => {
    if (rule.embeddedMinimumM === null) return rule.minimumM;
    const f = chainageM / totalM;
    const seg = line.segments.find((x) => f >= x.fromFraction && f <= x.toFraction);
    const street = seg && seg.structure === 'at_grade' && seg.rightOfWay !== 'dedicated_track';
    return street ? rule.embeddedMinimumM : rule.minimumM;
  };
  const classify = (s: CurvatureSample): CurveClass | null => {
    if (s.radiusM < minimumAt(s.chainageM)) return 'below_minimum';
    if (rule.recommendedM !== null && s.radiusM < rule.recommendedM) return 'below_recommended';
    return null;
  };
  // Group consecutive samples of the same class into one curve.
  const groups: { cls: CurveClass; min: CurvatureSample; threshold: number }[] = [];
  let prev: CurveClass | null = null;
  for (const s of samples) {
    const cls = classify(s);
    if (cls && cls === prev) {
      const g = groups[groups.length - 1]!;
      if (s.radiusM < g.min.radiusM) {
        g.min = s;
        g.threshold = cls === 'below_minimum' ? minimumAt(s.chainageM) : rule.recommendedM!;
      }
    } else if (cls) {
      groups.push({
        cls,
        min: s,
        threshold: cls === 'below_minimum' ? minimumAt(s.chainageM) : rule.recommendedM!,
      });
    }
    prev = cls;
  }
  const existing = existingInfrastructure(line);
  const ref = { id: profile.id, version: profile.version, cited: true };
  const estimate = polyline ? 'Vertex-based estimate on straight segments.' : '';
  const out: Omit<Finding, 'id'>[] = groups.map((g) => {
    const r = Math.round(g.min.radiusM);
    const kind = g.cls === 'below_minimum' ? 'minimum' : 'recommended';
    return {
      lineId: line.id,
      severity: existing ? 'info' : g.cls === 'below_minimum' ? 'error' : 'warning',
      category: 'curve_radius',
      position: g.min.position,
      message: `${existing ? 'Existing infrastructure: curve' : 'Curve'} radius ≈${r} m at ${Math.round(g.min.chainageM)} m, below the ${kind} ${g.threshold} m (documented default: ${ruleSource(rule)}). ${estimate}`,
      profile: ref,
    };
  });
  if (rule.stationRecommendedM !== null && samples.length) {
    for (const s of orderedStops(line, scenario.stations)) {
      const nearest = samples.reduce((a, b) =>
        Math.abs(b.chainageM - s.chainageM) < Math.abs(a.chainageM - s.chainageM) ? b : a,
      );
      if (nearest.radiusM < rule.stationRecommendedM) {
        out.push({
          lineId: line.id,
          severity: existing ? 'info' : 'warning',
          category: 'curve_radius',
          stationId: s.station.id,
          position: s.station.position,
          message: `Station "${s.station.name}" lies on a curve of radius ≈${Math.round(nearest.radiusM)} m; ${rule.stationRecommendedM} m or more is recommended at stations (documented default: ${ruleSource(rule)}).`,
          profile: ref,
        });
      }
    }
  }
  return out;
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
  const findings = [
    ...validateTrackNetwork(scenario),
    ...scenario.lines.flatMap((l) => validateLine(l, scenario, options)),
  ];
  for (const st of scenario.stations) {
    const lines = servingLines(scenario, st.id);
    const trackLines = lines.filter((l) => l.alignment.kind === 'track');
    if (!lines.length) {
      findings.push({
        id: `orphan-${st.id}`,
        severity: 'warning',
        category: 'station_alignment',
        stationId: st.id,
        position: st.position,
        message: st.trackRefs.length
          ? `Station "${st.name}" is on tracks but no service calls at it.`
          : `Stop "${st.name}" is not served by any line. A bus stop needs a bus or BRT line passing through it; delete it or add it to a line.`,
      });
    }
    // A rail station must reference tracks; after a track was deleted it must not look valid.
    if (trackLines.length && !st.trackRefs.length)
      findings.push({
        id: `no-track-${st.id}`,
        severity: 'error',
        category: 'station_alignment',
        stationId: st.id,
        position: st.position,
        message: `Station "${st.name}" is not on any track, but ${trackLines.map((l) => `"${l.name}"`).join(', ')} call at it. Draw track through it or assign tracks in the station inspector.`,
      });
  }
  return findings;
}

export function isLineComplete(
  line: TransportLine,
  scenario: Scenario,
  options?: ValidationOptions,
): boolean {
  return !validateLine(line, scenario, options).some((f) => f.severity === 'error');
}
