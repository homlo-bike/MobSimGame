/**
 * Geographic regions (neighbourhoods, districts, study areas): pure operations.
 *
 * Area is always computed in the project metric frame (never entered). Attributes
 * are area-level statistics with their unit, year, source, resolution and status;
 * nothing here derives individual-level attributes from them. Splitting a region
 * does not divide its statistics (that would need data the project does not
 * have): numeric values are left out of the parts and the parts say so.
 */
import type { FeatureCollection } from 'geojson';
import { difference, makeValid, split, union } from '@sakuzu/maplibre-gl-draw/geometry';
import type { LngLat, Region, RegionGeometry, RegionType, Scenario, SourcedValue } from './schema';
import { RegionGeometrySchema } from './schema';
import { createFrame } from '../geo/track/projection';
import { newId, nowIso } from '../util/id';

const touch = (s: Scenario): Scenario => ({ ...s, updatedAt: nowIso() });

export const REGION_TYPE_LABELS: Record<RegionType, string> = {
  neighbourhood: 'Neighbourhood',
  district: 'District',
  municipality: 'Municipality',
  commercial: 'Commercial area',
  industrial: 'Industrial area',
  residential: 'Residential area',
  university_campus: 'University campus',
  hospital_district: 'Hospital district',
  development_area: 'Development area',
  tod_area: 'Transit-oriented development area',
  user_defined: 'User-defined area',
};

export interface RegionAttributeDefinition {
  key: string;
  label: string;
  kind: 'number' | 'text';
  /** Default unit shown with the value (the user may change it). */
  unit: string;
  /** Money values need a currency and a price year. */
  money?: boolean;
  /** Values that may be sensitive or methodologically inconsistent between sources. */
  sensitive?: boolean;
}

/** The structured attributes from the brief; arbitrary extra fields go into metadata. */
export const REGION_ATTRIBUTES: RegionAttributeDefinition[] = [
  { key: 'totalPopulation', label: 'Total population', kind: 'number', unit: 'persons', sensitive: true },
  {
    key: 'populationDensity',
    label: 'Population density',
    kind: 'number',
    unit: 'persons/km²',
    sensitive: true,
  },
  { key: 'housingType', label: 'Housing type', kind: 'text', unit: '' },
  { key: 'housingDensity', label: 'Housing density', kind: 'number', unit: 'dwellings/km²' },
  {
    key: 'medianHouseholdIncome',
    label: 'Median household income',
    kind: 'number',
    unit: 'per year',
    money: true,
    sensitive: true,
  },
  { key: 'employmentCount', label: 'Employment count', kind: 'number', unit: 'jobs' },
  { key: 'employmentDensity', label: 'Employment density', kind: 'number', unit: 'jobs/km²' },
  {
    key: 'carOwnershipRate',
    label: 'Car-ownership rate',
    kind: 'number',
    unit: 'cars per household',
    sensitive: true,
  },
  { key: 'modalSplit', label: 'Existing modal split', kind: 'text', unit: '' },
  { key: 'averageHouseholdSize', label: 'Average household size', kind: 'number', unit: 'persons' },
  {
    key: 'averageRent',
    label: 'Average rent',
    kind: 'number',
    unit: 'per month',
    money: true,
    sensitive: true,
  },
  {
    key: 'averagePropertyValue',
    label: 'Average property value',
    kind: 'number',
    unit: '',
    money: true,
    sensitive: true,
  },
  { key: 'landUseMix', label: 'Land-use mix', kind: 'text', unit: '' },
  { key: 'schoolEnrollment', label: 'School enrolment', kind: 'number', unit: 'students' },
  { key: 'majorDestinations', label: 'Major destinations', kind: 'text', unit: '' },
];

export const VALUE_STATUS_LABELS: Record<SourcedValue['status'], string> = {
  observed: 'Observed',
  imported: 'Imported',
  assumed: 'Assumed',
  estimated: 'Estimated',
  synthetic: 'Synthetic',
  manual: 'Entered by hand',
};

const ringArea = (ring: readonly [number, number][]) => {
  let a = 0;
  for (let i = 0; i + 1 < ring.length; i++)
    a += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  return a / 2;
};

/** Area in square metres, in a transverse Mercator frame centred on the region (holes subtracted). */
export function regionAreaM2(geometry: RegionGeometry): number {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const first = polygons[0]?.[0]?.[0];
  if (!first) return 0;
  const frame = createFrame(first);
  let total = 0;
  for (const rings of polygons)
    rings.forEach((ring, i) => {
      const a = Math.abs(ringArea(ring.map((p) => frame.toMetres(p))));
      total += i === 0 ? a : -a;
    });
  return Math.max(0, total);
}

