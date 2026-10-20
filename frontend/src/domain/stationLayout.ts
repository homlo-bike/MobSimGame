/**
 * Rail station objects: a station owns straight platform tracks and its platforms
 * (side and island platforms), placed and rotated freely. Pure; geometry in the
 * project metric frame.
 *
 * Cross-section (left to right facing the station bearing): half of the side platforms
 * (rounded up) on the left, then the islands, then the other side platforms. Each track is
 * served by exactly one platform face, so a side platform adds one track and an island two:
 * one side = 1 track, two sides = 2, one island = 2, one side + one island = 3.
 *
 * Beyond the platforms each track bends (two curves of the mode's default radius) to the
 * normal track spacing, centred on the station, so a single or double track drawn to the
 * station ends connects directly.
 */
import type { LngLat, PhysicalTrack, Scenario, Station, TransportMode } from './schema';
import { MODES } from './modes';
import { afterTrackEdit } from './serviceRouting';
import {
  addDetachedTrack,
  defaultRadiusM,
  levelOfStructure,
  moveNode,
  networkFrame,
  removeTrack,
  setTrackPoints,
  trackGeometry,
  updateTrack,
} from './tracks';
import { parameterValue, platformLengthM, trackSpacingM } from './trackParameters';
import { deleteStation, uniqueStationName } from './network';
import { newId, nowIso } from '../util/id';

type Layout = NonNullable<Station['layout']>;

export const MAX_PLATFORMS = 8;

export function layoutError(side: number, island: number): string | null {
  if (!Number.isInteger(side) || !Number.isInteger(island) || side < 0 || island < 0)
    return 'Platform counts are whole numbers from 0';
  if (side > MAX_PLATFORMS || island > MAX_PLATFORMS) return `At most ${MAX_PLATFORMS} of each platform type`;
  if (side + island < 1) return 'A station needs at least one platform';
  return null;
}

export interface CrossElement {
  kind: 'track' | 'side' | 'island';
  /** Offset of the centre to the right of the station axis, metres. */
  offset: number;
  width: number;
}

/** Elements across the station, left to right, centred so the tracks are centred on the axis. */
export function crossSection(
  network: Scenario['trackNetwork'],
  mode: TransportMode,
  side: number,
  island: number,
): CrossElement[] {
  const s = trackSpacingM(network, mode);
  const wSide = parameterValue(network, 'sidePlatformWidthM');
  const wIsland = parameterValue(network, 'islandPlatformWidthM');
  const kinds: CrossElement['kind'][] = [];
  const left = Math.ceil(side / 2);
  for (let i = 0; i < left; i++) kinds.push('side', 'track');
  for (let i = 0; i < island; i++) kinds.push('track', 'island', 'track');
  for (let i = 0; i < side - left; i++) kinds.push('track', 'side');
  let x = 0;
  const out: CrossElement[] = kinds.map((kind) => {
    const width = kind === 'track' ? s : kind === 'side' ? wSide : wIsland;
    const e = { kind, offset: x + width / 2, width };
    x += width;
    return e;
  });
  const tracks = out.filter((e) => e.kind === 'track');
  const mid = tracks.reduce((a, e) => a + e.offset, 0) / tracks.length;
  return out.map((e) => ({ ...e, offset: e.offset - mid }));
}

const rad = (deg: number) => (deg * Math.PI) / 180;
/** Unit vector of a compass bearing in the metric frame (x east, y north). */
const dirOf = (bearingDeg: number): [number, number] => [
  Math.sin(rad(bearingDeg)),
  Math.cos(rad(bearingDeg)),
];

export interface StationGeometry {
  tracks: { points: LngLat[]; radii: (number | null)[] }[];
  platforms: { kind: 'side' | 'island'; ring: LngLat[] }[];
  /** Half the length of the whole station including the approach curves, metres. */
  halfLengthM: number;
  /** Ends of the station axis (for the rotation handle). */
  axis: [LngLat, LngLat];
}

