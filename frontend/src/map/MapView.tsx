/**
 * The geographic editor map: MapLibre + @sakuzu/maplibre-gl-draw.
 *
 * Rendering only. Network logic lives in domain/, the simulation in
 * simulation/engine.ts; this component samples them and pushes GeoJSON into
 * MapLibre sources.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { validateScenario } from '../validation/validate';
import { findingSubject } from '../validation/locate';
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
  isRing,
  moveStation,
  updateLineGeometry,
} from '../domain/network';
import { snapToPath } from '../geo/geometry';
import { basemapOptions, terrainSource } from '../providers/basemaps';
import { mockProviders } from '../providers/registry';
import { buildScenarioModels, vehicleStates, type LineSimulationModel } from '../simulation/engine';
import { simulationClock, simulationOptions } from '../simulation/runtime';
import { featureLineCoords, reconcileDraw, REMOTE } from './drawSync';
import {
  applyTrackHandles,
  isRailMode,
  nearestOnTrack,
  pointOnTrack,
  networkFrame,
  setCurveRadius,
  trackGeometry,
} from '../domain/tracks';
import { addStationOnTracks, afterTrackEdit, moveStationOnTracks } from '../domain/serviceRouting';
import { deleteLineWithNotice, finishDrawnTrack, requestTrackDeletion } from '../store/trackActions';
import { addDraftStop, drawingStops, finishStopDraft } from '../store/stopActions';
import { isStopLineMode } from '../domain/stopLines';
import { addManualSignal, moveSignal } from '../domain/signals';
import {
  addHole,
  createRegion,
  deleteRegion,
  setRegionGeometry,
  splitRegion,
  toRegionGeometry,
} from '../domain/regions';
import {
  ensureLayers,
  setBasemapSourceLayersVisible,
  setData,
  setVisible,
  SIGNAL_LAYER,
  SRC,
  STATION_LAYER,
  TRACK_LAYER_PREFIX,
  TRACK_NODE_LAYER,
  FINDING_CLUSTER_LAYER,
  FINDING_LAYER,
  CURVE_LABEL_LAYER,
  STATION_HANDLE_LAYER,
  PLATFORM_LAYER,
  CONFLICT_LAYER,
  REGION_FILL_LAYER,
} from './layers';
import {
  arrowsCollection,
  metresPerPixel,
  catchmentsCollection,
  closuresCollection,
  crossoversCollection,
  EMPTY,
  routeStatusCollection,
  signalsCollection,
  populationCollection,
  segmentsCollection,
  stationsCollection,
  findingsCollection,
  regionsCollection,
  regionLabelsCollection,
  curveLabelsCollection,
  conflictsCollection,
  walkingLinksCollection,
  dimOtherModes,
  platformsCollection,
  stationHandlesCollection,
  trackNodesCollection,
  tracksCollection,
  trafficCollection,
  transitCollection,
  vehiclesCollection,
  stopDraftCollection,
} from './overlays';
import { setMapInstance } from './mapInstance';
import { trackGuideSnap, type TrackGuideSnap } from '../domain/trackGuides';
import { findConflicts } from '../simulation/conflicts';
import { stationMode } from '../domain/modeSeparation';
import {
  nearbyTrackBearing,
  placeStation,
  snapStationBearing,
  updateStationLayout,
} from '../domain/stationLayout';
import { curveHandles, radiusFromHandle } from '../domain/curveHandles';
import { CurveEditor } from '../ui/CurveEditor';
import { createLogger, errorContext } from '../util/logger';
import { autoRoute } from '../routing/autoRoute';

const log = createLogger('map');

maplibregl.setWorkerUrl(workerUrl);

/** Maximum click distance from a line, in screen pixels, for placing a station. */
const STATION_SNAP_PX = 24;

/** A shape drawn with a region tool: a new region, a hole in the selected region, or a cut across it. */
function handleRegionDrawing(state: ReturnType<typeof useStore.getState>, geometry: GeoJSON.Geometry) {
  const sc = activeScenario(state.project);
  const target = state.selection?.kind === 'region' ? state.selection.id : null;
  if (state.tool === 'region_split') {
    if (!target || geometry.type !== 'LineString')
      return state.announce('Select a region, then draw a line across it.');
    const res = splitRegion(sc, target, geometry.coordinates as LngLat[]);
    if (res.error) return state.announce(res.error);
    state.commitScenario(res.scenario, 'Region split');
    state.select(null);
    state.setTool('select');
    return;
  }
  const g = toRegionGeometry(geometry as { type: string; coordinates: unknown });
  if (!g) return state.announce('The shape has no area. Draw at least three points.');
  if (state.tool === 'region_hole') {
    if (!target) return state.announce('Select a region first.');
    const res = addHole(sc, target, g);
    if (res.error) return state.announce(res.error);
    state.commitScenario(res.scenario, 'Hole cut out of the region');
    state.setTool('select');
    return;
  }
  const res = createRegion(sc, { geometry: g });
  state.commitScenario(res.scenario, `Region "${res.region.name}" drawn`);
  state.select({ kind: 'region', id: res.region.id });
  state.setTool('select');
}

