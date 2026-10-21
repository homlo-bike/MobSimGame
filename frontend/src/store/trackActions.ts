/**
 * Store actions for the track editor that combine several domain operations
 * (all pure; this module only reads and commits store state).
 */
import type { LngLat } from '../domain/schema';
import { activeScenario, createLine, deleteLine, updateLine } from '../domain/network';
import { stopsOnlyServedBy } from '../domain/stationKinds';
import { notify } from './notifications';
import { createTracks, drawnAsLoop, isRailMode, removeTrack, trackUsage } from '../domain/tracks';
import {
  afterTrackEdit,
  deleteTrackWithServices,
  setServiceStops,
  type DeleteTrackChoice,
} from '../domain/serviceRouting';
import { MODES } from '../domain/modes';
import { snapDrawingToStations } from '../domain/stationLayout';
import { stationMode } from '../domain/modeSeparation';
import { useStore } from './projectStore';
import { createLogger } from '../util/logger';

const log = createLogger('tracks');

/** Draw track (single or double) with the current tool options. Returns the new track ids. */
export function drawTracks(points: LngLat[], options: { loop?: boolean } = {}): string[] {
  const state = useStore.getState();
  const sc = activeScenario(state.project);
  const mode = isRailMode(state.newLineMode) ? state.newLineMode : 'tram';
  const o = state.trackDraw;
  const res = createTracks(sc, {
    // Track drawn into a station object joins the station's end, not its platform tracks.
    points: snapDrawingToStations(sc, points, o.double, mode),
    mode,
    double: o.double,
    radiusM: o.radius === 'default' ? undefined : o.radius,
    structure: o.structure === 'default' ? undefined : o.structure,
    loop: options.loop ?? false,
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
  // Show the new track in the inspector; the drawing tool stays active for the next track.
  if (res.trackIds[0]) state.select({ kind: 'track', id: res.trackIds[0] });
  return res.trackIds;
}

/**
 * A drawn track: when it ends back at its first point, ask whether to close it into a loop
 * (the answer comes through `resolveLoop`); otherwise create it at once.
 */
export function finishDrawnTrack(points: LngLat[]): string[] {
  const state = useStore.getState();
  const sc = activeScenario(state.project);
  if (drawnAsLoop(sc.trackNetwork, points)) {
    state.setPendingLoop(points);
    return [];
  }
  return drawTracks(points);
}

export function resolveLoop(close: boolean | 'cancel') {
  const state = useStore.getState();
  const points = state.pendingLoop;
  state.setPendingLoop(null);
  if (!points) return;
  if (close === 'cancel') {
    state.announce('Track not drawn');
    return;
  }
  drawTracks(points, { loop: close });
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
  const stops = state.serviceDraft;
  const ids = stops.map((x) => x.stationId);
  if (ids.length < 2) {
    state.announce('Pick at least two stations on tracks, then press Enter or “Create service”.');
    return null;
  }
  const sc = activeScenario(state.project);
  const mode = isRailMode(state.newLineMode) ? state.newLineMode : 'tram';
  const wrong = ids
    .map((id) => sc.stations.find((s) => s.id === id)!)
    .find((st) => stationMode(sc, st) !== mode);
  if (wrong) {
    state.announce(`"${wrong.name}" is not a ${MODES[mode].label} station; modes are kept separate.`);
    return null;
  }
  const positions = ids.map((id) => sc.stations.find((s) => s.id === id)!.position);
  // Loop (default): after the last stop the train returns to the first stop; back: it runs
  // back through the same stations.
  const loop = state.serviceReturn === 'loop';
  const c = createLine(sc, { coordinates: positions, mode, ring: loop });
  const base = loop ? updateLine(c.scenario, c.line.id, { direction: 'one_way' }) : c.scenario;
  const next = setServiceStops(base, c.line.id, stops);
  state.commitScenario(next, `Service "${c.line.name}" created with ${ids.length} stops`);
  state.setServiceDraft([]);
  state.setTool('select');
  state.select({ kind: 'line', id: c.line.id });
  return c.line.id;
}

/** Delete a line; stops left without any line are reported (they stay, flagged by validation). */
export function deleteLineWithNotice(lineId: string) {
  const state = useStore.getState();
  const sc = activeScenario(state.project);
  const line = sc.lines.find((l) => l.id === lineId);
  if (!line) return;
  const orphans = stopsOnlyServedBy(sc, [lineId]);
  state.commitScenario(deleteLine(sc, lineId), `Line "${line.name}" deleted`);
  if (orphans.length)
    notify({
      severity: 'warning',
      kind: 'project',
      title: `${orphans.length} stop(s) no longer served`,
      message: `${orphans.map((s) => s.name).join(', ')} had only "${line.name}". Add them to another line or delete them.`,
      target: { stationId: orphans[0]!.id },
    });
}
