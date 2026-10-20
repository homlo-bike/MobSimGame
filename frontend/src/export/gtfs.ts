/**
 * GTFS Schedule export (R9). Pure: builds the text files of a static GTFS feed from a
 * scenario; `zip` packs them. Lines become routes, stations stops, and each line one trip
 * pattern per direction that repeats at the peak headway between the service start and end
 * (frequencies.txt). Times between stops come from the simulation (running time with
 * acceleration and braking, dwell), so they match the animation without signal or
 * crossing waits. The feed describes a sketch, not a published timetable.
 */
import type { Project, Scenario, TransportLine, TransportMode } from '../domain/schema';
import { isRing, orderedStops } from '../domain/network';
import { pathCoordinates } from '../geo/geometry';
import { buildLineModel, tripPhases, type Phase } from '../simulation/engine';

/** GTFS route_type for each mode (basic route types of the GTFS Schedule reference). */
export const GTFS_ROUTE_TYPE: Partial<Record<TransportMode, number>> = {
  tram: 0,
  light_rail: 0,
  metro: 1,
  elevated_metro: 1,
  commuter_rail: 2,
  bus: 3,
  brt: 3,
  trolleybus: 11,
  custom: 3,
};

export interface GtfsOptions {
  /** Public URL of the deployment, for agency_url and feed_publisher_url. */
  baseUrl: string;
  /** IANA time zone of the network, e.g. "Europe/Berlin". */
  timezone: string;
  /** Feed date (validity starts here and runs one year). */
  date: Date;
}

