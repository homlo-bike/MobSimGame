/** The single simulation clock shared by the map renderer and the controls. */
import type { Scenario } from '../domain/schema';
import { SimulationClock, type ClosureInput, type SimulationOptions } from './engine';
import { signalAppliesTo } from '../domain/signals';
import { clockToS, DAY_S } from '../domain/timetable';

export const simulationClock = new SimulationClock();

export function formatSimTime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Where the animation starts: the first peak of day 1, else the earliest service start. */
export function simulationStartS(scenario: Scenario): number {
  const peaks = scenario.peakPeriods.map((p) => clockToS(p.start));
  if (peaks.length) return Math.min(...peaks);
  const starts = scenario.lines.flatMap((l) => l.servicePatterns.map((p) => clockToS(p.serviceStart)));
  return starts.length ? Math.min(...starts) : 0;
}

/** "Day 1 · 07:30:00" for a simulated time in seconds since midnight of day 1. */
export function formatSimDayTime(seconds: number): string {
  const day = Math.floor(seconds / DAY_S);
  return `Day ${day + 1} · ${formatSimTime(seconds - day * DAY_S)}`;
}

/** Simulation inputs from the scenario (signals) and the current disruption settings. */
export function simulationOptions(scenario: Scenario, closures: readonly ClosureInput[]): SimulationOptions {
  return {
    closures,
    // The animation runs the service day; analyses that need a steady peak hour drop this.
    timetable: { peakPeriods: scenario.peakPeriods },
    routedOnly: true,
    signalPriorityS: scenario.signalSettings.priorityAdjustmentS,
    signals: scenario.trafficSignals.map((sig) => ({
      position: sig.position,
      cycleS: sig.cycleS,
      greenS: sig.greenS,
      offsetS: sig.offsetS,
      delayS: sig.approxDelayS,
      appliesTo: (line: Parameters<typeof signalAppliesTo>[1]) => signalAppliesTo(sig, line),
      attached: sig.attachedTo !== null,
    })),
  };
}
