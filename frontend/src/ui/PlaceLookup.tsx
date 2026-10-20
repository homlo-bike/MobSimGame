/**
 * Find a city, district or neighbourhood and turn its boundary into a region.
 * A boundary comes only from the source; without one the map is centred on the
 * place and the user can draw the region by hand.
 */
import { useState, type FormEvent } from 'react';
import { backendProviders } from '../providers/registry';
import { ProviderError } from '../providers/backend';
import type { GeocodeResult } from '../providers/types';
import { regionFromPlace } from '../domain/regionLookup';
import { useScenario, useStore } from '../store/projectStore';
import { getMapInstance } from '../map/mapInstance';
import { createLogger } from '../util/logger';
import { Button } from './primitives';

const log = createLogger('place-lookup');

function zoomTo(r: GeocodeResult) {
  const map = getMapInstance();
  if (!map) return;
  if (r.bbox)
    map.fitBounds(
      [
        [r.bbox[0], r.bbox[1]],
        [r.bbox[2], r.bbox[3]],
      ],
      { maxZoom: 15, padding: 24 },
    );
  else map.flyTo({ center: r.position, zoom: 13 });
}

function errorMessage(e: unknown): string {
  return e instanceof ProviderError ? e.message : 'The lookup is unavailable';
}

export function PlaceLookup() {
  const scenario = useScenario();
  const commit = useStore((s) => s.commitScenario);
  const select = useStore((s) => s.select);
  const setTool = useStore((s) => s.setTool);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [status, setStatus] = useState('');
  const [offerDraw, setOfferDraw] = useState(false);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return setStatus('Enter at least two characters.');
    setBusy(true);
    setOfferDraw(false);
    try {
      const res = await backendProviders.geocoder.search(q.trim(), true);
      setResults(res.data);
      setStatus(
        res.data.length
          ? `${res.data.length} place(s) found. Source: ${res.provenance.attribution}`
          : 'No place found. Try another spelling, or draw the region by hand.',
      );
    } catch (err) {
      log.warn('place lookup failed', { state: err instanceof ProviderError ? err.state : 'unknown' });
      setResults([]);
      setStatus(`${errorMessage(err)}. You can still draw the region by hand.`);
      setOfferDraw(true);
    } finally {
      setBusy(false);
    }
  };

  const createFromBoundary = async (r: GeocodeResult) => {
    zoomTo(r);
    if (!r.boundaryAvailable || !r.osmType || !r.osmId) {
      setStatus(
        `No boundary is available for ${r.label}. The map is centred there; draw the region by hand.`,
      );
      setOfferDraw(true);
      return;
    }
    setBusy(true);
    try {
      const res = await backendProviders.geocoder.boundary(r.osmType, r.osmId);
      const out = regionFromPlace(
        scenario,
        r,
        res.data,
        res.provenance.retrievedAt ?? new Date().toISOString(),
      );
      if (out.outcome === 'no_boundary') {
        setStatus(
          `${res.capability.message || 'No boundary is available.'} The map is centred on the place.`,
        );
        setOfferDraw(true);
      } else if (out.outcome === 'exists') {
        select({ kind: 'region', id: out.region.id });
        setStatus(`"${out.region.name}" already exists from this place; it was not changed.`);
      } else {
        commit(out.scenario, `Region "${out.region.name}" created from the OpenStreetMap boundary`);
        select({ kind: 'region', id: out.region.id });
        setStatus(`Region "${out.region.name}" created. Statistics are empty until you enter them.`);
      }
    } catch (err) {
      log.warn('boundary lookup failed', { state: err instanceof ProviderError ? err.state : 'unknown' });
      setStatus(`${errorMessage(err)}. The map is centred on the place; draw the region by hand.`);
      setOfferDraw(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-2 rounded border border-slate-200 p-2">
      <form role="search" aria-label="Find a city or neighbourhood" onSubmit={search} className="flex gap-1">
        <label htmlFor="place-lookup" className="sr-only">
          City, district or neighbourhood
        </label>
        <input
          id="place-lookup"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="City, district or neighbourhood"
          className="min-w-0 flex-1 rounded border border-slate-500 px-1 py-0.5 text-sm"
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Searching…' : 'Find'}
        </Button>
      </form>
      <p className="mt-1 text-xs text-slate-600" role="status">
        {status || 'The search text is sent to Nominatim (OpenStreetMap) via the server.'}
      </p>
      {results.length > 0 && (
        <ul className="mt-1 space-y-1" aria-label="Places found">
          {results.map((r) => (
            <li key={`${r.osmType}-${r.osmId}-${r.label}`} className="text-xs">
              <span className="font-medium">{r.label.split(',')[0]}</span>
              {r.kind && <span className="text-slate-600"> ({r.kind.replace(/_/g, ' ')})</span>}
              {r.hierarchy && r.hierarchy.length > 0 && (
                <span className="block text-slate-600">In {r.hierarchy.join(' › ')}</span>
              )}
              <span className="mt-0.5 flex flex-wrap gap-1">
                <Button onClick={() => zoomTo(r)}>Go to</Button>
                <Button disabled={busy} onClick={() => void createFromBoundary(r)}>
                  {r.boundaryAvailable ? 'Create region from boundary' : 'No boundary: draw by hand'}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {offerDraw && (
        <Button className="mt-1" onClick={() => setTool('draw_region')}>
          Draw the region by hand
        </Button>
      )}
    </div>
  );
}
