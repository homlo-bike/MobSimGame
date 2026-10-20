/**
 * SUMO export (R9): plain-XML network of the rail track, public transport stops and the
 * rail services as flows, for running the scenario in Eclipse SUMO on the user's own
 * machine (owner decision: interoperate through files, no SUMO code or container here).
 * Pure: returns the files; `zip` packs them.
 *
 * Coordinates are longitude/latitude, so netconvert needs --proj.utm (SUMO
 * documentation, "Networks/PlainXML"). Street lines (bus, BRT, trolleybus) have no street
 * network in the project; they reach SUMO through the GTFS export and SUMO's own OSM and
 * GTFS import tools, as the bundled readme explains.
 */
import type { PhysicalTrack, Scenario, Station, TrackStep, TransportMode } from '../domain/schema';
import { MODES } from '../domain/modes';
import { orderedStops } from '../domain/network';
import { platformLengthM } from '../domain/trackParameters';
import { trackGeometry } from '../domain/tracks';
import { lineRates } from '../simulation/kinematics';
import { consistShape } from '../simulation/footprint';

/** SUMO vehicle class per rail mode ("Definition of Vehicles, Vehicle Types, and Routes"). */
export const SUMO_VCLASS: Partial<Record<TransportMode, string>> = {
  tram: 'tram',
  light_rail: 'rail_urban',
  metro: 'subway',
  elevated_metro: 'subway',
  commuter_rail: 'rail_urban',
  custom: 'rail_urban',
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (x: number, d = 2) => (Math.round(x * 10 ** d) / 10 ** d).toString();
const ll = (p: readonly [number, number]) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
const clockS = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 3600 + (m ?? 0) * 60;
};

/** SUMO edge ids of a track: forward, and the reverse one where trains may run against it. */
function edgeIds(t: PhysicalTrack): { forward: string | null; backward: string | null } {
  return {
    forward: t.direction === 'backward' ? null : t.id,
    backward: t.direction === 'forward' ? null : `-${t.id}`,
  };
}

export interface SumoExport {
  files: { name: string; content: string }[];
  /** Lines left out and why. */
  skipped: { lineId: string; reason: string }[];
}

