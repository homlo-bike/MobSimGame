/**
 * Client state (Zustand).
 *
 * The Project is immutable data; every edit produces a new Project via the pure
 * functions in domain/network.ts and is pushed onto an undo stack. The map's draw
 * layer mirrors the project (see map/drawSync.ts), never the other way round,
 * except for geometry edits which are fed back through `commitScenario`.
 */
import { create } from 'zustand';
import type { LngLat, StructureType, Project, Scenario, TransportMode } from '../domain/schema';
import { activeScenario, duplicateScenario, emptyScenario, replaceScenario } from '../domain/network';
import { SCHEMA_VERSION } from '../domain/schema';
import { newId, nowIso } from '../util/id';
import { loadFromLocalStorage } from './persistence';
import { stationMode } from '../domain/modeSeparation';
import type { UnitSystem } from '../analysis/units';
import { simulationClock, simulationStartS } from '../simulation/runtime';
import { newlySurplus, syncFleet, type FleetChanges } from '../domain/fleetRegistry';
import { spareRanker } from '../domain/reassign';
import { notify } from './notifications';
import { lineFleet } from '../analysis/fleet';

/** Vehicles each transit line needs (in service plus spares), and the fleet synced to it. */
function withFleet(scenario: Scenario, before?: Scenario, changes?: FleetChanges): Scenario {
  const needed = new Map<string, number>();
  for (const l of scenario.lines) {
    if (l.mode === 'cycling' || l.mode === 'pedestrian') continue;
    const f = lineFleet(l, scenario);
    if (f) needed.set(l.id, f.inService + f.spares);
  }
  return syncFleet(scenario, needed, { rank: spareRanker(scenario), before, changes });
}

/** Tell the user what the edit did to the fleet (F7/F8). */
function reportFleet(before: Scenario, after: Scenario, changes: FleetChanges) {
  const lineName = (id: string) => after.lines.find((l) => l.id === id)?.name ?? id;
  const extra = newlySurplus(before, after);
  if (extra.length)
    notify({
      severity: 'warning',
      kind: 'project',
      title: `${extra.length} vehicle(s) no longer needed`,
      message: `${extra
        .map((v) => v.code)
        .join(
          ', ',
        )} now go to the depot. Delete them in Dashboard → Vehicles, or keep them: a line that accepts their type uses them again.`,
    });
  const ok = changes.reassigned.filter((r) => r.reachable);
  const stuck = changes.reassigned.filter((r) => !r.reachable);
  if (ok.length)
    notify({
      severity: 'info',
      kind: 'project',
      title: `${ok.length} surplus vehicle(s) back in service`,
      message: ok.map((r) => `${r.vehicle.code} → ${lineName(r.lineId)}`).join(', '),
    });
  for (const r of stuck)
    notify({
      severity: 'error',
      kind: 'project',
      title: `${r.vehicle.code} cannot reach ${lineName(r.lineId)}`,
      message: `Reassigned to the line, but no depot of its mode has a way to the line's first stop (street route or depot track). Route the depot link or connect a depot track.`,
      target: { lineId: r.lineId },
    });
  if (changes.added.length)
    notify({
      severity: 'info',
      kind: 'project',
      title: `${changes.added.length} new vehicle(s) added`,
      message: changes.added.map((v) => `${v.code} → ${lineName(v.lineId ?? '')}`).join(', '),
    });
}
import { createLogger } from '../util/logger';
import { DEFAULT_BASEMAP_ID } from '../providers/basemaps';

const log = createLogger('store');

function selectionMode(sc: Scenario, sel: NonNullable<Selection>): TransportMode | null {
  if (sel.kind === 'line') return sc.lines.find((l) => l.id === sel.id)?.mode ?? null;
  if (sel.kind === 'segment') return sc.lines.find((l) => l.id === sel.lineId)?.mode ?? null;
  if (sel.kind === 'track') return sc.trackNetwork.tracks.find((t) => t.id === sel.id)?.designMode ?? null;
  if (sel.kind === 'station') {
    const st = sc.stations.find((s) => s.id === sel.id);
    return st ? stationMode(sc, st) : null;
  }
  return null;
}

