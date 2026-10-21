/**
 * Turnouts and crossings at track nodes (R5). Pure.
 *
 * A node may carry a turnout or crossing. Its kind fixes which movements a train may
 * make through the node; the roles of the track ends (switch toe, main and diverging
 * route of a turnout; the two routes of a crossing) follow from the drawn geometry.
 * A standard design from the catalogue adds the turnout radius, inclination and the
 * speed on the diverging route, each with its source.
 */
import type {
  Movement,
  Scenario,
  TrackEndRef,
  TrackNetwork,
  TrackNode,
  TrackStep,
  TransportMode,
} from './schema';
import { angleBetween, nodeEnds, outwardHeading, sameEnd, trackGeometry, updateNode } from './tracks';
import { length } from '../geo/track/primitives';

export type TurnoutKind = NonNullable<TrackNode['turnout']>['kind'];

export const TURNOUT_KIND_LABELS: Record<TurnoutKind, string> = {
  simple: 'Turnout (single switch)',
  diamond: 'Diamond crossing',
  single_slip: 'Single slip',
  double_slip: 'Double slip',
};

/** Number of track ends each kind connects. */
export const TURNOUT_ENDS: Record<TurnoutKind, number> = {
  simple: 3,
  diamond: 4,
  single_slip: 4,
  double_slip: 4,
};

const RIGHT = Math.PI / 2;

/** Roles of the ends of a simple turnout: the switch toe, the main (straighter) and the diverging route. */
export interface TurnoutRoles {
  toe: TrackEndRef;
  main: TrackEndRef;
  diverging: TrackEndRef;
  /** Angle between the main and the diverging route where they leave the node (degrees). */
  divergenceDeg: number;
}

function headings(net: TrackNetwork, nodeId: string) {
  return nodeEnds(net, nodeId)
    .map((e) => ({ e, h: outwardHeading(net, e) }))
    .filter((x): x is { e: TrackEndRef; h: number } => x.h !== null);
}

/**
 * The toe is the end from which both other ends can be reached without reversing; of
 * the other two, the one closer to straight through is the main route.
 */
export function turnoutRoles(net: TrackNetwork, nodeId: string): TurnoutRoles | null {
  const hs = headings(net, nodeId);
  if (hs.length !== 3) return null;
  for (let i = 0; i < 3; i++) {
    const toe = hs[i]!;
    const others = hs.filter((_, k) => k !== i);
    const [x, y] = others as [(typeof hs)[number], (typeof hs)[number]];
    const ax = angleBetween(toe.h, x.h);
    const ay = angleBetween(toe.h, y.h);
    if (ax <= RIGHT || ay <= RIGHT) continue;
    const [main, div] = ax >= ay ? [x, y] : [y, x];
    return {
      toe: toe.e,
      main: main.e,
      diverging: div.e,
      divergenceDeg: (angleBetween(main.h, div.h) * 180) / Math.PI,
    };
  }
  return null;
}

/** The two straight routes of a crossing: the pairing of four ends that is closest to straight. */
export function crossingRoutes(net: TrackNetwork, nodeId: string): [Movement, Movement] | null {
  const hs = headings(net, nodeId);
  if (hs.length !== 4) return null;
  const [a, b, c, d] = hs as [
    (typeof hs)[number],
    (typeof hs)[number],
    (typeof hs)[number],
    (typeof hs)[number],
  ];
  const pairings: [typeof a, typeof a, typeof a, typeof a][] = [
    [a, b, c, d],
    [a, c, b, d],
    [a, d, b, c],
  ];
  let best: [Movement, Movement] | null = null;
  let score = -Infinity;
  for (const [p, q, r, s] of pairings) {
    const k1 = angleBetween(p.h, q.h);
    const k2 = angleBetween(r.h, s.h);
    if (k1 <= RIGHT || k2 <= RIGHT) continue;
    if (k1 + k2 > score) {
      score = k1 + k2;
      best = [
        { a: p.e, b: q.e },
        { a: r.e, b: s.e },
      ];
    }
  }
  return best;
}

