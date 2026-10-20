/** The single simulation clock shared by the map renderer and the controls. */
import type { Scenario } from '../domain/schema';
import { SimulationClock, type ClosureInput, type SimulationOptions } from './engine';

export const simulationClock = new SimulationClock();

export function formatSimTime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Simulation inputs from the scenario (signals) and the current disruption settings. */
export function simulationOptions(scenario: Scenario, closures: readonly ClosureInput[]): SimulationOptions {
  return {
    closures,
    signalPriorityS: scenario.signalSettings.priorityAdjustmentS,
    signals: scenario.trafficSignals.map((sig) => ({
      position: sig.position,
      cycleS: sig.cycleS,
      greenS: sig.greenS,
      offsetS: sig.offsetS,
    })),
  };
}