export const HISTORY_LIMIT = 100;

export type Tool =
  | 'select'
  | 'draw_line'
  | 'add_station'
  | 'new_service'
  | 'add_signal'
  /** Place a depot of the current street mode (F5). */
  | 'add_depot'
  | 'draw_region'
  /** Draw a polygon to cut out of the selected region. */
  | 'region_hole'
  /** Draw a line across the selected region to split it. */
  | 'region_split';

/** Options for drawing track (rail modes). */
/** Tabs of the Project properties dialog. */
export type PropertiesTab = 'parameters' | 'modes' | 'vehicles' | 'priority' | 'service_day';

export interface ServiceDraftStop {
  stationId: string;
  trackId: string | null;
}

export interface TrackDrawOptions {
  double: boolean;
  /** 'default' = the mode's cited radius; null = no curves (kinks); a number = metres. */
  radius: 'default' | number | null;
  structure: StructureType | 'default';
  /** Drawing guides relative to the previous leg and parallel to nearby straight track. */
  guides: boolean;
}

/** A track deletion waiting for the user's choice because services use the track. */
export interface PendingTrackDeletion {
  trackIds: string[];
  lineIds: string[];
}

export type Selection =
  | { kind: 'line'; id: string }
  | { kind: 'track'; id: string }
  | { kind: 'region'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'station'; id: string }
  | { kind: 'segment'; lineId: string; id: string }
  | { kind: 'signal'; id: string }
  | { kind: 'depot'; id: string }
  | null;

export interface LayerToggles {
  buildings: boolean;
  existingTransit: boolean;
  population: boolean;
  traffic: boolean;
  parkingLandUse: boolean;
  catchments: boolean;
  /** Permitted-movement diagrams beside track junctions. */
  junctionSymbols: boolean;
}

export type View = 'map' | 'schematic' | 'dashboard' | 'table';

/** A closed section in the disruption simulation (not part of the project, not undoable). */
export interface SectionClosure {
  id: string;
  lineId: string;
  fromStationId: string;
  toStationId: string;
  /** turnback: both tracks closed; single_track: one track closed, trains share the other. */
  kind: 'turnback' | 'single_track';
}

export interface AppState {
  project: Project;
  past: Project[];
  future: Project[];
  selection: Selection;
  tool: Tool;
  newLineMode: TransportMode;
  /** For add_station: the line stations are added to (null = nearest line). */
  stationTargetLineId: string | null;
  trackDraw: TrackDrawOptions;
  /** Stations picked so far with the new_service tool, in order. */
  /** Stops picked with the "New service" tool: a station and, optionally, its platform track (R14a). */
  serviceDraft: ServiceDraftStop[];
  /** After the last stop: loop back to the first stop, or run back through the same stations. */
  serviceReturn: 'loop' | 'back';
  /** Stops clicked so far for a new bus, BRT or trolleybus line, in order. */
  stopDraft: LngLat[];
  /** The Project properties dialog is open (at this tab). */
  propertiesTab: PropertiesTab | null;
  pendingTrackDeletion: PendingTrackDeletion | null;
  /** A drawn track whose last point is back at its first: waiting for "close the loop?". */
  pendingLoop: LngLat[] | null;
  /** Platforms of the next station object placed with add_station (rail modes). */
  /** Platforms and level of new station objects (level null = the mode's default). */
  stationDraft: { sidePlatforms: number; islandPlatforms: number; level: number | null };
  /** The curve whose radius editor is open on the map. */
  curveEditor: { trackId: string; index: number } | null;
  /** The finding highlighted in the validation panel and on the map. */
  focusedFindingId: string | null;
  /** Which finding categories show markers on the map. */
  markerVisibility: Record<'error' | 'warning' | 'recommendation' | 'info', boolean>;
  basemapId: string;
  layers: LayerToggles;
  view: View;
  unitSystem: UnitSystem;
  reducedMotion: boolean;
  simulationRunning: boolean;
  simulationMultiplier: number;
  /** Incremented on reset so the renderer redraws vehicles at t = 0. */
  simulationEpoch: number;
  /** Polite screen-reader announcements. */
  announcement: string;
  closures: SectionClosure[];
  /**
   * Whether the user has an active project (created, opened or restored). On a
   * first visit the project is an unsaved scratch project and drawing asks the
   * user to create or select one first. UI state, never saved in the project.
   */
  projectActive: boolean;
  /** The create/select project dialog and the tool to resume afterwards. */
  projectGate: { open: boolean; mode: 'create' | 'select'; resume: Tool | null };
  /** The "Start a network" card was closed for this project. */
  startCardDismissed: boolean;

