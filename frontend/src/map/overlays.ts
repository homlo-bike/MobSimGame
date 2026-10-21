/** Pure builders for the GeoJSON shown in MapLibre layers (no map access). */
import { accessFacilities, accessIconId } from '../domain/stationAccess';
import type { FeatureCollection, Feature } from 'geojson';
import { circle } from '@turf/turf';
import type { LngLat, Scenario, TrackEndRef, TransportMode } from '../domain/schema';
import {
  isInterchange,
  isRing,
  linesServingStation,
  orderedStops,
  placedCrossovers,
} from '../domain/network';
import { distanceM, slicePath } from '../geo/geometry';
import { isGreen } from '../domain/signals';
import { interpolate, measurePath, type VehicleState } from '../simulation/engine';
import type { PopulationCell, TrafficSegment, TransitRoute } from '../providers/types';
import { networkFrame, nodeEnds, pointOnTrack, trackGeometry } from '../domain/tracks';
import { stationKind } from '../domain/stationKinds';
import { curveHandles } from '../domain/curveHandles';
import { stationGeometry, stationObjectLevel } from '../domain/stationLayout';

const levelText = (l: number) => (l > 0 ? `+${l}` : `−${-l}`);
import { MODE_PRIORITY, stationMode } from '../domain/modeSeparation';
import { modeRank } from '../simulation/conflicts';
import { pointOnSurface } from '@sakuzu/maplibre-gl-draw/geometry';
import type { Finding, Severity } from '../validation/validate';
import { SEVERITY_LABELS, SEVERITY_ORDER } from '../validation/validate';
import { findingPosition } from '../validation/locate';
import { stepsCoordinates, stepsSegments } from '../domain/serviceRouting';
import { wirePaths } from '../domain/overheadWire';
import { rampLabelPosition, ramps } from '../domain/ramps';

/**
 * Physical tracks, one feature each, oriented in their running direction so
 * arrows show it ('‹ ›' on track used both ways). Tracks are drawn at their true
 * position: double track is two features, never a pixel offset.
 */
export function tracksCollection(scenario: Scenario, selectedTrackId: string | null): FeatureCollection {
  const net = scenario.trackNetwork;
  const features: Feature[] = net.tracks.map((t) => {
    const coords = trackGeometry(net, t).coordinates;
    return {
      type: 'Feature',
      id: t.id,
      geometry: {
        type: 'LineString',
        coordinates: t.direction === 'backward' ? [...coords].reverse() : coords,
      },
      properties: {
        trackId: t.id,
        structure: t.structure,
        level: t.level,
        selected: t.id === selectedTrackId,
        double: !!t.groupId,
        existing: t.origin.source === 'osm' && !t.origin.edited,
        arrow: t.direction === 'both' ? '‹ ›' : '›',
        color: '#334155',
        // Arrows of the two tracks of a double track go to the outside (the running side).
        offsetSign: t.groupId || t.direction === 'both' ? (net.runningSide === 'right' ? 1 : -1) : 0,
      },
    };
  });
  return { type: 'FeatureCollection', features };
}

/** Visible regions with their style, for the fill, outline and label layers. */
export function regionsCollection(scenario: Scenario, selectedRegionId: string | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: scenario.regions
      .filter((r) => r.visible)
      .map((r) => ({
        type: 'Feature' as const,
        id: r.id,
        geometry: r.geometry,
        properties: {
          regionId: r.id,
          name: r.style.showLabel ? r.name : '',
          fill: r.style.fill,
          outline: r.style.outline,
          opacity: r.style.opacity,
          locked: r.locked,
          selected: r.id === selectedRegionId,
        },
      })),
  };
}

/** One label point inside each visible region that shows its name. */
export function regionLabelsCollection(scenario: Scenario): FeatureCollection {
  const features: Feature[] = [];
  for (const r of scenario.regions) {
    if (!r.visible || !r.style.showLabel) continue;
    let at: number[] | null = null;
    try {
      at = (pointOnSurface(r.geometry as never) as { coordinates?: number[] } | null)?.coordinates ?? null;
    } catch {
      at = null;
    }
    if (at)
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: at },
        properties: { name: r.name },
      });
  }
  return { type: 'FeatureCollection', features };
}

