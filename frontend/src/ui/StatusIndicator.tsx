/** Connection status pill (text and symbol, never colour alone) and the update banner. */
import { useState } from 'react';
import { useConnection } from '../store/connection';
import { CONNECTION_LABELS, type ConnectionStatus } from '../runtime/connectivity';
import { applyUpdate, currentUnsavedWorkReasons } from '../runtime/appStatus';
import { RUNNING_BUILD } from '../runtime/version';
import { useStore } from '../store/projectStore';
import { downloadText, safeFilename, serializeProject } from '../store/persistence';
import { Button } from './primitives';

const STYLE: Record<ConnectionStatus, { symbol: string; tone: string; short: string }> = {
  checking: { symbol: '…', tone: 'border-slate-300 text-slate-700', short: 'Checking' },
  connected: { symbol: '●', tone: 'border-emerald-600 text-emerald-800', short: 'Connected' },
  degraded: { symbol: '▲', tone: 'border-amber-600 text-amber-900', short: 'Server problem' },
  unreachable: { symbol: '✕', tone: 'border-red-600 text-red-800', short: 'Server unreachable' },
  offline: { symbol: '○', tone: 'border-slate-500 text-slate-800', short: 'Offline' },
  updating: { symbol: '↻', tone: 'border-sky-600 text-sky-800', short: 'Updating' },
};

export function StatusIndicator() {
  const status = useConnection((s) => s.status);
  const lastCheckedAt = useConnection((s) => s.lastCheckedAt);
  const st = STYLE[status];
  return (
    <span
      role="status"
      data-testid="connection-status"
      data-status={status}
      title={`${CONNECTION_LABELS[status]}${lastCheckedAt ? ` (checked ${new Date(lastCheckedAt).toLocaleTimeString()})` : ''}`}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${st.tone}`}
    >
      <span aria-hidden>{st.symbol}</span>
      <span className="sr-only">Connection: </span>
      {st.short}
    </span>
  );
}

export function UpdateBanner({ autosaveFailed }: { autosaveFailed: boolean }) {
  const available = useConnection((s) => s.updateAvailable);
  const deployed = useConnection((s) => s.deployed);
  const blocked = useConnection((s) => s.updateBlocked);
  const updating = useConnection((s) => s.updating);
  const project = useStore((s) => s.project);
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [later, setLater] = useState<string | null>(null);
  if (!available || !deployed || later === deployed.buildId) return null;

  const update = async () => {
    setError(null);
    const r = currentUnsavedWorkReasons(autosaveFailed);
    if (r.length && reasons === null) {
      setReasons(r);
      return;
    }
    const res = await applyUpdate();
    if (!res.ok) setError(`${res.error}. Save the project as a file first, then update.`);
  };
  const saveFile = () =>
    downloadText(`${safeFilename(project.name)}.mobsim.json`, serializeProject(project), 'application/json');

  return (
    <div
      role="region"
      aria-label="Application update"
      className="border-b border-sky-300 bg-sky-50 px-3 py-1 text-xs text-sky-950"
    >
      {blocked ? (
        <p>
          <strong>Update not applied.</strong> {blocked}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            <strong>A new version is available</strong> (running build{' '}
            {RUNNING_BUILD.builtAt.slice(0, 16).replace('T', ' ')}, new build{' '}
            {deployed.builtAt.slice(0, 16).replace('T', ' ')} UTC). Your project is kept: it is saved in this
            browser before the page reloads.
          </span>
          <Button variant="primary" disabled={updating} onClick={update}>
            {updating ? 'Updating…' : reasons ? 'Update anyway' : 'Update now'}
          </Button>
          <Button onClick={saveFile}>Save project file</Button>
          <Button variant="ghost" onClick={() => setLater(deployed.buildId)}>
            Later
          </Button>
        </div>
      )}
      {reasons && (
        <ul className="mt-1 list-disc ps-5" role="alert">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
          <li>Finish or save your work, or choose “Update anyway”.</li>
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-1 font-semibold text-red-900">
          ⛔ {error}
        </p>
      )}
    </div>
  );
}
