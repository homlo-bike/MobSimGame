/**
 * The track graph: which tracks a train can reach from which, following only
 * permitted movements at nodes and the running direction of each track.
 *
 * A graph state is (track, direction): +1 runs from → to, −1 to → from. Paths
 * never reverse inside a track or at a node; trains reverse only at the ends of
 * a service.
 */
import type { PhysicalTrack, TrackEndRef, TrackNetwork, TrackStep } from './schema';
import { isPermitted, nodeEnds, nodeMap, trackGeometry } from './tracks';

export type Dir = 1 | -1;

export function permits(track: PhysicalTrack, dir: Dir): boolean {
  return track.direction === 'both' || (track.direction === 'forward' ? dir === 1 : dir === -1);
}

/** Tracks reachable when leaving `track` in direction `dir` through the node at its far end. */
export function successors(
  net: TrackNetwork,
  track: PhysicalTrack,
  dir: Dir,
  allow?: (t: PhysicalTrack) => boolean,
): { track: PhysicalTrack; dir: Dir }[] {
  const nodeId = dir === 1 ? track.toNodeId : track.fromNodeId;
  const node = net.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  const arriving: TrackEndRef = { trackId: track.id, end: dir === 1 ? 'end' : 'start' };
  const out: { track: PhysicalTrack; dir: Dir }[] = [];
  for (const e of nodeEnds(net, nodeId)) {
    if (e.trackId === track.id && e.end === arriving.end) continue;
    if (!isPermitted(node, arriving, e)) continue;
    const t = net.tracks.find((x) => x.id === e.trackId);
    if (!t || (allow && !allow(t))) continue;
    const d: Dir = e.end === 'start' ? 1 : -1;
    if (permits(t, d)) out.push({ track: t, dir: d });
  }
  return out;
}

export interface TrackPosition {
  trackId: string;
  fraction: number;
}

export interface GraphPath {
  steps: TrackStep[];
  lengthM: number;
  /** Direction on the last track at the target. */
  arrivalDir: Dir;
}

interface Label {
  track: PhysicalTrack;
  dir: Dir;
  /** Distance travelled when entering this track (negative offset for the start track). */
  entry: number;
  prev: Label | null;
  start: boolean;
}

/**
 * Shortest permitted path from `from` to `to`. `startDir` fixes the direction
 * of departure (a train continuing its route cannot reverse at a stop); when
 * omitted both directions are tried.
 */
export function shortestPath(
  net: TrackNetwork,
  from: TrackPosition,
  to: TrackPosition,
  startDir?: Dir,
  allow?: (t: PhysicalTrack) => boolean,
): GraphPath | null {
  const byId = new Map(net.tracks.map((t) => [t.id, t]));
  const start = byId.get(from.trackId);
  const goal = byId.get(to.trackId);
  if (!start || !goal) return null;
  if (allow && (!allow(start) || !allow(goal))) return null;
  const lengths = new Map<string, number>();
  const len = (t: PhysicalTrack) => {
    let l = lengths.get(t.id);
    if (l === undefined) lengths.set(t.id, (l = trackGeometry(net, t).lengthM));
    return l;
  };
  const along = (t: PhysicalTrack, d: Dir, f: number) => (d === 1 ? f : 1 - f) * len(t);
  const open: Label[] = [];
  for (const d of startDir ? [startDir] : ([1, -1] as Dir[]))
    if (permits(start, d))
      open.push({ track: start, dir: d, entry: -along(start, d, from.fraction), prev: null, start: true });
  const settled = new Set<string>();
  let best: { label: Label; total: number } | null = null;
  while (open.length) {
    open.sort((x, y) => x.entry - y.entry);
    const cur = open.shift()!;
    if (best && cur.entry >= best.total) break;
    const k = `${cur.track.id}|${cur.dir}`;
    if (!cur.start) {
      if (settled.has(k)) continue;
      settled.add(k);
    }
    if (cur.track.id === goal.id) {
      const atGoal = cur.entry + along(goal, cur.dir, to.fraction);
      const ahead =
        !cur.start || along(goal, cur.dir, to.fraction) >= along(start, cur.dir, from.fraction) - 1e-9;
      if (ahead && (!best || atGoal < best.total)) best = { label: cur, total: atGoal };
    }
    const exit = cur.entry + len(cur.track);
    for (const nx of successors(net, cur.track, cur.dir, allow))
      if (!settled.has(`${nx.track.id}|${nx.dir}`))
        open.push({ track: nx.track, dir: nx.dir, entry: exit, prev: cur, start: false });
  }
  if (!best) return null;
  const chain: Label[] = [];
  for (let l: Label | null = best.label; l; l = l.prev) chain.unshift(l);
  const steps: TrackStep[] = chain.map((l, i) => {
    const f0 = i === 0 ? from.fraction : l.dir === 1 ? 0 : 1;
    const f1 = i === chain.length - 1 ? to.fraction : l.dir === 1 ? 1 : 0;
    return { trackId: l.track.id, reversed: l.dir === -1, from: f0, to: f1 };
  });
  return { steps, lengthM: Math.max(0, best.total), arrivalDir: best.label.dir };
}

