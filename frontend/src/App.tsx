import { PriorityPanel } from './ui/PriorityPanel';
import { stationMode } from './domain/modeSeparation';
import { MODES } from './domain/modes';
import type { TransportMode } from './domain/schema';
import { deleteStationObject } from './domain/stationLayout';
import { deleteLineWithNotice, finishServiceDraft, requestTrackDeletion } from './store/trackActions';
import { drawingStops, finishStopDraft, removeLastDraftStop } from './store/stopActions';
import { rerouteServices } from './domain/serviceRouting';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useStore, useScenario } from './store/projectStore';
import { saveToLocalStorage } from './store/persistence';
import { activeScenario, deleteStation } from './domain/network';
import { fetchSharedProject } from './api/projects';
import { Header } from './ui/Header';
import { LayerPanel, NetworkLists, ScenarioPanel, SearchBox, ToolPanel } from './ui/Sidebar';
import { LineInspector } from './ui/LineInspector';
import { VehicleProfilesPanel } from './ui/VehicleProfiles';
import { RegionInspector, RegionsPanel } from './ui/RegionInspector';
import {
  NodeInspector,
  TrackDeletionDialog,
  LoopDialog,
  TrackInspector,
  TrackParametersPanel,
} from './ui/TrackInspector';
import { StationInspector } from './ui/StationInspector';
import { SimulationControls } from './ui/SimulationControls';
import { SchematicView } from './ui/SchematicView';
import { Dashboard } from './ui/Dashboard';
import { TableView } from './ui/TableView';
import { DataSourcesDialog } from './ui/DataSourcesDialog';
import { ExampleDialog } from './ui/ExampleDialog';
import { Toast } from './ui/Toast';
import { ProjectGate } from './ui/ProjectGate';
import { StatusIndicator, UpdateBanner } from './ui/StatusIndicator';
import { startAppStatus } from './runtime/appStatus';
import { notify } from './store/notifications';
import { SignalInspector, SignalsPanel } from './ui/SignalsPanel';
import { FindingsList } from './ui/FindingsList';
import { Button, Checkbox, Section } from './ui/primitives';
import { validateScenario } from './validation/validate';
import { t } from './i18n';
import { createLogger, errorContext } from './util/logger';

const log = createLogger('app');

const MapView = lazy(() => import('./map/MapView'));

function isEditableTarget(el: EventTarget | null) {
  const node = el as HTMLElement | null;
  return (
    !!node &&
    (node.tagName === 'INPUT' ||
      node.tagName === 'TEXTAREA' ||
      node.tagName === 'SELECT' ||
      node.isContentEditable)
  );
}

/**
 * Objects of another mode than the active tab are shown read-only: every control inside is
 * disabled, with a button to switch to that mode's tab.
 */
function ModeLock({ mode, children }: { mode: TransportMode | null; children: React.ReactNode }) {
  const active = useStore((s) => s.newLineMode);
  const setMode = useStore((s) => s.setNewLineMode);
  if (!mode || mode === active) return <>{children}</>;
  return (
    <>
      <div role="note" className="m-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm">
        This belongs to <strong>{MODES[mode].label}</strong>. Modes are edited separately.{' '}
        <button type="button" className="underline" onClick={() => setMode(mode)}>
          Switch to {MODES[mode].label}
        </button>
      </div>
      <fieldset disabled aria-label={`${MODES[mode].label}, read-only`} className="opacity-80">
        {children}
      </fieldset>
    </>
  );
}

