/** Choose a real city and network to load from OpenStreetMap. */
import { useEffect, useId, useRef, useState } from 'react';
import { listExampleCities, loadExampleProject, type ExampleCity } from '../api/examples';
import { ProviderError } from '../providers/backend';
import { useStore } from '../store/projectStore';
import { Button } from './primitives';
import { notify } from '../store/notifications';

export function ExampleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const loadProject = useStore((s) => s.loadProject);
  const [cities, setCities] = useState<ExampleCity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cityId, setCityId] = useState('');
  const [kind, setKind] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const ids = { city: useId(), status: useId() };

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open || cities) return;
    listExampleCities()
      .then((c) => {
        setCities(c);
        setCityId(c[0]?.id ?? '');
        setKind(c[0]?.networks[0]?.kind ?? '');
      })
      .catch((e: Error) =>
        setError(
          e instanceof ProviderError
            ? `${e.message}. Example networks need the MobSimGame server.`
            : 'Example networks need the MobSimGame server.',
        ),
      );
  }, [open, cities]);

  useEffect(() => {
    if (!loading) return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [loading]);

  const city = cities?.find((c) => c.id === cityId);
  const network = city?.networks.find((n) => n.kind === kind);

  const load = async () => {
    if (!city || !network) return;
    setLoading(true);
    setElapsed(0);
    setError(null);
    try {
      const project = await loadExampleProject(city.id, network.kind);
      loadProject(project);
      notify({
        severity: 'success',
        kind: 'network',
        title: `Opened ${project.name}`,
        target: { projectId: project.id },
      });
      onClose();
    } catch (e) {
      const msg = e instanceof ProviderError ? e.message : 'Loading failed';
      setError(msg);
      notify({
        severity: 'error',
        kind: 'network',
        title: `Could not open ${network.label} of ${city.name}`,
        message: msg,
        toast: false,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="examples-title"
      className="m-auto w-[min(30rem,94vw)] rounded border border-slate-400 p-0 backdrop:bg-black/40"
    >
      <div className="p-4">
        <h2 id="examples-title" className="mb-1 text-lg font-semibold">
          Open a real network
        </h2>
        <p className="mb-3 text-sm text-slate-700">
          Loads today’s tram, metro or bus network of a city from OpenStreetMap, with real line and station
          names. You can then edit it or draw your own lines next to it.
        </p>
        {error && (
          <p role="alert" className="mb-2 rounded border-2 border-red-700 bg-red-50 p-2 text-sm">
            ⛔ {error}
          </p>
        )}
        {cities && (
          <>
            <label htmlFor={ids.city} className="block text-xs font-medium">
              City
            </label>
            <select
              id={ids.city}
              value={cityId}
              disabled={loading}
              onChange={(e) => {
                setCityId(e.target.value);
                setKind(cities.find((c) => c.id === e.target.value)?.networks[0]?.kind ?? '');
              }}
              className="mb-3 w-full rounded border border-slate-500 px-2 py-1"
            >
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}, {c.country}
                </option>
              ))}
            </select>
            <fieldset className="mb-3" disabled={loading}>
              <legend className="text-xs font-medium">Network</legend>
              {city?.networks.map((n) => (
                <label key={n.kind} className="flex items-start gap-2 py-0.5 text-sm">
                  <input
                    type="radio"
                    name="example-network"
                    className="mt-1"
                    checked={kind === n.kind}
                    onChange={() => setKind(n.kind)}
                  />
                  <span>
                    {n.label}
                    {n.note && <span className="block text-xs text-slate-600">{n.note}</span>}
                  </span>
                </label>
              ))}
            </fieldset>
          </>
        )}
        {!cities && !error && <p className="text-sm">Loading the list of cities…</p>}
        <p id={ids.status} role="status" className="mb-2 min-h-5 text-sm text-slate-700">
          {loading &&
            `Loading ${network?.label ?? ''} from OpenStreetMap… ${elapsed} s${
              elapsed > 20 ? ' (large networks can take a few minutes the first time)' : ''
            }`}
        </p>
        <p className="mb-3 text-xs text-slate-600">
          Map data © OpenStreetMap contributors (ODbL). Only the city and network are sent to the server.
          Opening a network replaces the current project; save it first if needed.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={load}
            disabled={!network || loading}
            aria-describedby={ids.status}
          >
            {loading ? 'Loading…' : 'Open network'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
