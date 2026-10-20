/**
 * MapLibre sources and layers owned by MobSimGame. They are re-added after every
 * basemap switch (style.load). Structure types use distinct dash patterns and
 * widths so they are distinguishable without colour.
 */
import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { StructureType } from '../domain/schema';
import { STRUCTURE_DASH } from '../domain/modes';
import { EMPTY } from './overlays';

export const SRC = {
  regions: 'msg-regions',
  regionLabels: 'msg-region-labels',
  tracks: 'msg-tracks',
  trackNodes: 'msg-track-nodes',
  segments: 'msg-segments',
  arrows: 'msg-arrows',
  crossovers: 'msg-crossovers',
  closures: 'msg-closures',
  signals: 'msg-signals',
  routeStatus: 'msg-route-status',
  stations: 'msg-stations',
  catchments: 'msg-catchments',
  vehicles: 'msg-vehicles',
  population: 'msg-population',
  traffic: 'msg-traffic',
  transit: 'msg-transit',
  dem: 'msg-dem',
  findings: 'msg-findings',
} as const;

export const STATION_LAYER = 'msg-stations-circle';
export const CROSSOVER_LAYER = 'msg-crossovers-circle';
export const SIGNAL_LAYER = 'msg-signals-circle';
export const TRACK_NODE_LAYER = 'msg-track-nodes-circle';
export const TRACK_LAYER_PREFIX = 'msg-track-';
export const FINDING_LAYER = 'msg-findings-symbol';
export const REGION_FILL_LAYER = 'msg-regions-fill';
export const FINDING_CLUSTER_LAYER = 'msg-findings-cluster';

/**
 * Marker shapes per finding category (shape and colour both differ, so the
 * category never depends on colour alone): error = square, warning = triangle,
 * recommendation = diamond, information = circle.
 */
function findingImage(severity: 'error' | 'warning' | 'recommendation' | 'info') {
  const size = 18;
  const data = new Uint8Array(size * size * 4);
  const fill: Record<string, [number, number, number]> = {
    error: [185, 28, 28],
    warning: [217, 119, 6],
    recommendation: [2, 132, 199],
    info: [71, 85, 105],
  };
  const c = (size - 1) / 2;
  const inside = (x: number, y: number, inset: number) => {
    const dx = Math.abs(x - c);
    const dy = y - c;
    const r = c - inset;
    switch (severity) {
      case 'error':
        return dx <= r - 1 && Math.abs(dy) <= r - 1;
      case 'warning': {
        const top = inset * 1.8;
        const bottom = size - 1 - inset;
        if (y < top || y > bottom) return false;
        return dx <= ((y - top) / (bottom - top)) * r;
      }
      case 'recommendation':
        return dx + Math.abs(dy) <= r;
      default:
        return dx * dx + dy * dy <= r * r;
    }
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (inside(x, y, 2.5)) data.set([...fill[severity]!, 255], i);
      else if (inside(x, y, 0.5)) data.set([255, 255, 255, 255], i);
    }
  return { width: size, height: size, data };
}

const ARROW_IMAGE = 'msg-arrow';

/** A small arrowhead pointing up (north): dark fill with a white outline, readable on any line colour. */
function arrowImage(): { width: number; height: number; data: Uint8Array } {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  // Triangle with apex at the top centre.
  const inside = (x: number, y: number, inset: number) => {
    const top = 2 + inset * 1.6;
    const bottom = size - 3 - inset;
    if (y < top || y > bottom) return false;
    const half = ((y - top) / (bottom - top)) * (size / 2 - 2 - inset);
    return Math.abs(x - size / 2) <= half;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;
      if (inside(px, py, 1.5)) {
        data.set([31, 41, 55, 255], i);
      } else if (inside(px, py, 0)) {
        data.set([255, 255, 255, 255], i);
      }
    }
  }
  return { width: size, height: size, data };
}

