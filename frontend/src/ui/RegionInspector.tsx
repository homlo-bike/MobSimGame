/**
 * Regions: the sidebar list (draw, import, export, visibility) and the region
 * inspector (type, style, lock, sourced attributes, metadata, holes, split, merge).
 */
import { useRef, useState, type FormEvent } from 'react';
import { bbox } from '@turf/turf';
import type { Region, RegionType, Scenario, SourcedValue } from '../domain/schema';
import {
  calculatedDensity,
  createRegion,
  deleteRegion,
  mergeRegions,
  REGION_ATTRIBUTES,
  REGION_TYPE_LABELS,
  regionAreaM2,
  regionsFromGeoJSON,
  regionsToGeoJSON,
  setRegionAttribute,
  toRegionGeometry,
  updateRegion,
  VALUE_STATUS_LABELS,
  type RegionAttributeDefinition,
} from '../domain/regions';
import { parseCoordinateList } from './TableView';
import { useScenario, useStore } from '../store/projectStore';
import { getMapInstance } from '../map/mapInstance';
import { CommitField } from './CommitField';
import { MetadataEditor } from './MetadataEditor';
import { Badge, Button, Checkbox, SelectField, Section } from './primitives';

const CONFIDENCE = ['unknown', 'low', 'medium', 'high'] as const;

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function zoomToRegion(r: Region) {
  const map = getMapInstance();
  if (!map) return;
  const b = bbox(r.geometry);
  map.fitBounds(
    [
      [b[0], b[1]],
      [b[2], b[3]],
    ],
    { padding: 60, maxZoom: 16 },
  );
}

export function RegionsPanel() {
  const scenario = useScenario();
  const commit = useStore((s) => s.commitScenario);
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const announce = useStore((s) => s.announce);
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const fromCoordinates = (e: FormEvent) => {
    e.preventDefault();
    const { coords, errors: errs } = parseCoordinateList(text);
    if (!errs.length && coords.length < 3) errs.push('A region needs at least three corners');
    const g = errs.length ? null : toRegionGeometry({ type: 'Polygon', coordinates: [coords] });
    if (!errs.length && !g) errs.push('The corners do not enclose an area');
    setErrors(errs);
    if (!g) return;
    const res = createRegion(scenario, { geometry: g });
    commit(res.scenario, `Region "${res.region.name}" created from ${coords.length} corners`);
    select({ kind: 'region', id: res.region.id });
    setText('');
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const res = regionsFromGeoJSON(scenario, JSON.parse(await f.text()), f.name);
      commit(
        res.scenario,
        `${res.imported} region(s) imported${res.skipped ? `, ${res.skipped} non-polygon feature(s) skipped` : ''}`,
      );
    } catch {
      announce('The file is not valid GeoJSON.');
    }
    if (file.current) file.current.value = '';
  };
  return (
    <Section
      title={`Regions (${scenario.regions.length})`}
      id="regions"
      collapsible
      defaultOpen={scenario.regions.length > 0}
    >
      <p className="mb-1 text-xs text-slate-600">
        Neighbourhoods, districts or study areas with sourced statistics. Values describe the area, never
        individual people or households.
      </p>
      <div className="mb-2 flex flex-wrap gap-1">
        <Button
          pressed={tool === 'draw_region'}
          onClick={() => setTool(tool === 'draw_region' ? 'select' : 'draw_region')}
        >
          Draw region
        </Button>
        <Button onClick={() => file.current?.click()}>Import GeoJSON…</Button>
        <input
          ref={file}
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          className="sr-only"
          aria-label="Import regions from a GeoJSON file"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <Button
          disabled={!scenario.regions.length}
          onClick={() => download('regions.geojson', regionsToGeoJSON(scenario.regions))}
        >
          Export GeoJSON
        </Button>
      </div>
      <ul className="max-h-48 space-y-0.5 overflow-auto" aria-label="Regions">
        {scenario.regions.map((r) => (
          <li key={r.id} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={r.visible}
              aria-label={`Show ${r.name}`}
              onChange={(e) =>
                commit(
                  updateRegion(scenario, r.id, { visible: e.target.checked }),
                  e.target.checked ? 'Region shown' : 'Region hidden',
                )
              }
            />
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-sm border"
              style={{ background: r.style.fill, borderColor: r.style.outline }}
            />
            <button
              type="button"
              className={`flex-1 rounded px-1 text-start text-sm hover:bg-slate-100 ${
                selection?.kind === 'region' && selection.id === r.id ? 'bg-teal-100 font-semibold' : ''
              }`}
              aria-current={selection?.kind === 'region' && selection.id === r.id ? 'true' : undefined}
              onClick={() => select({ kind: 'region', id: r.id })}
            >
              {r.name} <span className="text-xs text-slate-600">{REGION_TYPE_LABELS[r.type]}</span>
              {r.locked && <span className="ms-1 text-xs">🔒 locked</span>}
            </button>
          </li>
        ))}
      </ul>
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer">Create a region from typed corners</summary>
        <form onSubmit={fromCoordinates} className="mt-1">
          <label htmlFor="region-corners" className="block font-medium">
            Corners, one “longitude, latitude” per row
          </label>
          <textarea
            id="region-corners"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded border border-slate-500 p-1 font-mono"
          />
          {errors.length > 0 && (
            <ul role="alert" className="text-red-800">
              {errors.map((er) => (
                <li key={er}>⛔ {er}</li>
              ))}
            </ul>
          )}
          <Button type="submit">Create region</Button>
        </form>
      </details>
    </Section>
  );
}

