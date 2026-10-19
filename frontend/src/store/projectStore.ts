/**
 * Client state (Zustand).
 *
 * The Project is immutable data; every edit produces a new Project via the pure
 * functions in domain/network.ts and is pushed onto an undo stack. The map's draw
 * layer mirrors the project (see map/drawSync.ts), never the other way round,
 * except for geometry edits which are fed back through `commitScenario`.
 */
import { create } from 'zustand';
import type { Project, Scenario, TransportMode } from '../domain/schema';
import { activeScenario, duplicateScenario, emptyScenario, replaceScenario } from '../domain/network';
import { SCHEMA_VERSION } from '../domain/schema';
import { buildDemoProject } from '../domain/demo';
import { newId, nowIso } from '../util/id';
import { loadFromLocalStorage } from './persistence';
import type { UnitSystem } from '../analysis/units';
import { simulationClock } from '../simulation/runtime';
import { createLogger } from '../util/logger';
import { DEFAULT_BASEMAP_ID } from '../providers/basemaps';

const log = createLogger('store');

export const HISTORY_LIMIT = 100;

export type Tool = 'select' | 'draw_line' | 'add_station';

export type Selection =
  | { kind: 'line'; id: string }
  | { kind: 'station'; id: string }
  | { kind: 'segment'; lineId: string; id: string }
  | null;

export interface LayerToggles {
  terrain: boolean;
  buildings: boolean;
  existingTransit: boolean;
  population: boolean;
  traffic: boolean;
  parkingLandUse: boolean;
  catchments: boolean;
}

export type View = 'map' | 'schematic' | 'dashboard' | 'table';

export interface AppState {
  project: Project;
  past: Project[];
  future: Project[];
  selection: Selection;
  tool: Tool;
  newLineMode: TransportMode;
  /** For add_station: the line stations are added to (null = nearest line). */
  stationTargetLineId: string | null;
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

  commitScenario: (scenario: Scenario, label?: string) => void;
  commitProject: (project: Project, label?: string) => void;
  loadProject: (project: Project) => void;
  newProject: () => void;
  loadDemo: () => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  setTool: (t: Tool) => void;
  setNewLineMode: (m: TransportMode) => void;
  setStationTargetLine: (id: string | null) => void;
  setBasemap: (id: string) => void;
  toggleLayer: (k: keyof LayerToggles) => void;
  setView: (v: View) => void;
  setUnitSystem: (u: UnitSystem) => void;
  setReducedMotion: (v: boolean) => void;
  setSimulationRunning: (v: boolean) => void;
  setSimulationMultiplier: (m: number) => void;
  resetSimulation: () => void;
  announce: (msg: string) => void;
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

function initialProject(): Project {
  return loadFromLocalStorage() ?? buildDemoProject();
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
  const initial = initialProject();
  return {
    project: initial,
    past: [],
    future: [],
    selection: null,
    tool: 'select',
    newLineMode: 'tram',
    stationTargetLineId: null,
    basemapId: DEFAULT_BASEMAP_ID,
    layers: {
      terrain: false,
      buildings: true,
      existingTransit: false,
      population: false,
      traffic: false,
      parkingLandUse: true,
      catchments: false,
    },
    view: 'map',
    unitSystem: 'metric',
    reducedMotion: prefersReducedMotion(),
    simulationRunning: false,
    simulationMultiplier: 30,
    simulationEpoch: 0,
    announcement: '',

    commitScenario: (scenario, label) => push(replaceScenario(get().project, scenario), label),
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
        // Keep the user's basemap choice across projects; the OSM map is the default.
        basemapId: get().basemapId,
        announcement: `Loaded project ${project.name}`,
      });
    },
    newProject: () => get().loadProject(blankProject()),
    loadDemo: () => get().loadProject(buildDemoProject()),
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
    select: (selection) => set({ selection }),
    setTool: (tool) => set({ tool }),
    setNewLineMode: (newLineMode) => set({ newLineMode }),
    setStationTargetLine: (stationTargetLineId) => set({ stationTargetLineId }),
    setBasemap: (basemapId) => set({ basemapId }),
    toggleLayer: (k) => set({ layers: { ...get().layers, [k]: !get().layers[k] } }),
    setView: (view) => set({ view }),
    setUnitSystem: (unitSystem) => set({ unitSystem }),
    setReducedMotion: (reducedMotion) => set({ reducedMotion }),
    setSimulationRunning: (simulationRunning) => set({ simulationRunning }),
    setSimulationMultiplier: (simulationMultiplier) => set({ simulationMultiplier }),
    resetSimulation: () => {
      simulationClock.reset();
      set({ simulationEpoch: get().simulationEpoch + 1 });
    },
    announce: (announcement) => set({ announcement }),
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