/** Movements between the two routes of a crossing that a slip could provide (no reversing). */
export function slipCandidates(net: TrackNetwork, nodeId: string): Movement[] {
  const routes = crossingRoutes(net, nodeId);
  if (!routes) return [];
  const hs = headings(net, nodeId);
  const h = (e: TrackEndRef) => hs.find((x) => sameEnd(x.e, e))!.h;
  const [r1, r2] = routes;
  const out: Movement[] = [];
  for (const x of [r1.a, r1.b])
    for (const y of [r2.a, r2.b]) if (angleBetween(h(x), h(y)) > RIGHT) out.push({ a: x, b: y });
  return out;
}

/** Movements a turnout or crossing permits; empty when the geometry does not fit its kind. */
export function turnoutMovements(net: TrackNetwork, node: TrackNode): Movement[] {
  const t = node.turnout;
  if (!t) return [];
  if (t.kind === 'simple') {
    const r = turnoutRoles(net, node.id);
    return r
      ? [
          { a: r.toe, b: r.main },
          { a: r.toe, b: r.diverging },
        ]
      : [];
  }
  const routes = crossingRoutes(net, node.id);
  if (!routes) return [];
  if (t.kind === 'diamond') return [...routes];
  const slips = slipCandidates(net, node.id);
  if (t.kind === 'double_slip') return [...routes, ...slips];
  const chosen =
    t.slip &&
    slips.find(
      (m) =>
        (sameEnd(m.a, t.slip!.a) && sameEnd(m.b, t.slip!.b)) ||
        (sameEnd(m.a, t.slip!.b) && sameEnd(m.b, t.slip!.a)),
    );
  return chosen ? [...routes, chosen] : [...routes, ...slips.slice(0, 1)];
}

// --- Catalogue of standard designs -----------------------------------------------------

export interface TurnoutDesign {
  id: string;
  label: string;
  /** Radius of the diverging route (m). */
  radiusM: number;
  /** Inclination 1:n of the diverging route at the frog. */
  inclination: number;
  /** End angle α (degrees), where the source gives it. */
  angleDeg: number | null;
  /** Permitted speed on the diverging route (km/h). */
  divergingSpeedKmh: number;
  frog: 'curved' | 'straight';
  /** Modes the design is meant for. */
  modes: TransportMode[];
  status: 'documented_default';
  source: string;
}

const DB_REGELWEICHEN =
  'Deutsche Bahn standard simple turnouts (Regelweichen), table in "Weiche (Schienenverkehr)", German Wikipedia (CC BY-SA 4.0), https://de.wikipedia.org/wiki/Weiche_(Schienenverkehr), read 21 October 2026: designation EW xx-R-1:n, frog, permitted diverging speed, angle α.';

const RAIL: TransportMode[] = ['commuter_rail'];

const db = (
  r: number,
  n: number,
  label: string,
  v: number,
  frog: 'curved' | 'straight',
  angleDeg: number | null,
): TurnoutDesign => ({
  id: `db-ew-${r}-${label.replace(/[^0-9]/g, '')}`,
  label: `EW ${r}-1:${label} (DB, ${v} km/h diverging)`,
  radiusM: r,
  inclination: n,
  angleDeg,
  divergingSpeedKmh: v,
  frog,
  modes: RAIL,
  status: 'documented_default',
  source: DB_REGELWEICHEN,
});

export const TURNOUT_DESIGNS: TurnoutDesign[] = [
  db(190, 7.5, '7,5', 40, 'curved', 7.5946),
  db(190, 9, '9', 40, 'straight', null),
  db(300, 9, '9', 50, 'curved', 6.3402),
  db(500, 12, '12', 60, 'curved', 4.7636),
  db(500, 14, '14', 60, 'straight', null),
  db(760, 14, '14', 80, 'curved', 4.0856),
  db(1200, 18.5, '18,5', 100, 'curved', 3.0941),
  db(2500, 26.5, '26,5', 130, 'curved', 2.1611),
];

export function turnoutDesign(id: string | null | undefined): TurnoutDesign | null {
  return TURNOUT_DESIGNS.find((d) => d.id === id) ?? null;
}