/** Track nodes: open ends, buffer stops, connections and junctions (3+ ends). */
export function trackNodesCollection(scenario: Scenario, selectedNodeId: string | null): FeatureCollection {
  const net = scenario.trackNetwork;
  return {
    type: 'FeatureCollection',
    features: net.nodes.map((n) => {
      const ends = nodeEnds(net, n.id).length;
      const kind =
        n.kind === 'buffer_stop' ? 'buffer_stop' : ends <= 1 ? 'end' : ends >= 3 ? 'junction' : 'connection';
      return {
        type: 'Feature' as const,
        id: n.id,
        geometry: { type: 'Point' as const, coordinates: n.position },
        properties: { nodeId: n.id, kind, ends, selected: n.id === selectedNodeId },
      };
    }),
  };
}

/**
 * Permitted movements through junctions (nodes where three or more track ends meet, or
 * with a turnout), drawn as a small diagram at the node: one arm per track end, pointing
 * to where that track is a few symbol sizes away (so tangential tracks still fan out),
 * and for each permitted movement a curve between the two arms through the node. Ways
 * through the junction without a curve are not allowed.
 */
export function junctionMovesCollection(scenario: Scenario, reachM: number): FeatureCollection {
  const net = scenario.trackNetwork;
  const frame = networkFrame(net);
  const byId = new Map(net.tracks.map((t) => [t.id, t]));
  const features: Feature[] = [];
  for (const n of net.nodes) {
    if (nodeEnds(net, n.id).length < 3 && !n.turnout) continue;
    const c = frame.toMetres(n.position);
    const arm = (e: TrackEndRef): [number, number] | null => {
      const t = byId.get(e.trackId);
      if (!t) return null;
      const len = trackGeometry(net, t).lengthM;
      if (len <= 0) return null;
      const s = Math.min(4 * reachM, len / 2);
      const p = pointOnTrack(net, t, e.end === 'start' ? s / len : 1 - s / len).metres;
      const dx = p[0] - c[0];
      const dy = p[1] - c[1];
      const d = Math.hypot(dx, dy);
      return d > 0 ? [c[0] + (dx / d) * reachM, c[1] + (dy / d) * reachM] : null;
    };
    n.movements.forEach((m, i) => {
      const a = arm(m.a);
      const b = arm(m.b);
      if (!a || !b) return;
      // Quadratic curve with the node as control point.
      const pts = Array.from({ length: 9 }, (_, k) => {
        const u = k / 8;
        const w0 = (1 - u) * (1 - u);
        const w1 = 2 * u * (1 - u);
        const w2 = u * u;
        return frame.toLngLat([w0 * a[0] + w1 * c[0] + w2 * b[0], w0 * a[1] + w1 * c[1] + w2 * b[1]]);
      });
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: pts },
        properties: { nodeId: n.id, movement: i },
      });
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * One feature per track and segment. A double-track segment becomes two
 * features: each runs in its direction of travel (the return track's
 * coordinates are reversed) and is drawn offset to the running side, so arrows
 * along the line show the direction of each track. `offsetSign` is +1 for an
 * offset to the right of the feature's own direction.
 */
export function segmentsCollection(scenario: Scenario, selectedLineId: string | null): FeatureCollection {
  const features: Feature[] = [];
  for (const line of scenario.lines) {
    if (line.alignment.kind === 'track') {
      features.push(...trackServiceFeatures(scenario, line, line.id === selectedLineId));
      continue;
    }
    const guidedOrRoad = !['cycling', 'pedestrian'].includes(line.mode);
    // A bus return that uses other streets (one-way streets) is drawn as its own path.
    const ownReturn =
      line.alignment.kind === 'routed' && line.direction === 'bidirectional'
        ? line.alignment.returnCoordinates
        : null;
    if (ownReturn && ownReturn.length >= 2) {
      const seg = line.segments[0]!;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: ownReturn },
        properties: {
          lineId: line.id,
          segmentId: seg.id,
          color: line.color,
          structure: seg.structure,
          tracks: seg.tracks,
          selected: line.id === selectedLineId,
          track: 'return',
          offsetSign: line.runningSide === 'right' ? 1 : -1,
          arrow: '›',
        },
      });
    }
    for (const seg of line.segments) {
      const coords = slicePath(line.coordinates, isRing(line), seg.fromFraction, seg.toFraction);
      if (coords.length < 2) continue;
      const base = {
        lineId: line.id,
        segmentId: seg.id,
        color: line.color,
        structure: seg.structure,
        tracks: seg.tracks,
        selected: line.id === selectedLineId,
      };
      const sideSign = (line.runningSide === 'right' ? 1 : -1) * (seg.flipped ? -1 : 1);
      if (ownReturn && ownReturn.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { ...base, track: 'forward', offsetSign: sideSign, arrow: '›' },
        });
      } else if (seg.tracks === 'double' && line.direction === 'bidirectional' && guidedOrRoad) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { ...base, track: 'forward', offsetSign: sideSign, arrow: '›' },
        });
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [...coords].reverse() },
          properties: { ...base, track: 'return', offsetSign: sideSign, arrow: '›' },
        });
      } else {
        const oneWay = line.direction === 'one_way';
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: {
            ...base,
            track: 'single',
            offsetSign: 0,
            // Single track used both ways shows both directions; active modes show no arrows.
            arrow: !guidedOrRoad ? '' : oneWay ? '›' : '‹ ›',
          },
        });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