function AttributeRow({
  def,
  value,
  onChange,
  regionId,
}: {
  def: RegionAttributeDefinition;
  value: SourcedValue | undefined;
  onChange: (v: SourcedValue | null) => void;
  regionId: string;
}) {
  const base: SourcedValue = value ?? {
    value: '',
    unit: def.unit,
    currency: null,
    priceYear: null,
    datasetYear: null,
    source: '',
    sourceUrl: null,
    sourceDate: null,
    resolution: '',
    status: 'manual',
    confidence: 'unknown',
    note: '',
  };
  const set = (p: Partial<SourcedValue>) => onChange({ ...base, ...p });
  const id = `rg-${regionId}-${def.key}`;
  return (
    <li className="rounded border border-slate-200 p-1">
      <CommitField
        label={def.label}
        unit={[base.unit, def.money ? base.currency : null].filter(Boolean).join(' ') || undefined}
        type={def.kind === 'number' ? 'number' : 'text'}
        step="any"
        min={def.kind === 'number' ? 0 : undefined}
        value={value ? value.value : null}
        onCommit={(v) => (v === '' ? onChange(null) : set({ value: def.kind === 'number' ? Number(v) : v }))}
      />
      {value && (
        <p className="text-xs text-slate-700">
          <Badge>{VALUE_STATUS_LABELS[value.status]}</Badge>{' '}
          {value.datasetYear ? `${value.datasetYear} · ` : ''}
          {value.source || 'No source given'}
          {value.resolution ? ` · ${value.resolution}` : ''} · confidence {value.confidence}
          {def.money && !(value.currency && value.priceYear) && ' · ⚠ add currency and price year'}
        </p>
      )}
      {value && (
        <details className="text-xs">
          <summary className="cursor-pointer">Unit, year, source and status</summary>
          <div className="grid grid-cols-2 gap-x-2">
            <CommitField label="Unit" value={base.unit} onCommit={(v) => set({ unit: v })} />
            {def.money && (
              <CommitField
                label="Currency"
                value={base.currency ?? ''}
                onCommit={(v) => set({ currency: v || null })}
              />
            )}
            {def.money && (
              <CommitField
                label="Price year"
                type="number"
                min={1800}
                max={2200}
                value={base.priceYear}
                onCommit={(v) => set({ priceYear: v === '' ? null : Number(v) })}
              />
            )}
            <CommitField
              label="Dataset year"
              type="number"
              min={1800}
              max={2200}
              value={base.datasetYear}
              onCommit={(v) => set({ datasetYear: v === '' ? null : Number(v) })}
            />
            <CommitField label="Source" value={base.source} onCommit={(v) => set({ source: v })} />
            <CommitField
              label="Source URL"
              value={base.sourceUrl ?? ''}
              onCommit={(v) =>
                v && !/^https?:\/\//.test(v) ? 'Use an http(s) address' : set({ sourceUrl: v || null })
              }
            />
            <CommitField
              label="Source date"
              value={base.sourceDate ?? ''}
              onCommit={(v) => set({ sourceDate: v || null })}
            />
            <CommitField
              label="Geographic resolution"
              value={base.resolution}
              onCommit={(v) => set({ resolution: v })}
            />
          </div>
          <SelectField
            label="Status"
            value={base.status}
            onChange={(e) => set({ status: e.target.value as SourcedValue['status'] })}
            options={Object.entries(VALUE_STATUS_LABELS).map(([v, label]) => ({ value: v, label }))}
          />
          <SelectField
            label="Confidence"
            value={base.confidence}
            onChange={(e) => set({ confidence: e.target.value as SourcedValue['confidence'] })}
            options={CONFIDENCE.map((c) => ({ value: c, label: c }))}
          />
          <CommitField label="Limitation note" value={base.note} onCommit={(v) => set({ note: v })} />
          <label htmlFor={`${id}-clear`} className="sr-only">
            Clear {def.label}
          </label>
          <Button id={`${id}-clear`} variant="ghost" onClick={() => onChange(null)}>
            Clear value
          </Button>
        </details>
      )}
    </li>
  );
}