/** Screen distance between direction arrows, and their clearance around stations. */
const ARROW_SPACING_PX = 120;
const ARROW_STATION_CLEARANCE_PX = 14;

/** Direction arrows for services and tracks, spaced for the current zoom and kept clear of stations. */
function directionArrows(
  map: maplibregl.Map,
  segments: ReturnType<typeof segmentsCollection>,
  tracks: ReturnType<typeof tracksCollection>,
  scenario: ReturnType<typeof useScenario>,
  markers: LngLat[] = [],
) {
  const mpp = metresPerPixel(map.getZoom(), map.getCenter().lat);
  const options = {
    spacingM: ARROW_SPACING_PX * mpp,
    // Arrows never cover stations or validation markers.
    avoid: [...scenario.stations.map((s) => s.position), ...markers],
    avoidM: ARROW_STATION_CLEARANCE_PX * mpp,
  };
  const a = arrowsCollection(segments, options);
  return { ...a, features: [...a.features, ...arrowsCollection(tracks, options).features] };
}

/** A track and, on double track, its partner. */
function pairOf(sc: ReturnType<typeof activeScenario>, trackId: string): string[] {
  const t = sc.trackNetwork.tracks.find((x) => x.id === trackId);
  return t?.groupId
    ? sc.trackNetwork.tracks.filter((x) => x.groupId === t.groupId).map((x) => x.id)
    : [trackId];
}

/** A station moved to `to`: a station object takes its tracks along; a stop stays on its tracks. */
function movedStation(sc: ReturnType<typeof activeScenario>, id: string, to: LngLat) {
  const st = sc.stations.find((x) => x.id === id);
  if (st?.layout) return updateStationLayout(sc, id, { position: to }).scenario;
  return st?.trackRefs.length ? moveStationOnTracks(sc, id, to) : moveStation(sc, id, to);
}

