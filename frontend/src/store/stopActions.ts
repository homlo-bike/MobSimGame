/** Store actions for drawing bus, BRT and trolleybus lines stop by stop. */
import type { LngLat } from '../domain/schema';
import { activeScenario } from '../domain/network';
import { MODES } from '../domain/modes';
import { createStopLine, isStopLineMode, stopNear } from '../domain/stopLines';
import { autoRoute } from '../routing/autoRoute';
import { useStore } from './projectStore';
import { createLogger } from '../util/logger';

const log = createLogger('stop-lines');

/** True while the drawing tool places stops (street modes) rather than track or vertices. */
export function drawingStops(): boolean {
  const s = useStore.getState();
  return s.tool === 'draw_line' && isStopLineMode(s.newLineMode);
}

/** Add a clicked stop to the draft; a click near an existing stop of the mode reuses it. */
export function addDraftStop(at: LngLat) {
  const state = useStore.getState();
  const sc = activeScenario(state.project);
  const existing = stopNear(sc, state.newLineMode, at);
  const p: LngLat = existing ? [existing.position[0], existing.position[1]] : [at[0], at[1]];
  const draft = state.stopDraft;
  const last = draft[draft.length - 1];
  if (last && last[0] === p[0] && last[1] === p[1]) return;
  state.setStopDraft([...draft, p]);
  state.announce(
    `Stop ${draft.length + 1}${existing ? `: ${existing.name} (existing)` : ''}. Esc or right-click finishes the line.`,
  );
}

export function removeLastDraftStop() {
  const state = useStore.getState();
  if (!state.stopDraft.length) return;
  state.setStopDraft(state.stopDraft.slice(0, -1));
  state.announce(`Stop ${state.stopDraft.length + 1} removed`);
}

/**
 * Create the line from the drafted stops: one way through them in order and back to the
 * first stop. With fewer than two stops the drawing is cancelled.
 */
export function finishStopDraft(): string | null {
  const state = useStore.getState();
  const points = state.stopDraft;
  if (points.length < 2) {
    state.setStopDraft([]);
    state.setTool('select');
    state.announce(points.length ? 'A line needs at least two stops; nothing created' : 'Tool cancelled');
    return null;
  }
  const sc = activeScenario(state.project);
  const res = createStopLine(sc, { points, mode: state.newLineMode });
  if (res.error || !res.line) {
    state.announce(res.error ?? 'Line could not be created');
    return null;
  }
  const line = res.line;
  state.commitScenario(
    res.scenario,
    `${MODES[line.mode].label} line "${line.name}" created with ${line.stops.length} stops; it returns to the first stop`,
  );
  log.debug('stop line created', { lineId: line.id, stops: line.stops.length, reused: res.reused });
  state.setStopDraft([]);
  state.setTool('select');
  state.select({ kind: 'line', id: line.id });
  void autoRoute(line.id);
  return line.id;
}
