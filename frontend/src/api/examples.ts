/**
 * Real-city example networks, loaded live from OpenStreetMap through the
 * backend (which caches them). Only the city and network name are sent.
 */
import { z } from 'zod';
import type { Project } from '../domain/schema';
import { ProvenanceSchema } from '../domain/schema';
import { networkToProject, type NetworkData } from '../domain/examples';
import { apiFetch, ProviderError } from '../providers/backend';
import { createLogger } from '../util/logger';

const log = createLogger('examples');

export interface ExampleCity {
  id: string;
  name: string;
  country: string;
  networks: { kind: 'tram' | 'metro' | 'bus'; label: string; note: string }[];
}

const LngLat = z.tuple([z.number(), z.number()]);
const NetworkSchema = z.object({
  city: z.string(),
  cityName: z.string(),
  kind: z.enum(['tram', 'metro', 'bus']),
  label: z.string(),
  center: LngLat,
  zoom: z.number(),
  lines: z.array(
    z.object({
      id: z.string(),
      ref: z.string(),
      name: z.string(),
      colour: z.string().nullable(),
      mode: z.enum(['tram', 'light_rail', 'metro', 'bus', 'brt']),
      coordinates: z.array(LngLat),
      returnCoordinates: z.array(LngLat).nullable(),
      stops: z.array(z.string()),
      status: z.string(),
      gaps: z.number(),
    }),
  ),
  stations: z.array(z.object({ key: z.string(), name: z.string(), position: LngLat })),
  notes: z.array(z.string()),
});

export async function listExampleCities(): Promise<ExampleCity[]> {
  const res = await apiFetch('/api/v1/examples', undefined, 10000);
  if (!res.ok)
    throw new ProviderError(`Examples unavailable (HTTP ${res.status})`, 'temporarily_unavailable');
  const body = (await res.json()) as { cities: ExampleCity[] };
  return body.cities;
}

/** Load one network as a new project. Large bus networks can take minutes on first load. */
export async function loadExampleProject(cityId: string, kind: string): Promise<Project> {
  const res = await apiFetch(
    `/api/v1/examples/${encodeURIComponent(cityId)}/${encodeURIComponent(kind)}`,
    undefined,
    240000,
  );
  if (!res.ok) {
    const detail = ((await res.json().catch(() => ({}))) as { detail?: string }).detail;
    throw new ProviderError(detail ?? `Loading failed (HTTP ${res.status})`, 'temporarily_unavailable');
  }
  const body = z.object({ data: NetworkSchema, provenance: ProvenanceSchema }).safeParse(await res.json());
  if (!body.success) {
    log.error('unexpected example network response', { issues: body.error.issues.length });
    throw new ProviderError('Unexpected response from the server', 'temporarily_unavailable');
  }
  log.info('example network loaded', {
    city: cityId,
    kind,
    lines: body.data.data.lines.length,
    stations: body.data.data.stations.length,
  });
  return networkToProject(body.data.data as NetworkData, body.data.provenance);
}