function Inspector() {
  const scenario = useScenario();
  const selection = useStore((s) => s.selection);
  const reducedMotion = useStore((s) => s.reducedMotion);
  const setReducedMotion = useStore((s) => s.setReducedMotion);
  const unitSystem = useStore((s) => s.unitSystem);
  const setUnitSystem = useStore((s) => s.setUnitSystem);
  // Real networks can have hundreds of lines: validate only when the scenario changes.
  const findings = useMemo(() => validateScenario(scenario), [scenario]);
  if (selection?.kind === 'line' || selection?.kind === 'segment') {
    const id = selection.kind === 'line' ? selection.id : selection.lineId;
    const line = scenario.lines.find((l) => l.id === id);
    if (line)
      return (
        <ModeLock mode={line.mode}>
          <LineInspector key={line.id} line={line} scenario={scenario} />
        </ModeLock>
      );
  }
  if (selection?.kind === 'track') {
    const track = scenario.trackNetwork.tracks.find((t) => t.id === selection.id);
    if (track)
      return (
        <ModeLock mode={track.designMode}>
          <TrackInspector key={track.id} track={track} scenario={scenario} />
        </ModeLock>
      );
  }
  if (selection?.kind === 'region') {
    const region = scenario.regions.find((r) => r.id === selection.id);
    if (region) return <RegionInspector key={region.id} region={region} scenario={scenario} />;
  }
  if (selection?.kind === 'node') {
    const node = scenario.trackNetwork.nodes.find((n) => n.id === selection.id);
    if (node) return <NodeInspector key={node.id} node={node} scenario={scenario} />;
  }
  if (selection?.kind === 'signal') {
    const signal = scenario.trafficSignals.find((s) => s.id === selection.id);
    if (signal) return <SignalInspector key={signal.id} signal={signal} scenario={scenario} />;
  }
  if (selection?.kind === 'station') {
    const station = scenario.stations.find((s) => s.id === selection.id);
    if (station)
      return (
        <ModeLock mode={stationMode(scenario, station)}>
          <StationInspector key={station.id} station={station} scenario={scenario} />
        </ModeLock>
      );
  }
  return (
    <>
      <Section title={t('inspector')} id="inspector-empty">
        <p className="text-sm text-slate-700">
          Select a track, node, line or station on the map or in the lists to edit it.
        </p>
      </Section>
      <Section title="Display" id="display" collapsible defaultOpen={false}>
        <Checkbox
          label="Reduced motion"
          checked={reducedMotion}
          onChange={setReducedMotion}
          hint="Vehicles move in steps instead of continuously."
        />
        <Checkbox
          label="Imperial units"
          checked={unitSystem === 'imperial'}
          onChange={(v) => setUnitSystem(v ? 'imperial' : 'metric')}
          hint="Metric is the default; calculations always use metric."
        />
      </Section>
      <Section title={`${t('findings')} (${findings.length})`} id="all-findings">
        <FindingsList findings={findings} />
      </Section>
    </>
  );
}

