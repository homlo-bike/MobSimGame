/** Pure builders for the GeoJSON shown in MapLibre layers (no map access). */
import type { FeatureCollection, Feature } from 'geojson';
import { circle } from '@turf/turf';
import type { Scenario } from '../domain/schema';
import { isInterchange, isRing, linesServingStation } from '../domain/network';
import { slicePath } from '../geo/geometry';
import type { VehicleState } from '../simulation/engine';
import type { PopulationCell, TrafficSegment, TransitRoute } from '../providers/types';

export function segmentsCollection(scenario: Scenario, selectedLineId: string | null): FeatureCollection {
  const features: Feature[] = [];
  for (const line of scenario.lines) {
    for (const seg of line.segments) {
      const coords = slicePath(line.coordinates, isRing(line), seg.fromFraction, seg.toFraction);
      if (coords.length < 2) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {
          lineId: line.id,
          segmentId: seg.id,
          color: line.color,
          structure: seg.structure,
          tracks: seg.tracks,
          selected: line.id === selectedLineId,
        },
      });
    }
  }
  return { type: 'FeatureCollection', features };
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
