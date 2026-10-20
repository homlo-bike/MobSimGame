/**
 * Data-provider contracts.
 *
 * The app talks to data only through these interfaces. Every response carries
 * Provenance. Providers that need credentials are implemented on the backend
 * (backend/app/providers) and reached through /api so no secret reaches the
 * browser; the browser-side classes here are either mocks, thin clients of the
 * backend proxy, or pure interfaces awaiting a later phase.
 */
import type { LngLat, Provenance, Range } from '../domain/schema';

export type BBox = [west: number, south: number, east: number, north: number];

export type CapabilityState =
  | 'available'
  | 'authentication_required'
  | 'coverage_unavailable'
  | 'rate_limited'
  | 'temporarily_unavailable'
  | 'using_cache'
  | 'using_fallback'
  | 'manual_input_required'
  | 'not_configured'
  | 'demonstration';

export const CAPABILITY_LABELS: Record<CapabilityState, string> = {
  available: 'Available for this location',
  authentication_required: 'Authentication required',
  coverage_unavailable: 'Coverage unavailable',
  rate_limited: 'Rate limit reached',
  temporarily_unavailable: 'Provider temporarily unavailable',
  using_cache: 'Using cached result',
  using_fallback: 'Using a fallback dataset',
  manual_input_required: 'Manual input required',
  not_configured: 'Not configured',
  demonstration: 'Demonstration data (synthetic)',
};

export interface Capability {
  state: CapabilityState;
  message: string;
  checkedAt: string;
}

export interface ProviderResponse<T> {
  data: T;
  provenance: Provenance;
  capability: Capability;
}

export interface Provider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly label: string;
  /** Whether using this provider sends user-drawn geometry to a third party. */
  readonly sendsProjectDataToThirdParty: boolean;
  capability(area?: BBox): Promise<Capability>;
}

export type ProviderKind =
  | 'basemap'
  | 'osm_features'
  | 'geocoder'
  | 'traffic'
  | 'population'
  | 'elevation'
  | 'terrain'
  | 'transit'
  | 'routing'
  | 'air_quality'
  | 'emission_factor'
  | 'cost_benchmark'
  | 'property_value';

// --- Basemap / terrain -------------------------------------------------------

export interface BasemapOption {
  id: string;
  label: string;
  /** MapLibre style URL or inline style object. */
  style: string | object;
  attribution: string;
  highContrast?: boolean;
  requiresNetwork: boolean;
}

export interface BasemapProvider extends Provider {
  kind: 'basemap';
  options(): BasemapOption[];
}

export interface TerrainProvider extends Provider {
  kind: 'terrain';
  /** Raster-DEM source definition for MapLibre, or null if unavailable. */
  demSource(): {
    tiles: string[];
    encoding: 'terrarium' | 'mapbox';
    tileSize: number;
    maxzoom: number;
    attribution: string;
  } | null;
}

// --- OSM features & geocoding --------------------------------------------------

export type OsmFeatureCategory =
  | 'landmark'
  | 'transit_station'
  | 'district'
  | 'intersection'
  | 'major_street'
  | 'facility'
  | 'street'
  | 'place'
  | 'building'
  | 'water'
  | 'railway'
  | 'parking'
  | 'landuse'
  | 'other';

export interface OsmFeature {
  id: string;
  category: OsmFeatureCategory;
  name: string | null;
  /** All name:* tags, e.g. { 'name:de': '…' }. */
  names: Record<string, string>;
  position: LngLat;
  tags: Record<string, string>;
}

export interface OsmFeatureProvider extends Provider {
  kind: 'osm_features';
  featuresNear(position: LngLat, radiusM: number): Promise<ProviderResponse<OsmFeature[]>>;
  featuresInBBox(bbox: BBox, categories: OsmFeatureCategory[]): Promise<ProviderResponse<OsmFeature[]>>;
}

export interface GeocodeResult {
  label: string;
  position: LngLat;
  bbox: BBox | null;
  /** Address type from the geocoder, e.g. "city", "suburb", "neighbourhood". */
  kind?: string | null;
  osmType?: string | null;
  osmId?: number | null;
  /** Enclosing places, nearest first. */
  hierarchy?: string[];
  /** The result is an OSM relation and may have a boundary polygon. */
  boundaryAvailable?: boolean;
}

