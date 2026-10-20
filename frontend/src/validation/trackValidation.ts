/**
 * Advisory findings for the physical track network. Radii are checked against
 * the cited rule of each track's design mode; geometric checks (kinks, open
 * ends, crossings without a connection) use geometric tolerances only, never
 * an invented engineering limit. Imported, unedited tracks report information.
 */
import type { LngLat, PhysicalTrack, Scenario } from '../domain/schema';
import { MODE_PROFILES, type CurveRadiusRule } from '../domain/modeProfiles';
import { angleBetween, networkFrame, nodeEnds, outwardHeading, trackGeometry } from '../domain/tracks';
import { singleTrackBlocks } from '../domain/trackGraph';
import { rampLabelPosition, stationMaxGradient, trackRamp } from '../domain/ramps';
import { continuity, type ArcPrimitive } from '../geo/track/primitives';
import type { Vec } from '../geo/track/projection';
import type { Finding, Severity } from './validate';

/** Geometric tolerance for "tangent" connections (degrees); a numerical tolerance, not a design value. */
export const TANGENT_TOLERANCE_DEG = 0.1;

const existing = (t: PhysicalTrack) => t.origin.source === 'osm' && !t.origin.edited;

function ruleSource(rule: CurveRadiusRule): string {
  return rule.sources.map((s) => `${s.publisher}, ${s.title} (${s.year}) ${s.section}`).join('; ');
}

