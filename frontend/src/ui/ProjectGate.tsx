/**
 * Create or select a project. Opened when drawing starts without an active
 * project (the drawing resumes afterwards) and from File › New / Switch project.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useStore } from '../store/projectStore';
import { listStoredProjects, loadStoredProject, type StoredProjectSummary } from '../store/persistence';
import { getMapInstance } from '../map/mapInstance';
import { notify } from '../store/notifications';
import { Button } from './primitives';

export function ProjectGate() {
  const gate = useStore((s) => s.projectGate);
  const close = useStore((s) => s.closeProjectGate);
  const createProject = useStore((s) => s.createProject);
  const activateProject = useStore((s) => s.activateProject);
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'create' | 'select'>(gate.mode);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [stored, setStored] = useState<StoredProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Guards against creating two projects from a double click. */
  const submitting = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const ids = { name: useId(), desc: useId(), err: useId() };

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (gate.open && !d.open) {
      setMode(gate.mode);
      setName('');
      setDescription('');
      setError(null);
      submitting.current = false;
      setStored(listStoredProjects());
      // Older engines (and jsdom) lack showModal: fall back to a non-modal open dialog.
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
      requestAnimationFrame(() => nameInput.current?.focus());
    }
    if (!gate.open && d.open) d.close();
  }, [gate.open, gate.mode]);

  const create = (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    if (!name.trim()) {
      setError('Enter a project name');
      return;
    }
    submitting.current = true;
    const map = getMapInstance();
    const c = map?.getCenter();
    const p = createProject({
      name,
      description,
      mapView: c
        ? { center: [c.lng, c.lat], zoom: map!.getZoom(), bearing: map!.getBearing(), pitch: map!.getPitch() }
        : undefined,
    });
    notify({
      severity: 'success',
      kind: 'project',
      title: `Project “${p.name}” created`,
      target: { projectId: p.id },
    });
  };

  const select = (s: StoredProjectSummary) => {
    if (submitting.current) return;
    const p = loadStoredProject(s.id);
    if (!p) {
      setError(`“${s.name}” could not be read from this browser's storage.`);
      return;
    }
    submitting.current = true;
    activateProject(p);
    notify({
      severity: 'success',
      kind: 'project',
      title: `Opened “${p.name}”`,
      target: { projectId: p.id },
    });
  };

  const resuming = gate.resume === 'draw_line';
  return (
    <dialog
      ref={ref}
      onClose={close}
      aria-labelledby="gate-title"
      className="m-auto w-[min(30rem,94vw)] rounded border border-slate-400 p-0 backdrop:bg-black/40"
    >
      <div className="p-4">
        <h2 id="gate-title" className="mb-1 text-lg font-semibold">
          {resuming ? 'Choose a project for your line' : mode === 'create' ? 'New project' : 'Open a project'}
        </h2>
        {resuming && (
          <p className="mb-2 text-sm text-slate-700">
            Lines are saved in a project. Create one or pick an existing one; drawing starts right after.
          </p>
        )}
        <div
          role="tablist"
          aria-label="Project"
          className="mb-3 inline-flex rounded border border-slate-300 p-0.5 text-sm"
        >
          {(
            [
              ['create', 'Create new'],
              ['select', `Existing (${stored.length})`],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              type="button"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`rounded px-2 py-0.5 ${mode === m ? 'bg-slate-900 text-white' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
        {error && (
          <p id={ids.err} role="alert" className="mb-2 rounded border-2 border-red-700 bg-red-50 p-2 text-sm">
            ⛔ {error}
          </p>
        )}
        {mode === 'create' ? (
          <form onSubmit={create} aria-describedby={error ? ids.err : undefined}>
            <label htmlFor={ids.name} className="block text-xs font-medium">
              Name of the new project
            </label>
            <input
              id={ids.name}
              required
              ref={nameInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mb-2 w-full rounded border border-slate-500 px-2 py-1"
            />
            <label htmlFor={ids.desc} className="block text-xs font-medium">
              Description (optional)
            </label>
            <textarea
              id={ids.desc}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mb-3 w-full rounded border border-slate-500 px-2 py-1"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {resuming ? 'Create and start drawing' : 'Create project'}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            {stored.length === 0 ? (
              <p className="mb-3 text-sm text-slate-600">No projects are stored in this browser yet.</p>
            ) : (
              <ul className="mb-3 max-h-64 space-y-1 overflow-auto" aria-label="Projects in this browser">
                {stored.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => select(p)}
                      className="w-full rounded border border-slate-300 px-2 py-1 text-start text-sm hover:bg-slate-50"
                    >
                      <span className="block font-medium">{p.name}</span>
                      <span className="block text-xs text-slate-600">
                        {p.description ? `${p.description} · ` : ''}changed{' '}
                        {new Date(p.updatedAt).toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <Button type="button" onClick={close}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