export default function App() {
  const project = useStore((s) => s.project);
  const view = useStore((s) => s.view);
  const announcement = useStore((s) => s.announcement);
  const [dataOpen, setDataOpen] = useState(false);
  const projectActive = useStore((s) => s.projectActive);
  const startCardDismissed = useStore((s) => s.startCardDismissed);
  const dismissStartCard = useStore((s) => s.dismissStartCard);
  const tool = useStore((s) => s.tool);
  const projectGateOpen = useStore((s) => s.projectGate.open);
  /** "Draw a line": the card hides (tool changes) and keyboard focus moves to the map. */
  const startDrawing = () => {
    setTool('draw_line');
    requestAnimationFrame(() =>
      (document.querySelector('[data-testid="map"] canvas') as HTMLElement | null)?.focus(),
    );
  };
  const [examplesOpen, setExamplesOpen] = useState(false);
  const scenario = useScenario();
  const setTool = useStore((s) => s.setTool);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Autosave to this browser.
  useEffect(() => {
    // A first visit's scratch project is not stored until the user creates or opens a project.
    if (!projectActive) return;
    const id = setTimeout(() => {
      const r = saveToLocalStorage(project);
      const msg = r.ok
        ? null
        : `Not saved in this browser: ${r.error}. Use File › Save project to keep a file.`;
      setSaveError(msg);
      // Grouped by the notification centre, so repeated autosave failures appear once.
      if (msg)
        notify({ severity: 'error', kind: 'project', title: 'Autosave failed', message: msg, toast: false });
    }, 400);
    return () => clearTimeout(id);
  }, [project, projectActive]);

  // Connection and version monitoring (not in unit tests, which have no server).
  useEffect(() => {
    if (import.meta.env.MODE === 'test') return;
    return startAppStatus();
  }, []);

  // Open a shared project from ?share=<id>.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('share');
    if (!id) return;
    fetchSharedProject(id)
      .then((p) => useStore.getState().loadProject(p))
      .catch((e: Error) => {
        log.error('could not open shared project', { projectId: id, ...errorContext(e) });
        useStore.getState().announce(`Could not open shared project: ${e.message}`);
        notify({
          severity: 'error',
          kind: 'share',
          title: 'Could not open shared project',
          message: e.message,
        });
      });
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const state = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !isEditableTarget(e.target)) {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
      } else if (mod && e.key.toLowerCase() === 'y' && !isEditableTarget(e.target)) {
        e.preventDefault();
        state.redo();
      } else if (e.key === 'Enter' && state.tool === 'new_service' && !isEditableTarget(e.target)) {
        e.preventDefault();
        finishServiceDraft();
      } else if (
        (e.key === 'Escape' ||
          (e.key === 'Enter' && (e.target as HTMLElement | null)?.tagName !== 'BUTTON')) &&
        drawingStops() &&
        !isEditableTarget(e.target)
      ) {
        // A line drawn stop by stop is finished, not discarded (fewer than two stops cancel).
        e.preventDefault();
        finishStopDraft();
      } else if (e.key === 'Backspace' && drawingStops() && !isEditableTarget(e.target)) {
        e.preventDefault();
        removeLastDraftStop();
      } else if (e.key === 'Escape' && state.tool !== 'select') {
        state.setTool('select');
        state.announce('Tool cancelled');
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        !isEditableTarget(e.target) &&
        state.selection
      ) {
        const sc = activeScenario(state.project);
        const sel = state.selection;
        if (sel.kind === 'station') {
          const serving = sc.lines.filter(
            (l) => l.alignment.kind === 'track' && l.stops.some((x) => x.stationId === sel.id),
          );
          state.commitScenario(
            sc.stations.find((x) => x.id === sel.id)?.layout
              ? deleteStationObject(sc, sel.id)
              : rerouteServices(
                  deleteStation(sc, sel.id),
                  serving.map((l) => l.id),
                ),
            'Station deleted',
          );
        } else if (sel.kind === 'line') deleteLineWithNotice(sel.id);
        else if (sel.kind === 'track') requestTrackDeletion([sel.id]);
        state.select(null);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:bg-white focus:p-2"
      >
        {t('skipToMain')}
      </a>
      <Header onOpenDataSources={() => setDataOpen(true)} onOpenExamples={() => setExamplesOpen(true)} />
      {project.fictional && (
        <div
          role="note"
          className="border-b border-fuchsia-200 bg-fuchsia-50 px-3 py-0.5 text-xs text-fuchsia-950"
        >
          <strong>Fictional demonstration project:</strong> the network, names and all figures are synthetic
          and describe no real place.
        </div>
      )}
      <UpdateBanner autosaveFailed={!!saveError} />
      {saveError && (
        <div
          role="alert"
          className="border-b border-amber-200 bg-amber-50 px-3 py-0.5 text-xs text-amber-950"
        >
          ⚠ {saveError}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Tools and network"
          className="w-72 shrink-0 overflow-y-auto border-e border-slate-200 bg-white"
        >
          <SearchBox />
          <ToolPanel />
          <NetworkLists />
          <RegionsPanel />
          <SignalsPanel />
          <TrackParametersPanel />
          <PriorityPanel />
          <VehicleProfilesPanel />
          <ScenarioPanel />
          <LayerPanel />
        </aside>
        <main id="main" className="relative min-w-0 flex-1" tabIndex={-1}>
          {/* The map stays mounted so switching views keeps its state. */}
          <div className={view === 'map' ? 'h-full' : 'hidden'}>
            <Suspense fallback={<p className="p-4">Loading map…</p>}>
              <MapView />
            </Suspense>
          </div>
          {view === 'map' &&
            scenario.lines.length === 0 &&
            scenario.trackNetwork.tracks.length === 0 &&
            scenario.regions.length === 0 &&
            tool === 'select' &&
            !startCardDismissed &&
            !projectGateOpen && (
              <section
                aria-labelledby="start-title"
                className="absolute start-1/2 top-1/2 z-10 w-[min(26rem,90%)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white/95 p-4 shadow-lg"
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <h2 id="start-title" className="text-base font-semibold">
                    Start a network
                  </h2>
                  <button
                    type="button"
                    aria-label="Close start a network"
                    className="text-slate-600 hover:text-slate-900"
                    onClick={dismissStartCard}
                  >
                    ✕
                  </button>
                </div>
                <p className="mb-3 text-sm text-slate-700">
                  Open a city’s existing tram, metro or bus network, or search for a place and draw your own
                  track and lines.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => setExamplesOpen(true)}>
                    Open a real network…
                  </Button>
                  <Button onClick={startDrawing}>Draw track or a line</Button>
                </div>
              </section>
            )}
          {view === 'schematic' && <SchematicView />}
          {view === 'dashboard' && <Dashboard />}
          {view === 'table' && <TableView />}
        </main>
        <aside
          aria-label={t('inspector')}
          className="w-80 shrink-0 overflow-y-auto border-s border-slate-200 bg-white"
        >
          <Inspector />
        </aside>
      </div>
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-white px-3 py-1.5">
        <SimulationControls />
        <StatusIndicator />
        <p className="ms-auto text-xs text-slate-600">
          {t('disclaimerShort')}{' '}
          <button type="button" className="underline" onClick={() => setDataOpen(true)}>
            {t('limitationsLink')}
          </button>
        </p>
      </footer>
      <div aria-live="polite" className="sr-only" data-testid="announcer">
        {announcement}
      </div>
      <Toast />
      <DataSourcesDialog open={dataOpen} onClose={() => setDataOpen(false)} />
      {projectGateOpen && <ProjectGate />}
      <TrackDeletionDialog />
      <LoopDialog />
      {examplesOpen && <ExampleDialog open={examplesOpen} onClose={() => setExamplesOpen(false)} />}
    </div>
  );
}
