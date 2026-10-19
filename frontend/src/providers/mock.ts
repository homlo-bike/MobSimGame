/**
 * Mock providers for development, tests and the fictional demo.
 * Everything they return is synthetic and labelled `demonstration`.
 */
import type { LngLat } from '../domain/schema';
import { distanceM } from '../geo/geometry';
import { demoProvenance } from './provenance';
import type {
  BBox,
  Capability,
  ElevationProvider,
  GeocoderProvider,
  OsmFeature,
  OsmFeatureCategory,
  OsmFeatureProvider,
  PopulationCell,
  PopulationProvider,
  ProviderResponse,
  TrafficProvider,
  TrafficSegment,
  TransitProvider,
} from './types';

const demoCapability = (message = 'Synthetic demonstration data'): Capability => ({
  state: 'demonstration',
  message,
  checkedAt: new Date().toISOString(),
});

function respond<T>(data: T, dataset: string): ProviderResponse<T> {
  return { data, provenance: demoProvenance(dataset), capability: demoCapability() };
}

/** Deterministic pseudo-random in [0, 1) from two numbers. */
function hash2(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Fictional features around the demo city (near 0°, 0°). */
const DEMO_FEATURES: OsmFeature[] = [
  {
    id: 'demo-1',
    category: 'landmark',
    name: 'Old Clocktower',
    names: { 'name:de': 'Alter Uhrturm' },
    position: [0.0352, 0.0203],
    tags: { tourism: 'attraction' },
  },
  {
    id: 'demo-2',
    category: 'district',
    name: 'Millbrook',
    names: {},
    position: [0.012, 0.022],
    tags: { place: 'suburb' },
  },
  {
    id: 'demo-3',
    category: 'facility',
    name: 'Riverside University',
    names: {},
    position: [0.046, 0.021],
    tags: { amenity: 'university' },
  },
  {
    id: 'demo-4',
    category: 'major_street',
    name: 'Harbour Road',
    names: {},
    position: [0.058, 0.0215],
    tags: { highway: 'primary' },
  },
  {
    id: 'demo-5',
    category: 'facility',
    name: 'North Park',
    names: {},
    position: [0.0355, 0.0445],
    tags: { leisure: 'park' },
  },
  {
    id: 'demo-6',
    category: 'street',
    name: 'Linden Street',
    names: {},
    position: [0.0232, 0.0195],
    tags: { highway: 'residential' },
  },
  {
    id: 'demo-7',
    category: 'transit_station',
    name: 'Eastfield',
    names: {},
    position: [0.0695, 0.0238],
    tags: { railway: 'station' },
  },
];

export class MockOsmFeatureProvider implements OsmFeatureProvider {
  readonly id = 'mock-osm';
  readonly kind = 'osm_features' as const;
  readonly label = 'Demonstration features (synthetic)';
  readonly sendsProjectDataToThirdParty = false;
  async capability() {
    return demoCapability('Synthetic features exist only around the fictional demo city.');
  }
  async featuresNear(position: LngLat, radiusM: number) {
    return respond(
      DEMO_FEATURES.filter((f) => distanceM(f.position, position) <= radiusM),
      'Fictional demo city features',
    );
  }
  async featuresInBBox(bbox: BBox, categories: OsmFeatureCategory[]) {
    const [w, s, e, n] = bbox;
    return respond(
      DEMO_FEATURES.filter(
        (f) =>
          categories.includes(f.category) &&
          f.position[0] >= w &&
          f.position[0] <= e &&
          f.position[1] >= s &&
          f.position[1] <= n,
      ),
      'Fictional demo city features',
    );
  }
}

export class MockGeocoderProvider implements GeocoderProvider {
  readonly id = 'mock-geocoder';
  readonly kind = 'geocoder' as const;
  readonly label = 'Offline geocoder (coordinates and demo places)';
  readonly sendsProjectDataToThirdParty = false;
  async capability() {
    return demoCapability(
      'Accepts "latitude, longitude" or demo place names. Configure the backend for real search.',
    );
  }
  async search(query: string) {
    const q = query.trim();
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) {
      // Human-entered coordinates are conventionally "lat, lon"; converted to [lng, lat].
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return respond(
          [{ label: `${lat}, ${lng} (entered coordinates)`, position: [lng, lat] as LngLat, bbox: null }],
          'Entered coordinates',
        );
      }
    }
    const lower = q.toLowerCase();
    const hits = DEMO_FEATURES.filter((f) => f.name?.toLowerCase().includes(lower)).map((f) => ({
      label: `${f.name} (fictional demo city)`,
      position: f.position,
      bbox: null,
    }));
    if (lower.includes('demo'))
      hits.unshift({ label: 'Fictional demo city', position: [0.035, 0.02], bbox: null });
    return respond(hits, 'Fictional demo city gazetteer');
  }
}