  commitScenario: (scenario: Scenario, label?: string) => void;
  commitProject: (project: Project, label?: string) => void;
  loadProject: (project: Project) => void;
  newProject: () => void;
  /** Create a new, active project and resume a pending tool if any. */
  createProject: (input: { name: string; description: string; mapView?: Project['mapView'] }) => Project;
  /** Make a loaded project the active one and resume a pending tool if any. */
  activateProject: (project: Project) => void;
  openProjectGate: (mode: 'create' | 'select', resume?: Tool | null) => void;
  closeProjectGate: () => void;
  dismissStartCard: () => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  setTool: (t: Tool) => void;
  setNewLineMode: (m: TransportMode) => void;
  setStationTargetLine: (id: string | null) => void;
  setTrackDraw: (patch: Partial<TrackDrawOptions>) => void;
  setServiceDraft: (stops: ServiceDraftStop[]) => void;
  setServiceReturn: (r: 'loop' | 'back') => void;
  setStopDraft: (points: LngLat[]) => void;
  openProperties: (tab: PropertiesTab | null) => void;
  setPendingTrackDeletion: (p: PendingTrackDeletion | null) => void;
  setPendingLoop: (points: LngLat[] | null) => void;
  setCurveEditor: (c: { trackId: string; index: number } | null) => void;
  setStationDraft: (
    patch: Partial<{ sidePlatforms: number; islandPlatforms: number; level: number | null }>,
  ) => void;
  setFocusedFinding: (id: string | null) => void;
  setMarkerVisible: (severity: 'error' | 'warning' | 'recommendation' | 'info', visible: boolean) => void;
  setBasemap: (id: string) => void;
  toggleLayer: (k: keyof LayerToggles) => void;
  setView: (v: View) => void;
  setUnitSystem: (u: UnitSystem) => void;
  setReducedMotion: (v: boolean) => void;
  setSimulationRunning: (v: boolean) => void;
  setSimulationMultiplier: (m: number) => void;
  resetSimulation: () => void;
  /** A vehicle to open in the map's vehicle info window (fleet number), e.g. from the fleet table. */
  vehicleToShow: string | null;
  showVehicle: (code: string | null) => void;
  /** Jump the simulation to a time (seconds since midnight of day 1). */
  seekSimulation: (tS: number) => void;
  announce: (msg: string) => void;
  addClosure: (c: Omit<SectionClosure, 'id'>) => void;
  removeClosure: (id: string) => void;
  duplicateActiveScenario: () => void;
  setActiveScenario: (id: string) => void;
  deleteScenario: (id: string) => void;
}