/** A service on tracks drawn exactly over the tracks it uses, out and back. */
function trackServiceFeatures(
  scenario: Scenario,
  line: Scenario['lines'][number],
  selected: boolean,
): Feature[] {
  if (line.alignment.kind !== 'track') return [];
  const out: Feature[] = [];
  const paths = [
    { steps: line.alignment.path, track: 'forward' },
    { steps: line.alignment.returnPath ?? [], track: 'return' },
  ];
  for (const { steps, track } of paths) {
    if (!steps.length) continue;
    const coords = stepsCoordinates(scenario, steps);
    const segs = track === 'forward' ? line.segments : stepsSegments(scenario, line.id, steps);
    for (const seg of segs) {
      const part = slicePath(coords, false, seg.fromFraction, seg.toFraction);
      if (part.length < 2) continue;
      out.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: part },
        properties: {
          lineId: line.id,
          segmentId: seg.id,
          color: line.color,
          structure: seg.structure,
          tracks: 'single',
          selected,
          // A colour band under the physical track line.
          track: 'band',
          offsetSign: 0,
          arrow: '',
        },
      });
    }
  }
  // A track service that is not routed is not drawn as a service: a straight line between its stops
  // would look like trains jumping between tracks. routeStatusCollection marks it instead.
  if (!out.length && line.coordinates.length >= 2 && line.alignment.kind !== 'track')
    // Not routed yet: a thin sketch between the stops.
    out.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: line.coordinates },
      properties: {
        lineId: line.id,
        segmentId: line.segments[0]?.id ?? '',
        color: line.color,
        structure: 'at_grade',
        tracks: 'single',
        selected,
        track: 'single',
        offsetSign: 0,
        arrow: '',
        unrouted: true,
      },
    });
  return out;
}

/**
 * Street-routed sections that do not follow streets: unrouted (incomplete) or
 * accepted manual sketches. Drawn over the line so a straight bus line is
 * visibly "not routed yet" rather than looking like a finished route.
 */
export function routeStatusCollection(scenario: Scenario): FeatureCollection {
  const features: Feature[] = [];
  for (const line of scenario.lines) {
    if (line.alignment.kind === 'track' && line.alignment.status === 'unrouted') {
      // Red dashed "not routed" links between consecutive stops: there is no track path.
      const pos = line.stops
        .map((s) => scenario.stations.find((x) => x.id === s.stationId)?.position)
        .filter((p): p is [number, number] => !!p);
      for (let i = 1; i < pos.length; i++)
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [pos[i - 1]!, pos[i]!] },
          properties: { lineId: line.id, status: 'unrouted' },
        });
      continue;
    }
    if (line.alignment.kind !== 'routed') continue;
    for (const leg of line.alignment.legs) {
      if (leg.status === 'routed' || leg.geometry.length < 2) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: leg.geometry },
        properties: { lineId: line.id, status: leg.status },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Sections closed in the disruption simulation. */
