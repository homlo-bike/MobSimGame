import { useRef, useState } from 'react';
import { useStore, useScenario } from '../store/projectStore';
import { downloadText, parseProjectText, safeFilename, serializeProject } from '../store/persistence';
import { importGeoJSON, MAX_IMPORT_BYTES, sampledCoordinatesCsv, scenarioToGeoJSON } from '../geo/geojson';
import { openServerReport, shareProject } from '../api/projects';
import { ProviderError } from '../providers/backend';
import { Badge, Button } from './primitives';
import { CommitField } from './CommitField';
import { t } from '../i18n';
import type { View } from '../store/projectStore';

export function Header({ onOpenDataSources }: { onOpenDataSources: () => void }) {
  const project = useStore((s) => s.project);
  const scenario = useScenario();
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const commitProject = useStore((s) => s.commitProject);
  const commitScenario = useStore((s) => s.commitScenario);
  const loadProject = useStore((s) => s.loadProject);
  const newProject = useStore((s) => s.newProject);
  const loadDemo = useStore((s) => s.loadDemo);
  const announce = useStore((s) => s.announce);
  const mode = useStore((s) => s.newLineMode);
  const projectInput = useRef<HTMLInputElement>(null);
  const geojsonInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);

  const report = (text: string, error = false) => {
    setMessage({ text, error });
    announce(text);
  };

  const readFile = async (file: File, maxBytes: number) => {
    if (file.size > maxBytes) throw new Error(`File is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
    if (typeof file.text === 'function') return file.text();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
      reader.readAsText(file);
    });
  };

  const onOpenProject = async (file: File) => {
    try {
      const parsed = parseProjectText(await readFile(file, 20 * 1024 * 1024));
      if (!parsed.ok) return report(`Could not open project: ${parsed.errors.slice(0, 3).join('; ')}`, true);
      loadProject(parsed.project);
      report(`Opened “${parsed.project.name}”`);
    } catch (e) {
      report(`Could not open project: ${(e as Error).message}`, true);
    }
  };

  const onImportGeoJSON = async (file: File) => {
    try {
      const data = JSON.parse(await readFile(file, MAX_IMPORT_BYTES));
      const res = importGeoJSON(scenario, data, mode);
      if ('error' in res) return report(`Import failed: ${res.error}`, true);
      commitScenario(res.scenario, 'GeoJSON imported');
      const r = res.report;
      report(
        `Imported ${r.linesAdded} line(s), ${r.stationsAdded} station(s), ${r.stationsShared} shared stop(s).${r.skipped.length ? ` Skipped: ${r.skipped.slice(0, 3).join('; ')}` : ''}`,
      );
    } catch (e) {
      report(`Import failed: ${e instanceof SyntaxError ? 'not valid JSON' : (e as Error).message}`, true);
    }
  };

  const onShare = async () => {
    try {
      const res = await shareProject(project, shareId ?? undefined);
      setShareId(res.id);
      const url = `${location.origin}${location.pathname}?share=${encodeURIComponent(res.id)}`;
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      report(
        `Shared. Link: ${url} (copied if the clipboard is available). Anyone with the link can view it.`,
      );
    } catch (e) {
      report(e instanceof ProviderError ? `Share unavailable: ${e.message}` : 'Share failed', true);
    }
  };

  const name = safeFilename(project.name);
  const tabs: { id: View; label: string }[] = [
    { id: 'map', label: t('viewMap') },
    { id: 'schematic', label: t('viewSchematic') },
    { id: 'dashboard', label: t('viewDashboard') },
    { id: 'table', label: t('viewTable') },
  ];

  return (
    <header className="border-b border-slate-400 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <h1 className="text-lg font-bold text-teal-900">{t('appName')}</h1>
        <div className="w-56">
          <CommitField
            label="Project name"
            value={project.name}
            onCommit={(v) =>
              v.trim() ? commitProject({ ...project, name: v.trim() }, 'Project renamed') : 'Name is required'
            }
          />
        </div>
        {project.fictional && <Badge tone="demo">{t('fictional')}</Badge>}
        <div className="flex gap-1" role="group" aria-label="History">
          <Button onClick={undo} disabled={!past} aria-keyshortcuts="Control+Z">
            ↶ {t('undo')}
          </Button>
          <Button onClick={redo} disabled={!future} aria-keyshortcuts="Control+Shift+Z Control+Y">
            ↷ {t('redo')}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Project files">
          <Button onClick={newProject}>New</Button>
          <Button onClick={loadDemo}>Load demo</Button>
          <Button onClick={() => projectInput.current?.click()}>Open…</Button>
          <Button
            onClick={() => downloadText(`${name}.mobsim.json`, serializeProject(project), 'application/json')}
          >
            Save project
          </Button>
          <Button onClick={() => geojsonInput.current?.click()}>Import GeoJSON…</Button>
          <Button
            onClick={() =>
              downloadText(
                `${name}.geojson`,
                JSON.stringify(
                  scenarioToGeoJSON(scenario, { projectName: project.name, fictional: project.fictional }),
                  null,
                  2,
                ),
                'application/geo+json',
              )
            }
          >
            Export GeoJSON
          </Button>
          <Button
            onClick={() =>
              downloadText(`${name}-coordinates.csv`, sampledCoordinatesCsv(scenario), 'text/csv')
            }
          >
            Export CSV
          </Button>
          <Button onClick={onShare}>Share…</Button>
          <Button
            onClick={() =>
              openServerReport(project).catch((e) =>
                report(
                  e instanceof ProviderError ? `Report unavailable: ${e.message}` : 'Report failed',
                  true,
                ),
              )
            }
          >
            Report
          </Button>
          <Button onClick={onOpenDataSources}>Data &amp; licences</Button>
        </div>
        <input
          ref={projectInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Open project file"
          onChange={(e) =>
            e.target.files?.[0] && onOpenProject(e.target.files[0]).finally(() => (e.target.value = ''))
          }
        />
        <input
          ref={geojsonInput}
          type="file"
          accept=".geojson,.json,application/geo+json"
          className="hidden"
          aria-label="Import GeoJSON file"
          onChange={(e) =>
            e.target.files?.[0] && onImportGeoJSON(e.target.files[0]).finally(() => (e.target.value = ''))
          }
        />
      </div>
      <nav aria-label="Views" className="flex gap-1 px-3">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-current={view === tab.id ? 'page' : undefined}
            onClick={() => setView(tab.id)}
            className={`rounded-t border border-b-0 px-3 py-1 text-sm ${view === tab.id ? 'border-slate-400 bg-slate-100 font-semibold' : 'border-transparent text-slate-700 hover:bg-slate-100'}`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {message && (
        <div
          role={message.error ? 'alert' : 'status'}
          className={`flex items-start gap-2 px-3 py-1 text-sm ${message.error ? 'bg-red-50 text-red-900' : 'bg-emerald-50 text-emerald-950'}`}
        >
          <span className="flex-1">
            {message.error ? '⛔ ' : '✓ '}
            {message.text}
          </span>
          <button type="button" className="underline" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      )}
    </header>
  );
}