/** Pixel offset of each track from the line centre; grows with zoom so double track reads as two lines. */
const TRACK_OFFSET = [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  ['*', ['get', 'offsetSign'], 1],
  14,
  ['*', ['get', 'offsetSign'], 2.5],
  17,
  ['*', ['get', 'offsetSign'], 5],
] as unknown as number;
export const SEGMENT_LAYER_PREFIX = 'msg-seg-';

const STRUCTURES: StructureType[] = [
  'at_grade',
  'underground',
  'tunnel',
  'cut_and_cover',
  'elevated',
  'bridge',
];

export function ensureLayers(map: MlMap, opts: { labels: boolean }) {
  for (const id of Object.values(SRC)) {
    if (id === SRC.dem || map.getSource(id)) continue;
    if (id === SRC.findings)
      // Clustered so many findings in one place do not pile up.
      map.addSource(id, {
        type: 'geojson',
        data: EMPTY,
        cluster: true,
        clusterRadius: 36,
        clusterMaxZoom: 16,
        clusterProperties: { worst: ['max', ['get', 'rank']] },
      });
    else map.addSource(id, { type: 'geojson', data: EMPTY });
  }
  const add = (layer: Parameters<MlMap['addLayer']>[0]) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  };
  add({
    id: 'msg-population-fill',
    type: 'fill',
    source: SRC.population,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': [
        'interpolate',
        ['linear'],
        ['get', 'density'],
        0,
        '#fff7ec',
        2000,
        '#fdbb84',
        6000,
        '#e34a33',
        10000,
        '#7f0000',
      ],
      'fill-opacity': 0.45,
    },
  });
  add({
    id: 'msg-traffic-line',
    type: 'line',
    source: SRC.traffic,
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: {
      'line-width': 4,
      'line-color': [
        'interpolate',
        ['linear'],
        ['get', 'speedRatio'],
        0,
        '#7f1d1d',
        0.5,
        '#f59e0b',
        1,
        '#16a34a',
      ],
      'line-dasharray': [1, 1],
    },
  });
  add({
    id: 'msg-transit-line',
    type: 'line',
    source: SRC.transit,
    layout: { visibility: 'none' },
    paint: { 'line-width': 3, 'line-color': '#64748b', 'line-dasharray': [3, 2] },
  });
  add({
    id: 'msg-catchments-fill',
    type: 'fill',
    source: SRC.catchments,
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#0ea5e9', 'fill-opacity': 0.08, 'fill-outline-color': '#0369a1' },
  });
  // Regions under the network: fill and outline from each region's style.
  add({
    id: REGION_FILL_LAYER,
    type: 'fill',
    source: SRC.regions,
    paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': ['get', 'opacity'] },
  });
  add({
    id: 'msg-regions-outline',
    type: 'line',
    source: SRC.regions,
    paint: {
      'line-color': ['get', 'outline'],
      'line-width': ['case', ['get', 'selected'], 3, 1.5],
    },
  });
  if (opts.labels)
    add({
      id: 'msg-regions-label',
      type: 'symbol',
      source: SRC.regionLabels,
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
      paint: { 'text-color': '#3b0764', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
  // Halo under every segment so lines read on any basemap.
  add({
    id: 'msg-seg-halo',
    type: 'line',
    source: SRC.segments,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['case', ['get', 'selected'], 11, 8],
      'line-opacity': 0.9,
      'line-offset': TRACK_OFFSET,
    },
  });
  for (const s of STRUCTURES) {
    const dash = STRUCTURE_DASH[s];
    add({
      id: `${SEGMENT_LAYER_PREFIX}${s}`,
      type: 'line',
      source: SRC.segments,
      filter: ['==', ['get', 'structure'], s],
      layout: { 'line-cap': dash ? 'butt' : 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': [
          'case',
          ['==', ['get', 'track'], 'band'],
          ['case', ['get', 'selected'], 9, 6],
          ['==', ['get', 'track'], 'single'],
          ['case', ['get', 'selected'], 5, 3],
          ['case', ['get', 'selected'], 4, 3],
        ],
        'line-opacity': [
          'case',
          ['==', ['get', 'track'], 'band'],
          0.6,
          ['underground', 'tunnel', 'cut_and_cover'].includes(s) ? 0.75 : 1,
        ],
        'line-offset': TRACK_OFFSET,
        ...(dash ? { 'line-dasharray': dash } : {}),
      },
    });
  }
  // Physical tracks: a thin dark line per track at its true position, over the service colour bands.
  for (const s of STRUCTURES) {
    const dash = STRUCTURE_DASH[s];
    add({
      id: `${TRACK_LAYER_PREFIX}${s}`,
      type: 'line',
      source: SRC.tracks,
      filter: ['==', ['get', 'structure'], s],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': ['case', ['get', 'selected'], '#0f766e', '#1e293b'],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12,
          ['case', ['get', 'selected'], 3, 1],
          17,
          ['case', ['get', 'selected'], 4.5, 2],
        ],
        'line-opacity': ['underground', 'tunnel', 'cut_and_cover'].includes(s) ? 0.7 : 1,
        ...(dash ? { 'line-dasharray': dash } : {}),
      },
    });
  }
  // Track nodes: junctions are larger with a heavy ring, open ends are hollow (shape, not colour alone).
  add({
    id: TRACK_NODE_LAYER,
    type: 'circle',
    source: SRC.trackNodes,
    minzoom: 13,
    paint: {
      'circle-radius': [
        'case',
        ['get', 'selected'],
        7,
        ['==', ['get', 'kind'], 'junction'],
        5,
        ['==', ['get', 'kind'], 'connection'],
        2.5,
        4,
      ],
      'circle-color': ['case', ['==', ['get', 'kind'], 'end'], '#ffffff', '#1e293b'],
      'circle-stroke-color': ['case', ['get', 'selected'], '#0f766e', '#1e293b'],
      'circle-stroke-width': ['case', ['==', ['get', 'kind'], 'junction'], 2.5, 1.5],
    },
  });
  // Bus sections that do not follow streets: dashed (unrouted: red, manual: grey) with a label.
  add({
    id: 'msg-route-status-line',
    type: 'line',
    source: SRC.routeStatus,
    layout: { 'line-cap': 'butt' },
    paint: {
      'line-color': ['case', ['==', ['get', 'status'], 'unrouted'], '#b91c1c', '#475569'],
      'line-width': 3,
      'line-dasharray': [2, 2],
    },
  });
  // Closed sections: wide dashed band in a warning colour plus a pattern, never colour alone.
  add({
    id: 'msg-closures-line',
    type: 'line',
    source: SRC.closures,
    layout: { 'line-cap': 'butt' },
    paint: { 'line-color': '#b91c1c', 'line-width': 9, 'line-opacity': 0.55, 'line-dasharray': [1, 1] },
  });
  // Direction of travel on every track (both directions on single track used both ways).
  if (!map.hasImage(ARROW_IMAGE)) map.addImage(ARROW_IMAGE, arrowImage(), { pixelRatio: 1 });
  add({
    id: 'msg-arrows',
    type: 'symbol',
    source: SRC.arrows,
    minzoom: 13,
    layout: {
      'icon-image': ARROW_IMAGE,
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 17, 0.9],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      // Offset in the rotated frame: +x is the right of travel, matching the track offset.
      'icon-offset': [
        'case',
        ['>', ['get', 'offsetSign'], 0],
        ['literal', [6, 0]],
        ['<', ['get', 'offsetSign'], 0],
        ['literal', [-6, 0]],
        ['literal', [0, 0]],
      ],
    },
  });
  add({
    id: CROSSOVER_LAYER,
    type: 'circle',
    source: SRC.crossovers,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 6],
      'circle-color': '#ffffff',
      'circle-stroke-color': '#111827',
      'circle-stroke-width': 2,
    },
  });
  // Traffic signals: colour shows the simulated state; red also has a heavier ring (not colour alone).
  add({
    id: SIGNAL_LAYER,
    type: 'circle',
    source: SRC.signals,
    minzoom: 12,
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        12,
        2.5,
        16,
        ['case', ['get', 'selected'], 8, 5],
      ],
      'circle-color': ['case', ['==', ['get', 'state'], 'green'], '#16a34a', '#dc2626'],
      'circle-stroke-color': '#111827',
      'circle-stroke-width': ['case', ['==', ['get', 'state'], 'green'], 1, 2.5],
    },
  });
  add({
    id: STATION_LAYER,
    type: 'circle',
    source: SRC.stations,
    paint: {
      // Bus stops are smaller than rail stations; stops without a line have a grey ring.
      'circle-radius': [
        'case',
        ['get', 'selected'],
        9,
        ['get', 'interchange'],
        8,
        ['==', ['get', 'kind'], 'bus'],
        4.5,
        6,
      ],
      'circle-color': '#ffffff',
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'kind'], 'orphan'],
        '#94a3b8',
        ['get', 'interchange'],
        '#111827',
        ['get', 'color'],
      ],
      'circle-stroke-width': ['case', ['get', 'selected'], 4, ['get', 'interchange'], 3.5, 3],
    },
  });
  if (opts.labels) {
    add({
      id: 'msg-route-status-label',
      type: 'symbol',
      source: SRC.routeStatus,
      layout: {
        'symbol-placement': 'line-center',
        'text-field': ['case', ['==', ['get', 'status'], 'unrouted'], 'not routed', 'manual'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, -0.9],
      },
      paint: { 'text-color': '#7f1d1d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
    add({
      id: 'msg-crossovers-label',
      type: 'symbol',
      source: SRC.crossovers,
      layout: {
        'text-field': '×',
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#111827' },
    });
    add({
      id: 'msg-stations-label',
      type: 'symbol',
      source: SRC.stations,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
  }
  // Validation markers, above stations and lines.
  for (const sev of ['error', 'warning', 'recommendation', 'info'] as const)
    if (!map.hasImage(`msg-finding-${sev}`))
      map.addImage(`msg-finding-${sev}`, findingImage(sev), { pixelRatio: 1 });
  add({
    id: FINDING_CLUSTER_LAYER,
    type: 'circle',
    source: SRC.findings,
    filter: ['has', 'point_count'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 10, 20, 16],
      'circle-color': '#ffffff',
      // Worst category in the cluster: thicker ring for errors (not colour alone).
      'circle-stroke-color': ['match', ['get', 'worst'], 4, '#b91c1c', 3, '#d97706', 2, '#0284c7', '#475569'],
      'circle-stroke-width': ['match', ['get', 'worst'], 4, 4, 3, 3, 2],
    },
  });
  if (opts.labels)
    add({
      id: 'msg-findings-cluster-count',
      type: 'symbol',
      source: SRC.findings,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#111827' },
    });
  add({
    id: FINDING_LAYER,
    type: 'symbol',
    source: SRC.findings,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': ['concat', 'msg-finding-', ['get', 'severity']],
      'icon-size': ['case', ['get', 'focused'], 1.5, 1],
      'icon-allow-overlap': true,
      'symbol-sort-key': ['-', 0, ['get', 'rank']],
    },
  });
  add({
    id: 'msg-vehicles-circle',
    type: 'circle',
    source: SRC.vehicles,
    paint: {
      'circle-radius': 5,
      'circle-color': ['get', 'color'],
      'circle-stroke-color': '#111827',
      'circle-stroke-width': ['case', ['==', ['get', 'state'], 'running'], 1.5, 3],
    },
  });
}

export function setData(map: MlMap, source: string, data: FeatureCollection) {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}

export function setVisible(map: MlMap, layerId: string, visible: boolean) {
  if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

/** Toggle basemap layers by their vector source-layer (e.g. "building"). */
export function setBasemapSourceLayersVisible(map: MlMap, sourceLayers: string[], visible: boolean) {
  for (const layer of map.getStyle().layers ?? []) {
    const sl = (layer as { 'source-layer'?: string })['source-layer'];
    if (sl && sourceLayers.includes(sl))
      map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
  }
}
