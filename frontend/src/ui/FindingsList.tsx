import type { Finding } from '../validation/validate';
import { SEVERITY_LABELS, SEVERITY_SYMBOLS } from '../validation/validate';
import { useStore } from '../store/projectStore';
import { getMapInstance } from '../map/mapInstance';

const ORDER = { blocking: 0, warning: 1, recommendation: 2, info: 3 } as const;
const TONE = {
  blocking: 'border-red-700 bg-red-50 text-red-950',
  warning: 'border-amber-700 bg-amber-50 text-amber-950',
  recommendation: 'border-sky-700 bg-sky-50 text-sky-950',
  info: 'border-slate-400 bg-slate-50 text-slate-900',
};

export function FindingsList({ findings }: { findings: Finding[] }) {
  const select = useStore((s) => s.select);
  if (findings.length === 0) return <p className="text-sm text-slate-700">No findings.</p>;
  const sorted = [...findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const blocking = findings.filter((f) => f.severity === 'blocking').length;
  return (
    <div>
      <p className="mb-1 text-sm font-semibold" role={blocking ? 'alert' : undefined}>
        {blocking
          ? `${SEVERITY_SYMBOLS.blocking} ${blocking} blocking error(s): the line is not complete.`
          : '✓ No blocking errors.'}{' '}
        <span className="font-normal text-slate-600">
          Findings are advisory and do not certify safety or buildability.
        </span>
      </p>
      <ul className="space-y-1">
        {sorted.map((f) => (
          <li key={f.id} className={`rounded border-s-4 border px-2 py-1 text-sm ${TONE[f.severity]}`}>
            <span className="font-semibold">
              {SEVERITY_SYMBOLS[f.severity]} {SEVERITY_LABELS[f.severity]}:
            </span>{' '}
            {f.message}
            {(f.position || f.stationId) && (
              <button
                type="button"
                className="ms-1 underline"
                onClick={() => {
                  if (f.stationId) select({ kind: 'station', id: f.stationId });
                  if (f.position)
                    getMapInstance()?.flyTo({
                      center: f.position,
                      zoom: Math.max(getMapInstance()?.getZoom() ?? 14, 15),
                    });
                }}
              >
                Show
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