export function closuresCollection(
  scenario: Scenario,
  closures: readonly { lineId: string; fromStationId: string; toStationId: string }[],
): FeatureCollection {
  const features: Feature[] = [];
  for (const c of closures) {
    const line = scenario.lines.find((l) => l.id === c.lineId);
    if (!line) continue;
    const stops = orderedStops(line, scenario.stations);
    const a = stops.find((s) => s.station.id === c.fromStationId)?.fraction;
    const b = stops.find((s) => s.station.id === c.toStationId)?.fraction;
    if (a === undefined || b === undefined) continue;
    const coords = slicePath(line.coordinates, isRing(line), Math.min(a, b), Math.max(a, b));
    if (coords.length >= 2)
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { lineId: line.id },
      });
  }
  return { type: 'FeatureCollection', features };
}

/** Default distance between direction arrows when no zoom-dependent spacing is given. */
export const ARROW_SPACING_M = 150;

export interface ArrowOptions {
  /** Distance between arrows along each feature, metres (the map derives it from the zoom). */
  spacingM?: number;
  /** Points that arrows must keep clear of (stations, validation markers). */
  avoid?: readonly LngLat[];
  /** Clearance around `avoid` points, metres. */
  avoidM?: number;
  /**
   * Only one arrow (or pair) this far from each end of a feature instead of along its whole
   * length: tracks show their running direction where they meet nodes.
   */
  atEndsM?: number;
}

/**
 * Direction-of-travel arrows: points along each feature with the bearing of
 * travel. `offsetSign` places an arrow beside its track (+1 = right of travel), so
 * arrows of two tracks, or of the two directions of a single track, never sit
 * on top of each other. A feature drawn in both directions ('‹ ›') gets one
 * arrow per direction, each on its own right-hand side.
 */
export function arrowsCollection(segments: FeatureCollection, options: ArrowOptions = {}): FeatureCollection {
  const spacing = Math.max(1, options.spacingM ?? ARROW_SPACING_M);
  const avoid = options.avoid ?? [];
  const clear = options.avoidM ?? 0;
  const features: Feature[] = [];
  for (const f of segments.features) {
    if (f.geometry.type !== 'LineString') continue;
    const p = f.properties ?? {};
    if (!p.arrow) continue;
    const path = measurePath(f.geometry.coordinates as LngLat[], false);
    const both = p.arrow === '‹ ›';
    // Both directions on one line: each arrow sits on the right of its own travel direction.
    const side = both ? p.offsetSign || 1 : (p.offsetSign ?? 0);
    const ends =
      options.atEndsM === undefined
        ? null
        : path.lengthM > 4 * options.atEndsM
          ? [options.atEndsM, path.lengthM - options.atEndsM]
          : [path.lengthM / 2];
    const at =
      ends ??
      Array.from(
        { length: Math.ceil((path.lengthM - spacing / 2) / spacing) },
        (_, k) => spacing / 2 + k * spacing,
      );
    for (const d of at) {
      if (d < 0 || d >= path.lengthM) continue;
      const here = interpolate(path, d).position;
      if (clear > 0 && avoid.some((a) => distanceM(a, here) < clear)) continue;
      const ahead = interpolate(path, Math.min(path.lengthM, d + 2)).position;
      const bearing = bearingDeg(here, ahead);
      const props = {
        color: p.color,
        offsetSign: side,
        lineId: p.lineId ?? null,
        trackId: p.trackId ?? null,
      };
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: here },
        properties: { ...props, bearing },
      });
      if (both)
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: here },
          properties: { ...props, bearing: (bearing + 180) % 360 },
        });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Metres per screen pixel at a zoom and latitude (MapLibre's 512-pixel world). */
export function metresPerPixel(zoom: number, latitude: number): number {
  return (40075016.686 * Math.cos((latitude * Math.PI) / 180)) / (512 * 2 ** zoom);
}

function bearingDeg(a: LngLat, b: LngLat): number {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return ((Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
}

/** Traffic signals with their simulated state at time tS (green/red). */
export function signalsCollection(
  scenario: Scenario,
  tS: number,
  selectedId: string | null,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: scenario.trafficSignals.map((s) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: s.position },
      properties: { signalId: s.id, state: isGreen(s, tS) ? 'green' : 'red', selected: s.id === selectedId },
    })),
  };
}

export function crossoversCollection(scenario: Scenario): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: scenario.lines.flatMap((line) =>
      placedCrossovers(line, scenario.stations).map((c) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: c.position },
        properties: { lineId: line.id, crossoverId: c.id, color: line.color },
      })),
    ),
  };
}

