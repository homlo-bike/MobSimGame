/** Pure builders for the GeoJSON shown in MapLibre layers (no map access). */
import type { FeatureCollection, Feature } from 'geojson';
import { circle } from '@turf/turf';
import type { LngLat, Scenario } from '../domain/schema';
import {
  isInterchange,
  isRing,
  linesServingStation,
  orderedStops,
  placedCrossovers,
} from '../domain/network';
import { slicePath } from '../geo/geometry';
import { isGreen } from '../domain/signals';
import { interpolate, measurePath, type VehicleState } from '../simulation/engine';
import type { PopulationCell, TrafficSegment, TransitRoute } from '../providers/types';

/**
 * One feature per track and segment. A double-track segment becomes two
 * features: each runs in its direction of travel (the return track's
 * coordinates are reversed) and is drawn offset to the running side, so arrows
 * along the line show the direction of each track. `offsetSign` is +1 for an
 * offset to the right of the feature's own direction.
 */
export function segmentsCollection(scenario: Scenario, selectedLineId: string | null): FeatureCollection {
  const features: Feature[] = [];
  for (const line of scenario.lines) {
    const guidedOrRoad = !['cycling', 'pedestrian'].includes(line.mode);
    // A bus return that uses other streets (one-way streets) is drawn as its own path.
    const ownReturn =
      line.alignment.kind === 'routed' && line.direction === 'bidirectional'
        ? line.alignment.returnCoordinates
        : null;
    if (ownReturn && ownReturn.length >= 2) {
      const seg = line.segments[0]!;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: ownReturn },
        properties: {
          lineId: line.id,
          segmentId: seg.id,
          color: line.color,
          structure: seg.structure,
          tracks: seg.tracks,
          selected: line.id === selectedLineId,
          track: 'return',
          offsetSign: line.runningSide === 'right' ? 1 : -1,
          arrow: '›',
        },
      });
    }
    for (const seg of line.segments) {
      const coords = slicePath(line.coordinates, isRing(line), seg.fromFraction, seg.toFraction);
      if (coords.length < 2) continue;
      const base = {
        lineId: line.id,
        segmentId: seg.id,
        color: line.color,
        structure: seg.structure,
        tracks: seg.tracks,
        selected: line.id === selectedLineId,
      };
      const sideSign = (line.runningSide === 'right' ? 1 : -1) * (seg.flipped ? -1 : 1);
      if (ownReturn && ownReturn.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { ...base, track: 'forward', offsetSign: sideSign, arrow: '›' },
        });
      } else if (seg.tracks === 'double' && line.direction === 'bidirectional' && guidedOrRoad) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { ...base, track: 'forward', offsetSign: sideSign, arrow: '›' },
        });
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [...coords].reverse() },
          properties: { ...base, track: 'return', offsetSign: sideSign, arrow: '›' },
        });
      } else {
        const oneWay = line.direction === 'one_way';
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: {
            ...base,
            track: 'single',
            offsetSign: 0,
            // Single track used both ways shows both directions; active modes show no arrows.
            arrow: !guidedOrRoad ? '' : oneWay ? '›' : '‹ ›',
          },
        });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Sections closed in the disruption simulation. */
export function closuresCollection(
  scenario: Scenario,
  closures: readonly { lineId: string; fromStationId: string; toStationId: string }[],
): FeatureCollection {
  const features: Feature[] = [];
  for (const c of closures) {
    const line = scenario.lines.find((l) => l.id === c.lineId);
    if (!line) continue;
    const stops = orderedStops(line, scenario.stations);
    const a = stops.find((s) => s.station.id === c.fromStationId)?.fraction;
    const b = stops.find((s) => s.station.id === c.toStationId)?.fraction;
    if (a === undefined || b === undefined) continue;
    const coords = slicePath(line.coordinates, isRing(line), Math.min(a, b), Math.max(a, b));
    if (coords.length >= 2)
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { lineId: line.id },
      });
  }
  return { type: 'FeatureCollection', features };
}

/** Distance between direction arrows along a track. */
const ARROW_SPACING_M = 150;

/**
 * Direction-of-travel arrows: points along each track with the bearing of
 * travel and the side of the line the track is drawn on.
 */
export function arrowsCollection(segments: FeatureCollection): FeatureCollection {
  const features: Feature[] = [];
  for (const f of segments.features) {
    if (f.geometry.type !== 'LineString') continue;
    const p = f.properties ?? {};
    if (!p.arrow) continue;
    const path = measurePath(f.geometry.coordinates as LngLat[], false);
    const both = p.arrow === '‹ ›';
    for (let d = ARROW_SPACING_M / 2; d < path.lengthM; d += ARROW_SPACING_M) {
      const here = interpolate(path, d).position;
      const ahead = interpolate(path, Math.min(path.lengthM, d + 2)).position;
      const bearing = bearingDeg(here, ahead);
      const props = { color: p.color, offsetSign: p.offsetSign ?? 0 };
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: here },
        properties: { ...props, bearing },
      });
      if (both)
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: here },
          properties: { ...props, bearing: (bearing + 180) % 360 },
        });
    }
  }
  return { type: 'FeatureCollection', features };
}

function bearingDeg(a: LngLat, b: LngLat): number {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return ((Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
}

/** Traffic signals with their simulated state at time tS (green/red). */
export function signalsCollection(
  scenario: Scenario,
  tS: number,
  selectedId: string | null,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: scenario.trafficSignals.map((s) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: s.position },
      properties: { signalId: s.id, state: isGreen(s, tS) ? 'green' : 'red', selected: s.id === selectedId },
    })),
  };
}

export function crossoversCollection(scenario: Scenario): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: scenario.lines.flatMap((line) =>
      placedCrossovers(line, scenario.stations).map((c) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: c.position },
        properties: { lineId: line.id, crossoverId: c.id, color: line.color },
      })),
    ),
  };
}

export function stationsCollection(scenario: Scenario, selectedStationId: string | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: scenario.stations.map((s) => {
      const lines = linesServingStation(scenario, s.id);
      return {
        type: 'Feature',
        id: s.id,
        geometry: { type: 'Point', coordinates: s.position },
        properties: {
          stationId: s.id,
          name: s.name,
          interchange: isInterchange(scenario, s.id),
          color: lines[0]?.color ?? '#475569',
          lineCount: lines.length,
          selected: s.id === selectedStationId,
        },
      };
    }),
  };
}

export function catchmentsCollection(scenario: Scenario): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: scenario.stations.map((s) =>
      circle(s.position, s.catchmentRadiusM / 1000, {
        steps: 48,
        units: 'kilometers',
        properties: { stationId: s.id },
      }),
    ),
  };
}

export function vehiclesCollection(vehicles: readonly VehicleState[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: vehicles.map((v) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: v.position },
      properties: { id: v.id, color: v.color, state: v.state, bearing: v.bearingDeg },
    })),
  };
}

export function populationCollection(cells: readonly PopulationCell[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: cells.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [c.polygon] },
      properties: { density: c.density?.central ?? 0, status: c.status },
    })),
  };
}

export function trafficCollection(segments: readonly TrafficSegment[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: segments.map((s) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: s.coordinates },
      properties: { speedRatio: s.speedRatio, temporalType: s.temporalType },
    })),
  };
}

export function transitCollection(routes: readonly TransitRoute[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: routes.map((r) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: r.coordinates },
      properties: { name: r.name, mode: r.mode },
    })),
  };
}

export const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