/** Population density calculated from the entered population and the computed area (persons/km²). */
export function calculatedDensity(region: Region): number | null {
  const pop = region.attributes.totalPopulation?.value;
  const km2 = regionAreaM2(region.geometry) / 1e6;
  return typeof pop === 'number' && km2 > 0 ? pop / km2 : null;
}

function closeRing(ring: LngLat[]): LngLat[] {
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (!a || !b) return ring;
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
}

/** Normalise any polygon input into a valid region geometry, or null when it has no area. */
export function toRegionGeometry(g: { type: string; coordinates: unknown }): RegionGeometry | null {
  if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') return null;
  const closed =
    g.type === 'Polygon'
      ? { type: 'Polygon' as const, coordinates: (g.coordinates as LngLat[][]).map(closeRing) }
      : {
          type: 'MultiPolygon' as const,
          coordinates: (g.coordinates as LngLat[][][]).map((p) => p.map(closeRing)),
        };
  let valid: unknown = closed;
  try {
    valid = makeValid(closed as never) ?? null;
  } catch {
    valid = null;
  }
  const parsed = RegionGeometrySchema.safeParse(valid);
  return parsed.success && regionAreaM2(parsed.data) > 0 ? parsed.data : null;
}

export interface CreateRegionInput {
  name?: string;
  type?: RegionType;
  geometry: RegionGeometry;
  source?: Partial<Region['source']>;
}

export function createRegion(
  scenario: Scenario,
  input: CreateRegionInput,
): { scenario: Scenario; region: Region } {
  const n = scenario.regions.length + 1;
  const region: Region = {
    id: newId('rg'),
    name: input.name?.trim() || `Region ${n}`,
    type: input.type ?? 'user_defined',
    geometry: input.geometry,
    style: { fill: '#7c3aed', outline: '#5b21b6', opacity: 0.15, showLabel: true },
    visible: true,
    locked: false,
    attributes: {},
    metadata: {},
    source: {
      source: 'Drawn by the user',
      sourceUrl: null,
      sourceDate: null,
      sourceFeature: null,
      status: 'manual',
      confidence: 'unknown',
      ...input.source,
    },
    notes: '',
  };
  return { scenario: touch({ ...scenario, regions: [...scenario.regions, region] }), region };
}

export function updateRegion(scenario: Scenario, id: string, patch: Partial<Region>): Scenario {
  return touch({
    ...scenario,
    regions: scenario.regions.map((r) => (r.id === id ? { ...r, ...patch, id: r.id } : r)),
  });
}

/** Replace the geometry; refused for locked regions. */
export function setRegionGeometry(scenario: Scenario, id: string, geometry: RegionGeometry): Scenario {
  const r = scenario.regions.find((x) => x.id === id);
  if (!r || r.locked) return scenario;
  const g = toRegionGeometry(geometry);
  return g ? updateRegion(scenario, id, { geometry: g }) : scenario;
}

/** Set (or clear with null) one structured attribute. */
export function setRegionAttribute(
  scenario: Scenario,
  id: string,
  key: string,
  value: SourcedValue | null,
): Scenario {
  const r = scenario.regions.find((x) => x.id === id);
  if (!r) return scenario;
  const attributes = { ...r.attributes };
  if (value === null) delete attributes[key];
  else attributes[key] = value;
  return updateRegion(scenario, id, { attributes });
}

export function deleteRegion(scenario: Scenario, id: string): Scenario {
  return touch({ ...scenario, regions: scenario.regions.filter((r) => r.id !== id) });
}

export interface RegionEditResult {
  scenario: Scenario;
  error: string | null;
}

/** Cut a hole (the polygon drawn inside the region) out of it. */
export function addHole(scenario: Scenario, id: string, hole: RegionGeometry): RegionEditResult {
  const r = scenario.regions.find((x) => x.id === id);
  if (!r) return { scenario, error: 'Region not found' };
  if (r.locked) return { scenario, error: 'The region is locked. Unlock it to edit.' };
  const out = difference(r.geometry as never, [hole as never]);
  const g = out ? toRegionGeometry(out) : null;
  if (!g) return { scenario, error: 'Nothing would remain of the region.' };
  return { scenario: updateRegion(scenario, id, { geometry: g }), error: null };
}

/** Merge region `b` into `a`. Statistics are not added up: `a`'s values are kept and a note asks the user to check them. */
export function mergeRegions(scenario: Scenario, aId: string, bId: string): RegionEditResult {
  const a = scenario.regions.find((x) => x.id === aId);
  const b = scenario.regions.find((x) => x.id === bId);
  if (!a || !b || a.id === b.id) return { scenario, error: 'Choose two different regions' };
  if (a.locked || b.locked) return { scenario, error: 'A locked region cannot be merged. Unlock it first.' };
  const out = union([a.geometry as never, b.geometry as never]);
  const g = out ? toRegionGeometry(out) : null;
  if (!g) return { scenario, error: 'The regions could not be merged.' };
  const note = `Merged with "${b.name}". Area-level values were not combined; check them for the merged area.`;
  const merged = updateRegion(scenario, a.id, {
    geometry: g,
    notes: [a.notes, note].filter(Boolean).join('\n'),
  });
  return { scenario: deleteRegion(merged, b.id), error: null };
}

