/**
 * Physical track network: pure operations on `scenario.trackNetwork`.
 *
 * A track is one physical track between two nodes. Its editable geometry is a
 * PI polygon with radii (interior points stored as [lng, lat]); lines and arcs
 * are derived in the project metric frame, which is fixed by the network's
 * `frameOrigin`. Tracks connect only through nodes, and only along permitted
 * movements (`node.movements`), so a geometric crossing is never a connection.
 */
import type {
  LngLat,
  Movement,
  PhysicalTrack,
  Scenario,
  StructureType,
  TrackDirection,
  TrackEndRef,
  TrackGroup,
  TrackNetwork,
  TrackNode,
  TransportMode,
} from './schema';
import { createFrame, type MetricFrame, type Vec } from '../geo/track/projection';
import {
  buildPrimitives,
  parallel,
  splitAlignment,
  type BuiltAlignment,
  type PiAlignment,
} from '../geo/track/alignment';
import {
  headingAt,
  nearest,
  pointAt,
  sample,
  totalLength,
  length as primitiveLength,
  type Primitive,
} from '../geo/track/primitives';
import { CURVE_RADIUS_RULES } from './modeProfiles';
import { MODES } from './modes';
import { parameterValue, trackSpacingM } from './trackParameters';
import { newId, nowIso } from '../util/id';

const touch = (s: Scenario): Scenario => ({ ...s, updatedAt: nowIso() });

export const RAIL_MODES: TransportMode[] = ['tram', 'light_rail', 'metro', 'elevated_metro', 'commuter_rail'];
export const isRailMode = (mode: TransportMode) => RAIL_MODES.includes(mode);

/** Default radius for a new curve: the cited recommended minimum of the mode, else its minimum. */
export function defaultRadiusM(mode: TransportMode): number | null {
  const rule = CURVE_RADIUS_RULES[mode];
  return rule ? (rule.recommendedM ?? rule.minimumM) : null;
}