export function stationsCollection(scenario: Scenario, selectedStationId: string | null): FeatureCollection {
  const labels = stackedLabels(scenario);
  return {
    type: 'FeatureCollection',
    features: scenario.stations.map((s) => {
      const lines = linesServingStation(scenario, s.id);
      return {
        type: 'Feature',
        id: s.id,
        geometry: { type: 'Point', coordinates: s.position },
        properties: {
          stationId: s.id,
          name: s.name,
          // Stations on top of each other on different levels share one label, top level first.
          label: labels.get(s.id) ?? s.name,
          level: s.layout ? stationObjectLevel(scenario, s) : 0,
          // Elevator / escalator / ramp pictograms after the name (none on a hidden stacked label).
          accessIcon: labels.get(s.id) === '' ? null : accessIconId(accessFacilities(s.accessibility)),
          interchange: isInterchange(scenario, s.id),
          color: lines[0]?.color ?? '#475569',
          lineCount: lines.length,
          kind: stationKind(scenario, s),
          selected: s.id === selectedStationId,
        },
      };
    }),
  };
}

/**
 * Label of each station; stations standing on top of each other (within 5 m, on different
 * levels) get one label listing them from the highest level down, on the topmost station.
 */
function stackedLabels(scenario: Scenario): Map<string, string> {
  const out = new Map<string, string>();
  const done = new Set<string>();
  const level = (o: Scenario['stations'][number]) => (o.layout ? stationObjectLevel(scenario, o) : 0);
  const named = (o: Scenario['stations'][number]) =>
    level(o) === 0 ? o.name : `${o.name} (${levelText(level(o))})`;
  for (const s of scenario.stations) {
    if (done.has(s.id)) continue;
    const stack = scenario.stations.filter((o) => !done.has(o.id) && distanceM(o.position, s.position) <= 5);
    for (const o of stack) done.add(o.id);
    stack.sort((a, b) => level(b) - level(a));
    out.set(stack[0]!.id, stack.map(named).join('\n'));
    for (const o of stack.slice(1)) out.set(o.id, '');
  }
  return out;
}

export function catchmentsCollection(scenario: Scenario): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: scenario.stations.map((s) =>
      circle(s.position, s.catchmentRadiusM / 1000, {
        steps: 48,
        units: 'kilometers',
        properties: { stationId: s.id },
      }),
    ),
  };
}

export function vehiclesCollection(vehicles: readonly VehicleState[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: vehicles.map((v) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: v.position },
      properties: { id: v.id, color: v.color, state: v.state, bearing: v.bearingDeg, heightM: v.heightM },
    })),
  };
}

/** Vehicles drawn to scale: one polygon per unit of each consist. */
export function vehicleBodiesCollection(vehicles: readonly VehicleState[]): FeatureCollection {
  const features: Feature[] = [];
  for (const v of vehicles)
    v.footprint.forEach((ring, k) =>
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { id: v.id, unit: k, color: v.color, state: v.state, lead: k === 0, heightM: v.heightM },
      }),
    );
  return { type: 'FeatureCollection', features };
}

export function populationCollection(cells: readonly PopulationCell[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: cells.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [c.polygon] },
      properties: { density: c.density?.central ?? 0, status: c.status },
    })),
  };
}

export function trafficCollection(segments: readonly TrafficSegment[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: segments.map((s) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: s.coordinates },
      properties: { speedRatio: s.speedRatio, temporalType: s.temporalType },
    })),
  };
}

export function transitCollection(routes: readonly TransitRoute[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: routes.map((r) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: r.coordinates },
      properties: { name: r.name, mode: r.mode },
    })),
  };
}

/**
 * Validation markers: one point per finding at its position (or its object's), with
 * its severity for the marker shape. Hidden categories are left out.
 */