export function blankProject(): Project {
  const scenario = emptyScenario('Scenario A');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('prj'),
    name: 'Untitled project',
    description: '',
    metadata: {},
    fictional: false,
    mapView: { center: [10, 50], zoom: 4, bearing: 0, pitch: 0 },
    scenarios: [scenario],
    activeScenarioId: scenario.id,
    assumptionSets: [],
    datasetReferences: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

function initialProject(): { project: Project; active: boolean } {
  const stored = loadFromLocalStorage();
  return stored ? { project: stored, active: true } : { project: blankProject(), active: false };
}

export const useStore = create<AppState>()((set, get) => {
  const push = (project: Project, label?: string) => {
    const { project: current, past } = get();
    log.debug('edit committed', { label: label ?? null, history: past.length + 1 });
    set({
      project,
      past: [...past, current].slice(-HISTORY_LIMIT),
      future: [],
      ...(label ? { announcement: label } : {}),
    });
  };
  const { project: initial, active: initialActive } = initialProject();
  return {
    project: initial,
    past: [],
    future: [],
    selection: null,
    tool: 'select',
    newLineMode: 'tram',
    stationTargetLineId: null,
    trackDraw: { double: false, radius: 'default', structure: 'default', guides: true },
    serviceDraft: [],
    serviceReturn: 'loop',
    stopDraft: [],
    propertiesTab: null,
    pendingTrackDeletion: null,
    pendingLoop: null,
    curveEditor: null,
    stationDraft: { sidePlatforms: 2, islandPlatforms: 0, level: null },
    focusedFindingId: null,
    markerVisibility: { error: true, warning: true, recommendation: true, info: false },
    basemapId: DEFAULT_BASEMAP_ID,
    layers: {
      buildings: true,
      existingTransit: false,
      population: false,
      traffic: false,
      parkingLandUse: true,
      catchments: false,
      junctionSymbols: true,
    },
    view: 'map',
    unitSystem: 'metric',
    reducedMotion: prefersReducedMotion(),
    simulationRunning: false,
    simulationMultiplier: 30,
    simulationEpoch: 0,
    vehicleToShow: null,
    announcement: '',
    closures: [],
    projectActive: initialActive,
    projectGate: { open: false, mode: 'create', resume: null },
    startCardDismissed: false,

    // The fleet follows the lines on every edit (F3): no vehicle appears or vanishes unseen.
    commitScenario: (scenario, label) => {
      const before = activeScenario(get().project);
      const changes: FleetChanges = { reassigned: [], added: [] };
      const synced = withFleet(scenario, before, changes);
      push(replaceScenario(get().project, synced), label);
      reportFleet(before, synced, changes);
    },
    commitProject: (project, label) => push(project, label),
    loadProject: (project) => {
      log.info('project loaded', {
        projectId: project.id,
        fictional: project.fictional,
        scenarios: project.scenarios.length,
        lines: project.scenarios.reduce((n, sc) => n + sc.lines.length, 0),
      });
      set({
        project,
        past: [],
        future: [],
        selection: null,
        closures: [],
        projectActive: true,
        startCardDismissed: false,
        // Keep the user's basemap choice across projects; the OSM map is the default.
        basemapId: get().basemapId,
        announcement: `Loaded project ${project.name}`,
      });
    },
    newProject: () => get().openProjectGate('create'),
    createProject: ({ name, description, mapView }) => {
      const project = {
        ...blankProject(),
        name: name.trim() || 'Untitled project',
        description: description.trim(),
        // Start where the user is looking, not at the default overview.
        ...(mapView ? { mapView } : {}),
      };
      get().activateProject(project);
      return project;
    },
    activateProject: (project) => {
      const resume = get().projectGate.resume;
      get().loadProject(project);
      set({ projectGate: { open: false, mode: 'create', resume: null } });
      if (resume) set({ tool: resume });
    },
    openProjectGate: (mode, resume = null) => set({ projectGate: { open: true, mode, resume } }),
    closeProjectGate: () => set({ projectGate: { open: false, mode: 'create', resume: null } }),
    dismissStartCard: () => set({ startCardDismissed: true }),
    undo: () => {
      const { past, project, future } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      log.debug('undo', { remaining: past.length - 1 });
      set({ project: prev, past: past.slice(0, -1), future: [project, ...future], announcement: 'Undone' });
    },
    redo: () => {
      const { past, project, future } = get();
      const next = future[0];
      if (!next) return;
      log.debug('redo', { remaining: future.length - 1 });
      set({ project: next, past: [...past, project], future: future.slice(1), announcement: 'Redone' });
    },
    select: (selection) => {
      // Selecting a line, track or station switches to its mode's tab (modes are edited separately).
      const sc = activeScenario(get().project);
      const mode = selection ? selectionMode(sc, selection) : null;
      set(mode && mode !== get().newLineMode ? { selection, newLineMode: mode } : { selection });
    },
    setTool: (tool) => {
      // Lines belong to a project: ask for one first, then resume drawing.
      if (
        (tool === 'draw_line' || tool === 'new_service' || tool === 'draw_region') &&
        !get().projectActive
      ) {
        get().openProjectGate('create', tool);
        return;
      }
      set({
        tool,
        serviceDraft: tool === 'new_service' ? get().serviceDraft : [],
        stopDraft: tool === 'draw_line' ? get().stopDraft : [],
      });
    },
    setTrackDraw: (patch) => set({ trackDraw: { ...get().trackDraw, ...patch } }),
    setServiceDraft: (serviceDraft) => set({ serviceDraft }),
    setServiceReturn: (serviceReturn) => set({ serviceReturn }),
    setStopDraft: (stopDraft) => set({ stopDraft }),
    openProperties: (propertiesTab) => set({ propertiesTab }),
    setPendingTrackDeletion: (pendingTrackDeletion) => set({ pendingTrackDeletion }),
    setPendingLoop: (pendingLoop) => set({ pendingLoop }),
    setCurveEditor: (curveEditor) => set({ curveEditor }),
    setStationDraft: (patch) => set({ stationDraft: { ...get().stationDraft, ...patch } }),
    setFocusedFinding: (focusedFindingId) => set({ focusedFindingId }),
    setMarkerVisible: (severity, visible) =>
      set({ markerVisibility: { ...get().markerVisibility, [severity]: visible } }),
    setNewLineMode: (newLineMode) => set({ newLineMode, stopDraft: [] }),
    setStationTargetLine: (stationTargetLineId) => set({ stationTargetLineId }),
    setBasemap: (basemapId) => set({ basemapId }),
    toggleLayer: (k) => set({ layers: { ...get().layers, [k]: !get().layers[k] } }),
    setView: (view) => set({ view }),
    setUnitSystem: (unitSystem) => set({ unitSystem }),
    setReducedMotion: (reducedMotion) => set({ reducedMotion }),
    setSimulationRunning: (simulationRunning) => set({ simulationRunning }),
    setSimulationMultiplier: (simulationMultiplier) => set({ simulationMultiplier }),
    resetSimulation: () => {
      simulationClock.reset(simulationStartS(activeScenario(get().project)));
      set({ simulationEpoch: get().simulationEpoch + 1 });
    },
    showVehicle: (vehicleToShow) =>
      set({ vehicleToShow, ...(vehicleToShow ? { view: 'map' as const } : {}) }),
    seekSimulation: (tS) => {
      simulationClock.seek(tS);
      set({ simulationEpoch: get().simulationEpoch + 1 });
    },
    announce: (announcement) => set({ announcement }),
    addClosure: (c) =>
      set({
        closures: [...get().closures.filter((x) => x.lineId !== c.lineId), { ...c, id: newId('closure') }],
        announcement: 'Section closed in the simulation',
      }),
    removeClosure: (id) =>
      set({ closures: get().closures.filter((c) => c.id !== id), announcement: 'Section reopened' }),
    duplicateActiveScenario: () => {
      const p = get().project;
      push(duplicateScenario(p, p.activeScenarioId), 'Scenario duplicated');
    },
    setActiveScenario: (id) => {
      const p = get().project;
      if (!p.scenarios.some((s) => s.id === id)) return;
      set({ project: { ...p, activeScenarioId: id }, selection: null });
    },
    deleteScenario: (id) => {
      const p = get().project;
      if (p.scenarios.length <= 1) return;
      const scenarios = p.scenarios.filter((s) => s.id !== id);
      push(
        {
          ...p,
          scenarios,
          activeScenarioId: p.activeScenarioId === id ? scenarios[0]!.id : p.activeScenarioId,
        },
        'Scenario deleted',
      );
    },
  };
});

export const useScenario = () => useStore((s) => activeScenario(s.project));