export function levelOfStructure(structure: StructureType): number {
  if (structure === 'underground' || structure === 'tunnel' || structure === 'cut_and_cover') return -1;
  if (structure === 'elevated' || structure === 'bridge') return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Frame and derived geometry
// ---------------------------------------------------------------------------

const frames = new Map<string, MetricFrame>();

/** The project metric frame (falls back to the given point when the network has no origin yet). */
export function networkFrame(net: Pick<TrackNetwork, 'frameOrigin'>, fallback: LngLat = [0, 0]): MetricFrame {
  const o = net.frameOrigin ?? fallback;
  const key = `${o[0]},${o[1]}`;
  let f = frames.get(key);
  if (!f) {
    if (frames.size > 50) frames.clear();
    f = createFrame(o);
    frames.set(key, f);
  }
  return f;
}

export interface TrackGeometry {
  alignment: PiAlignment;
  built: BuiltAlignment;
  primitives: Primitive[];
  lengthM: number;
  /** Display samples, [lng, lat] (derived; never the source of truth). */
  coordinates: LngLat[];
}

const geometryCache = new WeakMap<PhysicalTrack, { key: string; geometry: TrackGeometry }>();

export function nodeMap(net: TrackNetwork): Map<string, TrackNode> {
  return new Map(net.nodes.map((n) => [n.id, n]));
}

export function trackGeometry(net: TrackNetwork, track: PhysicalTrack): TrackGeometry {
  const from = net.nodes.find((n) => n.id === track.fromNodeId);
  const to = net.nodes.find((n) => n.id === track.toNodeId);
  const a = from?.position ?? track.points[0] ?? [0, 0];
  const b = to?.position ?? track.points[track.points.length - 1] ?? a;
  const key = `${a.join()}|${b.join()}|${net.frameOrigin?.join() ?? ''}`;
  const cached = geometryCache.get(track);
  if (cached && cached.key === key) return cached.geometry;
  const frame = networkFrame(net, a);
  const alignment: PiAlignment = {
    points: [a, ...track.points, b].map((p) => frame.toMetres(p)),
    radii: [null, ...track.radii, null],
  };
  const built = buildPrimitives(alignment);
  const coordinates = sample(built.primitives, 5).map((v) => frame.toLngLat(v));
  const geometry: TrackGeometry = {
    alignment,
    built,
    primitives: built.primitives,
    lengthM: totalLength(built.primitives),
    coordinates: coordinates.length >= 2 ? coordinates : [a, b],
  };
  geometryCache.set(track, { key, geometry });
  return geometry;
}

/** Position and heading (radians, metric frame, in from → to direction) at a fraction of a track. */
export function pointOnTrack(
  net: TrackNetwork,
  track: PhysicalTrack,
  fraction: number,
): { position: LngLat; metres: Vec; heading: number } {
  const g = trackGeometry(net, track);
  let s = Math.min(1, Math.max(0, fraction)) * g.lengthM;
  const frame = networkFrame(net);
  for (const p of g.primitives) {
    const len = primitiveLength(p);
    if (s <= len || p === g.primitives[g.primitives.length - 1]) {
      const at = pointAt(p, s);
      return { position: frame.toLngLat(at.point), metres: at.point, heading: at.heading };
    }
    s -= len;
  }
  const n = net.nodes.find((x) => x.id === track.fromNodeId)!;
  return { position: n.position, metres: frame.toMetres(n.position), heading: 0 };
}

export interface TrackHit {
  track: PhysicalTrack;
  fraction: number;
  distanceM: number;
  /** Signed lateral offset, positive to the left of the from → to direction. */
  offsetM: number;
}

export function nearestOnTrack(net: TrackNetwork, track: PhysicalTrack, p: LngLat): TrackHit {
  const g = trackGeometry(net, track);
  const q = networkFrame(net).toMetres(p);
  let best: TrackHit = { track, fraction: 0, distanceM: Infinity, offsetM: 0 };
  let before = 0;
  for (const prim of g.primitives) {
    const n = nearest(prim, q);
    const d = Math.hypot(n.point[0] - q[0], n.point[1] - q[1]);
    if (d < best.distanceM)
      best = {
        track,
        fraction: g.lengthM > 0 ? Math.min(1, Math.max(0, (before + n.along) / g.lengthM)) : 0,
        distanceM: d,
        offsetM: n.offset,
      };
    before += primitiveLength(prim);
  }
  return best;
}

/** Tracks within `maxDistanceM` of a point (projected distance), nearest first; optionally one level only. */
export function tracksNear(net: TrackNetwork, p: LngLat, maxDistanceM: number, level?: number): TrackHit[] {
  if (!net.tracks.length) return [];
  return net.tracks
    .filter((t) => level === undefined || t.level === level)
    .map((t) => nearestOnTrack(net, t, p))
    .filter((h) => h.distanceM <= maxDistanceM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

// ---------------------------------------------------------------------------
// Ends and movements
// ---------------------------------------------------------------------------

export function nodeEnds(net: TrackNetwork, nodeId: string): TrackEndRef[] {
  const out: TrackEndRef[] = [];
  for (const t of net.tracks) {
    if (t.fromNodeId === nodeId) out.push({ trackId: t.id, end: 'start' });
    if (t.toNodeId === nodeId) out.push({ trackId: t.id, end: 'end' });
  }
  return out;
}

/** Heading (radians) pointing from the node into the track at the given end. */
export function outwardHeading(net: TrackNetwork, ref: TrackEndRef): number | null {
  const t = net.tracks.find((x) => x.id === ref.trackId);
  if (!t) return null;
  const g = trackGeometry(net, t);
  if (!g.primitives.length) return null;
  if (ref.end === 'start') return headingAt(g.primitives[0]!, 'start');
  return headingAt(g.primitives[g.primitives.length - 1]!, 'end') + Math.PI;
}

/** Angle between two outward headings, 0..π (π = straight through). */
export function angleBetween(h1: number, h2: number): number {
  // Wrapped absolute difference of the two headings.
  return Math.abs(((((h1 - h2) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
}

export const sameEnd = (a: TrackEndRef, b: TrackEndRef) => a.trackId === b.trackId && a.end === b.end;
export const movementHas = (m: Movement, a: TrackEndRef, b: TrackEndRef) =>
  (sameEnd(m.a, a) && sameEnd(m.b, b)) || (sameEnd(m.a, b) && sameEnd(m.b, a));

/**
 * Movements that follow the geometry: a train may pass from one end to another
 * when it does not have to reverse, i.e. the two tracks leave the node in
 * directions more than 90° apart. This is a geometric rule, not a design limit;
 * sharp angles are reported by validation.
 */
export function autoMovements(net: TrackNetwork, nodeId: string): Movement[] {
  const ends = nodeEnds(net, nodeId);
  const out: Movement[] = [];
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i]!;
      const b = ends[j]!;
      if (a.trackId === b.trackId && a.end === b.end) continue;
      const ha = outwardHeading(net, a);
      const hb = outwardHeading(net, b);
      if (ha === null || hb === null) continue;
      if (angleBetween(ha, hb) > Math.PI / 2) out.push({ a, b });
    }
  return out;
}

/** Recompute movements of auto nodes and drop references to ends that no longer exist. */
export function refreshNodes(net: TrackNetwork, nodeIds?: Iterable<string>): TrackNetwork {
  const only = nodeIds ? new Set(nodeIds) : null;
  return {
    ...net,
    nodes: net.nodes.map((n) => {
      if (only && !only.has(n.id)) return n;
      if (n.movementMode === 'auto') return { ...n, movements: autoMovements(net, n.id) };
      const ends = nodeEnds(net, n.id);
      const has = (r: TrackEndRef) => ends.some((e) => sameEnd(e, r));
      return { ...n, movements: n.movements.filter((m) => has(m.a) && has(m.b)) };
    }),
  };
}

/** Is passing through `node` from end `from` to end `to` permitted? */
export function isPermitted(node: TrackNode, from: TrackEndRef, to: TrackEndRef): boolean {
  return node.movements.some((m) => movementHas(m, from, to));
}

// ---------------------------------------------------------------------------
// Creating tracks
// ---------------------------------------------------------------------------

export interface CreateTrackInput {
  /** Clicked points, [lng, lat]: the first and last become nodes, the others PIs. */
  points: LngLat[];
  mode: TransportMode;
  double?: boolean;
  structure?: StructureType;
  level?: number;
  /**
   * Radius at every interior PI; undefined = the mode's cited default, null = no curves. For double
   * track this is the radius of the inner track.
   */
  radiusM?: number | null;
  /** Centre-line radius per point (overrides radiusM; ends are ignored). */
  radii?: (number | null)[];
  /**
   * Whether a track whose last point is back at its first closes into a loop. Undefined keeps the
   * automatic behaviour; the editor asks the user and passes the answer.
   */
  loop?: boolean;
  /**
   * Make each end meet the track it connects to tangentially (no kink) by adding a curve point
   * on the extension of that track. Default true.
   */
  tangentEnds?: boolean;
  origin?: PhysicalTrack['origin'];
}

export interface CreateTrackResult {
  scenario: Scenario;
  trackIds: string[];
  groupId: string | null;
  error?: string;
}

/**
 * A drawn loop (last point back at the first) is reordered so that it starts and
 * ends in the middle of its first straight: every corner, including the one
 * where the drawing started, can then carry a curve and the loop closes
 * tangentially.
 */
function closeLoop(net: TrackNetwork, points: LngLat[]): LngLat[] {
  if (points.length < 4) return points;
  const frame = networkFrame(net, points[0]!);
  const a = frame.toMetres(points[0]!);
  const b = frame.toMetres(points[points.length - 1]!);
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) > parameterValue(net, 'nodeSnapM')) return points;
  const p1 = frame.toMetres(points[1]!);
  const mid = frame.toLngLat([(a[0] + p1[0]) / 2, (a[1] + p1[1]) / 2]);
  return [mid, ...points.slice(1, -1), points[0]!, mid];
}

/** Whether a drawn track ends back at its first point (within the node snap distance). */
export function drawnAsLoop(net: TrackNetwork, points: readonly LngLat[]): boolean {
  if (points.length < 4) return false;
  const frame = networkFrame(net, points[0]!);
  const a = frame.toMetres(points[0]!);
  const b = frame.toMetres(points[points.length - 1]!);
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= parameterValue(net, 'nodeSnapM');
}

function withFrame(net: TrackNetwork, p: LngLat): TrackNetwork {
  return net.frameOrigin ? net : { ...net, frameOrigin: [p[0], p[1]] };
}

/**
 * The network as one mode sees it: its own tracks and the nodes they use (modes never share
 * track or nodes). Nodes without any track (just created) are kept.
 */
export function modeView(net: TrackNetwork, mode: TransportMode): TrackNetwork {
  const tracks = net.tracks.filter((t) => t.designMode === mode);
  const used = new Set(tracks.flatMap((t) => [t.fromNodeId, t.toNodeId]));
  const anyUse = new Set(net.tracks.flatMap((t) => [t.fromNodeId, t.toNodeId]));
  return { ...net, tracks, nodes: net.nodes.filter((n) => used.has(n.id) || !anyUse.has(n.id)) };
}

/**
 * The node a new track end attaches to: an existing node within the snap
 * distance on the same level, else a point on an existing track on the same
 * level (the track is split there), else a new node.
 */
function attachEnd(
  scenario: Scenario,
  p: LngLat,
  level: number,
  exclude: ReadonlySet<string> = new Set(),
  mode?: TransportMode,
): { scenario: Scenario; nodeId: string } {
  // Track only joins track of its own mode; other modes are never connected (they may cross).
  const net = mode ? modeView(scenario.trackNetwork, mode) : scenario.trackNetwork;
  const snap = parameterValue(net, 'nodeSnapM');
  const frame = networkFrame(net, p);
  const q = frame.toMetres(p);
  let bestNode: { id: string; d: number } | null = null;
  for (const n of net.nodes) {
    if (exclude.has(n.id)) continue;
    // Same level, or continuing an open track end (e.g. a portal from street level into a tunnel).
    if (n.level !== level && nodeEnds(net, n.id).length !== 1) continue;
    const v = frame.toMetres(n.position);
    const d = Math.hypot(v[0] - q[0], v[1] - q[1]);
    if (d <= snap && (!bestNode || d < bestNode.d)) bestNode = { id: n.id, d };
  }
  if (bestNode) return { scenario, nodeId: bestNode.id };
  const hit = tracksNear(net, p, snap, level).filter((h) => !exclude.has(h.track.id))[0];
  if (hit && hit.fraction > 1e-6 && hit.fraction < 1 - 1e-6) {
    const res = splitTrack(scenario, hit.track.id, hit.fraction);
    if (res.nodeId) return { scenario: res.scenario, nodeId: res.nodeId };
  }
  const node: TrackNode = {
    id: newId('tn'),
    position: [p[0], p[1]],
    level,
    kind: 'connection',
    movementMode: 'auto',
    movements: [],
    metadata: {},
  };
  return {
    scenario: {
      ...scenario,
      trackNetwork: { ...scenario.trackNetwork, nodes: [...scenario.trackNetwork.nodes, node] },
    },
    nodeId: node.id,
  };
}

/**
 * Heading a new track must have when it arrives at `p` and continues into the existing track it
 * attaches to there: into the single track at an open end, or along a track (either way) when it
 * joins the middle of one. Null when the end attaches to nothing, or to a node that is already a
 * junction.
 */
function arrivalHeadings(net: TrackNetwork, p: LngLat, level: number, searchM: number): number[] | null {
  if (!net.tracks.length) return null;
  const frame = networkFrame(net, p);
  const q = frame.toMetres(p);
  let best: { id: string; d: number } | null = null;
  for (const n of net.nodes) {
    if (n.level !== level && nodeEnds(net, n.id).length !== 1) continue;
    const v = frame.toMetres(n.position);
    const d = Math.hypot(v[0] - q[0], v[1] - q[1]);
    if (d <= searchM && (!best || d < best.d)) best = { id: n.id, d };
  }
  if (best) {
    const ends = nodeEnds(net, best.id);
    if (ends.length !== 1) return null;
    const h = outwardHeading(net, ends[0]!);
    return h === null ? null : [h];
  }
  const hit = tracksNear(net, p, searchM, level)[0];
  if (!hit || hit.fraction <= 1e-6 || hit.fraction >= 1 - 1e-6) return null;
  const h = pointOnTrack(net, hit.track, hit.fraction).heading;
  return [h, h + Math.PI];
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Add a curve point before the last point so the track arrives tangentially at what it connects
 * to (computed in the project metric frame). Unchanged when the end connects to nothing, is
 * already tangent (within 0.1°), or turns back by 90° or more (that is not a continuation).
 */
function tangentAtEnd(
  net: TrackNetwork,
  pts: LngLat[],
  radii: (number | null)[],
  level: number,
  radius: number | null,
  searchM: number,
): { pts: LngLat[]; radii: (number | null)[] } {
  if (pts.length < 2) return { pts, radii };
  const end = pts[pts.length - 1]!;
  const targets = arrivalHeadings(net, end, level, searchM);
  if (!targets) return { pts, radii };
  const frame = networkFrame(net, end);
  const e = frame.toMetres(end);
  const prev = frame.toMetres(pts[pts.length - 2]!);
  const dist = Math.hypot(e[0] - prev[0], e[1] - prev[1]);
  if (dist < 1) return { pts, radii };
  const natural = Math.atan2(e[1] - prev[1], e[0] - prev[0]);
  const target = targets.reduce((a, b) =>
    Math.abs(wrapAngle(b - natural)) < Math.abs(wrapAngle(a - natural)) ? b : a,
  );
  const dev = Math.abs(wrapAngle(target - natural));
  if (dev < (0.1 * Math.PI) / 180 || dev >= Math.PI / 2) return { pts, radii };
  const l = dist / 2;
  const pi = frame.toLngLat([e[0] - l * Math.cos(target), e[1] - l * Math.sin(target)]);
  return {
    pts: [...pts.slice(0, -1), pi, end],
    radii: [...radii.slice(0, -1), radius, radii[radii.length - 1] ?? null],
  };
}

/**
 * For double track: when a drawn end is near two open track ends that lie the track spacing
 * apart (the end of another double track, or of a two-track station), move it to their
 * midpoint so both new tracks join them.
 */
function snapEndToPair(net: TrackNetwork, p: LngLat, level: number, spacing: number): LngLat {
  const frame = networkFrame(net, p);
  const q = frame.toMetres(p);
  const open = net.nodes
    .filter((n) => n.level === level && nodeEnds(net, n.id).length === 1)
    .map((n) => ({ n, v: frame.toMetres(n.position) }))
    .filter((x) => Math.hypot(x.v[0] - q[0], x.v[1] - q[1]) <= spacing * 1.2);
  let best: { mid: [number, number]; d: number } | null = null;
  for (let i = 0; i < open.length; i++)
    for (let j = i + 1; j < open.length; j++) {
      const a = open[i]!.v;
      const b = open[j]!.v;
      if (Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1]) - spacing) > spacing * 0.15) continue;
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const d = Math.hypot(mid[0] - q[0], mid[1] - q[1]);
      if (!best || d < best.d) best = { mid, d };
    }
  return best ? frame.toLngLat(best.mid) : p;
}

/** Tangent connections at both ends of a drawn centre line. */
function tangentEnds(
  net: TrackNetwork,
  pts: LngLat[],
  radii: (number | null)[],
  level: number,
  radius: number | null,
  searchM: number,
): { pts: LngLat[]; radii: (number | null)[] } {
  const a = tangentAtEnd(net, pts, radii, level, radius, searchM);
  const b = tangentAtEnd(net, [...a.pts].reverse(), [...a.radii].reverse(), level, radius, searchM);
  return { pts: [...b.pts].reverse(), radii: [...b.radii].reverse() };
}

function addOneTrack(
  scenario: Scenario,
  points: LngLat[],
  radii: (number | null)[],
  base: Omit<PhysicalTrack, 'id' | 'fromNodeId' | 'toNodeId' | 'points' | 'radii'>,
  exclude: ReadonlySet<string> = new Set(),
  noRing = false,
): { scenario: Scenario; trackId: string; nodeIds: [string, string] } {
  let sc = scenario;
  const a = attachEnd(sc, points[0]!, base.level, exclude, base.designMode);
  sc = a.scenario;
  // A closed track (ring) ends at its own start node, unless the user declined the loop.
  const b = attachEnd(
    sc,
    points[points.length - 1]!,
    base.level,
    noRing ? new Set([...exclude, a.nodeId]) : exclude,
    base.designMode,
  );
  sc = b.scenario;
  const track: PhysicalTrack = {
    ...base,
    id: newId('trk'),
    fromNodeId: a.nodeId,
    toNodeId: b.nodeId,
    points: points.slice(1, -1).map((p) => [p[0], p[1]] as LngLat),
    radii: radii.slice(1, -1),
  };
  const net = sc.trackNetwork;
  return {
    scenario: {
      ...sc,
      trackNetwork: refreshNodes({ ...net, tracks: [...net.tracks, track] }, [a.nodeId, b.nodeId]),
    },
    trackId: track.id,
    nodeIds: [a.nodeId, b.nodeId],
  };
}

/** Draw a single track, or a double track as two parallel physical tracks with their own IDs. */
export function createTracks(scenario: Scenario, input: CreateTrackInput): CreateTrackResult {
  if (input.points.length < 2)
    return { scenario, trackIds: [], groupId: null, error: 'A track needs at least two points' };
  let sc: Scenario = { ...scenario, trackNetwork: withFrame(scenario.trackNetwork, input.points[0]!) };
  const net = sc.trackNetwork;
  let drawn = input.points;
  if (input.double && net.tracks.length) {
    const sp = trackSpacingM(net, input.mode);
    const lvl = input.level ?? levelOfStructure(input.structure ?? MODES[input.mode].defaultStructure);
    drawn = [
      snapEndToPair(modeView(net, input.mode), drawn[0]!, lvl, sp),
      ...drawn.slice(1, -1),
      snapEndToPair(modeView(net, input.mode), drawn[drawn.length - 1]!, lvl, sp),
    ];
  }
  const pts0 = input.loop === false ? drawn : closeLoop(net, drawn);
  const looped = pts0 !== drawn;
  // Per-point radii only apply when the points were not reordered.
  const inputRadii = !looped ? input.radii : undefined;
  const structure = input.structure ?? MODES[input.mode].defaultStructure;
  const level = input.level ?? levelOfStructure(structure);
  const spacing0 = trackSpacingM(net, input.mode);
  const def = defaultRadiusM(input.mode);
  // Double track: the given (or default) radius is that of the inner track, so the inner track meets
  // the cited value; the centre line is half the spacing wider.
  const requested = input.radiusM === undefined ? def : input.radiusM;
  const r = requested !== null && input.double ? requested + spacing0 / 2 : requested;
  const radii0 = pts0.map((_, i) =>
    i === 0 || i === pts0.length - 1 ? null : inputRadii ? (inputRadii[i] ?? null) : r,
  );
  // No kinks where the new track joins existing track: arrive tangentially (a loop closes on itself).
  const searchM = Math.max(parameterValue(net, 'nodeSnapM'), input.double ? spacing0 : 0);
  const { pts, radii } =
    input.tangentEnds === false || looped
      ? { pts: pts0, radii: radii0 }
      : tangentEnds(modeView(net, input.mode), pts0, radii0, level, r, searchM);
  const noRing = input.loop === false;
  const base = {
    name: '',
    direction: 'both' as TrackDirection,
    structure,
    level,
    rightOfWay: MODES[input.mode].defaultRightOfWay,
    designMode: input.mode,
    infrastructureClass: null,
    gaugeMm: null,
    electrification: 'unknown' as const,
    speedLimitKmh: null,
    groupId: null as string | null,
    stationId: null as string | null,
    origin: input.origin ?? { source: 'user' as const, ref: null, edited: false },
    metadata: {},
    notes: '',
  };
  if (!input.double) {
    const res = addOneTrack(sc, pts, radii, base, new Set(), noRing);
    return { scenario: touch(res.scenario), trackIds: [res.trackId], groupId: null };
  }
  const spacing = spacing0;
  const frame = networkFrame(net);
  const centre: PiAlignment = { points: pts.map((p) => frame.toMetres(p)), radii };
  const left = parallel(centre, spacing / 2);
  const right = parallel(centre, -spacing / 2);
  if (left.collapsed.length || right.collapsed.length)
    return {
      scenario,
      trackIds: [],
      groupId: null,
      error: `This curve or loop is too tight for double track with ${spacing} m between the tracks: the inner track would have no room. Draw it bigger (a radius above ${Math.ceil(spacing / 2)} m on the centre line), or draw single track.`,
    };
  const group: TrackGroup = { id: newId('tg'), kind: 'double', spacingM: spacing };
  sc = { ...sc, trackNetwork: { ...sc.trackNetwork, groups: [...sc.trackNetwork.groups, group] } };
  // Right-hand running: the right track carries the drawing direction.
  const rightDir: TrackDirection = net.runningSide === 'right' ? 'forward' : 'backward';
  const leftDir: TrackDirection = net.runningSide === 'right' ? 'backward' : 'forward';
  const toLngLat = (a: PiAlignment) => a.points.map((v) => frame.toLngLat(v));
  const l = addOneTrack(
    sc,
    toLngLat(left.alignment),
    left.alignment.radii,
    { ...base, groupId: group.id, direction: leftDir },
    new Set(),
    noRing,
  );
  // The partner track must not attach to the ends just created a few metres away.
  const fresh = new Set([l.trackId, ...l.nodeIds].filter((id) => !net.nodes.some((n) => n.id === id)));
  fresh.add(l.trackId);
  const rr = addOneTrack(
    l.scenario,
    toLngLat(right.alignment),
    right.alignment.radii,
    { ...base, groupId: group.id, direction: rightDir },
    fresh,
    noRing,
  );
  return { scenario: touch(rr.scenario), trackIds: [l.trackId, rr.trackId], groupId: group.id };
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function mapNetwork(scenario: Scenario, f: (net: TrackNetwork) => TrackNetwork): Scenario {
  return touch({ ...scenario, trackNetwork: f(scenario.trackNetwork) });
}

const markEdited = (t: PhysicalTrack): PhysicalTrack =>
  t.origin.source === 'osm' ? { ...t, origin: { ...t.origin, edited: true } } : t;

export function updateTrack(scenario: Scenario, trackId: string, patch: Partial<PhysicalTrack>): Scenario {
  return mapNetwork(scenario, (net) => {
    const next = {
      ...net,
      tracks: net.tracks.map((t) => (t.id === trackId ? { ...t, ...patch, id: t.id } : t)),
    };
    const t = next.tracks.find((x) => x.id === trackId);
    return t ? refreshNodes(next, [t.fromNodeId, t.toNodeId]) : next;
  });
}

/**
 * Add one track between two new nodes, without joining anything nearby (station tracks: the
 * user connects to their ends afterwards).
 */
export function addDetachedTrack(
  scenario: Scenario,
  points: LngLat[],
  radii: (number | null)[],
  base: Omit<PhysicalTrack, 'id' | 'fromNodeId' | 'toNodeId' | 'points' | 'radii'>,
): { scenario: Scenario; trackId: string } {
  const node = (p: LngLat): TrackNode => ({
    id: newId('tn'),
    position: [p[0], p[1]],
    level: base.level,
    kind: 'connection',
    movementMode: 'auto',
    movements: [],
    metadata: {},
  });
  const a = node(points[0]!);
  const b = node(points[points.length - 1]!);
  const track: PhysicalTrack = {
    ...base,
    id: newId('trk'),
    fromNodeId: a.id,
    toNodeId: b.id,
    points: points.slice(1, -1).map((p) => [p[0], p[1]] as LngLat),
    radii: radii.slice(1, -1),
  };
  const net = withFrame(scenario.trackNetwork, points[0]!);
  return {
    scenario: touch({
      ...scenario,
      trackNetwork: refreshNodes({ ...net, nodes: [...net.nodes, a, b], tracks: [...net.tracks, track] }, [
        a.id,
        b.id,
      ]),
    }),
    trackId: track.id,
  };
}

/** Replace the interior PIs (and their radii) of a track. */
export function setTrackPoints(
  scenario: Scenario,
  trackId: string,
  points: LngLat[],
  radii: (number | null)[],
): Scenario {
  const t = scenario.trackNetwork.tracks.find((x) => x.id === trackId);
  if (!t || radii.length !== points.length) return scenario;
  return updateTrack(scenario, trackId, markEdited({ ...t, points, radii }));
}

export function setTrackRadius(
  scenario: Scenario,
  trackId: string,
  index: number,
  radiusM: number | null,
): Scenario {
  const t = scenario.trackNetwork.tracks.find((x) => x.id === trackId);
  if (!t || index < 0 || index >= t.radii.length) return scenario;
  if (radiusM !== null && !(radiusM > 0 && Number.isFinite(radiusM))) return scenario;
  return updateTrack(
    scenario,
    trackId,
    markEdited({ ...t, radii: t.radii.map((r, i) => (i === index ? radiusM : r)) }),
  );
}

/**
 * Set the radius of a curve and, on double track, of the matching curve of the other track
 * (same point index) so the two stay concentric: the partner gets the radius plus the track
 * spacing when the edited track is the inner one, minus it when it is the outer one.
 */
export function setCurveRadius(
  scenario: Scenario,
  trackId: string,
  index: number,
  radiusM: number | null,
): Scenario {
  const net = scenario.trackNetwork;
  const t = net.tracks.find((x) => x.id === trackId);
  if (!t) return scenario;
  let sc = setTrackRadius(scenario, trackId, index, radiusM);
  const group = t.groupId ? net.groups.find((g) => g.id === t.groupId) : undefined;
  const partner = group
    ? net.tracks.find((x) => x.groupId === group.id && x.id !== t.id && x.points.length === t.points.length)
    : undefined;
  if (!group || !partner) return sc;
  if (radiusM === null) return setTrackRadius(sc, partner.id, index, null);
  const mine = trackGeometry(net, t).built.usedRadii[index + 1];
  const theirs = trackGeometry(net, partner).built.usedRadii[index + 1];
  const inner =
    mine === null || mine === undefined || theirs === null || theirs === undefined || mine <= theirs;
  const other = inner ? radiusM + group.spacingM : radiusM - group.spacingM;
  if (other > 0) sc = setTrackRadius(sc, partner.id, index, Math.round(other * 10) / 10);
  return sc;
}

/** Move a node: every connected track follows because tracks reference the node. */
export function moveNode(scenario: Scenario, nodeId: string, to: LngLat): Scenario {
  return mapNetwork(scenario, (net) => {
    const moved = {
      ...net,
      nodes: net.nodes.map((n) => (n.id === nodeId ? { ...n, position: [to[0], to[1]] as LngLat } : n)),
      tracks: net.tracks.map((t) => (t.fromNodeId === nodeId || t.toNodeId === nodeId ? markEdited(t) : t)),
    };
    return refreshNodes(moved, [nodeId]);
  });
}

/** Replace node `dropId` by `keepId` in every track end and remove it. */
export function mergeNodes(scenario: Scenario, keepId: string, dropId: string): Scenario {
  if (keepId === dropId) return scenario;
  return mapNetwork(scenario, (net) =>
    refreshNodes(
      {
        ...net,
        nodes: net.nodes.filter((n) => n.id !== dropId),
        tracks: net.tracks.map((t) =>
          t.fromNodeId === dropId || t.toNodeId === dropId
            ? markEdited({
                ...t,
                fromNodeId: t.fromNodeId === dropId ? keepId : t.fromNodeId,
                toNodeId: t.toNodeId === dropId ? keepId : t.toNodeId,
              })
            : t,
        ),
      },
      [keepId],
    ),
  );
}

/**
 * After a track end was moved onto something: connect node `nodeId` to another node within the
 * snap distance (same level, or an open end), or to the middle of a track (split there). The
 * other end of the same track is never a target, so moving an end never closes a loop by itself.
 */
export function connectMovedNode(scenario: Scenario, nodeId: string): Scenario {
  const all = scenario.trackNetwork;
  const ownAll = all.tracks.filter((t) => t.fromNodeId === nodeId || t.toNodeId === nodeId);
  const net = ownAll[0] ? modeView(all, ownAll[0].designMode) : all;
  const node = net.nodes.find((n) => n.id === nodeId);
  if (!node) return scenario;
  const own = net.tracks.filter((t) => t.fromNodeId === nodeId || t.toNodeId === nodeId);
  const forbidden = new Set([nodeId, ...own.flatMap((t) => [t.fromNodeId, t.toNodeId])]);
  const snap = parameterValue(net, 'nodeSnapM');
  const frame = networkFrame(net, node.position);
  const q = frame.toMetres(node.position);
  let best: { id: string; d: number } | null = null;
  for (const n of net.nodes) {
    if (forbidden.has(n.id)) continue;
    if (n.level !== node.level && nodeEnds(net, n.id).length !== 1) continue;
    const v = frame.toMetres(n.position);
    const d = Math.hypot(v[0] - q[0], v[1] - q[1]);
    if (d <= snap && (!best || d < best.d)) best = { id: n.id, d };
  }
  if (best) {
    const target = net.nodes.find((n) => n.id === best!.id)!;
    return mergeNodes(moveNode(scenario, nodeId, target.position), best.id, nodeId);
  }
  const ownIds = new Set(own.map((t) => t.id));
  const hit = tracksNear(net, node.position, snap, node.level).filter((h) => !ownIds.has(h.track.id))[0];
  if (hit && hit.fraction > 1e-6 && hit.fraction < 1 - 1e-6) {
    const res = splitTrack(scenario, hit.track.id, hit.fraction);
    if (res.nodeId) {
      const at = res.scenario.trackNetwork.nodes.find((n) => n.id === res.nodeId)!;
      return mergeNodes(moveNode(res.scenario, nodeId, at.position), res.nodeId, nodeId);
    }
  }
  return scenario;
}

export function updateNode(scenario: Scenario, nodeId: string, patch: Partial<TrackNode>): Scenario {
  return mapNetwork(scenario, (net) =>
    refreshNodes(
      { ...net, nodes: net.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch, id: n.id } : n)) },
      [nodeId],
    ),
  );
}

