/**
 * Keeps @sakuzu/maplibre-gl-draw features in step with the project's lines.
 *
 * Direction of truth: the project store. `reconcileDraw` writes the lines into
 * the drawing inside a transaction tagged with source 'remote'; event handlers
 * ignore 'remote' events so programmatic updates never loop back. User edits
 * made with the draw tools arrive as non-remote events and are committed to the
 * store as domain operations (which also gives them undo/redo).
 */
import type { Draw, Feature } from '@sakuzu/maplibre-gl-draw';
import type { LineString } from 'geojson';
import type { LngLat, Scenario } from '../domain/schema';
import { isRing } from '../domain/network';
import { pathCoordinates } from '../geo/geometry';

export const REMOTE = 'remote';

const sameCoords = (a: number[][], b: number[][]) =>
  a.length === b.length &&
  a.every((p, i) => Math.abs(p[0]! - b[i]![0]!) < 1e-10 && Math.abs(p[1]! - b[i]![1]!) < 1e-10);

export function lineStyle(color: string, selected: boolean) {
  // The draw layer is the editing handle; the structure-styled MapLibre layers draw the line itself.
  return { strokeColor: color, strokeWidth: selected ? 14 : 10, strokeOpacity: selected ? 0.35 : 0.18 };
}

export function reconcileDraw(draw: Draw, scenario: Scenario, selectedLineId: string | null) {
  draw.transact(
    () => {
      const wanted = new Map(scenario.lines.map((l) => [l.id, l]));
      for (const f of draw.features.list()) {
        if (!wanted.has(f.id)) draw.features.delete(f.id);
      }
      for (const line of scenario.lines) {
        const coordinates = pathCoordinates(line.coordinates, isRing(line));
        if (coordinates.length < 2) continue;
        const geometry: LineString = { type: 'LineString', coordinates };
        const style = lineStyle(line.color, line.id === selectedLineId);
        const existing = draw.features.get(line.id);
        if (!existing) {
          draw.features.create({
            id: line.id,
            type: 'LineString',
            geometry,
            style,
            properties: { name: line.name },
          });
        } else {
          const geomChanged = !sameCoords((existing.geometry as LineString).coordinates, coordinates);
          const styleChanged =
            existing.style.strokeColor !== style.strokeColor ||
            existing.style.strokeWidth !== style.strokeWidth ||
            existing.style.strokeOpacity !== style.strokeOpacity;
          if (geomChanged || styleChanged) {
            draw.features.update(line.id, {
              ...(geomChanged ? { geometry } : {}),
              ...(styleChanged ? { style } : {}),
            });
          }
        }
      }
    },
    { source: REMOTE, ignoreLocks: true },
  );
}

/** Coordinates from an edited draw feature, converted back to domain form. */
export function featureLineCoords(feature: Feature, ringLine: boolean): LngLat[] | null {
  if (feature.geometry.type !== 'LineString') return null;
  let coords = feature.geometry.coordinates.map((c) => [c[0]!, c[1]!] as LngLat);
  // Rings are stored open; the drawing shows them closed with a repeated first vertex.
  if (ringLine && coords.length > 3) coords = coords.slice(0, -1);
  return coords;
}
