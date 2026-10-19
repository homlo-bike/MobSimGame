import { useEffect, useState } from 'react';
import { useStore } from '../store/projectStore';
import { formatSimTime, simulationClock } from '../simulation/runtime';
import { Button } from './primitives';

const SPEEDS = [1, 10, 30, 60, 120, 300];

export function SimulationControls() {
  const running = useStore((s) => s.simulationRunning);
  const setRunning = useStore((s) => s.setSimulationRunning);
  const multiplier = useStore((s) => s.simulationMultiplier);
  const setMultiplier = useStore((s) => s.setSimulationMultiplier);
  const reducedMotion = useStore((s) => s.reducedMotion);
  const resetSimulation = useStore((s) => s.resetSimulation);
  const [time, setTime] = useState(0);

  useEffect(() => {
    simulationClock.setMultiplier(multiplier);
  }, [multiplier]);
  useEffect(() => {
    const id = setInterval(() => setTime(simulationClock.tick()), 500);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="flex flex-wrap items-center gap-2 text-sm"
      role="group"
      aria-label="Vehicle animation controls"
    >
      <strong className="text-slate-800">Animation</strong>
      <Button
        variant={running ? 'secondary' : 'primary'}
        onClick={() => setRunning(!running)}
        aria-label={running ? 'Pause animation' : 'Start animation'}
      >
        {running ? '❚❚ Pause' : '▶ Play'}
      </Button>
      <Button
        onClick={() => {
          resetSimulation();
          setTime(0);
        }}
      >
        ↺ Reset
      </Button>
      <label htmlFor="sim-speed" className="text-slate-800">
        Speed
      </label>
      <select
        id="sim-speed"
        className="rounded border border-slate-500 px-1 py-0.5"
        value={multiplier}
        onChange={(e) => setMultiplier(Number(e.target.value))}
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <span aria-live="off" className="font-mono" data-testid="sim-time">
        Simulated time {formatSimTime(time)}
      </span>
      <span className="text-xs text-slate-600">
        Illustrative animation (constant segment speeds, fixed dwell); not an operational simulation.
        {reducedMotion ? ' Reduced motion: positions update every 2 s.' : ''}
      </span>
    </div>
  );
}
