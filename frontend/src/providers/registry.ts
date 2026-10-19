/**
 * Which provider implementation is used for what, in Phase 1.
 *
 * Fictional projects use the synthetic mock providers. Real-place projects use
 * backend-proxied providers where they exist (geocoding, OSM features) and
 * otherwise report "not configured" / "manual input required" instead of
 * showing synthetic data over a real city.
 */
import type { Capability, CapabilityState, ProviderKind } from './types';
import {
  MockElevationProvider,
  MockGeocoderProvider,
  MockOsmFeatureProvider,
  MockPopulationProvider,
  MockTrafficProvider,
  MockTransitProvider,
} from './mock';
import { BackendGeocoderProvider, BackendOsmFeatureProvider, ProviderError } from './backend';
import { createLogger } from '../util/logger';

const log = createLogger('providers');

export const mockProviders = {
  geocoder: new MockGeocoderProvider(),
  osm: new MockOsmFeatureProvider(),
  population: new MockPopulationProvider(),
  traffic: new MockTrafficProvider(),
  transit: new MockTransitProvider(),
  elevation: new MockElevationProvider(),
};

export const backendProviders = {
  geocoder: new BackendGeocoderProvider(),
  osm: new BackendOsmFeatureProvider(),
};

export interface ProviderStatusRow {
  kind: ProviderKind;
  label: string;
  implementation: string;
  phase: number;
  state: CapabilityState;
  note: string;
}

const cap = (state: CapabilityState, message: string): Capability => ({
  state,
  message,
  checkedAt: new Date().toISOString(),
});

/** Static Phase 1 status of every provider interface (shown in the Data sources panel). */
export function providerStatusRows(fictional: boolean): ProviderStatusRow[] {
  const demo = (label: string): Pick<ProviderStatusRow, 'state' | 'note'> =>
    fictional
      ? { state: 'demonstration', note: `${label}: synthetic data for the fictional demo` }
      : {
          state: 'manual_input_required',
          note: `${label}: no provider configured; enter values manually (Phase 3 adds providers)`,
        };
  return [
    {
      kind: 'basemap',
      label: 'Basemap',
      implementation: 'OpenFreeMap styles / offline plain style',
      phase: 1,
      state: 'available',
      note: 'Keyless public tiles; offline style available',
    },
    {
      kind: 'terrain',
      label: 'Terrain',
      implementation: 'AWS Terrain Tiles (Terrarium)',
      phase: 1,
      state: 'available',
      note: 'Visual terrain only; not used for engineering grades',
    },
    {
      kind: 'geocoder',
      label: 'Geocoder',
      implementation: 'Nominatim via backend (cached), offline coordinate parser fallback',
      phase: 1,
      state: 'available',
      note: 'Search runs on submit only',
    },
    {
      kind: 'osm_features',
      label: 'OSM features',
      implementation: 'Overpass via backend (cached, bounded)',
      phase: 1,
      state: fictional ? 'demonstration' : 'available',
      note: fictional
        ? 'Synthetic features in the demo city'
        : 'Requires the backend; used for station-name suggestions',
    },
    {
      kind: 'population',
      label: 'Population density',
      implementation: 'CAMARA adapter (backend, disabled) · mock',
      phase: 3,
      ...demo('Population'),
    },
    {
      kind: 'traffic',
      label: 'Traffic',
      implementation: 'ArcGIS adapter (backend, disabled) · mock',
      phase: 3,
      ...demo('Traffic'),
    },
    {
      kind: 'transit',
      label: 'Existing transit',
      implementation: 'transport.rest adapter (backend, disabled) · mock',
      phase: 3,
      ...demo('Existing transit'),
    },
    {
      kind: 'elevation',
      label: 'Elevation',
      implementation: 'Interface · mock',
      phase: 2,
      ...demo('Elevation'),
    },
    {
      kind: 'routing',
      label: 'Street routing',
      implementation: 'Interface only',
      phase: 2,
      state: 'not_configured',
      note: 'Bus/BRT alignments are not routed in Phase 1',
    },
    {
      kind: 'air_quality',
      label: 'Air quality',
      implementation: 'Interface only',
      phase: 4,
      state: 'not_configured',
      note: 'No concentration modelling',
    },
    {
      kind: 'emission_factor',
      label: 'Emission factors',
      implementation: 'Interface · demonstration assumptions',
      phase: 4,
      state: 'demonstration',
      note: 'Synthetic factors in the demo assumption set',
    },
    {
      kind: 'cost_benchmark',
      label: 'Cost benchmarks',
      implementation: 'Interface · demonstration assumptions',
      phase: 4,
      state: 'demonstration',
      note: 'Synthetic costs in demo units (DU)',
    },
    {
      kind: 'property_value',
      label: 'Property value',
      implementation: 'Interface only (disabled by default)',
      phase: 4,
      state: 'not_configured',
      note: 'Optional module requiring local evidence',
    },
  ];
}

/** Geocode with the backend, falling back to the offline parser when unavailable. */
export async function geocode(query: string) {
  try {
    const res = await backendProviders.geocoder.search(query);
    if (res.data.length) return res;
    log.debug('geocoder returned no results; trying the offline coordinate parser');
    const offline = await mockProviders.geocoder.search(query);
    return offline.data.length ? offline : res;
  } catch (e) {
    log.warn('geocoder unavailable; using the offline coordinate parser', {
      state: e instanceof ProviderError ? e.state : 'unknown',
    });
    const offline = await mockProviders.geocoder.search(query);
    return {
      ...offline,
      capability: cap(
        'using_fallback',
        `${e instanceof ProviderError ? e.message : 'Search unavailable'}; using the offline coordinate parser`,
      ),
    };
  }
}