/** Geometry of a station object from its position and layout. */
export function stationGeometry(
  network: Scenario['trackNetwork'],
  position: LngLat,
  layout: Pick<Layout, 'mode' | 'bearingDeg' | 'sidePlatforms' | 'islandPlatforms' | 'platformLengthM'>,
): StationGeometry {
  const frame = networkFrame(network, position);
  const c = frame.toMetres(position);
  const d = dirOf(layout.bearingDeg);
  const r: [number, number] = [d[1], -d[0]];
  const at = (along: number, off: number): LngLat =>
    frame.toLngLat([c[0] + d[0] * along + r[0] * off, c[1] + d[1] * along + r[1] * off]);
  const els = crossSection(network, layout.mode, layout.sidePlatforms, layout.islandPlatforms);
  const trackEls = els.filter((e) => e.kind === 'track');
  const n = trackEls.length;
  const s = trackSpacingM(network, layout.mode);
  const L = layout.platformLengthM ?? platformLengthM(network, layout.mode);
  const R = defaultRadiusM(layout.mode) ?? 100;
  const throat = trackEls.map((_, i) => (i - (n - 1) / 2) * s);
  const shift = Math.max(0, ...trackEls.map((e, i) => Math.abs(e.offset - throat[i]!)));
  // Approach length for a reverse curve of radius R and lateral shift d: about 3·√(R·d).
  const T = shift > 0.01 ? Math.max(10, 3 * Math.sqrt(R * shift)) : 0;
  const half = L / 2 + T;
  const tracks = trackEls.map((e, i) => {
    const o = e.offset;
    const t = throat[i]!;
    if (Math.abs(o - t) < 0.01) return { points: [at(-L / 2 - T, o), at(L / 2 + T, o)], radii: [null, null] };
    return {
      points: [
        at(-L / 2 - T, t),
        at(-L / 2 - (2 * T) / 3, t),
        at(-L / 2 - T / 3, o),
        at(L / 2 + T / 3, o),
        at(L / 2 + (2 * T) / 3, t),
        at(L / 2 + T, t),
      ],
      radii: [null, R, R, R, R, null],
    };
  });
  const platforms = els
    .filter((e): e is CrossElement & { kind: 'side' | 'island' } => e.kind !== 'track')
    .map((e) => {
      const a = e.offset - e.width / 2;
      const b = e.offset + e.width / 2;
      return {
        kind: e.kind,
        ring: [at(-L / 2, a), at(L / 2, a), at(L / 2, b), at(-L / 2, b), at(-L / 2, a)],
      };
    });
  return { tracks, platforms, halfLengthM: half, axis: [at(-half, 0), at(half, 0)] };
}

function structureFor(construction: Station['construction'], mode: TransportMode) {
  const structure =
    construction === 'underground'
      ? 'underground'
      : construction === 'elevated'
        ? 'elevated'
        : MODES[mode].defaultStructure;
  return { structure, level: levelOfStructure(structure) };
}

export interface PlaceStationInput {
  position: LngLat;
  mode: TransportMode;
  bearingDeg: number;
  sidePlatforms: number;
  islandPlatforms: number;
  name?: string;
  construction?: Station['construction'];
  platformLengthM?: number | null;
}

/** Place a new station object with its tracks. */
export function placeStation(
  scenario: Scenario,
  input: PlaceStationInput,
): { scenario: Scenario; station: Station | null; error: string | null } {
  const error = layoutError(input.sidePlatforms, input.islandPlatforms);
  if (error) return { scenario, station: null, error };
  const construction = input.construction ?? 'surface';
  const station: Station = {
    id: newId('st'),
    name: uniqueStationName(scenario, input.name ?? `Station ${scenario.stations.length + 1}`),
    nameSource: input.name ? 'user' : 'generated',
    nameSuggestion: null,
    position: [input.position[0], input.position[1]],
    construction,
    platformType:
      input.islandPlatforms && input.sidePlatforms ? 'separate' : input.islandPlatforms ? 'island' : 'side',
    busStopType: 'unknown',
    layout: {
      mode: input.mode,
      bearingDeg: normBearing(input.bearingDeg),
      sidePlatforms: input.sidePlatforms,
      islandPlatforms: input.islandPlatforms,
      platformLengthM: input.platformLengthM ?? null,
      trackIds: [],
    },
    verticalOffsetM: null,
    entrances: [],
    accessibility: { stepFree: null, elevators: null, tactilePaving: null },
    catchmentRadiusM: MODES[input.mode].defaultCatchmentRadiusM,
    trackRefs: [],
    metadata: {},
    notes: '',
    imageUrls: [],
  };
  const withStation = { ...scenario, stations: [...scenario.stations, station] };
  const sc = rebuildStation(withStation, station.id);
  return { scenario: sc, station: sc.stations.find((s) => s.id === station.id)!, error: null };
}

export const normBearing = (b: number) => ((b % 360) + 360) % 360;

/**
 * Make the station's tracks match its position and layout: add or remove tracks when the
 * platform counts changed, and move the rest. Track ends are nodes, so track the user connected
 * to the station follows. Services are routed again.
 */
