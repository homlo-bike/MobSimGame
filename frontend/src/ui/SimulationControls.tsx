import { useEffect, useState } from 'react';
import { useScenario, useStore } from '../store/projectStore';
import { formatSimDayTime, simulationClock, simulationStartS } from '../simulation/runtime';
import { clockToS, DAY_S, periodAt } from '../domain/timetable';
import { Button } from './primitives';

const SPEEDS = [1, 10, 30, 60, 120, 300, 600];

/** What the network runs at a time: peak, off-peak or no service (any line). */
function networkPeriod(scenario: ReturnType<typeof useScenario>, tS: number): string {
  const kinds = scenario.lines.flatMap((l) =>
    l.servicePatterns.slice(0, 1).map((p) => periodAt(p, scenario.peakPeriods, tS)),
  );
  if (kinds.includes('peak')) return 'Peak';
  if (kinds.includes('off_peak')) return 'Off-peak';
  return kinds.length ? 'No service' : '';
}

export function SimulationControls() {
  const scenario = useScenario();
  const running = useStore((s) => s.simulationRunning);
  const setRunning = useStore((s) => s.setSimulationRunning);
  const multiplier = useStore((s) => s.simulationMultiplier);
  const setMultiplier = useStore((s) => s.setSimulationMultiplier);
  const reducedMotion = useStore((s) => s.reducedMotion);
  const resetSimulation = useStore((s) => s.resetSimulation);
  const seek = useStore((s) => s.seekSimulation);
  const [time, setTime] = useState(0);

  useEffect(() => {
    simulationClock.setMultiplier(multiplier);
  }, [multiplier]);
  useEffect(() => {
    // The day starts at the first peak (or the first service), not at midnight.
    if (simulationClock.timeS === 0) seek(simulationStartS(scenario));
    const id = setInterval(() => setTime(simulationClock.tick()), 500);
    return () => clearInterval(id);
    // Only on mount: later the user sets the time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dayStart = Math.floor(time / DAY_S) * DAY_S;
  const jump = (hhmm: string) => {
    const t = dayStart + clockToS(hhmm);
    seek(t);
    setTime(t);
  };
  const morning = scenario.peakPeriods[0]?.start ?? '07:00';

  return (
    <div
      className="flex flex-wrap items-center gap-2 text-sm"
      role="group"
      aria-label="Vehicle animation controls"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Animation</span>
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
          setTime(simulationStartS(scenario));
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
      <span aria-live="off" className="font-mono text-xs text-slate-700" data-testid="sim-time">
        <span className="sr-only">Simulated time </span>
        {formatSimDayTime(time)}
      </span>
      <span className="text-xs font-medium text-slate-700" data-testid="sim-period">
        {networkPeriod(scenario, time)}
      </span>
      <label htmlFor="sim-goto" className="text-slate-800">
        Go to
      </label>
      <input
        id="sim-goto"
        type="time"
        className="rounded border border-slate-500 px-1 py-0.5"
        onChange={(e) => e.target.value && jump(e.target.value)}
      />
      <Button onClick={() => jump(morning)}>Peak</Button>
      <Button onClick={() => jump('12:00')}>Midday</Button>
      <Button onClick={() => jump('02:00')}>Night</Button>
      <span
        className="text-xs text-slate-500"
        title="Timetables from each line's headways and service hours; not an operational simulation."
      >
        Illustrative only{reducedMotion ? ' · reduced motion (updates every 2 s)' : ''}
      </span>
    </div>
  );
}