export function findingsCollection(
  findings: readonly Finding[],
  scenario: Scenario,
  visible: Record<Severity, boolean>,
  focusedId: string | null,
): FeatureCollection {
  const features: Feature[] = [];
  for (const f of findings) {
    if (!visible[f.severity]) continue;
    const position = findingPosition(f, scenario);
    if (!position) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: position },
      properties: {
        findingId: f.id,
        severity: f.severity,
        rank: SEVERITY_ORDER.length - SEVERITY_ORDER.indexOf(f.severity),
        focused: f.id === focusedId,
        label: `${SEVERITY_LABELS[f.severity]}: ${f.message}`,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Curve labels ("C1 · R 250 m") at the middle of each curve of the selected track. */
export function curveLabelsCollection(scenario: Scenario, selectedTrackId: string | null): FeatureCollection {
  const net = scenario.trackNetwork;
  const t = selectedTrackId ? net.tracks.find((x) => x.id === selectedTrackId) : undefined;
  if (!t) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: curveHandles(net, t).map((h) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: h.position },
      properties: {
        trackId: t.id,
        index: h.index,
        label: `C${h.number} · ${h.usedM ? `R ${Math.round(h.usedM)} m` : 'sharp corner'}`,
        reduced: h.usedM !== null && h.requestedM !== null && Math.abs(h.usedM - h.requestedM) > 0.5,
      },
    })),
  };
}

/** Platforms of every station object, as polygons. */
export function platformsCollection(scenario: Scenario, selectedStationId: string | null): FeatureCollection {
  const features: Feature[] = [];
  for (const st of scenario.stations) {
    if (!st.layout) continue;
    for (const p of stationGeometry(scenario.trackNetwork, st.position, st.layout).platforms)
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [p.ring] },
        properties: { stationId: st.id, kind: p.kind, selected: st.id === selectedStationId },
      });
  }
  return { type: 'FeatureCollection', features };
}

/** Rotation handles at both ends of the selected station object's axis. */
export function stationHandlesCollection(
  scenario: Scenario,
  selectedStationId: string | null,
): FeatureCollection {
  const st = selectedStationId ? scenario.stations.find((s) => s.id === selectedStationId) : undefined;
  if (!st?.layout) return { type: 'FeatureCollection', features: [] };
  const g = stationGeometry(scenario.trackNetwork, st.position, st.layout);
  return {
    type: 'FeatureCollection',
    features: g.axis.map((p, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: p },
      properties: { stationId: st.id, end: i },
    })),
  };
}

/**
 * Mark features of other modes (`dim: true`) so they are drawn faded: the active tab's mode
 * is edited, the others are shown for context only.
 */
export function dimOtherModes(
  fc: FeatureCollection,
  scenario: Scenario,
  mode: TransportMode,
): FeatureCollection {
  const trackMode = new Map(scenario.trackNetwork.tracks.map((t) => [t.id, t.designMode]));
  const lineMode = new Map(scenario.lines.map((l) => [l.id, l.mode]));
  const stationModes = new Map(scenario.stations.map((s) => [s.id, stationMode(scenario, s)]));
  const nodeMode = new Map<string, TransportMode>();
  for (const t of scenario.trackNetwork.tracks) {
    nodeMode.set(t.fromNodeId, t.designMode);
    nodeMode.set(t.toNodeId, t.designMode);
  }
  return {
    ...fc,
    features: fc.features.map((f) => {
      const p = f.properties ?? {};
      const m =
        (p.trackId && trackMode.get(String(p.trackId))) ||
        (p.lineId && lineMode.get(String(p.lineId))) ||
        (p.stationId && stationModes.get(String(p.stationId))) ||
        (p.nodeId && nodeMode.get(String(p.nodeId))) ||
        null;
      return { ...f, properties: { ...p, dim: m !== null && m !== mode } };
    }),
  };
}

/** Crossings between lines, with which line has priority there. */
export function conflictsCollection(
  scenario: Scenario,
  conflicts: { crossings: { id: string; position: LngLat; lineIds: [string, string] }[] },
): FeatureCollection {
  const byId = new Map(scenario.lines.map((l) => [l.id, l]));
  const order = scenario.modePriority ?? MODE_PRIORITY;
  return {
    type: 'FeatureCollection',
    features: conflicts.crossings.map((c) => {
      const a = byId.get(c.lineIds[0]);
      const b = byId.get(c.lineIds[1]);
      const ra = a ? modeRank(order, a.mode) : 0;
      const rb = b ? modeRank(order, b.mode) : 0;
      const priority =
        ra === rb ? 'first to arrive goes first' : `${(ra < rb ? a : b)?.name ?? ''} has priority`;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: c.position },
        properties: { conflictId: c.id, label: `${a?.name ?? ''} × ${b?.name ?? ''}: ${priority}` },
      };
    }),
  };
}

