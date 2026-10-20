import { useRef, useState, type ReactNode } from 'react';
import { useStore, useScenario } from '../store/projectStore';
import { buildGtfs } from '../export/gtfs';
import { buildSumo } from '../export/sumo';
import { zip } from '../export/zip';
import { fullExport } from '../export/fullExport';
import { downloadText, parseProjectText, safeFilename, serializeProject } from '../store/persistence';
import { importGeoJSON, MAX_IMPORT_BYTES, sampledCoordinatesCsv, scenarioToGeoJSON } from '../geo/geojson';
import { openServerReport, shareProject } from '../api/projects';
import { currentSession, logout } from '../api/auth';
import { LoginDialog } from './LoginDialog';
import { NotificationMenu } from './NotificationMenu';
import { notify } from '../store/notifications';
import { ProviderError } from '../providers/backend';
import { Badge } from './primitives';
import { Menu, type MenuEntry } from './Menu';
import { CommitField } from './CommitField';
import { t } from '../i18n';
import { createLogger } from '../util/logger';

const log = createLogger('files');
import type { View } from '../store/projectStore';

export function Header({
  onOpenDataSources,
  onOpenExamples,
}: {
  onOpenDataSources: () => void;
  onOpenExamples: () => void;
}) {
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
  const announce = useStore((s) => s.announce);
  const mode = useStore((s) => s.newLineMode);
  const projectInput = useRef<HTMLInputElement>(null);
  const geojsonInput = useRef<HTMLInputElement>(null);
  const [shareId, setShareId] = useState<string | null>(null);

  // Every user-visible outcome of a file/share action is also logged (failures as warnings).
  const report = (text: string, error = false) => {
    if (error) log.warn('project file action failed', { message: text });
    else log.debug('project file action completed', { message: text });
    notify({
      severity: error ? 'error' : 'success',
      kind: 'file',
      title: text,
      target: { projectId: project.id },
    });
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

  const [loginOpen, setLoginOpen] = useState(false);
  const [signedInAs, setSignedInAs] = useState<string | null>(() => currentSession()?.username ?? null);

  /** Share again right after signing in when sharing is what asked for the login. */
  const pendingShare = useRef(false);

  const onShare = async () => {
    if (!currentSession()) {
      setSignedInAs(null);
      pendingShare.current = true;
      setLoginOpen(true);
      return;
    }
    try {
      const res = await shareProject(project, shareId ?? undefined);
      setShareId(res.id);
      const url = `${location.origin}${location.pathname}?share=${encodeURIComponent(res.id)}`;
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      report(
        `Shared. Link: ${url} (copied if the clipboard is available). Anyone with the link can view it.`,
      );
    } catch (e) {
      if (e instanceof ProviderError && e.state === 'authentication_required') {
        setSignedInAs(null);
        report('Your server session has ended. Sign in again to share.', true);
        pendingShare.current = true;
        setLoginOpen(true);
        return;
      }
      report(e instanceof ProviderError ? `Share unavailable: ${e.message}` : 'Share failed', true);
    }
  };

  const name = safeFilename(project.name);
  const exportGeoJSON = () =>
    downloadText(
      `${name}.geojson`,
      JSON.stringify(
        scenarioToGeoJSON(scenario, { projectName: project.name, fictional: project.fictional }),
        null,
        2,
      ),
      'application/geo+json',
    );
  const exportGtfs = () => {
    const feed = buildGtfs(project, scenario, {
      baseUrl: window.location.origin,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC',
      date: new Date(),
    });
    downloadText(`${name}-gtfs.zip`, zip(feed.files), 'application/zip');
    report(
      feed.skipped.length
        ? `GTFS exported; ${feed.skipped.length} line(s) left out (need two stops and a route)`
        : 'GTFS exported',
      feed.skipped.length > 0,
    );
  };
  const exportSumo = () => {
    const out = buildSumo(scenario, project.name);
    downloadText(`${name}-sumo.zip`, zip(out.files), 'application/zip');
    report(
      out.skipped.length
        ? `SUMO files exported; ${out.skipped.length} line(s) not included (street lines go through GTFS, see README.txt)`
        : 'SUMO files exported',
    );
  };
  const exportAll = () =>
    downloadText(
      `${name}-full-export.json`,
      JSON.stringify(
        fullExport(project, {
          appVersion: __APP_VERSION__,
          buildTime: __BUILD_TIME__,
          exportedAt: new Date().toISOString(),
        }),
        null,
        2,
      ),
      'application/json',
    );
  const openReport = () =>
    openServerReport(project).catch((e) =>
      report(e instanceof ProviderError ? `Report unavailable: ${e.message}` : 'Report failed', true),
    );

  const fileMenu: MenuEntry[] = [
    { kind: 'heading', label: 'Project' },
    { kind: 'item', label: 'New project…', onSelect: newProject },
    {
      kind: 'item',
      label: 'Switch project…',
      hint: 'this browser',
      onSelect: () => useStore.getState().openProjectGate('select'),
    },
    { kind: 'item', label: 'Open real network…', hint: 'OSM', onSelect: onOpenExamples },
    { kind: 'item', label: 'Open project…', hint: '.json', onSelect: () => projectInput.current?.click() },
    {
      kind: 'item',
      label: 'Save project',
      hint: '.json',
      onSelect: () => downloadText(`${name}.mobsim.json`, serializeProject(project), 'application/json'),
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'Project properties…',
      onSelect: () => useStore.getState().openProperties('parameters'),
    },
    { kind: 'heading', label: 'Import / export' },
    { kind: 'item', label: 'Import GeoJSON…', onSelect: () => geojsonInput.current?.click() },
    { kind: 'item', label: 'Export GeoJSON', onSelect: exportGeoJSON },
    { kind: 'item', label: 'Export GTFS timetable', hint: '.zip', onSelect: exportGtfs },
    { kind: 'item', label: 'Export for SUMO', hint: '.zip', onSelect: exportSumo },
    { kind: 'item', label: 'Export all data', hint: '.json', onSelect: exportAll },
    {
      kind: 'item',
      label: 'Export coordinates',
      hint: '.csv',
      onSelect: () => downloadText(`${name}-coordinates.csv`, sampledCoordinatesCsv(scenario), 'text/csv'),
    },
    { kind: 'separator' },
    { kind: 'heading', label: 'Share' },
    {
      kind: 'item',
      label: shareId ? 'Update shared project' : 'Save to server and share…',
      onSelect: onShare,
    },
    { kind: 'item', label: 'Print report', onSelect: openReport },
    { kind: 'separator' },
    signedInAs
      ? {
          kind: 'item',
          label: 'Sign out',
          hint: signedInAs,
          onSelect: () => {
            logout();
            setSignedInAs(null);
            report('Signed out of the server');
          },
        }
      : { kind: 'item', label: 'Sign in…', hint: 'server', onSelect: () => setLoginOpen(true) },
  ];

  const tabs: { id: View; label: string; title?: string }[] = [
    { id: 'map', label: t('viewMap') },
    { id: 'schematic', label: t('viewSchematic') },
    { id: 'dashboard', label: t('viewDashboard') },
    { id: 'table', label: t('viewTable'), title: t('viewTableHint') },
  ];

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
      <h1 className="text-base font-bold tracking-tight text-teal-800">{t('appName')}</h1>
      <span aria-hidden className="text-slate-300">
        /
      </span>
      <div className="w-52">
        <CommitField
          inline
          label="Project name"
          value={project.name}
          onCommit={(v) =>
            v.trim() ? commitProject({ ...project, name: v.trim() }, 'Project renamed') : 'Name is required'
          }
        />
      </div>
      {project.fictional && <Badge tone="demo">{t('fictional')}</Badge>}

      <nav aria-label="Views" className="ms-4 flex rounded-md bg-slate-100 p-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-current={view === tab.id ? 'page' : undefined}
            title={tab.title}
            onClick={() => setView(tab.id)}
            className={`rounded px-3 py-1 text-sm ${
              view === tab.id
                ? 'bg-white font-semibold text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="ms-auto flex items-center gap-1">
        <IconButton
          label={t('undo')}
          shortcut="Ctrl+Z"
          onClick={undo}
          disabled={!past}
          keyshortcuts="Control+Z"
        >
          ↶
        </IconButton>
        <IconButton
          label={t('redo')}
          shortcut="Ctrl+Shift+Z"
          onClick={redo}
          disabled={!future}
          keyshortcuts="Control+Shift+Z Control+Y"
        >
          ↷
        </IconButton>
        <span aria-hidden className="mx-1 h-5 border-s border-slate-200" />
        <Menu label="File" entries={fileMenu} />
        <NotificationMenu />
        <IconButton label="Data & licences" onClick={onOpenDataSources}>
          ⓘ
        </IconButton>
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
      {loginOpen && (
        <LoginDialog
          open={loginOpen}
          onClose={() => {
            setLoginOpen(false);
            pendingShare.current = false;
          }}
          onSignedIn={(user) => {
            setSignedInAs(user);
            setLoginOpen(false);
            report(`Signed in as ${user}`);
            if (pendingShare.current) {
              pendingShare.current = false;
              void onShare();
            }
          }}
        />
      )}
    </header>
  );
}

function IconButton({
  label,
  shortcut,
  keyshortcuts,
  onClick,
  disabled,
  children,
}: {
  label: string;
  shortcut?: string;
  keyshortcuts?: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-keyshortcuts={keyshortcuts}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded text-base text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}
