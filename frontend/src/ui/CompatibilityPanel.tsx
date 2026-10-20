/** Which track classes each rail service mode may use (domain/compatibility.ts), editable per project. */
import {
  allowedClasses,
  DEFAULT_CLASS_FOR_MODE,
  INFRASTRUCTURE_CLASS_LABELS,
  isCompatibilityOverridden,
  RAIL_CLASSES,
  setServiceCompatibility,
} from '../domain/compatibility';
import { MODES } from '../domain/modes';
import { rerouteServices } from '../domain/serviceRouting';
import { RAIL_MODES } from '../domain/tracks';
import { useScenario, useStore } from '../store/projectStore';
import { Badge, Button, Section } from './primitives';

export function CompatibilityPanel() {
  const scenario = useScenario();
  const commit = useStore((s) => s.commitScenario);
  const net = scenario.trackNetwork;
  const apply = (next: typeof scenario, label: string) => commit(rerouteServices(next), label);
  return (
    <Section title="Infrastructure compatibility" id="compatibility" collapsible defaultOpen={false}>
      <p className="mb-1 text-xs text-slate-600">
        Which track a rail service may run on. Services are routed only over allowed track. The defaults are a
        modelling convention of this tool, not a cited rule; allow more where your network does (for example
        tram-trains on railway track). Bus and BRT stay street-routed.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">
            Service modes (rows) and the track classes they may use (columns)
          </caption>
          <thead>
            <tr>
              <th scope="col" className="text-start">
                Service
              </th>
              {RAIL_CLASSES.map((c) => (
                <th key={c} scope="col" className="px-1 text-start font-medium">
                  {INFRASTRUCTURE_CLASS_LABELS[c].replace(' track', '')}
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">Reset</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {RAIL_MODES.map((m) => {
              const allowed = allowedClasses(net, m);
              const own = DEFAULT_CLASS_FOR_MODE[m];
              const changed = isCompatibilityOverridden(net, m);
              return (
                <tr key={m}>
                  <th scope="row" className="text-start font-normal">
                    {MODES[m].label} {changed && <Badge>Changed</Badge>}
                  </th>
                  {RAIL_CLASSES.map((c) => (
                    <td key={c} className="px-1">
                      <input
                        type="checkbox"
                        aria-label={`${MODES[m].label} may use ${INFRASTRUCTURE_CLASS_LABELS[c].toLowerCase()}`}
                        checked={allowed.includes(c)}
                        disabled={c === own}
                        title={c === own ? 'A mode always uses its own track class' : undefined}
                        onChange={(e) =>
                          apply(
                            setServiceCompatibility(
                              scenario,
                              m,
                              e.target.checked ? [...allowed, c] : allowed.filter((x) => x !== c),
                            ),
                            `${MODES[m].label} ${e.target.checked ? 'may' : 'may not'} use ${INFRASTRUCTURE_CLASS_LABELS[c].toLowerCase()}`,
                          )
                        }
                      />
                    </td>
                  ))}
                  <td>
                    {changed && (
                      <Button
                        onClick={() =>
                          apply(
                            setServiceCompatibility(scenario, m, null),
                            `${MODES[m].label} compatibility reset`,
                          )
                        }
                      >
                        Reset
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