/** Allow or forbid one movement; the node switches to manual movements. */
export function setMovement(
  scenario: Scenario,
  nodeId: string,
  a: TrackEndRef,
  b: TrackEndRef,
  allowed: boolean,
): Scenario {
  const node = scenario.trackNetwork.nodes.find((n) => n.id === nodeId);
  if (!node) return scenario;
  const others = node.movements.filter((m) => !movementHas(m, a, b));
  return updateNode(scenario, nodeId, {
    movementMode: 'manual',
    movements: allowed ? [...others, { a, b }] : others,
  });
}

export interface SplitResult {
  scenario: Scenario;
  nodeId: string | null;
  /** The two parts: the original id keeps the first part. */
  trackIds: [string, string] | null;
}

/**
 * Split a track at a fraction of its length into two tracks joined by a new
 * node. Geometry is preserved exactly (also inside arcs); station references,
 * movements and service paths are carried over to the parts.
 */
export function splitTrack(scenario: Scenario, trackId: string, fraction: number): SplitResult {
  const net = scenario.trackNetwork;
  const t = net.tracks.find((x) => x.id === trackId);
  if (!t || fraction <= 0 || fraction >= 1) return { scenario, nodeId: null, trackIds: null };
  const g = trackGeometry(net, t);
  const parts = splitAlignment(g.alignment, fraction * g.lengthM);
  if (!parts) return { scenario, nodeId: null, trackIds: null };
  const frame = networkFrame(net);
  const [first, second] = parts;
  const at = frame.toLngLat(first.points[first.points.length - 1]!);
  const node: TrackNode = {
    id: newId('tn'),
    position: at,
    level: t.level,
    kind: 'connection',
    movementMode: 'auto',
    movements: [],
    metadata: {},
  };
  const interior = (a: PiAlignment) => ({
    points: a.points.slice(1, -1).map((v) => frame.toLngLat(v)),
    radii: a.radii.slice(1, -1),
  });
  const a: PhysicalTrack = { ...t, toNodeId: node.id, ...interior(first) };
  const b: PhysicalTrack = { ...t, id: newId('trk'), fromNodeId: node.id, ...interior(second) };
  const remapEnd = (r: TrackEndRef): TrackEndRef =>
    r.trackId === t.id && r.end === 'end' ? { trackId: b.id, end: 'end' } : r;
  const nodes = [
    ...net.nodes.map((n) =>
      n.id === t.toNodeId
        ? { ...n, movements: n.movements.map((m) => ({ a: remapEnd(m.a), b: remapEnd(m.b) })) }
        : n,
    ),
    node,
  ];
  let next: TrackNetwork = {
    ...net,
    nodes,
    tracks: net.tracks.flatMap((x) => (x.id === t.id ? [a, b] : [x])),
  };
  next = refreshNodes(next, [node.id]);
  // A through movement at the new node is always permitted.
  next = {
    ...next,
    nodes: next.nodes.map((n) =>
      n.id === node.id &&
      !n.movements.some((m) => movementHas(m, { trackId: a.id, end: 'end' }, { trackId: b.id, end: 'start' }))
        ? {
            ...n,
            movements: [
              ...n.movements,
              { a: { trackId: a.id, end: 'end' }, b: { trackId: b.id, end: 'start' } },
            ],
          }
        : n,
    ),
  };
  const stations = scenario.stations.map((st) => ({
    ...st,
    trackRefs: st.trackRefs.map((r) =>
      r.trackId !== t.id
        ? r
        : r.fraction <= fraction
          ? { trackId: a.id, fraction: r.fraction / fraction }
          : { trackId: b.id, fraction: (r.fraction - fraction) / (1 - fraction) },
    ),
  }));
  const lines = scenario.lines.map((l) => {
    if (l.alignment.kind !== 'track') return l;
    const splitSteps = (steps: typeof l.alignment.path) =>
      steps.flatMap((s) => {
        if (s.trackId !== t.id) return [s];
        const lo = Math.min(s.from, s.to);
        const hi = Math.max(s.from, s.to);
        const pieces = [];
        if (lo < fraction)
          pieces.push({ trackId: a.id, from: lo / fraction, to: Math.min(hi, fraction) / fraction });
        if (hi > fraction)
          pieces.push({
            trackId: b.id,
            from: (Math.max(lo, fraction) - fraction) / (1 - fraction),
            to: (hi - fraction) / (1 - fraction),
          });
        const ordered = s.reversed ? pieces.reverse() : pieces;
        return ordered
          .filter((p) => p.to - p.from > 1e-9)
          .map((p) => ({
            trackId: p.trackId,
            reversed: s.reversed,
            from: s.reversed ? p.to : p.from,
            to: s.reversed ? p.from : p.to,
          }));
      });
    return {
      ...l,
      alignment: {
        ...l.alignment,
        path: splitSteps(l.alignment.path),
        returnPath: l.alignment.returnPath ? splitSteps(l.alignment.returnPath) : null,
      },
    };
  });
  return {
    scenario: touch({ ...scenario, trackNetwork: next, stations, lines }),
    nodeId: node.id,
    trackIds: [a.id, b.id],
  };
}