function segIntersect(p: Vec, p2: Vec, q: Vec, q2: Vec): Vec | null {
  const r: Vec = [p2[0] - p[0], p2[1] - p[1]];
  const s: Vec = [q2[0] - q[0], q2[1] - q[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den;
  const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p[0] + t * r[0], p[1] + t * r[1]] : null;
}

export function validateTrackNetwork(scenario: Scenario): Finding[] {
  const net = scenario.trackNetwork;
  if (!net.tracks.length) return [];
  const out: Finding[] = [];
  let n = 0;
  const add = (f: Omit<Finding, 'id'>, track?: PhysicalTrack) => {
    const info = track && existing(track) && f.severity !== 'info';
    out.push({
      id: `trk-${n++}`,
      ...f,
      severity: info ? 'info' : f.severity,
      message: info ? `Existing infrastructure: ${f.message}` : f.message,
    });
  };
  const frame = networkFrame(net);
  const label = (t: PhysicalTrack) => (t.name ? `Track "${t.name}"` : 'A track');

  for (const t of net.tracks) {
    const g = trackGeometry(net, t);
    const rule = MODE_PROFILES[t.designMode].curveRadius;
    // --- Radii --------------------------------------------------------------
    for (const w of g.built.warnings) {
      if (w.kind === 'radius_reduced')
        add(
          {
            severity: 'warning',
            category: 'curve_radius',
            trackId: t.id,
            position: frame.toLngLat(g.alignment.points[w.vertex]!),
            message: `${label(t)}: radius ${Math.round(w.requestedM)} m does not fit between the neighbouring points; ${Math.round(w.usedM)} m is used. Move the points apart or lower the radius.`,
          },
          t,
        );
      if (w.kind === 'reversal')
        add(
          {
            severity: 'error',
            category: 'geometry',
            trackId: t.id,
            position: frame.toLngLat(g.alignment.points[w.vertex]!),
            message: `${label(t)} turns back on itself at a point.`,
          },
          t,
        );
    }
    if (rule) {
      const street = t.structure === 'at_grade' && t.rightOfWay !== 'dedicated_track';
      const minimum = street && rule.embeddedMinimumM !== null ? rule.embeddedMinimumM : rule.minimumM;
      for (const p of g.primitives) {
        if (p.kind !== 'arc') continue;
        const arc = p as ArcPrimitive;
        let severity: Severity | null = null;
        let threshold = 0;
        if (arc.radius < minimum - 1e-6) {
          severity = 'error';
          threshold = minimum;
        } else if (rule.recommendedM !== null && arc.radius < rule.recommendedM - 1e-6) {
          severity = 'warning';
          threshold = rule.recommendedM;
        }
        if (severity)
          add(
            {
              severity,
              category: 'curve_radius',
              trackId: t.id,
              position: frame.toLngLat(arc.start),
              message: `${label(t)}: curve radius ${Math.round(arc.radius)} m is below the ${severity === 'error' ? 'minimum' : 'recommended'} ${threshold} m (documented default: ${ruleSource(rule)}). No transition curves or cant are modelled.`,
              profile: {
                id: MODE_PROFILES[t.designMode].id,
                version: MODE_PROFILES[t.designMode].version,
                cited: true,
              },
            },
            t,
          );
      }
    }
    // --- Kinks inside the track ------------------------------------------------
    const c = continuity(g.primitives, 0.01, TANGENT_TOLERANCE_DEG);
    for (const k of c.kinks)
      add(
        {
          severity: 'warning',
          category: 'geometry',
          trackId: t.id,
          position: frame.toLngLat(g.primitives[k.index]!.end),
          message: `${label(t)} has a ${k.angleDeg.toFixed(1)}° kink without a curve. Set a radius at that point.`,
        },
        t,
      );
  }

  // --- Nodes -----------------------------------------------------------------
  const byId = new Map(net.tracks.map((t) => [t.id, t]));
  for (const node of net.nodes) {
    const ends = nodeEnds(net, node.id);
    const first = byId.get(ends[0]?.trackId ?? '');
    if (ends.length === 1 && node.kind !== 'buffer_stop')
      add(
        {
          severity: 'recommendation',
          category: 'connectivity',
          nodeId: node.id,
          trackId: first?.id,
          position: node.position,
          message: 'Open track end: connect it, or mark it as a buffer stop.',
        },
        first,
      );
    for (const m of node.movements) {
      const ha = outwardHeading(net, m.a);
      const hb = outwardHeading(net, m.b);
      if (ha === null || hb === null) continue;
      const kink = Math.PI - angleBetween(ha, hb);
      if (kink > (TANGENT_TOLERANCE_DEG * Math.PI) / 180)
        add(
          {
            severity: 'warning',
            category: 'geometry',
            nodeId: node.id,
            trackId: m.a.trackId,
            position: node.position,
            message: `Connection with a ${((kink * 180) / Math.PI).toFixed(1)}° kink: the tracks do not meet tangentially. Adjust the points or add a curve before the connection.`,
          },
          byId.get(m.a.trackId),
        );
    }
    if (ends.length >= 3)
      add(
        {
          severity: 'info',
          category: 'connectivity',
          nodeId: node.id,
          position: node.position,
          message: `${ends.length} track ends meet here; the turnout or crossing type is not specified yet (permitted movements: ${node.movements.length}).`,
        },
        first,
      );
    if (ends.length >= 2 && !node.movements.length)
      add(
        {
          severity: 'warning',
          category: 'connectivity',
          nodeId: node.id,
          position: node.position,
          message: 'Tracks meet here but no movement between them is permitted.',
        },
        first,
      );
  }

  // --- Crossings without a connection (same level) ------------------------------
  const metric = net.tracks.map((t) => ({
    t,
    pts: trackGeometry(net, t).coordinates.map((p) => frame.toMetres(p)),
  }));
  type Box = [number, number, number, number];
  const box = (pts: Vec[]): Box =>
    pts.reduce<Box>(
      (b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
  const boxes = metric.map((m) => box(m.pts));
  for (let i = 0; i < metric.length; i++)
    for (let j = i + 1; j < metric.length; j++) {
      const A = metric[i]!;
      const B = metric[j]!;
      if (A.t.level !== B.t.level) continue;
      if (A.t.groupId && A.t.groupId === B.t.groupId) continue;
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3]) continue;
      const shared = [A.t.fromNodeId, A.t.toNodeId].filter((x) => x === B.t.fromNodeId || x === B.t.toNodeId);
      const sharedPts = shared.map((id) => frame.toMetres(net.nodes.find((nd) => nd.id === id)!.position));
      let hit: Vec | null = null;
      for (let k = 1; k < A.pts.length && !hit; k++)
        for (let l = 1; l < B.pts.length && !hit; l++) {
          const x = segIntersect(A.pts[k - 1]!, A.pts[k]!, B.pts[l - 1]!, B.pts[l]!);
          if (x && !sharedPts.some((p) => Math.hypot(p[0] - x[0], p[1] - x[1]) < 1)) hit = x;
        }
      if (hit) {
        const position: LngLat = frame.toLngLat(hit);
        add(
          {
            severity: 'info',
            category: 'connectivity',
            trackId: A.t.id,
            position,
            message:
              'Two tracks cross on the same level (a level crossing). Trains cannot change track here; in the simulation one vehicle at a time uses the crossing, by priority. For a bridge or tunnel, put one track on another level.',
          },
          existing(A.t) && existing(B.t) ? A.t : undefined,
        );
      }
    }

  // --- Single track used in both directions ---------------------------------------
  const blocks = singleTrackBlocks(net);
  const reported = new Set<string>();
  for (const line of scenario.lines) {
    if (line.alignment.kind !== 'track' || line.direction !== 'bidirectional') continue;
    for (const s of line.alignment.path) {
      const b = blocks.get(s.trackId)?.blockId;
      if (!b || reported.has(b)) continue;
      reported.add(b);
      add({
        severity: 'info',
        category: 'operations',
        trackId: s.trackId,
        lineId: line.id,
        message: `Single track used in both directions by "${line.name}": trains wait for opposing trains to clear the section, which limits the frequency.`,
      });
    }
  }

  // --- Ramps between levels -----------------------------------------------------------
  for (const t of net.tracks) {
    const r = trackRamp(net, t);
    if (!r) continue;
    const where = `${label(t)} is a ramp from level ${r.fromLevel} to level ${r.toLevel}`;
    const limit = r.cited ? 'the cited maximum' : 'the placeholder maximum';
    if (!r.fits)
      add(
        {
          severity: r.cited ? 'error' : 'warning',
          category: 'grade',
          trackId: t.id,
          position: rampLabelPosition(net, t),
          message: `${where}: ${fmt(r.gradientPercent)} % over ${Math.round(r.lengthM)} m is steeper than ${limit} of ${fmt(r.maxGradientPercent)} %. It needs at least ${Math.round(r.requiredLengthM)} m for the ${Math.abs(r.riseM).toFixed(1)} m height difference: lengthen it or move a track end.`,
        },
        t,
      );
    // A platform must not stand on a ramp steeper than the station limit.
    const stations = scenario.stations.filter(
      (st) => st.trackRefs.some((ref) => ref.trackId === t.id) || st.layout?.trackIds.includes(t.id),
    );
    const maxStation = stationMaxGradient(net, t.designMode);
    for (const st of stations)
      if (r.gradientPercent > maxStation.percent + 1e-9)
        add(
          {
            severity: maxStation.cited ? 'error' : 'warning',
            category: 'grade',
            trackId: t.id,
            stationId: st.id,
            position: st.position,
            message: `Station "${st.name}" is on a ramp (${fmt(r.gradientPercent)} %); platform track may be at most ${fmt(maxStation.percent)} %${maxStation.cited ? ' (EBO § 7 (2))' : ' (placeholder)'}. Put the ramp outside the station.`,
          },
          t,
        );
  }
  return out;
}

const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(x < 1 ? 2 : 1) : '∞');
