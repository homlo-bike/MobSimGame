import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore, useScenario } from '../store/projectStore';
import { downloadText, parseProjectText, safeFilename, serializeProject } from '../store/persistence';
import { importGeoJSON, MAX_IMPORT_BYTES, sampledCoordinatesCsv, scenarioToGeoJSON } from '../geo/geojson';
import { openServerReport, shareProject } from '../api/projects';
import { currentSession, logout } from '../api/auth';
import { LoginDialog } from './LoginDialog';
import { ProviderError } from '../providers/backend';
import { Badge } from './primitives';
import { Menu, type MenuEntry } from './Menu';
import { CommitField } from './CommitField';
import { t } from '../i18n';
import { createLogger } from '../util/logger';

const log = createLogger('files');
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
  const dismissMessage = useCallback(() => setMessage(null), []);

  // Every user-visible outcome of a file/share action is also logged (failures as warnings).
  const report = (text: string, error = false) => {
    if (error) log.warn('project file action failed', { message: text });
    else log.debug('project file action completed', { message: text });
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
  const openReport = () =>
    openServerReport(project).catch((e) =>
      report(e instanceof ProviderError ? `Report unavailable: ${e.message}` : 'Report failed', true),
    );

  const fileMenu: MenuEntry[] = [
    { kind: 'heading', label: 'Project' },
    { kind: 'item', label: 'New project', onSelect: newProject },
    { kind: 'item', label: 'Load demo', onSelect: loadDemo },
    { kind: 'item', label: 'Open project…', hint: '.json', onSelect: () => projectInput.current?.click() },
    {
      kind: 'item',
      label: 'Save project',
      hint: '.json',
      onSelect: () => downloadText(`${name}.mobsim.json`, serializeProject(project), 'application/json'),
    },
    { kind: 'separator' },
    { kind: 'heading', label: 'Import / export' },
    { kind: 'item', label: 'Import GeoJSON…', onSelect: () => geojsonInput.current?.click() },
    { kind: 'item', label: 'Export GeoJSON', onSelect: exportGeoJSON },
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
      {message && <Toast message={message} onDismiss={dismissMessage} />}
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

/** Transient status message; successes fade after 6 s, errors stay until dismissed. */
function Toast({ message, onDismiss }: { message: { text: string; error: boolean }; onDismiss: () => void }) {
  useEffect(() => {
    if (message.error) return;
    const id = setTimeout(onDismiss, 6000);
    return () => clearTimeout(id);
  }, [message, onDismiss]);
  return (
    <div
      role={message.error ? 'alert' : 'status'}
      className={`fixed bottom-16 end-4 z-50 flex max-w-md items-start gap-3 rounded-md border px-3 py-2 text-sm shadow-lg ${
        message.error
          ? 'border-red-300 bg-red-50 text-red-950'
          : 'border-emerald-300 bg-emerald-50 text-emerald-950'
      }`}
    >
      <span className="flex-1 break-words">
        {message.error ? '⛔ ' : '✓ '}
        {message.text}
      </span>
      <button type="button" className="text-xs underline" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