function rebuildStation(scenario: Scenario, stationId: string): Scenario {
  const st = scenario.stations.find((s) => s.id === stationId);
  if (!st?.layout) return scenario;
  const layout = st.layout;
  const geom = stationGeometry(scenario.trackNetwork, st.position, layout);
  const { structure, level } = structureFor(st.construction, layout.mode);
  let sc = scenario;
  let ids = layout.trackIds.filter((id) => sc.trackNetwork.tracks.some((t) => t.id === id));
  for (const id of ids.slice(geom.tracks.length)) sc = removeTrack(sc, id);
  ids = ids.slice(0, geom.tracks.length);
  geom.tracks.forEach((g, i) => {
    const existing = ids[i] ? sc.trackNetwork.tracks.find((t) => t.id === ids[i]) : undefined;
    if (!existing) {
      const base: Omit<PhysicalTrack, 'id' | 'fromNodeId' | 'toNodeId' | 'points' | 'radii'> = {
        name: `${st.name} track ${i + 1}`,
        direction: 'both',
        structure,
        level,
        rightOfWay: 'dedicated_track',
        designMode: layout.mode,
        infrastructureClass: null,
        gaugeMm: null,
        electrification: 'unknown',
        speedLimitKmh: null,
        groupId: null,
        stationId: st.id,
        origin: { source: 'user', ref: null, edited: false },
        metadata: {},
        notes: '',
      };
      const res = addDetachedTrack(sc, g.points, g.radii, base);
      sc = res.scenario;
      ids[i] = res.trackId;
      return;
    }
    sc = moveNode(sc, existing.fromNodeId, g.points[0]!);
    sc = moveNode(sc, existing.toNodeId, g.points[g.points.length - 1]!);
    sc = setTrackPoints(sc, existing.id, g.points.slice(1, -1), g.radii.slice(1, -1));
    if (existing.structure !== structure || existing.level !== level || existing.designMode !== layout.mode)
      sc = updateTrack(sc, existing.id, { structure, level, designMode: layout.mode });
  });
  sc = {
    ...sc,
    updatedAt: nowIso(),
    stations: sc.stations.map((s) =>
      s.id === stationId
        ? {
            ...s,
            layout: { ...layout, trackIds: ids },
            trackRefs: ids.map((trackId) => ({ trackId, fraction: 0.5 })),
          }
        : s,
    ),
  };
  return afterTrackEdit(sc, ids);
}

export type StationLayoutPatch = Partial<
  Pick<Layout, 'bearingDeg' | 'sidePlatforms' | 'islandPlatforms' | 'platformLengthM'>
> & { position?: LngLat; construction?: Station['construction'] };

/** Move, rotate or change the platforms of a station object. */
export function updateStationLayout(
  scenario: Scenario,
  stationId: string,
  patch: StationLayoutPatch,
): { scenario: Scenario; error: string | null } {
  const st = scenario.stations.find((s) => s.id === stationId);
  if (!st?.layout) return { scenario, error: 'Not a station object' };
  const layout: Layout = {
    ...st.layout,
    ...(patch.bearingDeg !== undefined ? { bearingDeg: normBearing(patch.bearingDeg) } : {}),
    ...(patch.sidePlatforms !== undefined ? { sidePlatforms: patch.sidePlatforms } : {}),
    ...(patch.islandPlatforms !== undefined ? { islandPlatforms: patch.islandPlatforms } : {}),
    ...(patch.platformLengthM !== undefined ? { platformLengthM: patch.platformLengthM } : {}),
  };
  const error = layoutError(layout.sidePlatforms, layout.islandPlatforms);
  if (error) return { scenario, error };
  const next: Station = {
    ...st,
    position: patch.position ? [patch.position[0], patch.position[1]] : st.position,
    construction: patch.construction ?? st.construction,
    platformType:
      layout.islandPlatforms && layout.sidePlatforms
        ? 'separate'
        : layout.islandPlatforms
          ? 'island'
          : 'side',
    layout,
  };
  const sc = { ...scenario, stations: scenario.stations.map((s) => (s.id === stationId ? next : s)) };
  return { scenario: rebuildStation(sc, stationId), error: null };
}

/** Delete a station object with its tracks (services that called there lose the stop). */
export function deleteStationObject(scenario: Scenario, stationId: string): Scenario {
  const st = scenario.stations.find((s) => s.id === stationId);
  let sc = deleteStation(scenario, stationId);
  for (const id of st?.layout?.trackIds ?? []) sc = removeTrack(sc, id);
  return afterTrackEdit(sc, []);
}

/**
 * Snap a bearing to straight track within 100 m of the station (parallel), if within the
 * tolerance; the station's own tracks do not count.
 */