/** Services and stations that use a track. */
export function trackUsage(scenario: Scenario, trackId: string): { lineIds: string[]; stationIds: string[] } {
  return {
    lineIds: scenario.lines
      .filter(
        (l) =>
          l.alignment.kind === 'track' &&
          [...l.alignment.path, ...(l.alignment.returnPath ?? [])].some((s) => s.trackId === trackId),
      )
      .map((l) => l.id),
    stationIds: scenario.stations
      .filter((s) => s.trackRefs.some((r) => r.trackId === trackId))
      .map((s) => s.id),
  };
}

/**
 * Remove a track, its station references and nodes left without tracks.
 * Services that used it keep their (now broken) path; callers decide whether to
 * reroute them (domain/serviceRouting.ts).
 */
export function removeTrack(scenario: Scenario, trackId: string): Scenario {
  const net = scenario.trackNetwork;
  const t = net.tracks.find((x) => x.id === trackId);
  if (!t) return scenario;
  const tracks = net.tracks.filter((x) => x.id !== trackId);
  const used = new Set(tracks.flatMap((x) => [x.fromNodeId, x.toNodeId]));
  const groupsUsed = new Set(tracks.map((x) => x.groupId).filter(Boolean));
  let next: TrackNetwork = {
    ...net,
    tracks,
    nodes: net.nodes.filter((n) => used.has(n.id)),
    groups: net.groups.filter((g) => groupsUsed.has(g.id)),
  };
  next = refreshNodes(next, [t.fromNodeId, t.toNodeId]);
  return touch({
    ...scenario,
    trackNetwork: next,
    stations: scenario.stations.map((s) => ({
      ...s,
      trackRefs: s.trackRefs.filter((r) => r.trackId !== trackId),
    })),
  });
}

