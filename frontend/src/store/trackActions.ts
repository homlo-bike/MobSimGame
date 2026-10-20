/**
 * Store actions for the track editor that combine several domain operations
 * (all pure; this module only reads and commits store state).
 */
import type { LngLat } from '../domain/schema';
import { activeScenario, createLine } from '../domain/network';
import { createTracks, isRailMode, removeTrack, trackUsage } from '../domain/tracks';
import {
  afterTrackEdit,
  deleteTrackWithServices,
  setServiceStops,
  type DeleteTrackChoice,
} from '../domain/serviceRouting';
import { MODES } from '../domain/modes';
import { useStore } from './projectStore';
import { createLogger } from '../util/logger';

const log = createLogger('tracks');

/** Draw track (single or double) with the current tool options. Returns the new track ids. */
export function drawTracks(points: LngLat[]): string[] {
  const state = useStore.getState();
  const sc = activeScenario(state.project);
  const mode = isRailMode(state.newLineMode) ? state.newLineMode : 'tram';
  const o = state.trackDraw;
  const res = createTracks(sc, {
    points,
    mode,
    double: o.double,
    radiusM: o.radius === 'default' ? undefined : o.radius,
    structure: o.structure === 'default' ? undefined : o.structure,
  });
  if (res.error) {
    state.announce(res.error);
    return [];
  }
  // A new track may split existing ones (junctions): keep stations and services on them.
  const next = afterTrackEdit(res.scenario, res.trackIds);
  state.commitScenario(
    next,
    `${o.double ? 'Double track' : 'Track'} drawn (${MODES[mode].label}, ${points.length} points)`,
  );
  log.debug('track drawn', { tracks: res.trackIds.length, points: points.length, double: o.double });
  return res.trackIds;
}

/** Delete tracks; when services use them, ask the user first (cancel, reroute, break, delete services). */
export function requestTrackDeletion(trackIds: string[]) {
  const state = useStore.getState();
  const sc = activeScenario(state.project);
  const lineIds = [...new Set(trackIds.flatMap((id) => trackUsage(sc, id).lineIds))];
  if (!lineIds.length) {
    let next = sc;
    for (const id of trackIds) next = removeTrack(next, id);
    state.commitScenario(next, trackIds.length > 1 ? `${trackIds.length} tracks deleted` : 'Track deleted');
    state.select(null);
    return;
  }
  state.setPendingTrackDeletion({ trackIds, lineIds });
}

export function resolveTrackDeletion(choice: DeleteTrackChoice | 'cancel') {
  const state = useStore.getState();
  const pending = state.pendingTrackDeletion;
  state.setPendingTrackDeletion(null);
  if (!pending || choice === 'cancel') {
    // Re-render so the map shows the tracks again.
    state.commitScenario({ ...activeScenario(state.project) });
    state.announce('Track not deleted');
    return;
  }
  let next = activeScenario(state.project);
  for (const id of pending.trackIds) next = deleteTrackWithServices(next, id, choice);
  const label =
    choice === 'reroute'
      ? 'Track deleted; services rerouted where possible'
      : choice === 'break'
        ? 'Track deleted; affected services are unrouted'
        : 'Track and the services using it deleted';
  state.commitScenario(next, label);
  state.select(null);
}

/** Create a service on tracks from the stations picked with the "New service" tool. */
export function finishServiceDraft(): string | null {
  const state = useStore.getState();
  const ids = state.serviceDraft;
  if (ids.length < 2) {
    state.announce('Pick at least two stations on tracks, then press Enter or “Create service”.');
    return null;
  }
  const sc = activeScenario(state.project);
  const mode = isRailMode(state.newLineMode) ? state.newLineMode : 'tram';
  const positions = ids.map((id) => sc.stations.find((s) => s.id === id)!.position);
  const c = createLine(sc, { coordinates: positions, mode, ring: false });
  const next = setServiceStops(c.scenario, c.line.id, ids);
  state.commitScenario(next, `Service "${c.line.name}" created with ${ids.length} stations`);
  state.setServiceDraft([]);
  state.setTool('select');
  state.select({ kind: 'line', id: c.line.id });
  return c.line.id;
}