/** Synthetic population density: smooth peak around the demo centre plus noise. */
export class MockPopulationProvider implements PopulationProvider {
  readonly id = 'mock-population';
  readonly kind = 'population' as const;
  readonly label = 'Synthetic population density';
  readonly sendsProjectDataToThirdParty = false;
  constructor(private centre: LngLat = [0.035, 0.02]) {}
  async capability() {
    return demoCapability();
  }
  densityAt(p: LngLat): number {
    const d = distanceM(p, this.centre);
    return Math.round(9000 * Math.exp(-d / 2500) + 600 * hash2(p[0] * 1000, p[1] * 1000));
  }
  async densityInPolygon(polygon: LngLat[], options?: { precision?: number }) {
    const xs = polygon.map((p) => p[0]);
    const ys = polygon.map((p) => p[1]);
    const step = options?.precision && options.precision >= 7 ? 0.002 : 0.004;
    const cells: PopulationCell[] = [];
    for (let x = Math.min(...xs); x < Math.max(...xs); x += step) {
      for (let y = Math.min(...ys); y < Math.max(...ys); y += step) {
        const c: LngLat = [x + step / 2, y + step / 2];
        const v = this.densityAt(c);
        cells.push({
          cellId: `demo-${x.toFixed(4)}-${y.toFixed(4)}`,
          polygon: [
            [x, y],
            [x + step, y],
            [x + step, y + step],
            [x, y + step],
            [x, y],
          ],
          density: { low: Math.round(v * 0.7), central: v, high: Math.round(v * 1.3) },
          dataType: v < 300 ? 'low_density' : 'density_estimation',
          status: 'demonstration',
        });
      }
    }
    return respond(cells, 'Synthetic population density grid');
  }
}

export class MockTrafficProvider implements TrafficProvider {
  readonly id = 'mock-traffic';
  readonly kind = 'traffic' as const;
  readonly label = 'Demonstration traffic (synthetic)';
  readonly sendsProjectDataToThirdParty = false;
  async capability() {
    return demoCapability('Synthetic congestion pattern; not live, historic or predicted traffic.');
  }
  async trafficInBBox(bbox: BBox) {
    const [w, s, e, n] = bbox;
    const segments: TrafficSegment[] = [];
    const rows = 6;
    for (let i = 0; i <= rows; i++) {
      const y = s + ((n - s) * i) / rows;
      const x = w + ((e - w) * i) / rows;
      const at = new Date().toISOString();
      segments.push({
        coordinates: [
          [w, y],
          [e, y],
        ],
        speedRatio: 0.3 + 0.6 * hash2(i, 1),
        observedAt: at,
        temporalType: 'demonstration',
      });
      segments.push({
        coordinates: [
          [x, s],
          [x, n],
        ],
        speedRatio: 0.3 + 0.6 * hash2(i, 2),
        observedAt: at,
        temporalType: 'demonstration',
      });
    }
    return respond(segments, 'Synthetic traffic grid');
  }
}

/** Synthetic terrain: gentle hill north-east of the demo centre. */
export class MockElevationProvider implements ElevationProvider {
  readonly id = 'mock-elevation';
  readonly kind = 'elevation' as const;
  readonly label = 'Synthetic elevation';
  readonly sendsProjectDataToThirdParty = false;
  async capability() {
    return demoCapability();
  }
  elevationAt(p: LngLat): number {
    const d = distanceM(p, [0.05, 0.03]);
    return 20 + 45 * Math.exp(-((d / 1800) ** 2));
  }
  async elevations(points: LngLat[]) {
    return respond(
      points.map((p) => this.elevationAt(p)),
      'Synthetic elevation surface',
    );
  }
}

export class MockTransitProvider implements TransitProvider {
  readonly id = 'mock-transit';
  readonly kind = 'transit' as const;
  readonly label = 'Existing transit (synthetic)';
  readonly sendsProjectDataToThirdParty = false;
  async capability() {
    return demoCapability('Synthetic "existing" bus routes around the demo city.');
  }
  async stopsInBBox() {
    return respond(
      [
        { id: 'ex-1', name: 'Existing stop A', position: [0.02, 0.03] as LngLat, modes: ['bus'] },
        { id: 'ex-2', name: 'Existing stop B', position: [0.05, 0.01] as LngLat, modes: ['bus'] },
      ],
      'Synthetic existing transit',
    );
  }
  async routesInBBox() {
    return respond(
      [
        {
          id: 'ex-r1',
          name: 'Existing bus 7 (synthetic)',
          mode: 'bus',
          coordinates: [
            [0.005, 0.03],
            [0.02, 0.03],
            [0.05, 0.01],
            [0.065, 0.005],
          ] as LngLat[],
          frequencyPerHour: 4,
        },
      ],
      'Synthetic existing transit',
    );
  }
}