/** Length in metres of a list of steps. */
export function stepsLengthM(net: TrackNetwork, steps: readonly TrackStep[]): number {
  const byId = new Map(net.tracks.map((t) => [t.id, t]));
  return steps.reduce((sum, s) => {
    const t = byId.get(s.trackId);
    return t ? sum + Math.abs(s.to - s.from) * trackGeometry(net, t).lengthM : sum;
  }, 0);
}

export interface BlockMembership {
  blockId: string;
  /** +1 when the track's from → to runs in the block's reference direction, −1 otherwise. */
  orientation: Dir;
}

/**
 * Single-track blocks: maximal chains of bidirectional tracks joined at nodes
 * where exactly two track ends meet with a through movement. A train in a block
 * stops trains of the other direction from entering the whole block (there is
 * nowhere to pass inside it). Returns track id → block membership.
 */
export function singleTrackBlocks(net: TrackNetwork): Map<string, BlockMembership> {
  const nodes = nodeMap(net);
  const out = new Map<string, BlockMembership>();
  const both = net.tracks.filter((t) => t.direction === 'both');
  const byId = new Map(both.map((t) => [t.id, t]));
  for (const t of both) {
    if (out.has(t.id)) continue;
    const blockId = `block:${t.id}`;
    const stack: { track: PhysicalTrack; orientation: Dir }[] = [{ track: t, orientation: 1 }];
    while (stack.length) {
      const { track: cur, orientation } = stack.pop()!;
      if (out.has(cur.id)) continue;
      out.set(cur.id, { blockId, orientation });
      for (const own of ['start', 'end'] as const) {
        const nodeId = own === 'start' ? cur.fromNodeId : cur.toNodeId;
        const ends = nodeEnds(net, nodeId);
        const node = nodes.get(nodeId);
        if (ends.length !== 2 || !node || !isPermitted(node, ends[0]!, ends[1]!)) continue;
        const other = ends.find((e) => !(e.trackId === cur.id && e.end === own));
        const nb = other ? byId.get(other.trackId) : undefined;
        if (!other || !nb || out.has(nb.id)) continue;
        // Travelling through the node keeps the block direction: own dir × own orientation = nb dir × nb orientation.
        const dirCur: Dir = own === 'end' ? 1 : -1;
        const dirNb: Dir = other.end === 'start' ? 1 : -1;
        stack.push({ track: nb, orientation: (dirCur * orientation * dirNb) as Dir });
      }
    }
  }
  return out;
}

/** Connected components of the graph (ignoring directions), as lists of track ids. */
export function components(net: TrackNetwork): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const t of net.tracks) {
    if (seen.has(t.id)) continue;
    const comp: string[] = [];
    const stack = [t];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur.id)) continue;
      seen.add(cur.id);
      comp.push(cur.id);
      for (const d of [1, -1] as Dir[])
        for (const nx of successorsIgnoringDirection(net, cur, d)) if (!seen.has(nx.id)) stack.push(nx);
    }
    out.push(comp);
  }
  return out;
}

function successorsIgnoringDirection(net: TrackNetwork, track: PhysicalTrack, dir: Dir): PhysicalTrack[] {
  const nodeId = dir === 1 ? track.toNodeId : track.fromNodeId;
  const node = net.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  const arriving: TrackEndRef = { trackId: track.id, end: dir === 1 ? 'end' : 'start' };
  return nodeEnds(net, nodeId)
    .filter((e) => !(e.trackId === track.id && e.end === arriving.end) && isPermitted(node, arriving, e))
    .map((e) => net.tracks.find((x) => x.id === e.trackId))
    .filter((x): x is PhysicalTrack => !!x);
}
