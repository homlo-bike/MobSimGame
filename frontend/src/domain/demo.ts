/**
 * FICTIONAL demonstration project.
 *
 * It is placed near 0° N, 0° E (open ocean, "Null Island") on a plain background
 * so it cannot be mistaken for a proposal for any real place. All names, numbers
 * and overlays are synthetic.
 */
import type { LngLat, Project, Scenario } from './schema';
import { SCHEMA_VERSION } from './schema';
import { addStationOnLine, createLine, emptyScenario, renameStation, updateLine } from './network';
import { snapToPath } from '../geo/geometry';
import { newId, nowIso } from '../util/id';
import { DEMO_ASSUMPTIONS } from '../analysis/demoAssumptions';
import { demoProvenance } from '../providers/provenance';

const ringCentre: LngLat = [0.035, 0.02];
const ringRadius = 0.012;
const ringCoords: LngLat[] = [...Array(12).keys()].map((i) => {
  const a = (i * Math.PI) / 6;
  return [ringCentre[0] + ringRadius * Math.cos(a), ringCentre[1] + ringRadius * Math.sin(a)];
});

function fractionAt(coords: LngLat[], x: number, y: number): number {
  return snapToPath(coords, false, [x, y])!.fraction;
}

export function buildDemoScenario(): Scenario {
  let s = emptyScenario('Demo scenario A (fictional)');
  s = {
    ...s,
    description:
      'Fictional network: one metro line, one light-rail ring and one BRT line. Synthetic data only.',
  };

  // --- Red metro line: surface west, tunnel through the centre, elevated east ---
  const redCoords: LngLat[] = [
    [0.0, 0.026],
    [0.008, 0.022],
    [0.015, 0.02],
    [0.023, 0.02],
    [0.035, 0.02],
    [0.047, 0.02],
    [0.058, 0.021],
    [0.07, 0.024],
  ];
  let r = createLine(s, {
    coordinates: redCoords,
    mode: 'metro',
    name: 'Red Line (fictional)',
    color: '#c81e3a',
  });
  s = r.scenario;
  const red = r.line;
  const tunnelStart = fractionAt(redCoords, 0.017, 0.02);
  const tunnelEnd = fractionAt(redCoords, 0.052, 0.0205);
  s = updateLine(s, red.id, {
    shortName: 'R',
    segments: [
      {
        id: newId('seg'),
        fromFraction: 0,
        toFraction: tunnelStart,
        structure: 'at_grade',
        rightOfWay: 'dedicated_track',
        tracks: 'double',
        speedLimitKmh: null,
        notes: '',
        flipped: false,
      },
      {
        id: newId('seg'),
        fromFraction: tunnelStart,
        toFraction: tunnelEnd,
        structure: 'tunnel',
        rightOfWay: 'dedicated_track',
        tracks: 'double',
        speedLimitKmh: null,
        notes: 'West portal near Millbrook; east ramp before Harbour Road (fictional).',
        flipped: false,
      },
      {
        id: newId('seg'),
        fromFraction: tunnelEnd,
        toFraction: 1,
        structure: 'elevated',
        rightOfWay: 'dedicated_track',
        tracks: 'double',
        speedLimitKmh: null,
        notes: 'Viaduct (fictional).',
        flipped: false,
      },
    ],
    servicePatterns: [
      {
        ...red.servicePatterns[0]!,
        peakHeadwayMin: 5,
        offPeakHeadwayMin: 10,
        serviceStart: '05:00',
        serviceEnd: '24:00',
      },
    ],
  });
  const redStops: [LngLat, string][] = [
    [[0.0, 0.026], 'Westend (fictional)'],
    [[0.012, 0.0209], 'Millbrook (fictional)'],
    [[0.023, 0.02], 'Ring West (fictional)'],
    [[0.035, 0.02], 'Central (fictional)'],
    [[0.047, 0.02], 'University (fictional)'],
    [[0.058, 0.021], 'Harbour Road (fictional)'],
    [[0.07, 0.024], 'Eastfield (fictional)'],
  ];
  const ids: Record<string, string> = {};
  for (const [p, name] of redStops) {
    const res = addStationOnLine(s, red.id, p);
    s = res.scenario;
    s = renameStation(s, res.station!.id, name);
    ids[name] = res.station!.id;
  }

  // --- Blue light-rail ring sharing two interchange stations with the Red Line ---
  r = createLine(s, {
    coordinates: ringCoords,
    mode: 'light_rail',
    name: 'Blue Ring (fictional)',
    color: '#1f5fbf',
    ring: true,
  });
  s = r.scenario;
  const ring = r.line;
  s = updateLine(s, ring.id, { shortName: 'B' });
  const ringStops: [number, string][] = [
    [0, 'University (fictional)'],
    [45, 'Ring North-East (fictional)'],
    [90, 'Ring North (fictional)'],
    [135, 'Ring North-West (fictional)'],
    [180, 'Ring West (fictional)'],
    [225, 'Ring South-West (fictional)'],
    [270, 'Ring South (fictional)'],
    [315, 'Ring South-East (fictional)'],
  ];
  for (const [deg, name] of ringStops) {
    const a = (deg * Math.PI) / 180;
    const res = addStationOnLine(s, ring.id, [
      ringCentre[0] + ringRadius * Math.cos(a),
      ringCentre[1] + ringRadius * Math.sin(a),
    ]);
    s = res.scenario;
    if (!res.reused) s = renameStation(s, res.station!.id, name);
  }

  // --- Green BRT line, north–south, interchange with the Red Line at Central ---
  const brtCoords: LngLat[] = [
    [0.0355, 0.045],
    [0.035, 0.032],
    [0.035, 0.02],
    [0.035, 0.008],
    [0.0345, -0.005],
  ];
  r = createLine(s, {
    coordinates: brtCoords,
    mode: 'brt',
    name: 'Green BRT (fictional)',
    color: '#13804a',
    alignment: 'polyline',
  });
  s = r.scenario;
  const brt = r.line;
  s = updateLine(s, brt.id, {
    shortName: 'G',
    segments: [
      {
        id: newId('seg'),
        fromFraction: 0,
        toFraction: 0.5,
        structure: 'at_grade',
        rightOfWay: 'dedicated_lane',
        tracks: 'double',
        speedLimitKmh: 50,
        notes: '',
        flipped: false,
      },
      {
        id: newId('seg'),
        fromFraction: 0.5,
        toFraction: 1,
        structure: 'at_grade',
        rightOfWay: 'mixed_traffic',
        tracks: 'double',
        speedLimitKmh: 50,
        notes: '',
        flipped: false,
      },
    ],
  });
  const brtStops: [LngLat, string][] = [
    [[0.0355, 0.045], 'North Park (fictional)'],
    [[0.035, 0.032], 'Ring North (fictional)'],
    [[0.035, 0.02], 'Central (fictional)'],
    [[0.035, 0.008], 'Ring South (fictional)'],
    [[0.0345, -0.005], 'South Gate (fictional)'],
  ];
  for (const [p, name] of brtStops) {
    const res = addStationOnLine(s, brt.id, p);
    s = res.scenario;
    if (!res.reused) s = renameStation(s, res.station!.id, name);
  }
  s = {
    ...s,
    depots: [
      { id: newId('depot'), name: 'Westend depot (fictional)', position: [-0.004, 0.027], lineIds: [red.id] },
    ],
    assumptionSetId: DEMO_ASSUMPTIONS.id,
  };
  return s;
}

export function buildDemoProject(): Project {
  const scenario = buildDemoScenario();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('prj'),
    name: 'Fictional demo city',
    description:
      'FICTIONAL demonstration project. The network, names, populations, traffic and every figure are synthetic and describe no real city.',
    fictional: true,
    mapView: { center: [0.035, 0.02], zoom: 12.6, bearing: 0, pitch: 0 },
    scenarios: [scenario],
    activeScenarioId: scenario.id,
    assumptionSets: [DEMO_ASSUMPTIONS],
    datasetReferences: [
      { id: 'demo-data', provenance: demoProvenance('Fictional demo city (network, population, traffic)') },
    ],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}