/** Tracks of the same double-track group. */
export function groupMembers(net: TrackNetwork, groupId: string | null): PhysicalTrack[] {
  return groupId ? net.tracks.filter((t) => t.groupId === groupId) : [];
}

/** Editable handle points of a track: from node, PIs, to node. */
export function trackHandles(net: TrackNetwork, track: PhysicalTrack): LngLat[] {
  const n = nodeMap(net);
  return [
    n.get(track.fromNodeId)?.position ?? [0, 0],
    ...track.points,
    n.get(track.toNodeId)?.position ?? [0, 0],
  ];
}

/**
 * Apply edited handle positions (from the map): moved ends move their nodes
 * (connected tracks follow), interior points become the new PIs. Radii are kept
 * for PIs that already existed (matched by position) and new PIs get the mode's
 * default radius.
 */
export function applyTrackHandles(scenario: Scenario, trackId: string, handles: LngLat[]): Scenario {
  const net = scenario.trackNetwork;
  const t = net.tracks.find((x) => x.id === trackId);
  if (!t || handles.length < 2) return scenario;
  const old = trackHandles(net, t);
  const same = (p: LngLat, q: LngLat) => Math.abs(p[0] - q[0]) < 1e-10 && Math.abs(p[1] - q[1]) < 1e-10;
  let sc = scenario;
  const movedStart = !same(old[0]!, handles[0]!);
  const movedEnd = !same(old[old.length - 1]!, handles[handles.length - 1]!);
  if (movedStart) sc = moveNode(sc, t.fromNodeId, handles[0]!);
  if (movedEnd) sc = moveNode(sc, t.toNodeId, handles[handles.length - 1]!);
  const interior = handles.slice(1, -1);
  const def = defaultRadiusM(t.designMode);
  const radii = interior.map((p) => {
    const k = t.points.findIndex((q) => same(p, q));
    if (k >= 0) return t.radii[k] ?? null;
    // A moved PI keeps the radius of the PI at the same index when the count is unchanged.
    if (interior.length === t.points.length) return t.radii[interior.indexOf(p)] ?? def;
    return def;
  });
  // An end dropped onto another track end or track arrives tangentially there (no kink): probe the
  // network without this track and its own nodes.
  let pts: LngLat[] = [handles[0]!, ...interior, handles[handles.length - 1]!];
  let rr: (number | null)[] = [null, ...radii, null];
  if (movedStart || movedEnd) {
    const view = modeView(sc.trackNetwork, t.designMode);
    const probe: TrackNetwork = {
      ...view,
      tracks: view.tracks.filter((x) => x.id !== t.id),
      nodes: view.nodes.filter((n) => n.id !== t.fromNodeId && n.id !== t.toNodeId),
    };
    const snap = parameterValue(net, 'nodeSnapM');
    if (movedEnd) ({ pts, radii: rr } = tangentAtEnd(probe, pts, rr, t.level, def, snap));
    if (movedStart) {
      const r = tangentAtEnd(probe, [...pts].reverse(), [...rr].reverse(), t.level, def, snap);
      pts = [...r.pts].reverse();
      rr = [...r.radii].reverse();
    }
  }
  sc = setTrackPoints(sc, trackId, pts.slice(1, -1), rr.slice(1, -1));
  // An end dropped onto another node or track connects to it.
  if (movedStart) sc = connectMovedNode(sc, t.fromNodeId);
  if (movedEnd && sc.trackNetwork.nodes.some((n) => n.id === t.toNodeId))
    sc = connectMovedNode(sc, t.toNodeId);
  return sc;
}

export { primitiveLength };
