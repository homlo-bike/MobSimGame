import { useEffect, useRef } from 'react';
import { useStore } from '../store/projectStore';
import { providerStatusRows } from '../providers/registry';
import { CAPABILITY_LABELS } from '../providers/types';
import { Badge, Button } from './primitives';
import { t } from '../i18n';

/** Where users can obtain the source of this deployment (override when you run a modified version). */
const SOURCE_URL =
  (import.meta.env.VITE_SOURCE_URL as string | undefined) || 'https://github.com/homlo-bike/MobSimGame';

export function DataSourcesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const project = useStore((s) => s.project);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="ds-title"
      className="m-auto max-h-[90vh] w-[min(56rem,95vw)] overflow-auto rounded border border-slate-400 p-0 backdrop:bg-black/40"
    >
      <div className="p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 id="ds-title" className="text-lg font-semibold">
            {t('dataSources')}
          </h2>
          <Button onClick={onClose} aria-label="Close data sources dialog">
            Close
          </Button>
        </div>
        <h3 className="font-semibold">Limitations</h3>
        <p className="mb-2 text-sm">{t('disclaimer')}</p>
        <ul className="mb-3 list-disc ps-5 text-sm">
          <li>
            Alignments are conceptual sketches. Validation findings are advisory; nothing here is declared
            safe, buildable or construction-ready.
          </li>
          <li>All Phase 1 analysis uses a synthetic demonstration assumption set and is labelled as such.</li>
          <li>Distances use a spherical-earth approximation (sketch accuracy).</li>
          <li>Missing OpenStreetMap tags do not mean a feature does not exist.</li>
        </ul>
        <h3 className="font-semibold">Attribution and licences</h3>
        <ul className="mb-3 list-disc ps-5 text-sm">
          <li>
            Map data ©{' '}
            <a
              className="underline"
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenStreetMap contributors
            </a>
            , available under the Open Database Licence (ODbL 1.0).
          </li>
          <li>
            Basemap tiles:{' '}
            <a className="underline" href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">
              OpenFreeMap
            </a>{' '}
            © OpenMapTiles.
          </li>
          <li>
            Terrain: AWS Terrain Tiles (Mapzen/Tilezen) with SRTM, GMTED2010, 3DEP (USGS) and ETOPO1 (NOAA)
            sources.
          </li>
          <li>Map rendering: MapLibre GL JS (BSD-3-Clause).</li>
          <li>
            Drawing and editing:{' '}
            <a
              className="underline"
              href="https://github.com/sakuzu/maplibre-gl-draw"
              target="_blank"
              rel="noopener noreferrer"
            >
              @sakuzu/maplibre-gl-draw
            </a>{' '}
            (AGPL-3.0-only). Its source is available at that link; see THIRD_PARTY_NOTICES.md.
          </li>
          <li>
            Geocoding (when the backend is configured): Nominatim / OpenStreetMap, used on explicit search
            only, cached.
          </li>
          <li>
            MobSimGame © 2026 Homlo-Bike is free software under the{' '}
            <a
              className="underline"
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              GNU Affero General Public License v3.0 only
            </a>
            , without warranty.{' '}
            <a className="underline" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
              Get the source code of this version
            </a>
            . Operators of modified versions must offer their modified source to users. Datasets keep their
            own licences.
          </li>
        </ul>
        <h3 className="font-semibold">Providers</h3>
        <table className="mb-3 w-full text-sm">
          <thead>
            <tr>
              <th scope="col" className="text-start">
                Data
              </th>
              <th scope="col" className="text-start">
                Implementation
              </th>
              <th scope="col" className="text-start">
                Status
              </th>
              <th scope="col" className="text-start">
                Phase
              </th>
            </tr>
          </thead>
          <tbody>
            {providerStatusRows(project.fictional).map((r) => (
              <tr key={r.kind} className="align-top">
                <th scope="row" className="text-start font-normal">
                  {r.label}
                </th>
                <td>{r.implementation}</td>
                <td>
                  <Badge
                    tone={r.state === 'demonstration' ? 'demo' : r.state === 'available' ? 'ok' : 'warn'}
                  >
                    {CAPABILITY_LABELS[r.state]}
                  </Badge>
                  <span className="block text-xs text-slate-600">{r.note}</span>
                </td>
                <td>{r.phase}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="font-semibold">Privacy</h3>
        <p className="mb-2 text-sm">
          Projects are stored in this browser (local storage). Nothing is sent to MobSimGame’s backend unless
          you sign in and choose File › Save to server and share. Search text goes to the configured geocoder; station-name lookups send
          the station’s coordinates (not the project) to Overpass through the backend. Basemap and terrain
          tiles are requested from their hosts. No tracking or analytics.
        </p>
        <h3 className="font-semibold">Project datasets</h3>
        <ul className="list-disc ps-5 text-sm">
          {project.datasetReferences.length === 0 && <li>No datasets recorded.</li>}
          {project.datasetReferences.map((d) => (
            <li key={d.id}>
              {d.provenance.dataset} — {d.provenance.provider}. Status: {d.provenance.status}. Licence:{' '}
              {d.provenance.license}. {d.provenance.limitations.join(' ')}
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  );
}