/** A press that moves the pointer less than this is a click, not a drag. */
const CLICK_TOLERANCE_PX = 4;

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
  const closures = useStore((s) => s.closures);
  const newLineMode = useStore((s) => s.newLineMode);
  const markerVisibility = useStore((s) => s.markerVisibility);
  const focusedFindingId = useStore((s) => s.focusedFindingId);
  // Validation markers (also kept for click handling).
  const findings = useMemo(() => validateScenario(scenario), [scenario]);
  const findingsRef = useRef(findings);
  findingsRef.current = findings;
  /** Zoom (rounded to half steps) at which direction arrows were laid out. */
  const [arrowZoom, setArrowZoom] = useState(0);
  const serviceDraft = useStore((s) => s.serviceDraft);
  const stopDraft = useStore((s) => s.stopDraft);

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
    // Arrow spacing follows the zoom: lay arrows out again in half-zoom steps.
    const onZoom = () => setArrowZoom(Math.round(map.getZoom() * 2) / 2);
    map.on('zoomend', onZoom);
    onZoom();
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
      // The built-in guides are north-based; track guides come from the provider below instead.
      snapping: { enabled: true, tolerancePx: 12, kinds: { guide: false } },
      style: { line: { strokeColor: '#0f766e', strokeWidth: 6, strokeOpacity: 0.9 } },
    });
    drawRef.current = draw;

    // How far the pointer travelled during the last press: a click on a track end (no drag) must
    // not move it, even when snapping would pull it onto a nearby point.
    let pressAt: { x: number; y: number } | null = null;
    let lastTravelPx = Infinity;
    let releasedAt = 0;
    const canvas = map.getCanvasContainer();
    const onDown = (e: PointerEvent) => {
      pressAt = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      lastTravelPx = pressAt ? Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) : Infinity;
      releasedAt = performance.now();
      pressAt = null;
    };
    canvas.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);

    // Track drawing guides: relative to the last leg (or the track end the drawing starts from)
    // and parallel to straight track near the cursor (domain/trackGuides.ts).
    let placed: LngLat[] = [];
    let activeGuide: TrackGuideSnap | null = null;
    const removeGuides = draw.extensions.snapProviders.add({
      name: 'msg-track-guides',
      candidates(ctx) {
        const st = useStore.getState();
        activeGuide = null;
        if (st.tool !== 'draw_line' || !isRailMode(st.newLineMode) || !st.trackDraw.guides) return [];
        const net = activeScenario(st.project).trackNetwork;
        const cursor = ctx.lngLat as LngLat;
        const toleranceM = ctx.tolerancePx * metresPerPixel(map.getZoom(), cursor[1]);
        const snap = trackGuideSnap(net, placed, cursor, toleranceM);
        if (!snap) return [];
        activeGuide = snap;
        return [{ position: snap.position, kind: 'track-guide', priority: -1, source: snap.label }];
      },
    });
    const showGuide = (g: TrackGuideSnap | null) =>
      setData(map, SRC.guides, {
        type: 'FeatureCollection',
        features: g
          ? [
              {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: g.line },
                properties: { label: g.label },
              },
            ]
          : [],
      });

    // Curve handles: drag the middle of a curve along its bisector to set the radius
    // (domain/curveHandles.ts); a click without a drag opens the radius editor.
    let curveDrag: { trackId: string; index: number; radius: number | null | undefined } | null = null;
    const removeCurveHandles = draw.extensions.handleProviders.add({
      name: 'msg-curve-handles',
      handles(feature) {
        const st = useStore.getState();
        if (st.selection?.kind !== 'track' || st.selection.id !== feature.id) return [];
        const net = activeScenario(st.project).trackNetwork;
        const t = net.tracks.find((x) => x.id === feature.id);
        if (!t) return [];
        return curveHandles(net, t).map((h) => ({
          id: `curve-${h.index}`,
          position: h.position,
          kind: 'curve-radius',
          cursor: 'move',
        }));
      },
      onDragStart(feature, handle) {
        if (!feature) return false;
        curveDrag = { trackId: feature.id, index: Number(handle.id.slice(6)), radius: undefined };
        return true;
      },
      onDrag(_feature, _handle, event) {
        if (!curveDrag) return null;
        const sc = activeScenario(useStore.getState().project);
        const net = sc.trackNetwork;
        const t = net.tracks.find((x) => x.id === curveDrag!.trackId);
        if (!t) return null;
        const r = radiusFromHandle(net, t, curveDrag.index, event.lngLat as LngLat);
        curveDrag.radius = r;
        const preview = { ...t, radii: t.radii.map((x, i) => (i === curveDrag!.index ? r : x)) };
        setData(map, SRC.curvePreview, {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: trackGeometry(net, preview).coordinates },
              properties: {},
            },
          ],
        });
        setData(map, SRC.curveLabels, {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: event.lngLat },
              properties: {
                label: `C${curveDrag.index + 1} · ${r ? `R ${r} m` : 'sharp corner'}`,
                reduced: false,
              },
            },
          ],
        });
        return null;
      },
      onDragEnd() {
        const d = curveDrag;
        curveDrag = null;
        setData(map, SRC.curvePreview, EMPTY);
        if (!d) return;
        const state = useStore.getState();
        const sc = activeScenario(state.project);
        if (d.radius === undefined) {
          // A click on the handle: open the editor.
          state.setCurveEditor({ trackId: d.trackId, index: d.index });
          state.commitScenario({ ...sc });
          return;
        }
        state.commitScenario(
          afterTrackEdit(setCurveRadius(sc, d.trackId, d.index, d.radius), pairOf(sc, d.trackId)),
          d.radius === null ? `Curve C${d.index + 1} removed` : `Curve C${d.index + 1}: radius ${d.radius} m`,
        );
      },
    });

    const offs = [
      removeGuides,
      removeCurveHandles,
      () => canvas.removeEventListener('pointerdown', onDown, true),
      () => window.removeEventListener('pointerup', onUp, true),
      draw.on('preview.changed', ({ feature, confirmedVertices }) => {
        const coords =
          feature && feature.geometry.type === 'LineString' ? (feature.geometry.coordinates as LngLat[]) : [];
        placed = coords.slice(0, confirmedVertices ?? Math.max(0, coords.length - 1));
        if (!feature) showGuide(null);
      }),
      draw.on('snap.changed', ({ result }) => {
        showGuide(result?.target?.kind === 'track-guide' ? activeGuide : null);
      }),
      draw.on('feature.created', ({ feature, source }) => {
        if (source === REMOTE) return;
        const state = useStore.getState();
        // Region tools: the drawn shape becomes a region, a hole or a cut; the draw feature is replaced.
        if (state.tool === 'draw_region' || state.tool === 'region_hole' || state.tool === 'region_split') {
          draw.transact(() => draw.features.delete(feature.id), { source: REMOTE });
          handleRegionDrawing(state, feature.geometry);
          return;
        }
        if (feature.geometry.type !== 'LineString') {
          draw.transact(() => draw.features.delete(feature.id), { source: REMOTE });
          return;
        }
        const coords = featureLineCoords(feature, false);
        if (!coords || coords.length < 2) return;
        placed = [];
        showGuide(null);
        if (isRailMode(state.newLineMode)) {
          // Rail modes draw physical track; services are created on it with the Service tool.
          draw.transact(() => draw.features.delete(feature.id), { source: REMOTE });
          finishDrawnTrack(coords);
          // Stay in the drawing tool: the next click starts another track (Esc stops drawing).
          setTimeout(() => {
            if (useStore.getState().tool === 'draw_line') draw.setMode('draw_line');
          }, 0);
          return;
        }
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
        if (line.alignment.kind === 'routed') void autoRoute(line.id);
      }),
      draw.on('feature.updated', ({ feature, source, intermediate }) => {
        if (source === REMOTE || intermediate) return;
        const state = useStore.getState();
        const sc = activeScenario(state.project);
        const region = sc.regions.find((r) => r.id === feature.id);
        if (region) {
          const g = toRegionGeometry(feature.geometry as { type: string; coordinates: unknown });
          if (g) state.commitScenario(setRegionGeometry(sc, region.id, g), `Region "${region.name}" edited`);
          return;
        }
        const track = sc.trackNetwork.tracks.find((t) => t.id === feature.id);
        if (track) {
          const handles = featureLineCoords(feature, false);
          if (!handles || handles.length < 2) return;
          // Only an edit that ends a pointer press just now (not a keyboard edit) can be a click.
          const wasClick = lastTravelPx < CLICK_TOLERANCE_PX && performance.now() - releasedAt < 500;
          lastTravelPx = Infinity;
          if (wasClick) {
            // A click, not a drag: put the handles back where they were.
            reconcileDraw(draw, sc, null, track.id, null, state.newLineMode);
            return;
          }
          const moved = applyTrackHandles(sc, track.id, handles);
          // Every track at a moved node changes shape too.
          const nodes = new Set([track.fromNodeId, track.toNodeId]);
          const touched = moved.trackNetwork.tracks
            .filter((t) => t.id === track.id || nodes.has(t.fromNodeId) || nodes.has(t.toNodeId))
            .map((t) => t.id);
          state.commitScenario(afterTrackEdit(moved, touched), 'Track edited');
          return;
        }
        const line = sc.lines.find((l) => l.id === feature.id);
        if (!line) return;
        const coords = featureLineCoords(feature, isRing(line));
        if (coords && coords.length >= 2) {
          state.commitScenario(updateLineGeometry(sc, line.id, coords), `Line "${line.name}" edited`);
          if (line.alignment.kind === 'routed') void autoRoute(line.id);
        }
      }),
      draw.on('feature.deleted', ({ feature, source }) => {
        if (source === REMOTE) return;
        const state = useStore.getState();
        const sc = activeScenario(state.project);
        const region = sc.regions.find((r) => r.id === feature.id);
        if (region) {
          if (region.locked) reconcileDraw(draw, sc, null, null, null, state.newLineMode);
          else {
            state.commitScenario(deleteRegion(sc, region.id), `Region "${region.name}" deleted`);
            state.select(null);
          }
          return;
        }
        if (sc.trackNetwork.tracks.some((t) => t.id === feature.id)) {
          requestTrackDeletion([feature.id]);
          // Until the user decides, the drawing shows the track again.
          reconcileDraw(draw, sc, null, null, null, state.newLineMode);
        } else if (sc.lines.some((l) => l.id === feature.id)) deleteLineWithNotice(feature.id);
      }),
      draw.on('selection.changed', ({ selection: sel }) => {
        if (sel.type === 'feature' && sel.ids.length === 1) {
          const state = useStore.getState();
          const sc = activeScenario(state.project);
          if (sc.lines.some((l) => l.id === sel.ids[0])) state.select({ kind: 'line', id: sel.ids[0]! });
          else if (sc.trackNetwork.tracks.some((t) => t.id === sel.ids[0]))
            state.select({ kind: 'track', id: sel.ids[0]! });
          else if (sc.regions.some((r) => r.id === sel.ids[0]))
            state.select({ kind: 'region', id: sel.ids[0]! });
        }
      }),
    ];

    // --- Station placement and selection ---------------------------------------
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const state = useStore.getState();
      const sc = activeScenario(state.project);
      if (drawingStops()) {
        // Bus, BRT and trolleybus lines: every click is a stop, served in the clicked order.
        addDraftStop([e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      if (state.tool === 'add_station' && isRailMode(state.newLineMode)) {
        // A rail station is an object with its own tracks and platforms, placed where clicked.
        // It lines up with straight track within 100 m, else it runs east–west.
        const at: LngLat = [e.lngLat.lng, e.lngLat.lat];
        const res = placeStation(sc, {
          position: at,
          mode: state.newLineMode,
          bearingDeg: nearbyTrackBearing(sc, at) ?? 90,
          sidePlatforms: state.stationDraft.sidePlatforms,
          islandPlatforms: state.stationDraft.islandPlatforms,
        });
        if (res.error || !res.station) {
          state.announce(res.error ?? 'Station could not be added');
          return;
        }
        state.commitScenario(
          res.scenario,
          `Station "${res.station.name}" placed with ${res.station.layout!.trackIds.length} track(s); connect track to its ends`,
        );
        state.select({ kind: 'station', id: res.station.id });
        return;
      }
      if (state.tool === 'add_station' && !sc.lines.length) {
        // Stops on existing track (imported networks): snap to the nearest track within a few pixels.
        const at: LngLat = [e.lngLat.lng, e.lngLat.lat];
        const net = sc.trackNetwork;
        let best: { px: number; position: LngLat } | null = null;
        for (const t of net.tracks) {
          const hit = nearestOnTrack(net, t, at);
          const position = pointOnTrack(net, t, hit.fraction).position;
          const p = map.project(position);
          const px = Math.hypot(p.x - e.point.x, p.y - e.point.y);
          if (!best || px < best.px) best = { px, position };
        }
        if (!best || best.px > STATION_SNAP_PX) {
          state.announce('No track close enough to the click. Click on a track to add a station.');
          return;
        }
        const res = addStationOnTracks(sc, best.position, { mode: state.newLineMode });
        if (res.error || !res.station) {
          state.announce(res.error ?? 'Station could not be added');
          return;
        }
        state.commitScenario(
          res.scenario,
          res.reused
            ? `Existing station "${res.station.name}" now also serves this track`
            : `Station "${res.station.name}" added on ${res.station.trackRefs.length} track(s)`,
        );
        state.select({ kind: 'station', id: res.station.id });
        return;
      }
      if (state.tool === 'add_signal') {
        const res = addManualSignal(sc, [e.lngLat.lng, e.lngLat.lat]);
        state.commitScenario(res.scenario, 'Traffic signal placed');
        state.select({ kind: 'signal', id: res.signal.id });
        return;
      }
      if (state.tool === 'new_service') {
        // Nearest station on screen (from the project data, not from what is rendered yet).
        let st: (typeof sc.stations)[number] | null = null;
        let bestPx = STATION_SNAP_PX;
        for (const x of sc.stations) {
          const p = map.project(x.position);
          const px = Math.hypot(p.x - e.point.x, p.y - e.point.y);
          if (px <= bestPx) {
            bestPx = px;
            st = x;
          }
        }
        if (!st) {
          state.announce('Click on a station that lies on a track.');
          return;
        }
        if (!st.trackRefs.length) {
          state.announce(`"${st.name}" is not on a track.`);
          return;
        }
        if (stationMode(sc, st) !== state.newLineMode) {
          state.announce(
            `"${st.name}" belongs to another mode; services only call at stations of their mode.`,
          );
          return;
        }
        const draft = state.serviceDraft;
        if (draft[draft.length - 1] === st.id) return;
        state.setServiceDraft([...draft, st.id]);
        state.announce(`Stop ${draft.length + 1}: ${st.name}. Press Enter to create the service.`);
        return;
      }
      if (state.tool === 'add_station') {
        const at: LngLat = [e.lngLat.lng, e.lngLat.lat];
        const candidates = state.stationTargetLineId
          ? sc.lines.filter((l) => l.id === state.stationTargetLineId)
          : sc.lines.filter((l) => l.alignment.kind !== 'track');
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
      // A crossing marker says who has priority there.
      if (map.getLayer(CONFLICT_LAYER)) {
        const x = map.queryRenderedFeatures(e.point, { layers: [CONFLICT_LAYER] })[0];
        if (x?.properties?.label) {
          new maplibregl.Popup({ closeButton: true })
            .setLngLat(e.lngLat)
            .setText(`Crossing: ${String(x.properties.label)}`)
            .addTo(map);
          state.announce(`Crossing: ${String(x.properties.label)}`);
          return;
        }
      }
      // A curve label of the selected track opens its radius editor.
      if (state.tool === 'select' && map.getLayer(CURVE_LABEL_LAYER)) {
        const c = map.queryRenderedFeatures(e.point, { layers: [CURVE_LABEL_LAYER] })[0];
        if (c?.properties?.trackId) {
          state.setCurveEditor({ trackId: String(c.properties.trackId), index: Number(c.properties.index) });
          return;
        }
      }
      // Validation markers: a cluster zooms in; a marker selects its object and highlights the finding.
      const markerLayers = [FINDING_LAYER, FINDING_CLUSTER_LAYER].filter((id) => map.getLayer(id));
      const marker = markerLayers.length
        ? map.queryRenderedFeatures(e.point, { layers: markerLayers })[0]
        : undefined;
      if (marker?.properties?.cluster_id !== undefined) {
        const src = map.getSource(SRC.findings) as maplibregl.GeoJSONSource;
        void src
          .getClusterExpansionZoom(Number(marker.properties.cluster_id))
          .then((z) =>
            map.easeTo({ center: (marker.geometry as GeoJSON.Point).coordinates as LngLat, zoom: z }),
          );
        return;
      }
      if (marker?.properties?.findingId) {
        const f = findingsRef.current.find((x) => x.id === marker.properties!.findingId);
        if (f) {
          state.setFocusedFinding(f.id);
          const subject = findingSubject(f);
          if (subject) state.select(subject);
          state.announce(marker.properties.label as string);
        }
        return;
      }
      const trackLayers = (map.getStyle().layers ?? [])
        .map((l) => l.id)
        .filter((id) => id.startsWith(TRACK_LAYER_PREFIX) && map.getLayer(id));
      const hit = map.queryRenderedFeatures(e.point, {
        layers: [STATION_LAYER, STATION_HANDLE_LAYER, SIGNAL_LAYER, TRACK_NODE_LAYER, PLATFORM_LAYER].filter(
          (id) => map.getLayer(id),
        ),
      })[0];
      if (hit?.properties?.stationId) state.select({ kind: 'station', id: String(hit.properties.stationId) });
      else if (hit?.properties?.signalId)
        state.select({ kind: 'signal', id: String(hit.properties.signalId) });
      else if (hit?.properties?.nodeId) state.select({ kind: 'node', id: String(hit.properties.nodeId) });
      else if (state.tool === 'select' && trackLayers.length) {
        const box: [maplibregl.PointLike, maplibregl.PointLike] = [
          [e.point.x - 4, e.point.y - 4],
          [e.point.x + 4, e.point.y + 4],
        ];
        const t = map.queryRenderedFeatures(box, { layers: trackLayers })[0];
        if (t?.properties?.trackId) state.select({ kind: 'track', id: String(t.properties.trackId) });
        else if (map.getLayer(REGION_FILL_LAYER)) {
          const r = map.queryRenderedFeatures(e.point, { layers: [REGION_FILL_LAYER] })[0];
          if (r?.properties?.regionId) state.select({ kind: 'region', id: String(r.properties.regionId) });
        }
      }
    };
    map.on('click', onClick);
    // Right-click finishes a line drawn stop by stop (as Esc does).
    map.on('contextmenu', (e) => {
      if (!drawingStops()) return;
      e.preventDefault();
      finishStopDraft();
    });

    // Drag stations in select mode.
    let dragging: string | null = null;
    // Drag traffic signals in select mode.
    let draggingSignal: string | null = null;
    map.on('mousedown', SIGNAL_LAYER, (e) => {
      if (useStore.getState().tool !== 'select') return;
      const id = e.features?.[0]?.properties?.signalId;
      if (!id) return;
      e.preventDefault();
      draggingSignal = String(id);
      draw.setInteractionLocked(true);
      map.dragPan.disable();
      map.getCanvas().style.cursor = 'grabbing';
    });
    map.on('mousemove', (e) => {
      if (!draggingSignal) return;
      const sc = activeScenario(useStore.getState().project);
      const preview = moveSignal(sc, draggingSignal, [e.lngLat.lng, e.lngLat.lat]);
      setData(map, SRC.signals, signalsCollection(preview, simulationClock.timeS, draggingSignal));
    });
    map.on('mouseup', (e) => {
      if (!draggingSignal) return;
      const id = draggingSignal;
      draggingSignal = null;
      map.dragPan.enable();
      draw.setInteractionLocked(false);
      map.getCanvas().style.cursor = '';
      const state = useStore.getState();
      state.commitScenario(
        moveSignal(activeScenario(state.project), id, [e.lngLat.lng, e.lngLat.lat]),
        'Signal moved',
      );
      state.select({ kind: 'signal', id });
    });

    const startStationDrag = (e: maplibregl.MapLayerMouseEvent) => {
      if (useStore.getState().tool !== 'select' || rotating) return;
      // Other modes are locked: switch to their tab to move them.
      if (e.features?.[0]?.properties?.dim) return;
      const id = e.features?.[0]?.properties?.stationId;
      if (!id) return;
      e.preventDefault();
      dragging = String(id);
      draw.setInteractionLocked(true);
      map.dragPan.disable();
      map.getCanvas().style.cursor = 'grabbing';
    };
    map.on('mousedown', STATION_LAYER, startStationDrag);
    // A station object can also be grabbed by its platforms.
    map.on('mousedown', PLATFORM_LAYER, startStationDrag);
    map.on('mousemove', (e) => {
      if (!dragging) return;
      const sc = activeScenario(useStore.getState().project);
      const preview = movedStation(sc, dragging, [e.lngLat.lng, e.lngLat.lat]);
      setData(map, SRC.stations, stationsCollection(preview, dragging));
      if (preview.stations.find((x) => x.id === dragging)?.layout) {
        setData(map, SRC.platforms, platformsCollection(preview, dragging));
        setData(map, SRC.tracks, tracksCollection(preview, null));
        setData(map, SRC.stationHandles, stationHandlesCollection(preview, dragging));
      }
    });
    map.on('mouseup', (e) => {
      if (!dragging) return;
      const id = dragging;
      dragging = null;
      map.dragPan.enable();
      draw.setInteractionLocked(false);
      map.getCanvas().style.cursor = '';
      const state = useStore.getState();
      const sc = activeScenario(state.project);
      const to: LngLat = [e.lngLat.lng, e.lngLat.lat];
      state.commitScenario(movedStation(sc, id, to), 'Station moved');
      state.select({ kind: 'station', id });
    });

    // Rotate a station object by dragging a handle at one end; it lines up with straight track
    // within 100 m when close (hold Alt to rotate freely).
    let rotating: { id: string; end: number } | null = null;
    const rotated = (
      sc: ReturnType<typeof activeScenario>,
      r: { id: string; end: number },
      e: maplibregl.MapMouseEvent,
    ) => {
      const st = sc.stations.find((x) => x.id === r.id);
      if (!st?.layout) return sc;
      const frame = networkFrame(sc.trackNetwork, st.position);
      const c = frame.toMetres(st.position);
      const p = frame.toMetres([e.lngLat.lng, e.lngLat.lat]);
      let bearing = (Math.atan2(p[0] - c[0], p[1] - c[1]) * 180) / Math.PI + (r.end === 0 ? 180 : 0);
      if (!e.originalEvent.altKey) bearing = snapStationBearing(sc, st.id, st.position, bearing).bearingDeg;
      return updateStationLayout(sc, st.id, { bearingDeg: bearing }).scenario;
    };
    map.on('mousedown', STATION_HANDLE_LAYER, (e) => {
      if (useStore.getState().tool !== 'select') return;
      const f = e.features?.[0]?.properties;
      if (!f?.stationId) return;
      e.preventDefault();
      rotating = { id: String(f.stationId), end: Number(f.end) };
      draw.setInteractionLocked(true);
      map.dragPan.disable();
    });
    map.on('mousemove', (e) => {
      if (!rotating) return;
      const preview = rotated(activeScenario(useStore.getState().project), rotating, e);
      setData(map, SRC.platforms, platformsCollection(preview, rotating.id));
      setData(map, SRC.tracks, tracksCollection(preview, null));
      setData(map, SRC.stationHandles, stationHandlesCollection(preview, rotating.id));
    });
    map.on('mouseup', (e) => {
      if (!rotating) return;
      const r = rotating;
      rotating = null;
      map.dragPan.enable();
      draw.setInteractionLocked(false);
      const state = useStore.getState();
      const next = rotated(activeScenario(state.project), r, e);
      const st = next.stations.find((x) => x.id === r.id);
      state.commitScenario(next, `Station rotated to ${Math.round(st?.layout?.bearingDeg ?? 0)}°`);
      state.select({ kind: 'station', id: r.id });
    });
    map.on('mouseenter', STATION_HANDLE_LAYER, () => {
      if (useStore.getState().tool === 'select') map.getCanvas().style.cursor = 'crosshair';
    });
    map.on('mouseleave', STATION_HANDLE_LAYER, () => {
      if (!rotating) map.getCanvas().style.cursor = '';
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
    if (tool !== 'draw_line' && map.getSource(SRC.guides)) setData(map, SRC.guides, EMPTY);
    const stops = tool === 'draw_line' && isStopLineMode(newLineMode);
    if (stops) {
      // Street lines are drawn stop by stop by the map click handler, not as a free polyline.
      if (draw.drawing.isDrawing()) draw.drawing.cancel();
      draw.setMode('select');
    } else if (tool === 'draw_line' || tool === 'region_split') draw.setMode('draw_line');
    else if (tool === 'draw_region' || tool === 'region_hole') draw.setMode('draw_polygon');
    else {
      if (draw.drawing.isDrawing()) draw.drawing.cancel();
      draw.setMode('select');
    }
    const placing = stops || tool === 'add_station' || tool === 'new_service' || tool === 'add_signal';
    draw.setInteractionLocked(placing);
    map.getCanvas().style.cursor = placing ? 'crosshair' : '';
  }, [tool, newLineMode]);

  // The stops placed so far for a new street line.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource(SRC.stopDraft)) return;
    setData(map, SRC.stopDraft, stopDraftCollection(stopDraft));
  }, [stopDraft, styleVersion]);

  // The curve editor belongs to the selected track.
  useEffect(() => {
    const ce = useStore.getState().curveEditor;
    if (ce && selection?.kind !== 'track') useStore.getState().setCurveEditor(null);
    else if (ce && selection?.kind === 'track' && selection.id !== ce.trackId)
      useStore.getState().setCurveEditor(null);
  }, [selection]);

  // --- Network overlays and draw features ---------------------------------------
  const selectedLineId =
    selection?.kind === 'line' ? selection.id : selection?.kind === 'segment' ? selection.lineId : null;
  const selectedStationId = selection?.kind === 'station' ? selection.id : null;
  const selectedSignalId = selection?.kind === 'signal' ? selection.id : null;
  const selectedTrackId = selection?.kind === 'track' ? selection.id : null;
  // Crossings between lines, for the map (the simulation computes its own).
  const conflicts = useMemo(() => findConflicts(scenario), [scenario]);
  const selectedNodeId = selection?.kind === 'node' ? selection.id : null;
  const selectedRegionId = selection?.kind === 'region' ? selection.id : null;
  useEffect(() => {
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!map || !draw || !map.getSource(SRC.segments)) return;
    // Other modes are drawn faded (and get no editing handles): the tab's mode is being edited.
    const segments = dimOtherModes(segmentsCollection(scenario, selectedLineId), scenario, newLineMode);
    const tracks = dimOtherModes(tracksCollection(scenario, selectedTrackId), scenario, newLineMode);
    setData(map, SRC.regions, regionsCollection(scenario, selectedRegionId));
    setData(map, SRC.regionLabels, regionLabelsCollection(scenario));
    setData(map, SRC.tracks, tracks);
    setData(
      map,
      SRC.trackNodes,
      dimOtherModes(trackNodesCollection(scenario, selectedNodeId), scenario, newLineMode),
    );
    setData(map, SRC.curveLabels, curveLabelsCollection(scenario, selectedTrackId));
    setData(map, SRC.segments, segments);
    const markers = findingsCollection(findings, scenario, markerVisibility, focusedFindingId);
    setData(map, SRC.findings, markers);
    setData(
      map,
      SRC.arrows,
      directionArrows(
        map,
        segments,
        tracks,
        scenario,
        markers.features.map((f) => (f.geometry as GeoJSON.Point).coordinates as LngLat),
      ),
    );
    setData(map, SRC.crossovers, crossoversCollection(scenario));
    setData(map, SRC.conflicts, conflictsCollection(scenario, conflicts));
    setData(map, SRC.walkingLinks, walkingLinksCollection(scenario));
    setData(map, SRC.routeStatus, routeStatusCollection(scenario));
    setData(map, SRC.closures, closuresCollection(scenario, closures));
    setData(map, SRC.signals, signalsCollection(scenario, simulationClock.timeS, selectedSignalId));
    setData(
      map,
      SRC.stations,
      dimOtherModes(stationsCollection(scenario, selectedStationId), scenario, newLineMode),
    );
    setData(
      map,
      SRC.platforms,
      dimOtherModes(platformsCollection(scenario, selectedStationId), scenario, newLineMode),
    );
    setData(map, SRC.stationHandles, stationHandlesCollection(scenario, selectedStationId));
    setData(map, SRC.catchments, layers.catchments ? catchmentsCollection(scenario) : EMPTY);
    reconcileDraw(draw, scenario, selectedLineId, selectedTrackId, selectedRegionId, newLineMode);
  }, [
    scenario,
    findings,
    markerVisibility,
    focusedFindingId,
    arrowZoom,
    selectedLineId,
    selectedTrackId,
    selectedNodeId,
    selectedRegionId,
    selectedStationId,
    selectedSignalId,
    styleVersion,
    layers.catchments,
    closures,
    newLineMode,
    conflicts,
  ]);

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
    const simOptions = simulationOptions(scenario, closures);
    let models: LineSimulationModel[] = buildScenarioModels(scenario, simOptions);
    let frame = 0;
    let lastDraw = 0;
    let lastSignals = 0;
    const render = () => {
      const t = simulationClock.tick();
      const now = performance.now();
      // Reduced motion: update in discrete steps every 2 s instead of continuous movement.
      if (!reducedMotion || now - lastDraw > 2000) {
        setData(map, SRC.vehicles, vehiclesCollection(models.flatMap((m) => vehicleStates(m, t))));
        lastDraw = now;
      }
      // Signal states change every few simulated seconds: refresh them a few times per second.
      if (scenario.trafficSignals.length && now - lastSignals > 300) {
        setData(map, SRC.signals, signalsCollection(scenario, t, null));
        lastSignals = now;
      }
      if (simulationClock.running) frame = requestAnimationFrame(render);
    };
    if (running) {
      simulationClock.start();
      frame = requestAnimationFrame(render);
    } else {
      simulationClock.pause();
      models = buildScenarioModels(scenario, simOptions);
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
  }, [running, scenario, reducedMotion, styleVersion, simulationEpoch, closures]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={container}
        className="h-full w-full"
        role="application"
        aria-label="Network map. Use the side panels or the Table view for keyboard editing."
        data-testid="map"
      />
      {mapRef.current && styleVersion > 0 && <CurveEditor map={mapRef.current} />}
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
          {isRailMode(newLineMode)
            ? 'Click to place a station with its tracks and platforms · drag it to move, drag the round handle to rotate · connect track to its ends · Esc to finish'
            : !scenario.lines.length
              ? 'Click on a track to add a stop · Esc to finish'
              : 'Click on a line to add a station · Esc to finish'}
        </p>
      )}
      {tool === 'draw_line' && (
        <p className="pointer-events-none absolute start-1/2 top-2 -translate-x-1/2 rounded bg-slate-900/85 px-3 py-1 text-sm text-white">
          {isRailMode(newLineMode)
            ? 'Click to place track points (curves at each point) · end on a track or track end to connect · Enter finishes this track and starts the next · Esc to stop drawing'
            : isStopLineMode(newLineMode)
              ? `Click the stops in the order they are served (${stopDraft.length} placed), at the kerb of the side the vehicle stops on · the line returns to the first stop · Esc, Enter or right-click finishes · Backspace removes the last stop`
              : 'Click to add vertices · Enter or double-click to finish · Esc to cancel'}
        </p>
      )}
      {(tool === 'draw_region' || tool === 'region_hole') && (
        <p className="pointer-events-none absolute start-1/2 top-2 -translate-x-1/2 rounded bg-slate-900/85 px-3 py-1 text-sm text-white">
          {tool === 'draw_region'
            ? 'Click the corners of the region'
            : 'Draw the hole inside the selected region'}{' '}
          · Enter or click the first point to finish · Esc to cancel
        </p>
      )}
      {tool === 'region_split' && (
        <p className="pointer-events-none absolute start-1/2 top-2 -translate-x-1/2 rounded bg-slate-900/85 px-3 py-1 text-sm text-white">
          Draw a line all the way across the selected region · Enter to finish · Esc to cancel
        </p>
      )}
      {tool === 'add_signal' && (
        <p className="pointer-events-none absolute start-1/2 top-2 -translate-x-1/2 rounded bg-slate-900/85 px-3 py-1 text-sm text-white">
          Click to place a traffic signal · Esc to finish
        </p>
      )}
      {tool === 'new_service' && (
        <p className="pointer-events-none absolute start-1/2 top-2 -translate-x-1/2 rounded bg-slate-900/85 px-3 py-1 text-sm text-white">
          Click stations in calling order ({serviceDraft.length} picked) · Enter to create the service · Esc
          to cancel
        </p>
      )}
    </div>
  );
}
