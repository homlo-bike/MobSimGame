/**
 * Basemap and terrain options. Only keyless public endpoints are listed by
 * default. Extra styles can be added at build time with VITE_EXTRA_BASEMAPS
 * ("Label|https://…/style.json,Label 2|…"). Never put keyed URLs there: the
 * value is public in the browser bundle.
 */
import type { StyleSpecification } from 'maplibre-gl';
import type { BasemapOption } from './types';

const OFM_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

/** A style without basemap tiles: works offline (labels need the glyph server) and in tests. */
export function plainStyle(highContrast: boolean): StyleSpecification {
  return {
    version: 8,
    name: highContrast ? 'High contrast (no basemap)' : 'Plain (no basemap)',
    // Glyphs are only needed for station labels; if offline, labels are simply not drawn.
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': highContrast ? '#000000' : '#f1f5f4' },
      },
    ],
  };
}

export function basemapOptions(): BasemapOption[] {
  const options: BasemapOption[] = [
    {
      id: 'ofm-liberty',
      label: 'OpenFreeMap Liberty',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      attribution: OFM_ATTRIBUTION,
      requiresNetwork: true,
    },
    {
      id: 'ofm-positron',
      label: 'OpenFreeMap Positron (light)',
      style: 'https://tiles.openfreemap.org/styles/positron',
      attribution: OFM_ATTRIBUTION,
      requiresNetwork: true,
    },
    {
      id: 'ofm-bright',
      label: 'OpenFreeMap Bright',
      style: 'https://tiles.openfreemap.org/styles/bright',
      attribution: OFM_ATTRIBUTION,
      requiresNetwork: true,
    },
    {
      id: 'plain',
      label: 'Plain background (offline)',
      style: plainStyle(false),
      attribution: '',
      requiresNetwork: false,
    },
    {
      id: 'high-contrast',
      label: 'High contrast (offline)',
      style: plainStyle(true),
      attribution: '',
      highContrast: true,
      requiresNetwork: false,
    },
  ];
  const extra = (import.meta.env.VITE_EXTRA_BASEMAPS as string | undefined) ?? '';
  for (const [i, entry] of extra.split(',').filter(Boolean).entries()) {
    const [label, url] = entry.split('|');
    if (label && url && /^https:\/\//.test(url)) {
      options.push({ id: `extra-${i}`, label, style: url, attribution: '', requiresNetwork: true });
    }
  }
  return options;
}

export const TERRAIN_ATTRIBUTION =
  'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a> (Mapzen/Tilezen; SRTM, GMTED2010 and 3DEP courtesy of the U.S. Geological Survey; ETOPO1 courtesy of NOAA; see <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">source attributions</a>)';

export function terrainSource() {
  const url = (import.meta.env.VITE_TERRAIN_TILES_URL as string | undefined) ?? '';
  if (!url) return null;
  return {
    tiles: [url],
    encoding: 'terrarium' as const,
    tileSize: 256,
    maxzoom: 15,
    attribution: TERRAIN_ATTRIBUTION,
  };
}