/** Walking links between stations as dotted lines. */
export function walkingLinksCollection(scenario: Scenario): FeatureCollection {
  const pos = new Map(scenario.stations.map((s) => [s.id, s.position]));
  const features: Feature[] = [];
  for (const l of scenario.interchanges) {
    const pts = l.stationIds.map((id) => pos.get(id)).filter((p): p is LngLat => !!p);
    if (pts.length >= 2)
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: pts },
        properties: { linkId: l.id },
      });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Preview of a bus, BRT or trolleybus line being drawn stop by stop: numbered stops,
 * the order they are served in, and the way back to the first stop (dashed).
 */
export function stopDraftCollection(points: readonly LngLat[]): FeatureCollection {
  const features: Feature[] = points.map((p, i) => ({
    type: 'Feature',
    properties: { kind: 'stop', label: String(i + 1) },
    geometry: { type: 'Point', coordinates: [p[0], p[1]] },
  }));
  if (points.length >= 2)
    features.push({
      type: 'Feature',
      properties: { kind: 'path', closing: false },
      geometry: { type: 'LineString', coordinates: points.map((p) => [p[0], p[1]]) },
    });
  if (points.length >= 2)
    features.push({
      type: 'Feature',
      properties: { kind: 'path', closing: true },
      geometry: {
        type: 'LineString',
        coordinates: [points[points.length - 1]!, points[0]!].map((p) => [p[0], p[1]]),
      },
    });
  return { type: 'FeatureCollection', features };
}

/** Overhead wire of trolleybus lines (shown wherever a trolleybus line runs). */
export function wiresCollection(scenario: Scenario): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: wirePaths(scenario).map((w) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: w.coordinates },
      properties: { lineId: w.lineId },
    })),
  };
}

/** Ramps between levels: a label in the middle (levels, gradient, length) and the portal at street level. */
export function rampsCollection(scenario: Scenario): FeatureCollection {
  const net = scenario.trackNetwork;
  const features: Feature[] = [];
  for (const r of ramps(scenario)) {
    const t = net.tracks.find((x) => x.id === r.trackId)!;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: rampLabelPosition(net, t) },
      properties: {
        kind: 'label',
        trackId: t.id,
        fits: r.fits,
        label: `${r.fits ? '' : '⚠ '}Ramp ${r.fromLevel} → ${r.toLevel} · ${r.gradientPercent.toFixed(1)} % · ${Math.round(r.lengthM)} m`,
      },
    });
    if (r.portal)
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: r.portal },
        properties: {
          kind: 'portal',
          trackId: t.id,
          label: r.fromLevel < 0 || r.toLevel < 0 ? 'Portal' : 'Ramp start',
        },
      });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * (+) markers on every platform track of the stations a new rail service may call at
 * (R14a), each at the platform's point on its own track, so parallel platforms move apart
 * as the map zooms in and the marker is clicked where it is drawn. A marker already
 * picked shows its stop number instead.
 */
export function platformPicksCollection(
  scenario: Scenario,
  stationIds: readonly string[],
  draft: readonly { stationId: string; trackId: string | null }[],
): FeatureCollection {
  const net = scenario.trackNetwork;
  const allowed = new Set(stationIds);
  const features: Feature[] = [];
  for (const st of scenario.stations) {
    if (!allowed.has(st.id)) continue;
    for (const ref of st.trackRefs) {
      const track = net.tracks.find((t) => t.id === ref.trackId);
      if (!track) continue;
      const p = pointOnTrack(net, track, ref.fraction);
      const picks = draft.flatMap((d, i) =>
        d.stationId === st.id && d.trackId === ref.trackId ? [i + 1] : [],
      );
      features.push({
        type: 'Feature',
        properties: {
          stationId: st.id,
          trackId: ref.trackId,
          picked: picks.length > 0,
          label: picks.join(','),
        },
        geometry: { type: 'Point', coordinates: [p.position[0], p.position[1]] },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Add a platform to a service draft, or take it out when it is already in it (toggle). */
export function togglePlatformStop<T extends { stationId: string; trackId: string | null }>(
  draft: readonly T[],
  stop: T,
): { draft: T[]; removed: boolean } {
  const same = (d: T) => d.stationId === stop.stationId && d.trackId === stop.trackId;
  if (draft.some(same)) return { draft: draft.filter((d) => !same(d)), removed: true };
  return { draft: [...draft, stop], removed: false };
}
