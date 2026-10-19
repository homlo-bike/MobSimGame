/**
 * The geographic editor map: MapLibre + @sakuzu/maplibre-gl-draw.
 *
 * Rendering only. Network logic lives in domain/, the simulation in
 * simulation/engine.ts; this component samples them and pushes GeoJSON into
 * MapLibre sources.
 */
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { createDraw, type Draw } from '@sakuzu/maplibre-gl-draw';
import type { LngLat } from '../domain/schema';
import { useStore, useScenario } from '../store/projectStore';
import {
  activeScenario,
  addStationOnLine,
  createLine,
  deleteLine,
  isRing,
  moveStation,
  updateLineGeometry,
} from '../domain/network';
import { snapToPath } from '../geo/geometry';
import { basemapOptions, terrainSource } from '../providers/basemaps';
import { mockProviders } from '../providers/registry';
import { buildScenarioModels, vehicleStates, type LineSimulationModel } from '../simulation/engine';
import { simulationClock } from '../simulation/runtime';
import { featureLineCoords, reconcileDraw, REMOTE } from './drawSync';
import {
  ensureLayers,
  setBasemapSourceLayersVisible,
  setData,
  setVisible,
  SRC,
  STATION_LAYER,
} from './layers';
import {
  catchmentsCollection,
  EMPTY,
  populationCollection,
  segmentsCollection,
  stationsCollection,
  trafficCollection,
  transitCollection,
  vehiclesCollection,
} from './overlays';
import { setMapInstance } from './mapInstance';
import { createLogger, errorContext } from '../util/logger';

const log = createLogger('map');

maplibregl.setWorkerUrl(workerUrl);

/** Maximum click distance from a line, in screen pixels, for placing a station. */
const STATION_SNAP_PX = 24;