/** Radius and diverging speed in force at a node: the design's, else the user's values. */
export function turnoutGeometry(t: NonNullable<TrackNode['turnout']>): {
  radiusM: number | null;
  divergingSpeedKmh: number | null;
  source: string;
} {
  const d = turnoutDesign(t.designId);
  if (d) return { radiusM: d.radiusM, divergingSpeedKmh: d.divergingSpeedKmh, source: d.source };
  return { radiusM: t.radiusM, divergingSpeedKmh: t.divergingSpeedKmh, source: 'User input' };
}

// --- Editing -----------------------------------------------------------------------------

/** Give a node a turnout or crossing (movements follow it), or remove it (movements follow the geometry). */
export function setTurnout(scenario: Scenario, nodeId: string, turnout: TrackNode['turnout']): Scenario {
  return updateNode(scenario, nodeId, { turnout, movementMode: turnout ? 'turnout' : 'auto' });
}

// --- Speed on diverging routes -----------------------------------------------------------

/** Part of a service where it takes the diverging route of a turnout (fractions of the line). */
export interface DivergingRestriction {
  nodeId: string;
  fromFraction: number;
  toFraction: number;
  speedKmh: number;
}

/**
 * Where a service routed over tracks takes the diverging route of a turnout with a known
 * diverging speed. The restriction covers the first element (arc or straight) of the
 * diverging track as drawn from the node.
 */
export function divergingRestrictions(
  net: TrackNetwork,
  steps: readonly TrackStep[],
): DivergingRestriction[] {
  const tracks = new Map(net.tracks.map((t) => [t.id, t]));
  const nodes = new Map(net.nodes.map((n) => [n.id, n]));
  const lens = steps.map((s) => {
    const t = tracks.get(s.trackId);
    return t ? Math.abs(s.to - s.from) * trackGeometry(net, t).lengthM : 0;
  });
  const total = lens.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const out: DivergingRestriction[] = [];
  let at = 0;
  for (let i = 0; i + 1 < steps.length; i++) {
    at += lens[i]!;
    const s = steps[i]!;
    const n = steps[i + 1]!;
    const ts = tracks.get(s.trackId);
    const tn = tracks.get(n.trackId);
    if (!ts || !tn) continue;
    const exit: TrackEndRef = { trackId: s.trackId, end: s.to >= s.from ? 'end' : 'start' };
    const entry: TrackEndRef = { trackId: n.trackId, end: n.to >= n.from ? 'start' : 'end' };
    const nodeId = exit.end === 'end' ? ts.toNodeId : ts.fromNodeId;
    const node = nodes.get(nodeId);
    if (!node?.turnout || node.turnout.kind !== 'simple') continue;
    const speed = turnoutGeometry(node.turnout).divergingSpeedKmh;
    const roles = turnoutRoles(net, nodeId);
    if (!speed || !roles) continue;
    const pair = (x: TrackEndRef, y: TrackEndRef) =>
      (sameEnd(exit, x) && sameEnd(entry, y)) || (sameEnd(exit, y) && sameEnd(entry, x));
    if (!pair(roles.toe, roles.diverging)) continue;
    // Length of the diverging track's first element from the node.
    const divTrack = tracks.get(roles.diverging.trackId)!;
    const prims = trackGeometry(net, divTrack).primitives;
    const first = roles.diverging.end === 'start' ? prims[0] : prims[prims.length - 1];
    const len = first ? length(first) : 0;
    const divIsNext = sameEnd(entry, roles.diverging);
    const a = divIsNext ? at : at - len;
    const b = divIsNext ? at + len : at;
    out.push({
      nodeId,
      fromFraction: Math.max(0, a / total),
      toFraction: Math.min(1, b / total),
      speedKmh: speed,
    });
  }
  return out;
}

/** The smallest radius of the diverging track's first arc from the node, or null if it starts straight. */
export function divergingRadiusM(net: TrackNetwork, roles: TurnoutRoles): number | null {
  const t = net.tracks.find((x) => x.id === roles.diverging.trackId);
  if (!t) return null;
  const prims = trackGeometry(net, t).primitives;
  const ordered = roles.diverging.end === 'start' ? prims : [...prims].reverse();
  const arc = ordered.find((p) => p.kind === 'arc');
  return arc && arc.kind === 'arc' ? arc.radius : null;
}