export function RegionInspector({ region, scenario }: { region: Region; scenario: Scenario }) {
  const commit = useStore((s) => s.commitScenario);
  const select = useStore((s) => s.select);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const announce = useStore((s) => s.announce);
  const [mergeWith, setMergeWith] = useState('');
  const patch = (p: Partial<Region>, label = 'Region updated') =>
    commit(updateRegion(scenario, region.id, p), label);
  const km2 = regionAreaM2(region.geometry) / 1e6;
  const density = calculatedDensity(region);
  const holes =
    region.geometry.type === 'Polygon'
      ? region.geometry.coordinates.length - 1
      : region.geometry.coordinates.reduce((n, p) => n + p.length - 1, 0);
  return (
    <div>
      <Section title="Region" id="region-inspector">
        <div className="mb-2 flex flex-wrap gap-1">
          <Button onClick={() => zoomToRegion(region)}>Zoom to region</Button>
          <Button
            variant="danger"
            disabled={region.locked}
            onClick={() => {
              commit(deleteRegion(scenario, region.id), `Region "${region.name}" deleted`);
              select(null);
            }}
          >
            Delete region
          </Button>
        </div>
        <CommitField
          label="Name"
          value={region.name}
          onCommit={(v) => (v.trim() ? patch({ name: v.trim() }) : 'Name is required')}
        />
        <SelectField
          label="Region type"
          value={region.type}
          onChange={(e) => patch({ type: e.target.value as RegionType }, 'Region type changed')}
          options={Object.entries(REGION_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <p className="mb-2 text-sm">
          Area <strong>{km2.toFixed(km2 < 10 ? 3 : 1)} km²</strong> (calculated, projected)
          {holes ? ` · ${holes} hole(s)` : ''}
          {region.geometry.type === 'MultiPolygon' && ` · ${region.geometry.coordinates.length} parts`}
        </p>
        <Checkbox
          label="Lock (prevents editing the shape, deleting, splitting and merging)"
          checked={region.locked}
          onChange={(v) => patch({ locked: v }, v ? 'Region locked' : 'Region unlocked')}
        />
        <Checkbox label="Show on the map" checked={region.visible} onChange={(v) => patch({ visible: v })} />
        <p className="text-xs text-slate-700">
          Source: {region.source.source || 'not given'}
          {region.source.sourceFeature ? ` (${region.source.sourceFeature})` : ''} ·{' '}
          {VALUE_STATUS_LABELS[region.source.status]}
        </p>
      </Section>

      <Section title="Style" id="region-style" collapsible defaultOpen={false}>
        <div className="flex flex-wrap items-end gap-2">
          {(['fill', 'outline'] as const).map((k) => (
            <div key={k}>
              <label htmlFor={`rg-${region.id}-${k}`} className="block text-xs font-medium">
                {k === 'fill' ? 'Fill colour' : 'Outline colour'}
              </label>
              <input
                id={`rg-${region.id}-${k}`}
                type="color"
                value={region.style[k]}
                onChange={(e) =>
                  patch({ style: { ...region.style, [k]: e.target.value } }, 'Region style changed')
                }
                className="h-8 w-14 rounded border border-slate-500"
              />
            </div>
          ))}
          <CommitField
            label="Fill opacity"
            unit="0–1"
            type="number"
            min={0}
            max={1}
            step="any"
            value={region.style.opacity}
            onCommit={(v) =>
              patch({ style: { ...region.style, opacity: Number(v) } }, 'Region style changed')
            }
          />
        </div>
        <Checkbox
          label="Show the name as a label"
          checked={region.style.showLabel}
          onChange={(v) => patch({ style: { ...region.style, showLabel: v } })}
        />
      </Section>

      <Section title="Statistics" id="region-attributes">
        <p className="mb-1 text-xs text-slate-600">
          Area-level values with unit, year, source, resolution and status. They can be incomplete, sensitive
          or defined differently by different sources; nothing is inferred about individuals.
        </p>
        {density !== null && (
          <p className="mb-1 text-sm">
            Population density from population and area:{' '}
            <strong>{Math.round(density).toLocaleString()} persons/km²</strong> <Badge>Calculated</Badge>
          </p>
        )}
        <ul className="space-y-1">
          {REGION_ATTRIBUTES.map((def) => (
            <AttributeRow
              key={def.key}
              def={def}
              regionId={region.id}
              value={region.attributes[def.key]}
              onChange={(v) =>
                commit(setRegionAttribute(scenario, region.id, def.key, v), `${def.label} updated`)
              }
            />
          ))}
        </ul>
      </Section>

      <Section title="Custom fields and notes" id="region-metadata">
        <MetadataEditor
          value={region.metadata}
          onChange={(metadata) => patch({ metadata }, 'Region details changed')}
          idPrefix={`region-${region.id}`}
        />
        <CommitField label="Notes" value={region.notes} onCommit={(v) => patch({ notes: v })} />
      </Section>

      <Section title="Shape" id="region-shape">
        <p className="mb-1 text-xs text-slate-600">
          Drag the corners on the map to edit. Holes and splits use the drawing tools.
        </p>
        <div className="flex flex-wrap gap-1">
          <Button
            disabled={region.locked}
            pressed={tool === 'region_hole'}
            onClick={() => setTool(tool === 'region_hole' ? 'select' : 'region_hole')}
          >
            Cut a hole…
          </Button>
          <Button
            disabled={region.locked}
            pressed={tool === 'region_split'}
            onClick={() => setTool(tool === 'region_split' ? 'select' : 'region_split')}
          >
            Split with a line…
          </Button>
          <Button onClick={() => download(`${region.name}.geojson`, regionsToGeoJSON([region]))}>
            Export GeoJSON
          </Button>
        </div>
        {scenario.regions.length > 1 && (
          <div className="mt-2 flex items-end gap-1">
            <div className="flex-1">
              <SelectField
                label="Merge with region"
                value={mergeWith}
                onChange={(e) => setMergeWith(e.target.value)}
                options={[
                  { value: '', label: 'Choose…' },
                  ...scenario.regions
                    .filter((r) => r.id !== region.id)
                    .map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
            </div>
            <Button
              className="mb-2"
              disabled={!mergeWith || region.locked}
              onClick={() => {
                const res = mergeRegions(scenario, region.id, mergeWith);
                if (res.error) announce(res.error);
                else commit(res.scenario, 'Regions merged');
                setMergeWith('');
              }}
            >
              Merge
            </Button>
          </div>
        )}
      </Section>
    </div>
  );
}