export default function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<Draw | null>(null);
  /** Basemap currently applied to the map, so unchanged selections do not reload the style. */
  const appliedBasemapRef = useRef<string | null>(null);
  const [styleVersion, setStyleVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const scenario = useScenario();
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const basemapId = useStore((s) => s.basemapId);
  const layers = useStore((s) => s.layers);
  const running = useStore((s) => s.simulationRunning);
  const reducedMotion = useStore((s) => s.reducedMotion);
  const simulationEpoch = useStore((s) => s.simulationEpoch);

  // --- Create map and draw once -------------------------------------------
  useEffect(() => {
    if (!container.current) return;
    const options = basemapOptions();
    const initial = options.find((o) => o.id === useStore.getState().basemapId) ?? options[0]!;
    appliedBasemapRef.current = initial.id;
    const view = useStore.getState().project.mapView;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: initial.style as maplibregl.StyleSpecification | string,
        center: view.center,
        zoom: view.zoom,
        bearing: view.bearing,
        pitch: view.pitch,
        attributionControl: {
          compact: false,
          customAttribution: [
            '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>',
            'Drawing: <a href="https://github.com/sakuzu/maplibre-gl-draw" target="_blank" rel="noopener">maplibre-gl-draw</a> (AGPL-3.0)',
          ],
        },
      });
    } catch (e) {
      log.error('map could not start (WebGL2 required)', errorContext(e));
      setError(
        `The map could not start: ${(e as Error).message}. WebGL2 is required; the list views still work.`,
      );
      return;
    }
    mapRef.current = map;
    setMapInstance(map);
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('style.load', () => {
      log.debug('map style loaded', () => ({
        glyphs: !!map.getStyle().glyphs,
        layers: map.getStyle().layers?.length,
      }));
      ensureLayers(map, { labels: !!map.getStyle().glyphs });
      setStyleVersion((v) => v + 1);
    });
    map.on('error', (e) => {
      // Tile and glyph failures are expected offline: debug only. Anything else is a warning.
      const message = e.error?.message ?? 'unknown map error';
      const resource = /tile|glyph|sprite|fetch|AJAXError|\.pbf|\.png/i.test(message) || 'sourceId' in e;
      if (resource) log.debug('map resource failed to load', { message });
      else log.warn('map error', { message });
    });

    const draw = createDraw(map, {
      defaultMode: 'select',
      autoName: false,
      snapping: { enabled: true, tolerancePx: 12 },
      style: { line: { strokeColor: '#0f766e', strokeWidth: 6, strokeOpacity: 0.9 } },
    });
    drawRef.current = draw;

    const offs = [
      draw.on('feature.created', ({ feature, source }) => {
        if (source === REMOTE) return;
        const state = useStore.getState();
        if (feature.geometry.type !== 'LineString') {
          draw.transact(() => draw.features.delete(feature.id), { source: REMOTE });
          return;
        }
        const coords = featureLineCoords(feature, false);
        if (!coords || coords.length < 2) return;
        const sc = activeScenario(state.project);
        const { scenario: next, line } = createLine(sc, {
          coordinates: coords,
          mode: state.newLineMode,
          id: feature.id,
        });
        state.commitScenario(next, `Line "${line.name}" created with ${coords.length} vertices`);
        log.debug('line drawn', { lineId: line.id, mode: line.mode, vertices: coords.length });
        state.select({ kind: 'line', id: line.id });
        state.setTool('select');
      }),
      draw.on('feature.updated', ({ feature, source, intermediate }) => {
        if (source === REMOTE || intermediate) return;
        const state = useStore.getState();
        const sc = activeScenario(state.project);
        const line = sc.lines.find((l) => l.id === feature.id);
        if (!line) return;
        const coords = featureLineCoords(feature, isRing(line));
        if (coords && coords.length >= 2)
          state.commitScenario(updateLineGeometry(sc, line.id, coords), `Line "${line.name}" edited`);
      }),
      draw.on('feature.deleted', ({ feature, source }) => {
        if (source === REMOTE) return;
        const state = useStore.getState();
        const sc = activeScenario(state.project);
        if (sc.lines.some((l) => l.id === feature.id))
          state.commitScenario(deleteLine(sc, feature.id), 'Line deleted');
      }),
      draw.on('selection.changed', ({ selection: sel }) => {
        if (sel.type === 'feature' && sel.ids.length === 1) {
          const state = useStore.getState();
          if (activeScenario(state.project).lines.some((l) => l.id === sel.ids[0]))
            state.select({ kind: 'line', id: sel.ids[0]! });
        }
      }),
    ];

    // --- Station placement and selection ---------------------------------------
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const state = useStore.getState();
      const sc = activeScenario(state.project);
      if (state.tool === 'add_station') {
        const at: LngLat = [e.lngLat.lng, e.lngLat.lat];
        const candidates = state.stationTargetLineId
          ? sc.lines.filter((l) => l.id === state.stationTargetLineId)
          : sc.lines;
        let best: { id: string; px: number } | null = null;
        for (const l of candidates) {
          const snap = snapToPath(l.coordinates, isRing(l), at);
          if (!snap) continue;
          const p = map.project(snap.position);
          const px = Math.hypot(p.x - e.point.x, p.y - e.point.y);
          if (!best || px < best.px) best = { id: l.id, px };
        }
        if (!best || best.px > STATION_SNAP_PX) {
          state.announce('No line close enough to the click. Click on a line to add a station.');
          return;
        }
        const res = addStationOnLine(sc, best.id, at);
        if (res.error) {
          state.announce(res.error);
          return;
        }
        state.commitScenario(
          res.scenario,
          res.reused
            ? `Existing station "${res.station!.name}" added to the line (shared)`
            : `Station "${res.station!.name}" added`,
        );
        state.select({ kind: 'station', id: res.station!.id });
        return;
      }
      const hit = map.queryRenderedFeatures(e.point, { layers: [STATION_LAYER] })[0];
      if (hit?.properties?.stationId) state.select({ kind: 'station', id: String(hit.properties.stationId) });
    };
    map.on('click', onClick);

    // Drag stations in select mode.
    let dragging: string | null = null;
    map.on('mousedown', STATION_LAYER, (e) => {
      if (useStore.getState().tool !== 'select') return;
      const id = e.features?.[0]?.properties?.stationId;
      if (!id) return;
      e.preventDefault();
      dragging = String(id);
      draw.setInteractionLocked(true);
      map.dragPan.disable();
      map.getCanvas().style.cursor = 'grabbing';
    });
    map.on('mousemove', (e) => {
      if (!dragging) return;
      const sc = activeScenario(useStore.getState().project);
      const preview = moveStation(sc, dragging, [e.lngLat.lng, e.lngLat.lat]);
      setData(map, SRC.stations, stationsCollection(preview, dragging));
    });
    map.on('mouseup', (e) => {
      if (!dragging) return;
      const id = dragging;
      dragging = null;
      map.dragPan.enable();
      draw.setInteractionLocked(false);
      map.getCanvas().style.cursor = '';
      const state = useStore.getState();
      state.commitScenario(
        moveStation(activeScenario(state.project), id, [e.lngLat.lng, e.lngLat.lat]),
        'Station moved',
      );
      state.select({ kind: 'station', id });
    });
    map.on('mouseenter', STATION_LAYER, () => {
      if (useStore.getState().tool === 'select') map.getCanvas().style.cursor = 'grab';
    });
    map.on('mouseleave', STATION_LAYER, () => {
      if (!dragging) map.getCanvas().style.cursor = '';
    });

    return () => {
      offs.forEach((off) => off());
      draw.destroy();
      map.remove();
      setMapInstance(null);
      mapRef.current = null;
      drawRef.current = null;
    };
  }, []);

  // --- Basemap switching -----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const opt = basemapOptions().find((o) => o.id === basemapId);
    if (opt && opt.id !== appliedBasemapRef.current) {
      appliedBasemapRef.current = opt.id;
      log.debug('basemap switched', { basemap: opt.id });
      map.setStyle(opt.style as maplibregl.StyleSpecification | string);
    }
  }, [basemapId]);

  // --- Fly to the project's view when a different project is loaded ---------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.jumpTo({
      center: project.mapView.center,
      zoom: project.mapView.zoom,
      bearing: project.mapView.bearing,
      pitch: project.mapView.pitch,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // --- Tools ------------------------------------------------------------------
  useEffect(() => {
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map) return;
    if (tool === 'draw_line') draw.setMode('draw_line');
    else {
      if (draw.drawing.isDrawing()) draw.drawing.cancel();
      draw.setMode('select');
    }
    draw.setInteractionLocked(tool === 'add_station');
    map.getCanvas().style.cursor = tool === 'add_station' ? 'crosshair' : '';
  }, [tool]);

  // --- Network overlays and draw features ---------------------------------------
  const selectedLineId =
    selection?.kind === 'line' ? selection.id : selection?.kind === 'segment' ? selection.lineId : null;
  const selectedStationId = selection?.kind === 'station' ? selection.id : null;
  useEffect(() => {
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!map || !draw || !map.getSource(SRC.segments)) return;
    setData(map, SRC.segments, segmentsCollection(scenario, selectedLineId));
    setData(map, SRC.stations, stationsCollection(scenario, selectedStationId));
    setData(map, SRC.catchments, layers.catchments ? catchmentsCollection(scenario) : EMPTY);
    reconcileDraw(draw, scenario, selectedLineId);
  }, [scenario, selectedLineId, selectedStationId, styleVersion, layers.catchments]);

  // --- Context layers --------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource(SRC.segments)) return;
    setVisible(map, 'msg-catchments-fill', layers.catchments);
    setBasemapSourceLayersVisible(map, ['building'], layers.buildings);
    setBasemapSourceLayersVisible(map, ['landuse', 'landcover', 'park'], layers.parkingLandUse);
    const fictional = project.fictional;
    const bounds = map.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];
    let cancelled = false;
    // Synthetic overlays are only shown for fictional projects (never over a real city).
    (async () => {
      if (layers.population && fictional) {
        const poly: LngLat[] = [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[1]],
          [bbox[2], bbox[3]],
          [bbox[0], bbox[3]],
          [bbox[0], bbox[1]],
        ];
        const res = await mockProviders.population.densityInPolygon(poly);
        if (!cancelled) setData(map, SRC.population, populationCollection(res.data));
      }
      if (layers.traffic && fictional) {
        const res = await mockProviders.traffic.trafficInBBox(bbox);
        if (!cancelled) setData(map, SRC.traffic, trafficCollection(res.data));
      }
      if (layers.existingTransit && fictional) {
        const res = await mockProviders.transit.routesInBBox();
        if (!cancelled) setData(map, SRC.transit, transitCollection(res.data));
      }
    })();
    setVisible(map, 'msg-population-fill', layers.population && fictional);
    setVisible(map, 'msg-traffic-line', layers.traffic && fictional);
    setVisible(map, 'msg-transit-line', layers.existingTransit && fictional);

    // Terrain (visual only).
    const dem = terrainSource();
    if (layers.terrain && dem) {
      if (!map.getSource(SRC.dem)) {
        map.addSource(SRC.dem, {
          type: 'raster-dem',
          tiles: dem.tiles,
          encoding: dem.encoding,
          tileSize: dem.tileSize,
          maxzoom: dem.maxzoom,
          attribution: dem.attribution,
        });
      }
      map.setTerrain({ source: SRC.dem, exaggeration: 1.3 });
    } else if (map.getTerrain()) {
      map.setTerrain(null);
    }
    return () => {
      cancelled = true;
    };
  }, [layers, styleVersion, project.fictional]);

  // --- Vehicle animation (frame-rate independent) -----------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let models: LineSimulationModel[] = buildScenarioModels(scenario);
    let frame = 0;
    let lastDraw = 0;
    const render = () => {
      const t = simulationClock.tick();
      const now = performance.now();
      // Reduced motion: update in discrete steps every 2 s instead of continuous movement.
      if (!reducedMotion || now - lastDraw > 2000) {
        setData(map, SRC.vehicles, vehiclesCollection(models.flatMap((m) => vehicleStates(m, t))));
        lastDraw = now;
      }
      if (simulationClock.running) frame = requestAnimationFrame(render);
    };
    if (running) {
      simulationClock.start();
      frame = requestAnimationFrame(render);
    } else {
      simulationClock.pause();
      models = buildScenarioModels(scenario);
      if (map.getSource(SRC.vehicles)) {
        const t = simulationClock.timeS;
        setData(
          map,
          SRC.vehicles,
          t > 0 ? vehiclesCollection(models.flatMap((m) => vehicleStates(m, t))) : EMPTY,
        );
      }
    }
    return () => cancelAnimationFrame(frame);
  }, [running, scenario, reducedMotion, styleVersion, simulationEpoch]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={container}
        className="h-full w-full"
        role="application"
        aria-label="Network map. Use the side panels or the Table view for keyboard editing."
        data-testid="map"
      />
      {error && (
        <div
          role="alert"
          className="absolute inset-x-4 top-4 rounded border-2 border-red-700 bg-white p-3 text-red-900"
        >
          {error}
        </div>
      )}
      {tool === 'add_station' && (
        <p className="pointer-events-none absolute start-1/2 top-2 -translate-x-1/2 rounded bg-slate-900/85 px-3 py-1 text-sm text-white">
          Click on a line to add a station · Esc to finish
        </p>
      )}
      {tool === 'draw_line' && (
        <p className="pointer-events-none absolute start-1/2 top-2 -translate-x-1/2 rounded bg-slate-900/85 px-3 py-1 text-sm text-white">
          Click to add vertices · Enter or double-click to finish · Esc to cancel
        </p>
      )}
    </div>
  );
}
