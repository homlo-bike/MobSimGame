/**
 * Full export (R9): the project together with every value the tool calculates from it and
 * the metadata needed to judge them (parameters with status and source, findings,
 * attribution, versions). Pure: the caller adds the app version and writes the file.
 *
 * Synthetic demonstration figures (catchment population, boardings, costs) are included
 * only for fictional demonstration projects, labelled as such; a real-place project never
 * gets them.
 */
import type { Project, Scenario, TransportLine } from '../domain/schema';
import { SCHEMA_VERSION } from '../domain/schema';
import { MODES } from '../domain/modes';
import { isRing, lineLengthM, linesServingStation, orderedStops } from '../domain/network';
import { routeStatus } from '../domain/alignment';
import { parameter, TRACK_PARAMETERS, type TrackParameterId } from '../domain/trackParameters';
import { modeDefaultRows } from '../domain/projectProperties';
import { stationMode } from '../domain/modeSeparation';
import { ramps } from '../domain/ramps';
import { trackGeometry } from '../domain/tracks';
import { wireSummary } from '../domain/overheadWire';
import { linkDistanceM, linkWalkMin } from '../domain/walkingLinks';
import { lineFleet } from '../analysis/fleet';
import { analyseScenario } from '../analysis/demoAnalysis';
import { validateScenario } from '../validation/validate';
import { findConflicts } from '../simulation/conflicts';
import { buildLineModel, roundTripS } from '../simulation/engine';
import { lineRates } from '../simulation/kinematics';
import { consistShape } from '../simulation/footprint';

export const FULL_EXPORT_FORMAT = 'mobsimgame-full-export';
export const FULL_EXPORT_VERSION = 1;

/** Attribution that must travel with exported map data. */
export const EXPORT_ATTRIBUTION = [
  '© OpenStreetMap contributors (ODbL 1.0) for imported networks, names and street routes',
  'Track geometry, stations and services drawn by the project authors',
];

export const EXPORT_DISCLAIMER =
  'Exploratory sketch tool output, not engineering design or official forecasting. Findings are advisory; values marked placeholder or demonstration are not from a cited source.';

export interface FullExportMeta {
  appVersion: string;
  buildTime: string;
  exportedAt: string;
}

export function fullExport(project: Project, meta: FullExportMeta) {
  return {
    format: FULL_EXPORT_FORMAT,
    formatVersion: FULL_EXPORT_VERSION,
    metadata: {
      ...meta,
      schemaVersion: SCHEMA_VERSION,
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        fictional: project.fictional,
        activeScenarioId: project.activeScenarioId,
      },
      units: 'metres (M), seconds (S), km/h (Kmh), m/s² (Ms2), per cent (Percent), WGS 84 [lon, lat]',
      attribution: EXPORT_ATTRIBUTION,
      disclaimer: EXPORT_DISCLAIMER,
    },
    project,
    scenarios: project.scenarios.map((s) => scenarioResults(s, project.fictional)),
  };
}

/** Everything calculated for one scenario. */
export function scenarioResults(s: Scenario, fictional: boolean) {
  const net = s.trackNetwork;
  return {
    scenarioId: s.id,
    name: s.name,
    parameters: (Object.keys(TRACK_PARAMETERS) as TrackParameterId[]).map((id) => {
      const p = parameter(net, id);
      return {
        id,
        label: p.definition.label,
        unit: p.definition.unit,
        value: p.value,
        status: p.status,
        defaultValue: p.definition.defaultValue,
        source: p.definition.source,
      };
    }),
    modeDefaults: modeDefaultRows(s),
    lines: s.lines.map((l) => lineResults(s, l)),
    stations: s.stations.map((st) => ({
      id: st.id,
      name: st.name,
      mode: stationMode(s, st),
      construction: st.construction,
      position: st.position,
      lineIds: linesServingStation(s, st.id).map((l) => l.id),
    })),
    tracks: net.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      mode: t.designMode,
      lengthM: trackGeometry(net, t).lengthM,
      level: t.level,
      structure: t.structure,
      electrification: t.electrification,
      gaugeMm: t.gaugeMm,
    })),
    ramps: ramps(s),
    crossings: findConflicts(s),
    walkingLinks: s.interchanges.map((link) => ({
      id: link.id,
      stationIds: link.stationIds,
      distanceM: linkDistanceM(s, link),
      ...linkWalkMin(s, link),
    })),
    findings: validateScenario(s),
    // Synthetic figures only for the fictional demonstration project.
    demonstrationAnalysis: fictional
      ? { status: 'demonstration', note: 'Synthetic inputs; not real data.', ...analyseScenario(s) }
      : null,
  };
}

function lineResults(s: Scenario, l: TransportLine) {
  const model = buildLineModel(l, s);
  const route = routeStatus(l);
  return {
    id: l.id,
    name: l.name,
    mode: l.mode,
    modeLabel: MODES[l.mode].label,
    direction: l.direction,
    ring: isRing(l),
    alignment: l.alignment.kind,
    routeStatus: route,
    lengthM: lineLengthM(l),
    stops: orderedStops(l, s.stations).map((o) => ({
      stationId: o.station.id,
      name: o.station.name,
      chainageM: o.chainageM,
    })),
    fleet: lineFleet(l, s),
    /** Simulated duration of one round trip including dwell, waits and acceleration. */
    simulatedRoundTripS: model ? roundTripS(model) : null,
    rates: lineRates(l, s),
    following: model ? { ...model.following, vehicleLengthM: model.vehicleLengthM } : null,
    consist: consistShape(l, s),
    overheadWire: wireSummary(s, l),
  };
}