/** Split a region along a line drawn across it into separate regions. */
export function splitRegion(scenario: Scenario, id: string, cut: LngLat[]): RegionEditResult {
  const r = scenario.regions.find((x) => x.id === id);
  if (!r) return { scenario, error: 'Region not found' };
  if (r.locked) return { scenario, error: 'The region is locked. Unlock it to edit.' };
  let parts: { type: string; coordinates: unknown }[] = [];
  try {
    const res = split(r.geometry as never, { type: 'LineString', coordinates: cut } as never) as unknown;
    parts = Array.isArray(res) ? (res as { type: string; coordinates: unknown }[]) : [];
  } catch {
    parts = [];
  }
  const geoms = parts.map(toRegionGeometry).filter((g): g is RegionGeometry => !!g);
  if (geoms.length < 2) return { scenario, error: 'Draw the line all the way across the region.' };
  // Text attributes describe the whole area and are kept; numbers cannot be divided without data.
  const kept = Object.fromEntries(
    Object.entries(r.attributes).filter(([, v]) => typeof v.value === 'string'),
  );
  const note = `Split from "${r.name}". Numeric area-level values were not divided; enter them for this part.`;
  let sc = deleteRegion(scenario, r.id);
  geoms.forEach((g, i) => {
    const res = createRegion(sc, {
      name: `${r.name} ${String.fromCharCode(65 + i)}`,
      type: r.type,
      geometry: g,
      source: r.source,
    });
    sc = updateRegion(res.scenario, res.region.id, {
      style: r.style,
      attributes: kept,
      metadata: r.metadata,
      notes: [r.notes, note].filter(Boolean).join('\n'),
    });
  });
  return { scenario: sc, error: null };
}

/** GeoJSON export: one feature per region with its name, type, attributes and metadata. */
export function regionsToGeoJSON(regions: readonly Region[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: regions.map((r) => ({
      type: 'Feature',
      id: r.id,
      geometry: r.geometry,
      properties: {
        name: r.name,
        regionType: r.type,
        areaKm2: Math.round((regionAreaM2(r.geometry) / 1e6) * 1000) / 1000,
        attributes: r.attributes,
        metadata: r.metadata,
        source: r.source,
        notes: r.notes,
      },
    })),
  };
}

/** Import polygons from GeoJSON as regions; other properties become metadata text. */
export function regionsFromGeoJSON(
  scenario: Scenario,
  data: unknown,
  fileName = 'GeoJSON file',
): { scenario: Scenario; imported: number; skipped: number } {
  const fc = data as {
    type?: string;
    features?: { geometry?: { type: string; coordinates: unknown }; properties?: Record<string, unknown> }[];
  };
  const features = fc?.type === 'FeatureCollection' && Array.isArray(fc.features) ? fc.features : [];
  let sc = scenario;
  let imported = 0;
  let skipped = 0;
  for (const f of features) {
    const g = f.geometry ? toRegionGeometry(f.geometry) : null;
    if (!g) {
      skipped++;
      continue;
    }
    const props = f.properties ?? {};
    const name = typeof props.name === 'string' ? props.name : undefined;
    const type =
      typeof props.regionType === 'string' && props.regionType in REGION_TYPE_LABELS
        ? (props.regionType as RegionType)
        : undefined;
    const res = createRegion(sc, {
      name,
      type,
      geometry: g,
      source: { source: `Imported from ${fileName}`, status: 'imported', sourceDate: nowIso().slice(0, 10) },
    });
    const metadata: Record<string, string> = {};
    for (const [k, v] of Object.entries(props)) {
      if (['name', 'regionType', 'attributes', 'metadata', 'source', 'areaKm2', 'notes'].includes(k))
        continue;
      if (v !== null && v !== undefined) metadata[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    // A file exported by MobSimGame round-trips its structured attributes.
    const attrs =
      props.attributes && typeof props.attributes === 'object'
        ? (props.attributes as Record<string, SourcedValue>)
        : {};
    sc = updateRegion(res.scenario, res.region.id, {
      metadata: { ...(props.metadata as Record<string, string> | undefined), ...metadata },
      attributes: attrs,
      notes: typeof props.notes === 'string' ? props.notes : '',
    });
    imported++;
  }
  return { scenario: sc, imported, skipped };
}
