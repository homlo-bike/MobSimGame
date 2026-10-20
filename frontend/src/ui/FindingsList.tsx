/**
 * Validation findings: labelled category counts with definitions, filters,
 * sorting, and links between each finding and the object it concerns.
 * Categories use text and a symbol, never colour alone.
 */
import { useEffect, useRef, useState } from 'react';
import type { Scenario } from '../domain/schema';
import type { Finding, Severity } from '../validation/validate';
import {
  SEVERITY_DEFINITIONS,
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  SEVERITY_PLURALS,
  SEVERITY_SYMBOLS,
} from '../validation/validate';
import {
  countBySeverity,
  findingPosition,
  findingSubject,
  sortFindings,
  type FindingSort,
} from '../validation/locate';
import { useStore } from '../store/projectStore';
import { focusFinding } from '../map/focus';
import { SelectField } from './primitives';

const TONE: Record<Severity, string> = {
  error: 'border-red-700 bg-red-50/60 text-red-950',
  warning: 'border-amber-600 bg-amber-50/60 text-amber-950',
  recommendation: 'border-sky-600 bg-sky-50/50 text-slate-900',
  info: 'border-slate-300 text-slate-700',
};

const SORT_LABELS: Record<FindingSort, string> = {
  severity: 'Severity',
  line: 'Line',
  station: 'Station',
  segment: 'Segment or track',
  mode: 'Mode',
};

/**
 * Counts per category with their meaning. With `onToggle`, each category is a
 * toggle button that filters the list.
 */
export function ValidationSummary({
  findings,
  shown,
  onToggle,
}: {
  findings: readonly Finding[];
  shown?: Record<Severity, boolean>;
  onToggle?: (s: Severity) => void;
}) {
  const counts = countBySeverity(findings);
  return (
    <div>
      <ul className="mb-1 grid grid-cols-2 gap-1" aria-label="Findings by category">
        {SEVERITY_ORDER.map((sev) => {
          const label = `${SEVERITY_SYMBOLS[sev]} ${SEVERITY_PLURALS[sev]}: ${counts[sev]}`;
          return (
            <li key={sev}>
              {onToggle ? (
                <button
                  type="button"
                  aria-pressed={shown?.[sev] ?? true}
                  title={SEVERITY_DEFINITIONS[sev]}
                  onClick={() => onToggle(sev)}
                  className={`w-full rounded border-s-[3px] px-2 py-0.5 text-start text-sm ${TONE[sev]} ${
                    shown?.[sev] === false ? 'opacity-50 line-through' : ''
                  }`}
                >
                  {label}
                </button>
              ) : (
                <span
                  title={SEVERITY_DEFINITIONS[sev]}
                  className={`block rounded border-s-[3px] px-2 py-0.5 text-sm ${TONE[sev]}`}
                >
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <details className="text-xs text-slate-700">
        <summary className="cursor-pointer select-none">What do the categories mean?</summary>
        <dl className="mt-1 space-y-0.5">
          {SEVERITY_ORDER.map((sev) => (
            <div key={sev}>
              <dt className="inline font-semibold">
                {SEVERITY_SYMBOLS[sev]} {SEVERITY_LABELS[sev]}:
              </dt>{' '}
              <dd className="inline">{SEVERITY_DEFINITIONS[sev]}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

export function FindingsList({ findings, scenario }: { findings: Finding[]; scenario?: Scenario }) {
  const select = useStore((s) => s.select);
  const setView = useStore((s) => s.setView);
  const focused = useStore((s) => s.focusedFindingId);
  const setFocused = useStore((s) => s.setFocusedFinding);
  const activeScenario = useStore((s) =>
    s.project.scenarios.find((x) => x.id === s.project.activeScenarioId),
  );
  const sc = scenario ?? activeScenario!;
  const [shown, setShown] = useState<Record<Severity, boolean>>({
    error: true,
    warning: true,
    recommendation: true,
    info: true,
  });
  const [sort, setSort] = useState<FindingSort>('severity');
  const focusedRef = useRef<HTMLLIElement>(null);
  // A finding chosen on the map scrolls into view in the list.
  useEffect(() => {
    focusedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [focused]);

  if (findings.length === 0) return <p className="text-sm text-slate-700">No findings.</p>;
  const errors = findings.filter((f) => f.severity === 'error').length;
  const visible = sortFindings(
    findings.filter((f) => shown[f.severity]),
    sort,
    sc,
  );
  return (
    <div>
      <p className="mb-1 text-sm font-semibold" role={errors ? 'alert' : undefined}>
        {errors ? `${SEVERITY_SYMBOLS.error} ${errors} error(s) need your action.` : '✓ No errors.'}{' '}
        <span className="font-normal text-slate-600">
          Findings are advisory and do not certify safety or buildability.
        </span>
      </p>
      <ValidationSummary
        findings={findings}
        shown={shown}
        onToggle={(sev) => setShown({ ...shown, [sev]: !shown[sev] })}
      />
      <SelectField
        label="Sort findings by"
        value={sort}
        onChange={(e) => setSort(e.target.value as FindingSort)}
        options={(Object.keys(SORT_LABELS) as FindingSort[]).map((k) => ({
          value: k,
          label: SORT_LABELS[k],
        }))}
      />
      <p className="sr-only" aria-live="polite">
        {visible.length} of {findings.length} findings shown
      </p>
      <ul className="space-y-1" aria-label="Findings">
        {visible.map((f) => {
          const isFocused = f.id === focused;
          const linkable = !!findingSubject(f) || !!findingPosition(f, sc);
          return (
            <li
              key={f.id}
              ref={isFocused ? focusedRef : undefined}
              aria-current={isFocused ? 'true' : undefined}
              className={`border-s-[3px] px-2 py-1 text-[13px] leading-snug ${TONE[f.severity]} ${
                isFocused ? 'outline outline-2 outline-offset-1 outline-teal-700' : ''
              }`}
            >
              <span className="font-semibold">
                {SEVERITY_SYMBOLS[f.severity]} {SEVERITY_LABELS[f.severity]}:
              </span>{' '}
              {f.message}
              {linkable && (
                <button
                  type="button"
                  className="ms-1 underline"
                  aria-label={`Show on map: ${f.message}`}
                  onClick={() => focusFinding(sc, f, select, setView, setFocused)}
                >
                  Show
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