export function snapStationBearing(
  scenario: Scenario,
  stationId: string | null,
  position: LngLat,
  bearingDeg: number,
  toleranceDeg = 6,
): { bearingDeg: number; snapped: boolean } {
  const net = scenario.trackNetwork;
  const frame = networkFrame(net, position);
  const c = frame.toMetres(position);
  let best: { b: number; d: number } | null = null;
  for (const t of net.tracks) {
    if (stationId && t.stationId === stationId) continue;
    for (const p of trackGeometry(net, t).primitives) {
      if (p.kind !== 'line') continue;
      const dx = p.end[0] - p.start[0];
      const dy = p.end[1] - p.start[1];
      const len2 = dx * dx + dy * dy;
      if (len2 < 1) continue;
      const u = Math.max(0, Math.min(1, ((c[0] - p.start[0]) * dx + (c[1] - p.start[1]) * dy) / len2));
      if (Math.hypot(p.start[0] + u * dx - c[0], p.start[1] + u * dy - c[1]) > 100) continue;
      const lineBearing = normBearing((Math.atan2(dx, dy) * 180) / Math.PI);
      for (const b of [lineBearing, normBearing(lineBearing + 180)]) {
        const diff = Math.abs(((b - bearingDeg + 540) % 360) - 180);
        if (diff <= toleranceDeg && (!best || diff < best.d)) best = { b, d: diff };
      }
    }
  }
  return best
    ? { bearingDeg: best.b, snapped: true }
    : { bearingDeg: normBearing(bearingDeg), snapped: false };
}

/** Bearing of the nearest straight track within 100 m, if any (for a new station's default). */
export function nearbyTrackBearing(scenario: Scenario, position: LngLat): number | null {
  const res = snapStationBearing(scenario, null, position, 0, 90);
  return res.snapped ? res.bearingDeg : null;
}

/**
 * A drawn track that starts or ends inside a station object connects to the station's end
 * facing the rest of the drawing, not to the middle of its platform tracks: the end point is
 * moved to that end (the middle of its track ends for double track, else the nearest track end).
 */
export function snapDrawingToStations(scenario: Scenario, points: LngLat[], double: boolean): LngLat[] {
  if (points.length < 2) return points;
  const net = scenario.trackNetwork;
  const frame = networkFrame(net, points[0]!);
  const snapEnd = (p: LngLat, toward: LngLat): LngLat => {
    const q = frame.toMetres(p);
    const w = frame.toMetres(toward);
    for (const st of scenario.stations) {
      if (!st.layout) continue;
      const g = stationGeometry(net, st.position, st.layout);
      const c = frame.toMetres(st.position);
      const d = dirOf(st.layout.bearingDeg);
      const along = (q[0] - c[0]) * d[0] + (q[1] - c[1]) * d[1];
      const across = Math.abs(-(q[0] - c[0]) * d[1] + (q[1] - c[1]) * d[0]);
      const halfWidth =
        crossSection(net, st.layout.mode, st.layout.sidePlatforms, st.layout.islandPlatforms).reduce(
          (m, e) => Math.max(m, Math.abs(e.offset) + e.width / 2),
          0,
        ) + 2;
      // Only points well inside the station; a point at a station end already joins its nodes.
      if (Math.abs(along) > g.halfLengthM - 2 || across > halfWidth) continue;
      // The end facing where the drawing comes from.
      const towardAlong = (w[0] - c[0]) * d[0] + (w[1] - c[1]) * d[1];
      const sign = towardAlong >= along ? 1 : -1;
      const ends = st.layout.trackIds
        .map((id) => net.tracks.find((t) => t.id === id))
        .filter((t): t is PhysicalTrack => !!t)
        .map((t) => net.nodes.find((n) => n.id === (sign > 0 ? t.toNodeId : t.fromNodeId))!.position);
      if (!ends.length) continue;
      if (double && ends.length >= 2) {
        const m = ends.map((e) => frame.toMetres(e));
        const mid = m.reduce((a, v) => [a[0] + v[0] / m.length, a[1] + v[1] / m.length], [0, 0]);
        return frame.toLngLat([mid[0], mid[1]]);
      }
      return ends
        .map((e) => ({ e, dist: Math.hypot(frame.toMetres(e)[0] - q[0], frame.toMetres(e)[1] - q[1]) }))
        .sort((a, b) => a.dist - b.dist)[0]!.e;
    }
    return p;
  };
  const first = snapEnd(points[0]!, points[1]!);
  const last = snapEnd(points[points.length - 1]!, points[points.length - 2]!);
  return [first, ...points.slice(1, -1), last];
}
