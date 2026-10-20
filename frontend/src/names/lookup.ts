/**
 * Station-name lookup with a bounded wait.
 *
 * Always settles: with suggestions, with "nothing named nearby", with an error,
 * or after NAME_LOOKUP_TIMEOUT_MS. A coordinate name is only offered as the last
 * entry and the caller is told why. Successful results are cached for the
 * session per rounded position and language, so repeated lookups at the same
 * place do not query the provider again.
 */
import type { LngLat } from '../domain/schema';
import type { OsmFeature, OsmFeatureProvider } from '../providers/types';
import { ProviderError } from '../providers/backend';
import { suggestStationNames, type NameSuggestion } from './suggest';

/** Longer than the backend's own limit (query 15 s + 5 s), so the server answers first. */
export const NAME_LOOKUP_TIMEOUT_MS = 25000;
export const NAME_LOOKUP_RADIUS_M = 500;

export type LookupStatus = 'ok' | 'empty' | 'error' | 'timeout' | 'cancelled';

export interface LookupOutcome {
  status: LookupStatus;
  suggestions: NameSuggestion[];
  message: string;
  attribution?: string;
}

const cache = new Map<string, LookupOutcome>();
export const clearNameCache = () => cache.clear();

const cacheKey = (p: LngLat, language: string | undefined) =>
  `${p[0].toFixed(4)},${p[1].toFixed(4)},${language ?? ''}`;

function isFeature(f: unknown): f is OsmFeature {
  if (typeof f !== 'object' || f === null) return false;
  const o = f as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.category === 'string' && Array.isArray(o.position);
}

export async function lookupStationNames(
  position: LngLat,
  provider: Pick<OsmFeatureProvider, 'featuresNear'>,
  options: { language?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<LookupOutcome> {
  const fallbackOnly = () =>
    suggestStationNames(position, [], { provider: 'MobSimGame', language: options.language });
  const key = cacheKey(position, options.language);
  const hit = cache.get(key);
  if (hit) return hit;
  const timeoutMs = options.timeoutMs ?? NAME_LOOKUP_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const cancelled = new Promise<'cancelled'>((resolve) => {
    if (options.signal?.aborted) resolve('cancelled');
    options.signal?.addEventListener('abort', () => resolve('cancelled'));
  });
  try {
    const res = await Promise.race([
      provider.featuresNear(position, NAME_LOOKUP_RADIUS_M),
      timeout,
      cancelled,
    ]);
    if (res === 'cancelled') return { status: 'cancelled', suggestions: [], message: '' };
    if (res === 'timeout')
      return {
        status: 'timeout',
        suggestions: fallbackOnly(),
        message: `No answer from the map-data service within ${Math.round(timeoutMs / 1000)} s. Try again later; only a coordinate name is available now.`,
      };
    if (!Array.isArray(res.data))
      throw new ProviderError('The map-data service returned invalid data', 'temporarily_unavailable');
    const features = res.data.filter(isFeature);
    const suggestions = suggestStationNames(position, features, {
      provider: res.provenance.provider,
      language: options.language,
    });
    const named = suggestions.filter((s) => !s.coordinateFallback).length;
    const outcome: LookupOutcome = named
      ? {
          status: 'ok',
          suggestions,
          message: `${named} suggestion(s) within ${NAME_LOOKUP_RADIUS_M} m.`,
          attribution: `${res.provenance.provider}. ${res.provenance.attribution}.`,
        }
      : {
          status: 'empty',
          suggestions,
          message: `No named station, place, facility or street was found within ${NAME_LOOKUP_RADIUS_M} m. Only a coordinate name is available; you can type a name instead.`,
          attribution: `${res.provenance.provider}. ${res.provenance.attribution}.`,
        };
    cache.set(key, outcome);
    return outcome;
  } catch (e) {
    return {
      status: 'error',
      suggestions: fallbackOnly(),
      message: `Name lookup failed: ${e instanceof ProviderError ? e.message : 'unexpected error'}. Only a coordinate name is available; you can type a name instead.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