export interface BoundaryResult {
  label: string;
  osmType: string;
  osmId: number;
  /** Polygon or MultiPolygon; null when the source has no boundary for the place. */
  geometry: { type: string; coordinates: unknown } | null;
}

export interface GeocoderProvider extends Provider {
  kind: 'geocoder';
  /** Free-text search, executed on explicit submit only (no autocomplete, per Nominatim policy). */
  search(query: string): Promise<ProviderResponse<GeocodeResult[]>>;
}

// --- Traffic, population, elevation ---------------------------------------------

export type TrafficTemporalType = 'live' | 'historic' | 'predicted' | 'demonstration';

export interface TrafficSegment {
  coordinates: LngLat[];
  /** Ratio of current speed to free-flow speed, 0..1. */
  speedRatio: number;
  observedAt: string;
  temporalType: TrafficTemporalType;
}

export interface TrafficProvider extends Provider {
  kind: 'traffic';
  trafficInBBox(bbox: BBox): Promise<ProviderResponse<TrafficSegment[]>>;
}

export type PopulationStatus = 'observed' | 'estimated' | 'projected' | 'assumed' | 'demonstration';

export interface PopulationCell {
  /** Geohash (CAMARA-style) or other cell id. */
  cellId: string;
  polygon: LngLat[];
  /** People per km², low/central/high (CAMARA minPplDensity / pplDensity / maxPplDensity). */
  density: Range | null;
  dataType: 'no_data' | 'low_density' | 'density_estimation';
  status: PopulationStatus;
}

export interface PopulationProvider extends Provider {
  kind: 'population';
  densityInPolygon(
    polygon: LngLat[],
    options?: { precision?: number },
  ): Promise<ProviderResponse<PopulationCell[]>>;
}

export interface ElevationProvider extends Provider {
  kind: 'elevation';
  elevations(points: LngLat[]): Promise<ProviderResponse<number[]>>;
}

// --- Transit & routing --------------------------------------------------------------

export interface TransitStop {
  id: string;
  name: string;
  position: LngLat;
  modes: string[];
}

export interface TransitRoute {
  id: string;
  name: string;
  mode: string;
  coordinates: LngLat[];
  frequencyPerHour: number | null;
}

export interface TransitProvider extends Provider {
  kind: 'transit';
  stopsInBBox(bbox: BBox): Promise<ProviderResponse<TransitStop[]>>;
  routesInBBox(bbox: BBox): Promise<ProviderResponse<TransitRoute[]>>;
}

export interface RoutingProvider extends Provider {
  kind: 'routing';
  /** Route via the street network; null data means no route was found. */
  route(
    waypoints: LngLat[],
    profile: 'bus' | 'car' | 'bicycle' | 'foot',
  ): Promise<ProviderResponse<LngLat[] | null>>;
}

// --- Factors and benchmarks (Phase 4) ---------------------------------------------------

export interface AirQualityProvider extends Provider {
  kind: 'air_quality';
  observations(
    bbox: BBox,
  ): Promise<
    ProviderResponse<
      { pollutant: string; value: number; unit: string; position: LngLat; observedAt: string }[]
    >
  >;
}

export interface EmissionFactor {
  pollutant: 'co2e' | 'nox' | 'pm25' | 'pm10';
  vehicleClass: string;
  gPerVehicleKm: Range;
  year: number;
}

export interface EmissionFactorProvider extends Provider {
  kind: 'emission_factor';
  factors(region: string, year: number): Promise<ProviderResponse<EmissionFactor[]>>;
}

export interface CostBenchmark {
  item: string;
  unit: string;
  cost: Range;
  currency: string;
  priceYear: number;
}

export interface CostBenchmarkProvider extends Provider {
  kind: 'cost_benchmark';
  benchmarks(region: string): Promise<ProviderResponse<CostBenchmark[]>>;
}

export interface PropertyValueProvider extends Provider {
  kind: 'property_value';
  /** Disabled by default; requires local evidence. */
  upliftByDistanceBand(
    stationPosition: LngLat,
  ): Promise<ProviderResponse<{ bandM: [number, number]; upliftPercent: Range }[]>>;
}
