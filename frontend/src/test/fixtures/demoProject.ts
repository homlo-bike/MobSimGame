/**
 * FICTIONAL demonstration project — TEST FIXTURE ONLY (not offered in the app).
 *
 * It is placed near 0° N, 0° E (open ocean, "Null Island") on a plain background
 * so it cannot be mistaken for a proposal for any real place. All names, numbers
 * and overlays are synthetic.
 */
import type { LngLat, Project, Scenario } from '../../domain/schema';
import { SCHEMA_VERSION } from '../../domain/schema';
import { addStationOnLine, createLine, emptyScenario, renameStation, updateLine } from '../../domain/network';
import { createTracks } from '../../domain/tracks';
import { addStationOnTracks, setServiceStops, setStationTrack } from '../../domain/serviceRouting';
import { newId, nowIso } from '../../util/id';
import { DEMO_ASSUMPTIONS } from '../../analysis/demoAssumptions';
import { demoProvenance } from '../../providers/provenance';

const ringCentre: LngLat = [0.035, 0.02];
const ringRadius = 0.012;
const ringCoords: LngLat[] = [...Array(12).keys()].map((i) => {
  const a = (i * Math.PI) / 6;
  return [ringCentre[0] + ringRadius * Math.cos(a), ringCentre[1] + ringRadius * Math.sin(a)];
});

const ringStart: LngLat = [
  (ringCoords[11]![0] + ringCoords[0]![0]) / 2,
  (ringCoords[11]![1] + ringCoords[0]![1]) / 2,
];

export function buildDemoScenario(): Scenario {
  let s = emptyScenario('Demo scenario A (fictional)');
  s = {
    ...s,
    description:
      'Fictional network: one metro line, one light-rail ring and one BRT line. Synthetic data only.',
  };

  // --- Red metro line: double track, surface west, tunnel through the centre, elevated east ---
  const pieces: { points: LngLat[]; structure: 'at_grade' | 'tunnel' | 'elevated' }[] = [
    {
      points: [
        [0.0, 0.026],
        [0.008, 0.022],
        [0.015, 0.02],
        [0.017, 0.02],
      ],
      structure: 'at_grade',
    },
    {
      points: [
        [0.017, 0.02],
        [0.023, 0.02],
        [0.035, 0.02],
        [0.047, 0.02],
        [0.052, 0.0205],
      ],
      structure: 'tunnel',
    },
    {
      points: [
        [0.052, 0.0205],
        [0.058, 0.021],
        [0.07, 0.024],
      ],
      structure: 'elevated',
    },
  ];
  for (const p of pieces) {
    const res = createTracks(s, {
      points: p.points,
      mode: 'metro',
      double: true,
      structure: p.structure,
    });
    if (res.error) throw new Error(res.error);
    s = res.scenario;
  }
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
  const redIds: string[] = [];
  for (const [p, name] of redStops) {
    const res = addStationOnTracks(s, p, { mode: 'metro' });
    s = renameStation(res.scenario, res.station!.id, name);
    ids[name] = res.station!.id;
    redIds.push(res.station!.id);
  }
  let r = createLine(s, {
    coordinates: redStops.map(([p]) => p),
    mode: 'metro',
    name: 'Red Line (fictional)',
    color: '#c81e3a',
  });
  s = r.scenario;
  const red = r.line;
  s = updateLine(s, red.id, {
    shortName: 'R',
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
  s = setServiceStops(s, red.id, redIds);

  // --- Blue light-rail ring (double track) sharing two interchange stations with the Red Line ---
  const ringTracks = createTracks(s, {
    // Start and end in the middle of a straight so the ring closes tangentially.
    points: [ringStart, ...ringCoords, ringStart],
    mode: 'light_rail',
    double: true,
    structure: 'at_grade',
  });
  if (ringTracks.error) throw new Error(ringTracks.error);
  s = ringTracks.scenario;
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
  const ringIds: string[] = [];
  for (const [deg, name] of ringStops) {
    const a = (deg * Math.PI) / 180;
    const at: LngLat = [ringCentre[0] + ringRadius * Math.cos(a), ringCentre[1] + ringRadius * Math.sin(a)];
    const shared = ids[name];
    if (shared) {
      // Interchange: the existing Red Line station also serves the ring tracks.
      for (const id of ringTracks.trackIds) s = setStationTrack(s, shared, id, true);
      ringIds.push(shared);
      continue;
    }
    const res = addStationOnTracks(s, at, { mode: 'light_rail' });
    s = res.reused ? res.scenario : renameStation(res.scenario, res.station!.id, name);
    ringIds.push(res.station!.id);
  }
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
  s = setServiceStops(s, ring.id, ringIds);

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
    metadata: {},
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
