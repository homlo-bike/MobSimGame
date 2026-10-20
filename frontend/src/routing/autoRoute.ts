/** Route a line after its waypoints change, if the server offers street routing. */
import { activeScenario } from '../domain/network';
import { useStore } from '../store/projectStore';
import { routeLineOnStreets } from './routeLine';

export async function autoRoute(lineId: string): Promise<void> {
  const before = activeScenario(useStore.getState().project);
  const line = before.lines.find((l) => l.id === lineId);
  if (!line || line.alignment.kind !== 'routed') return;
  if (!line.alignment.legs.some((l) => l.status === 'unrouted')) return;
  const waypoints = JSON.stringify(line.alignment.waypoints);
  const outcome = await routeLineOnStreets(before, line);
  // Apply only if the user has not edited this line's waypoints in the meantime.
  const state = useStore.getState();
  const now = activeScenario(state.project);
  const current = now.lines.find((l) => l.id === lineId);
  if (!current || current.alignment.kind !== 'routed') return;
  if (JSON.stringify(current.alignment.waypoints) !== waypoints) return;
  const routed = outcome.scenario.lines.find((l) => l.id === lineId);
  if (outcome.routed + outcome.failed > 0 && routed) {
    state.commitScenario(
      { ...now, lines: now.lines.map((l) => (l.id === lineId ? routed : l)) },
      outcome.message,
    );
  } else {
    state.announce(outcome.message);
  }
}