const csv = (rows: (string | number)[][]) =>
  rows
    .map((r) =>
      r
        .map((v) => {
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n') + '\n';

const ymd = (d: Date) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

/** Seconds → "HH:MM:SS" (hours may exceed 24, as GTFS allows). */
export function gtfsTime(totalS: number): string {
  const s = Math.round(totalS);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const clockS = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 3600 + (m ?? 0) * 60;
};

/** Arrival and departure (s after trip start) at a chainage, travelling in `dir`, from the trip's phases. */
function timesAt(
  phases: readonly Phase[],
  chainageM: number,
  dir: 1 | -1,
): { arr: number; dep: number } | null {
  let t = 0;
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i]!;
    if (p.direction === dir) {
      if (p.kind === 'dwell' && Math.abs(p.chainageM - chainageM) < 1)
        return { arr: t, dep: t + p.durationS };
      if (p.kind === 'run') {
        const lo = Math.min(p.fromM, p.toM);
        const hi = Math.max(p.fromM, p.toM);
        if (chainageM >= lo - 1e-6 && chainageM <= hi + 1e-6) {
          const f = hi > lo ? Math.abs(chainageM - p.fromM) / (hi - lo) : 0;
          // A dwell right after this run is the stop itself.
          const next = phases[i + 1];
          if (f > 0.999 && next?.kind === 'dwell' && Math.abs(next.chainageM - chainageM) < 1)
            return { arr: t + p.durationS, dep: t + p.durationS + next.durationS };
          return { arr: t + f * p.durationS, dep: t + f * p.durationS };
        }
      }
    }
    t += p.durationS;
  }
  return null;
}

export interface GtfsFeed {
  files: { name: string; content: string }[];
  /** Lines left out and why. */
  skipped: { lineId: string; reason: string }[];
}

export function buildGtfs(project: Project, scenario: Scenario, opt: GtfsOptions): GtfsFeed {
  const skipped: GtfsFeed['skipped'] = [];
  const stopsUsed = new Set<string>();
  const routes: (string | number)[][] = [];
  const trips: (string | number)[][] = [];
  const stopTimes: (string | number)[][] = [];
  const freqs: (string | number)[][] = [];
  const shapes: (string | number)[][] = [];
  for (const line of scenario.lines) {
    const type = GTFS_ROUTE_TYPE[line.mode];
    if (type === undefined) {
      skipped.push({ lineId: line.id, reason: 'mode without public transport service' });
      continue;
    }
    const model = buildLineModel(line, scenario);
    const svc = model?.services[0];
    const stops = orderedStops(line, scenario.stations);
    if (!model || !svc || stops.length < 2) {
      skipped.push({ lineId: line.id, reason: 'needs at least two stops and a valid route' });
      continue;
    }
    const phases = tripPhases(model, svc, 0);
    const pattern = line.servicePatterns[0];
    routes.push([
      line.id,
      'mobsim',
      line.shortName,
      line.name,
      type,
      line.color.replace('#', '').toUpperCase(),
    ]);
    const directions: (1 | -1)[] =
      line.direction === 'bidirectional' && !isRing(line) && svc.pattern === 'shuttle' ? [1, -1] : [1];
    for (const dir of directions) {
      const tripId = `${line.id}-${dir === 1 ? 'out' : 'back'}`;
      const shapeId = `${tripId}-shape`;
      trips.push([line.id, 'all_days', tripId, dir === 1 ? 0 : 1, shapeId]);
      const seq = dir === 1 ? stops : [...stops].reverse();
      const start = pattern ? clockS(pattern.serviceStart) : 5 * 3600;
      let n = 0;
      let last = -1;
      for (const st of seq) {
        const tt = timesAt(phases, st.chainageM, dir);
        if (!tt) continue;
        // Times never go backwards within a trip.
        const arr = Math.max(tt.arr, last);
        const dep = Math.max(tt.dep, arr);
        last = dep;
        stopsUsed.add(st.station.id);
        stopTimes.push([tripId, gtfsTime(start + arr), gtfsTime(start + dep), st.station.id, ++n]);
      }
      // A loop returns to its first stop.
      if (isRing(line) && seq.length) {
        const lap = phases.filter((p) => p.direction === dir).reduce((a, p) => a + p.durationS, 0);
        stopTimes.push([tripId, gtfsTime(start + lap), gtfsTime(start + lap), seq[0]!.station.id, ++n]);
      }
      if (pattern)
        freqs.push([
          tripId,
          gtfsTime(clockS(pattern.serviceStart)),
          gtfsTime(clockS(pattern.serviceEnd)),
          Math.round(pattern.peakHeadwayMin * 60),
          0,
        ]);
      const coords = shapeCoords(line, model.returnPath?.coords ?? null, dir);
      coords.forEach((c, i) => shapes.push([shapeId, c[1].toFixed(6), c[0].toFixed(6), i + 1]));
    }
  }
  const stops = scenario.stations
    .filter((s) => stopsUsed.has(s.id))
    .map((s) => [s.id, s.name, s.position[1].toFixed(6), s.position[0].toFixed(6), 0]);
  const end = new Date(opt.date.getTime());
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  const files = [
    {
      name: 'agency.txt',
      content: csv([
        ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
        ['mobsim', project.name || 'MobSimGame sketch', opt.baseUrl, opt.timezone],
      ]),
    },
    {
      name: 'stops.txt',
      content: csv([['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type'], ...stops]),
    },
    {
      name: 'routes.txt',
      content: csv([
        ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color'],
        ...routes,
      ]),
    },
    {
      name: 'trips.txt',
      content: csv([['route_id', 'service_id', 'trip_id', 'direction_id', 'shape_id'], ...trips]),
    },
    {
      name: 'stop_times.txt',
      content: csv([['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'], ...stopTimes]),
    },
    {
      name: 'frequencies.txt',
      content: csv([['trip_id', 'start_time', 'end_time', 'headway_secs', 'exact_times'], ...freqs]),
    },
    {
      name: 'calendar.txt',
      content: csv([
        [
          'service_id',
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
          'sunday',
          'start_date',
          'end_date',
        ],
        ['all_days', 1, 1, 1, 1, 1, 1, 1, ymd(opt.date), ymd(end)],
      ]),
    },
    {
      name: 'shapes.txt',
      content: csv([['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], ...shapes]),
    },
    {
      name: 'feed_info.txt',
      content: csv([
        ['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_version'],
        [project.name || 'MobSimGame sketch', opt.baseUrl, 'en', ymd(opt.date)],
      ]),
    },
  ];
  return { files, skipped };
}

function shapeCoords(line: TransportLine, back: [number, number][] | null, dir: 1 | -1): [number, number][] {
  const out = pathCoordinates(line.coordinates, isRing(line)) as [number, number][];
  if (dir === 1) return out;
  return back && back.length >= 2 ? back : [...out].reverse();
}
