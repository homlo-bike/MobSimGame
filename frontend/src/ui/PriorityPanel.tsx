/** Priority at crossings and merges between lines (simulation/conflicts.ts), editable per project. */
import { MODES } from '../domain/modes';
import { MODE_PRIORITY, moveModePriority } from '../domain/modeSeparation';
import { useScenario, useStore } from '../store/projectStore';
import { Button, Section } from './primitives';

export function PriorityPanel({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const scenario = useScenario();
  const commit = useStore((s) => s.commitScenario);
  const order = scenario.modePriority ?? MODE_PRIORITY;
  return (
    <Section title="Crossing priority" id="crossing-priority" collapsible defaultOpen={defaultOpen}>
      <p className="mb-1 text-xs text-slate-600">
        Where lines cross or merge on the same level, the higher mode goes first and the other waits until the
        crossing is clear. Between vehicles of the same mode, the one that arrives first goes first. Crossings
        are marked on the map.
      </p>
      <ol aria-label="Priority, highest first" className="space-y-0.5 text-sm">
        {order.map((m, i) => (
          <li key={m} className="flex items-center gap-1">
            <span className="w-5 text-end text-slate-500">{i + 1}.</span>
            <span className="flex-1">{MODES[m].label}</span>
            <Button
              disabled={i === 0}
              aria-label={`Move ${MODES[m].label} up`}
              onClick={() =>
                commit(moveModePriority(scenario, m, -1), `${MODES[m].label} moved up in priority`)
              }
            >
              ↑
            </Button>
            <Button
              disabled={i === order.length - 1}
              aria-label={`Move ${MODES[m].label} down`}
              onClick={() =>
                commit(moveModePriority(scenario, m, 1), `${MODES[m].label} moved down in priority`)
              }
            >
              ↓
            </Button>
          </li>
        ))}
      </ol>
      {scenario.modePriority && (
        <Button
          className="mt-1"
          onClick={() => commit({ ...scenario, modePriority: undefined }, 'Crossing priority reset')}
        >
          Reset to the default order
        </Button>
      )}
    </Section>
  );
}