export function buildSumo(scenario: Scenario, projectName: string): SumoExport {
  const net = scenario.trackNetwork;
  const usedNodes = new Set<string>();
  const edges: string[] = [];
  for (const t of net.tracks) {
    if (!SUMO_VCLASS[t.designMode]) continue;
    const g = trackGeometry(net, t);
    const speed = (t.speedLimitKmh ?? MODES[t.designMode].defaultMaxSpeedKmh) / 3.6;
    const allow = SUMO_VCLASS[t.designMode]!;
    const { forward, backward } = edgeIds(t);
    const shape = g.coordinates.map(ll).join(' ');
    const shapeBack = [...g.coordinates].reverse().map(ll).join(' ');
    usedNodes.add(t.fromNodeId);
    usedNodes.add(t.toNodeId);
    const common = `numLanes="1" speed="${num(speed)}" allow="${allow}" spreadType="center"`;
    // A single track used both ways is one track: "bidi" pairs the two directions.
    const bidi = (other: string | null) => (forward && backward ? ` bidi="${other}"` : '');
    if (forward)
      edges.push(
        `  <edge id="${esc(forward)}" from="${t.fromNodeId}" to="${t.toNodeId}" ${common} shape="${shape}"${bidi(backward)}/>`,
      );
    if (backward)
      edges.push(
        `  <edge id="${esc(backward)}" from="${t.toNodeId}" to="${t.fromNodeId}" ${common} shape="${shapeBack}"${bidi(forward)}/>`,
      );
  }
  const nodes = net.nodes
    .filter((n) => usedNodes.has(n.id))
    .map((n) => `  <node id="${n.id}" x="${n.position[0].toFixed(7)}" y="${n.position[1].toFixed(7)}"/>`);

  const stops: string[] = [];
  const stopIds = new Set<string>();
  const vtypes: string[] = [];
  const flows: string[] = [];
  const skipped: SumoExport['skipped'] = [];
  for (const line of scenario.lines) {
    const vclass = SUMO_VCLASS[line.mode];
    if (!vclass || line.alignment.kind !== 'track') {
      skipped.push({
        lineId: line.id,
        reason: 'street line: use the GTFS export with SUMO’s OSM and GTFS import (see README.txt)',
      });
      continue;
    }
    if (line.alignment.status !== 'routed' || !line.alignment.path.length) {
      skipped.push({ lineId: line.id, reason: 'not routed over the tracks' });
      continue;
    }
    const shape = consistShape(line, scenario);
    const rates = lineRates(line, scenario);
    const vt = `vt_${line.id}`;
    vtypes.push(
      `  <vType id="${vt}" vClass="${vclass}" length="${num(shape.unitLengthM * shape.units)}" width="${num(shape.widthM)}" accel="${num(rates.accelMs2)}" decel="${num(rates.decelMs2)}" maxSpeed="${num(line.maxSpeedKmh / 3.6)}"/>`,
    );
    const pattern = line.servicePatterns[0];
    const legs: { steps: TrackStep[]; dir: 'out' | 'back' }[] = [{ steps: line.alignment.path, dir: 'out' }];
    if (line.direction === 'bidirectional' && line.alignment.returnPath?.length)
      legs.push({ steps: line.alignment.returnPath, dir: 'back' });
    for (const leg of legs) {
      const route: string[] = [];
      for (const s of leg.steps) {
        const t = net.tracks.find((x) => x.id === s.trackId);
        if (!t) continue;
        const ids = edgeIds(t);
        const id = s.reversed ? ids.backward : ids.forward;
        if (id && route[route.length - 1] !== id) route.push(id);
      }
      if (route.length === 0) continue;
      const stopEls: string[] = [];
      const ordered = orderedStops(line, scenario.stations);
      for (const o of leg.dir === 'out' ? ordered : [...ordered].reverse()) {
        const stop = stopOnRoute(scenario, o.station, leg.steps, line.mode);
        if (!stop) continue;
        if (!stopIds.has(stop.id)) {
          stopIds.add(stop.id);
          stops.push(
            `  <trainStop id="${stop.id}" lane="${esc(stop.edge)}_0" startPos="${num(stop.start)}" endPos="${num(stop.end)}" name="${esc(o.station.name)}" friendlyPos="true"/>`,
          );
        }
        stopEls.push(`    <stop busStop="${stop.id}" duration="${Math.round(line.dwellTimeS)}"/>`);
      }
      const begin = pattern ? clockS(pattern.serviceStart) : 5 * 3600;
      const end = pattern ? clockS(pattern.serviceEnd) : 24 * 3600;
      const period = Math.round((pattern?.peakHeadwayMin ?? 10) * 60);
      flows.push(
        `  <flow id="${line.id}_${leg.dir}" type="${vt}" line="${esc(line.shortName || line.name)}" begin="${begin}" end="${end}" period="${period}">\n` +
          `    <route edges="${route.map(esc).join(' ')}"/>\n` +
          stopEls.join('\n') +
          (stopEls.length ? '\n' : '') +
          '  </flow>',
      );
    }
  }

  const header = (root: string, extra = '') =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${esc(projectName).replace(/-{2,}/g, '-')}: exported by MobSimGame. Coordinates are longitude,latitude: build with netconvert and the proj.utm option (see README.txt). -->\n<${root}${extra}>\n`;
  return {
    files: [
      { name: 'network.nod.xml', content: header('nodes') + nodes.join('\n') + '\n</nodes>\n' },
      { name: 'network.edg.xml', content: header('edges') + edges.join('\n') + '\n</edges>\n' },
      { name: 'stops.add.xml', content: header('additional') + stops.join('\n') + '\n</additional>\n' },
      {
        name: 'routes.rou.xml',
        content: header('routes') + [...vtypes, ...flows].join('\n') + '\n</routes>\n',
      },
      { name: 'README.txt', content: readme(projectName, skipped.length) },
    ],
    skipped,
  };
}

/** Where a station's platform lies on the service's route: edge and position along it. */
function stopOnRoute(
  scenario: Scenario,
  st: Station,
  steps: readonly TrackStep[],
  mode: TransportMode,
): { id: string; edge: string; start: number; end: number } | null {
  const net = scenario.trackNetwork;
  const refs = [
    ...st.trackRefs,
    ...(st.layout?.trackIds ?? []).map((trackId) => ({ trackId, fraction: 0.5 })),
  ];
  for (const s of steps) {
    const ref = refs.find((r) => r.trackId === s.trackId);
    if (!ref) continue;
    const t = net.tracks.find((x) => x.id === s.trackId);
    if (!t) continue;
    const ids = edgeIds(t);
    const edge = s.reversed ? ids.backward : ids.forward;
    if (!edge) continue;
    const len = trackGeometry(net, t).lengthM;
    const at = (s.reversed ? 1 - ref.fraction : ref.fraction) * len;
    const half = Math.min(len, st.layout?.platformLengthM ?? platformLengthM(net, mode)) / 2;
    const start = Math.max(0, Math.min(len - 2 * half, at - half));
    return { id: `${st.id}_${edge.replace(/^-/, 'r')}`, edge, start, end: Math.min(len, start + 2 * half) };
  }
  return null;
}

function readme(projectName: string, skipped: number): string {
  return `${projectName}: SUMO files exported by MobSimGame

Files
- network.nod.xml, network.edg.xml: the rail track network (nodes and tracks; a single
  track used both ways is a pair of edges joined by "bidi").
- stops.add.xml: platforms as train stops.
- routes.rou.xml: one vehicle type and one flow per rail service and direction, repeating
  at the peak headway between service start and end, stopping for the dwell time.

Build and run (Eclipse SUMO, https://eclipse.dev/sumo)
  netconvert --node-files network.nod.xml --edge-files network.edg.xml --proj.utm -o network.net.xml
  sumo-gui -n network.net.xml -a stops.add.xml -r routes.rou.xml

Coordinates are longitude/latitude; --proj.utm projects them to metres.

Street lines (bus, BRT, trolleybus)${skipped ? ` and ${skipped} other line(s)` : ''} are not in these files: the project has
no street network. Import the streets from OpenStreetMap (osmWebWizard or netconvert
--osm-files) and the services from MobSimGame's GTFS export (SUMO's gtfs2pt tool).

This is an exploratory sketch, not engineering design or an official timetable.
`;
}
