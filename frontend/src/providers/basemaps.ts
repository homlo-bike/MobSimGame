/**
 * Background options: one of map (OpenStreetMap), aerial imagery or terrain relief is
 * shown at a time, so only the visible layer is downloaded. Only keyless public endpoints
 * are listed by default. Extra styles can be added at build time with VITE_EXTRA_BASEMAPS
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

/** Default background: OpenStreetMap data in the OpenFreeMap Liberty vector style. */
export const DEFAULT_BASEMAP_ID = 'ofm-liberty';

export function basemapOptions(): BasemapOption[] {
  const options: BasemapOption[] = [
    {
      id: 'ofm-liberty',
      label: 'OpenStreetMap (OpenFreeMap Liberty)',
      kind: 'map',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      attribution: OFM_ATTRIBUTION,
      requiresNetwork: true,
    },
    {
      id: 'ofm-positron',
      label: 'OpenStreetMap light (OpenFreeMap Positron)',
      kind: 'map',
      style: 'https://tiles.openfreemap.org/styles/positron',
      attribution: OFM_ATTRIBUTION,
      requiresNetwork: true,
    },
    {
      id: 'ofm-bright',
      label: 'OpenStreetMap bright (OpenFreeMap Bright)',
      kind: 'map',
      style: 'https://tiles.openfreemap.org/styles/bright',
      attribution: OFM_ATTRIBUTION,
      requiresNetwork: true,
    },
    {
      id: 'plain',
      label: 'Plain background (offline)',
      kind: 'plain',
      style: plainStyle(false),
      attribution: '',
      requiresNetwork: false,
    },
    {
      id: 'high-contrast',
      label: 'High contrast (offline)',
      kind: 'plain',
      style: plainStyle(true),
      attribution: '',
      highContrast: true,
      requiresNetwork: false,
    },
  ];
  options.splice(3, 0, {
    id: 'aerial-s2',
    label: 'Aerial: Sentinel-2 cloudless 2016 (10 m, EOX)',
    kind: 'aerial',
    style: rasterStyle(S2_TILES, S2_ATTRIBUTION, 15),
    attribution: S2_ATTRIBUTION,
    requiresNetwork: true,
  });
  // Esri's terms apply to the deployment that enables it (see docs/PROVIDER_CONFIGURATION.md).
  if ((import.meta.env.VITE_ESRI_IMAGERY as string | undefined) === '1')
    options.splice(4, 0, {
      id: 'aerial-esri',
      label: 'Aerial: Esri World Imagery',
      kind: 'aerial',
      style: rasterStyle(ESRI_TILES, ESRI_ATTRIBUTION, 19),
      attribution: ESRI_ATTRIBUTION,
      requiresNetwork: true,
    });
  const dem = terrainSource();
  if (dem)
    options.splice(
      options.findIndex((o) => o.kind === 'plain'),
      0,
      {
        id: 'terrain',
        label: 'Terrain relief (3D when tilted)',
        kind: 'terrain',
        style: terrainStyle(dem),
        attribution: dem.attribution,
        requiresNetwork: true,
      },
    );
  const extra = (import.meta.env.VITE_EXTRA_BASEMAPS as string | undefined) ?? '';
  for (const [i, entry] of extra.split(',').filter(Boolean).entries()) {
    const [label, url] = entry.split('|');
    if (label && url && /^https:\/\//.test(url)) {
      options.push({
        id: `extra-${i}`,
        label,
        kind: 'map',
        style: url,
        attribution: '',
        requiresNetwork: true,
      });
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

const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

const S2_TILES = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';
export const S2_ATTRIBUTION =
  '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless - https://s2maps.eu</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016), <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>';

const ESRI_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const ESRI_ATTRIBUTION =
  'Imagery: <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Vantor, Earthstar Geographics, and the GIS User Community';

/** A style made of one raster tile layer (aerial imagery). */
function rasterStyle(tiles: string, attribution: string, maxzoom: number): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      imagery: { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom, attribution },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#1f2937' } },
      { id: 'imagery', type: 'raster', source: 'imagery' },
    ],
  };
}

/** Terrain relief: hillshading from the elevation tiles, which also give the 3D surface. */
function terrainStyle(dem: NonNullable<ReturnType<typeof terrainSource>>): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      'basemap-dem': {
        type: 'raster-dem',
        tiles: dem.tiles,
        encoding: dem.encoding,
        tileSize: dem.tileSize,
        maxzoom: dem.maxzoom,
        attribution: dem.attribution,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f1f5f4' } },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'basemap-dem',
        paint: { 'hillshade-exaggeration': 0.6, 'hillshade-shadow-color': '#475569' },
      },
    ],
  };
}
