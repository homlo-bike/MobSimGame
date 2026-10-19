/**
 * Thin browser clients for providers proxied by the MobSimGame backend.
 * The backend holds credentials, enforces limits and caches; the browser only
 * sends the minimum query (a point or bounding box), never the whole project.
 */
import { z } from 'zod';
import type { LngLat } from '../domain/schema';
import { createLogger } from '../util/logger';
import { ProvenanceSchema } from '../domain/schema';
import type {
  BBox,
  Capability,
  CapabilityState,
  GeocoderProvider,
  OsmFeature,
  OsmFeatureCategory,
  OsmFeatureProvider,
  ProviderResponse,
} from './types';

const log = createLogger('api');

export const API_BASE: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

const CapabilitySchema = z.object({
  state: z.string(),
  message: z.string(),
  checkedAt: z.string(),
});

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly state: CapabilityState,
  ) {
    super(message);
  }
}

export async function apiFetch(path: string, init?: RequestInit, timeoutMs = 20000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // Query strings can hold search text or coordinates: log the path only.
  const route = path.split('?')[0];
  const method = init?.method ?? 'GET';
  const started = performance.now();
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, signal: ctrl.signal });
    const ctx = { method, route, status: res.status, ms: Math.round(performance.now() - started) };
    log.debug('api response', ctx);
    if (res.status === 429) {
      log.warn('api rate limit reached', ctx);
      throw new ProviderError('Rate limit reached, try again shortly', 'rate_limited');
    }
    if (res.status === 401 || res.status === 403) {
      log.warn('api refused the request', ctx);
      throw new ProviderError('Authentication required', 'authentication_required');
    }
    if (res.status === 503 || res.status === 502 || res.status === 504) {
      log.warn('provider temporarily unavailable', ctx);
      throw new ProviderError('Provider temporarily unavailable', 'temporarily_unavailable');
    }
    if (res.status >= 500) log.error('api server error', ctx);
    return res;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    log.warn('backend not reachable', {
      method,
      route,
      reason: (e as Error)?.name === 'AbortError' ? 'timeout' : 'network',
    });
    throw new ProviderError(
      'Backend not reachable (the app keeps working offline)',
      'temporarily_unavailable',
    );
  } finally {
    clearTimeout(timer);
  }
}

const ResponseSchema = <T extends z.ZodType>(data: T) =>
  z.object({ data, provenance: ProvenanceSchema, capability: CapabilitySchema });

const OsmFeatureSchema = z.object({
  id: z.string(),
  category: z.string(),
  name: z.string().nullable(),
  names: z.record(z.string(), z.string()),
  position: z.tuple([z.number(), z.number()]),
  tags: z.record(z.string(), z.string()),
});

async function parse<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
  if (!res.ok) throw new ProviderError(`Provider error (HTTP ${res.status})`, 'temporarily_unavailable');
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    log.error('unexpected provider response shape', {
      issues: parsed.error.issues.length,
      url: res.url.split('?')[0],
    });
    throw new ProviderError('Unexpected provider response', 'temporarily_unavailable');
  }
  return parsed.data;
}

export class BackendOsmFeatureProvider implements OsmFeatureProvider {
  readonly id = 'backend-overpass';
  readonly kind = 'osm_features' as const;
  readonly label = 'OpenStreetMap (Overpass via backend)';
  readonly sendsProjectDataToThirdParty = true; // the query point/bbox is sent to the Overpass endpoint
  async capability(): Promise<Capability> {
    try {
      const res = await apiFetch('/api/v1/providers', undefined, 5000);
      const body = (await res.json()) as { providers: { id: string; capability: Capability }[] };
      return (
        body.providers.find((p) => p.id === 'overpass')?.capability ?? {
          state: 'not_configured',
          message: 'Overpass provider not configured on the backend',
          checkedAt: new Date().toISOString(),
        }
      );
    } catch (e) {
      return {
        state: e instanceof ProviderError ? e.state : 'temporarily_unavailable',
        message: String((e as Error).message),
        checkedAt: new Date().toISOString(),
      };
    }
  }
  async featuresNear(position: LngLat, radiusM: number): Promise<ProviderResponse<OsmFeature[]>> {
    const q = new URLSearchParams({
      lon: String(position[0]),
      lat: String(position[1]),
      radius_m: String(Math.round(radiusM)),
    });
    const res = await apiFetch(`/api/v1/osm/features-near?${q}`);
    return (await parse(res, ResponseSchema(z.array(OsmFeatureSchema)))) as ProviderResponse<OsmFeature[]>;
  }
  async featuresInBBox(
    bbox: BBox,
    categories: OsmFeatureCategory[],
  ): Promise<ProviderResponse<OsmFeature[]>> {
    const q = new URLSearchParams({ bbox: bbox.join(','), categories: categories.join(',') });
    const res = await apiFetch(`/api/v1/osm/features?${q}`);
    return (await parse(res, ResponseSchema(z.array(OsmFeatureSchema)))) as ProviderResponse<OsmFeature[]>;
  }
}

export class BackendGeocoderProvider implements GeocoderProvider {
  readonly id = 'backend-nominatim';
  readonly kind = 'geocoder' as const;
  readonly label = 'Nominatim (via backend, cached)';
  readonly sendsProjectDataToThirdParty = true; // the search text is sent to the geocoder
  async capability(): Promise<Capability> {
    return {
      state: 'available',
      message: 'Search on submit; results are cached by the backend',
      checkedAt: new Date().toISOString(),
    };
  }
  async search(query: string) {
    const res = await apiFetch(`/api/v1/geocode?${new URLSearchParams({ q: query })}`);
    const schema = ResponseSchema(
      z.array(
        z.object({
          label: z.string(),
          position: z.tuple([z.number(), z.number()]),
          bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
        }),
      ),
    );
    return (await parse(res, schema)) as ProviderResponse<
      { label: string; position: LngLat; bbox: BBox | null }[]
    >;
  }
}

const RoutedLegSchema = z.object({
  status: z.enum(['routed', 'failed']),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
  lengthM: z.number().nullable(),
  durationS: z.number().nullable(),
  message: z.string(),
});
export type RoutedLeg = z.infer<typeof RoutedLegSchema>;

/**
 * Route each leg between consecutive waypoints on the street network (self-hosted
 * Valhalla behind the backend). Waypoints never go to a third party.
 */
export async function routeLegs(
  waypoints: readonly LngLat[],
  mode: 'bus' | 'brt',
): Promise<ProviderResponse<RoutedLeg[]>> {
  const res = await apiFetch(
    '/api/v1/routing/route',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waypoints, mode }),
    },
    60000,
  );
  if (res.status === 422) throw new ProviderError('Too many or invalid waypoints', 'manual_input_required');
  return (await parse(res, ResponseSchema(z.array(RoutedLegSchema)))) as ProviderResponse<RoutedLeg[]>;
}

/** Capability of one backend provider by id (e.g. "valhalla"); never throws. */
export async function backendCapability(id: string): Promise<Capability> {
  try {
    const res = await apiFetch('/api/v1/providers', undefined, 5000);
    const body = (await res.json()) as { providers: { id: string; capability: Capability }[] };
    return (
      body.providers.find((p) => p.id === id)?.capability ?? {
        state: 'not_configured',
        message: 'Not available on this server',
        checkedAt: new Date().toISOString(),
      }
    );
  } catch (e) {
    return {
      state: e instanceof ProviderError ? e.state : 'temporarily_unavailable',
      message: e instanceof ProviderError ? e.message : 'Backend not reachable',
      checkedAt: new Date().toISOString(),
    };
  }
}
