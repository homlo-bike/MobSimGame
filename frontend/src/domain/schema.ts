/**
 * Domain schema for MobSimGame projects.
 *
 * Coordinates are always GeoJSON order: [longitude, latitude] in WGS84 (EPSG:4326).
 * Distances are metres, speeds km/h, times seconds unless a field name says otherwise.
 *
 * Every schema here is the single source of truth for both runtime validation
 * (import, load, local storage) and the TypeScript types used in the app.
 */
import { z } from 'zod';

/**
 * Schema 3 separates physical track (scenario.trackNetwork) from services
 * (lines). Older, unpublished formats are not migrated (owner decision).
 */
export const SCHEMA_VERSION = 3;
export const SUPPORTED_SCHEMA_VERSIONS = [3] as const;

/** [longitude, latitude] with range checks. */
export const LngLatSchema = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .describe('[longitude, latitude] in WGS84');
export type LngLat = z.infer<typeof LngLatSchema>;

// ---------------------------------------------------------------------------
// Provenance, ranges and assumptions
// ---------------------------------------------------------------------------

export const DataStatusSchema = z.enum(['observed', 'modelled', 'assumed', 'calculated', 'demonstration']);
export type DataStatus = z.infer<typeof DataStatusSchema>;

export const ConfidenceSchema = z.enum(['high', 'medium', 'low', 'unknown']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ProvenanceSchema = z.object({
  provider: z.string(),
  dataset: z.string(),
  sourceUrl: z.string().nullable(),
  license: z.string(),
  attribution: z.string(),
  retrievedAt: z.string().nullable(),
  coverage: z.string(),
  datasetDate: z.string().nullable(),
  spatialResolution: z.string().nullable(),
  status: DataStatusSchema,
  limitations: z.array(z.string()),
  cacheExpiresAt: z.string().nullable(),
  confidence: ConfidenceSchema,
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const RangeSchema = z
  .object({ low: z.number(), central: z.number(), high: z.number() })
  .refine((r) => r.low <= r.central && r.central <= r.high, 'Range must satisfy low <= central <= high');
export type Range = z.infer<typeof RangeSchema>;

export const AssumptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  unit: z.string(),
  value: RangeSchema,
  status: z.enum(['documented_default', 'user_override', 'calibrated', 'demonstration']),
  source: z.string(),
  sourceDate: z.string().nullable(),
  notes: z.string().default(''),
  sensitivity: z.enum(['low', 'medium', 'high', 'unknown']).default('unknown'),
});
export type Assumption = z.infer<typeof AssumptionSchema>;

export const AssumptionSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  assumptions: z.array(AssumptionSchema),
});
export type AssumptionSet = z.infer<typeof AssumptionSetSchema>;

export const DatasetReferenceSchema = z.object({
  id: z.string(),
  provenance: ProvenanceSchema,
});
export type DatasetReference = z.infer<typeof DatasetReferenceSchema>;

// ---------------------------------------------------------------------------
// Network entities
// ---------------------------------------------------------------------------

export const TransportModeSchema = z.enum([
  'bus',
  'brt',
  'tram',
  'light_rail',
  'metro',
  'elevated_metro',
  'commuter_rail',
  'cycling',
  'pedestrian',
  'custom',
]);
export type TransportMode = z.infer<typeof TransportModeSchema>;

export const DirectionSchema = z.enum(['one_way', 'bidirectional']);
export type Direction = z.infer<typeof DirectionSchema>;

/** Vertical structure of a segment. "at_grade" is a surface alignment. */
export const StructureTypeSchema = z.enum([
  'at_grade',
  'underground',
  'elevated',
  'bridge',
  'tunnel',
  'cut_and_cover',
]);
export type StructureType = z.infer<typeof StructureTypeSchema>;

export const RightOfWaySchema = z.enum(['mixed_traffic', 'dedicated_lane', 'dedicated_track']);
export type RightOfWay = z.infer<typeof RightOfWaySchema>;

export const TrackCountSchema = z.enum(['single', 'double']);
export type TrackCount = z.infer<typeof TrackCountSchema>;

export const EndTypeSchema = z.enum(['terminal_station', 'reversing_siding', 'turnback', 'depot']);
export type EndType = z.infer<typeof EndTypeSchema>;

/**
 * A part of a line between two fractions of its length (0 = start, 1 = end).
 * Fractions instead of metres keep segments meaningful while vertices are edited.
 * Segments of a line always cover [0, 1] contiguously (enforced by geo/segments.ts).
 */
export const TrackSegmentSchema = z.object({
  id: z.string(),
  fromFraction: z.number().min(0).max(1),
  toFraction: z.number().min(0).max(1),
  structure: StructureTypeSchema,
  rightOfWay: RightOfWaySchema,
  tracks: TrackCountSchema,
  speedLimitKmh: z.number().positive().nullable().default(null),
  /** Portal or transition notes for structure changes. */
  notes: z.string().default(''),
  /**
   * Double track: swap which track carries which direction on this segment
   * (e.g. left-hand running through a flying junction). Single track: the
   * one-way service runs against the line's drawn direction here.
   */
  flipped: z.boolean().default(false),
});
export type TrackSegment = z.infer<typeof TrackSegmentSchema>;

export const ServicePatternSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['all_stops', 'express', 'custom']),
  /** Station ids served, in line order. Empty for all_stops means "every stop of the line". */
  servedStationIds: z.array(z.string()),
  peakHeadwayMin: z.number().positive(),
  offPeakHeadwayMin: z.number().positive(),
  serviceStart: z.string().regex(/^\d{2}:\d{2}$/),
  serviceEnd: z.string().regex(/^\d{2}:\d{2}$/),
});
export type ServicePattern = z.infer<typeof ServicePatternSchema>;

/** Vehicle categories; which ones a mode may use is defined in domain/vehicles.ts. */
export const VehicleCategorySchema = z.enum([
  'standard_bus',
  'articulated_bus',
  'double_articulated_bus',
  'double_decker_bus',
  'minibus',
  'trolleybus',
  'brt_standard_bus',
  'brt_articulated_bus',
  'brt_double_articulated_bus',
  'brt_trolleybus',
  'tram_single',
  'tram_articulated',
  'tram_coupled_set',
  'tram_low_floor',
  'tram_high_floor',
  'lrv_single',
  'lrv_coupled_consist',
  'lrv_custom',
  'metro_consist',
  'metro_automated',
  'light_metro',
  'metro_custom',
  'emu',
  'dmu',
  'locomotive_hauled',
  'commuter_train',
  'regional_train',
  'train_custom',
  'custom',
]);
export type VehicleCategory = z.infer<typeof VehicleCategorySchema>;

export const VehicleTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Primary mode; `compatibleModes` lists every service mode that may use the vehicle. */
  mode: TransportModeSchema,
  category: VehicleCategorySchema.default('custom'),
  compatibleModes: z.array(TransportModeSchema).default([]),
  /** Total passengers (seated + standing) at the planning load factor. */
  capacity: z.number().int().positive(),
  seatedCapacity: z.number().int().nonnegative().nullable().default(null),
  maxSpeedKmh: z.number().positive(),
  /** Length of one unit, metres. A consist of `unitsPerConsist` units is that many times longer. */
  lengthM: z.number().positive(),
  widthM: z.number().positive().nullable().default(null),
  unitsPerConsist: z.number().int().positive().default(1),
  accelerationMs2: z.number().positive().nullable().default(null),
  serviceBrakingMs2: z.number().positive().nullable().default(null),
  /** Smallest curve radius the vehicle can run through, metres (from the manufacturer). */
  minRadiusM: z.number().positive().nullable().default(null),
  maxGradePercent: z.number().positive().nullable().default(null),
  doorCount: z.number().int().positive().nullable().default(null),
  energy: z
    .enum([
      'electric_overhead',
      'electric_third_rail',
      'battery',
      'diesel',
      'hybrid',
      'gas',
      'hydrogen',
      'unknown',
    ])
    .default('unknown'),
  /** Platform types the vehicle can serve (free text such as "low-floor 30 cm"); empty = not specified. */
  compatiblePlatforms: z.array(z.string()).default([]),
  status: z.enum(['documented_default', 'user_override', 'demonstration']),
  source: z.string(),
  notes: z.string().default(''),
});
export type VehicleType = z.infer<typeof VehicleTypeSchema>;

export const LineTerminationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ends'), start: EndTypeSchema, end: EndTypeSchema }),
  /** Ring/circular line: the alignment closes on itself. */
  z.object({ kind: z.literal('ring') }),
  /** User-defined turning loop at one or both ends (geometry ends inside the loop). */
  z.object({ kind: z.literal('loop'), note: z.string().default('') }),
]);
export type LineTermination = z.infer<typeof LineTerminationSchema>;

/** Status of one street-routed leg between two consecutive waypoints. */
export const RouteLegSchema = z.object({
  /** routed: follows the street network; manual: the user accepts a sketched leg; unrouted: incomplete. */
  status: z.enum(['routed', 'manual', 'unrouted']),
  provider: z.string().nullable().default(null),
  routedAt: z.string().nullable().default(null),
  message: z.string().default(''),
  /** Leg geometry from its start to its end waypoint; a straight sketch unless routed. */
  geometry: z.array(LngLatSchema).default([]),
});
export type RouteLeg = z.infer<typeof RouteLegSchema>;

/** Free key/value metadata for user-defined fields (e.g. "owner", "built"). */
export const MetadataSchema = z.record(z.string(), z.string());
export type Metadata = z.infer<typeof MetadataSchema>;

/** Vertical level: 0 = ground, negative = below ground, positive = above ground. */
export const LevelSchema = z.number().int().min(-9).max(9);

export const TrackEndSchema = z.enum(['start', 'end']);
export type TrackEnd = z.infer<typeof TrackEndSchema>;

export const TrackEndRefSchema = z.object({ trackId: z.string(), end: TrackEndSchema });
export type TrackEndRef = z.infer<typeof TrackEndRefSchema>;

/** A permitted movement through a node between two track ends (both ways). */
export const MovementSchema = z.object({ a: TrackEndRefSchema, b: TrackEndRefSchema });
export type Movement = z.infer<typeof MovementSchema>;

/**
 * A point where track ends meet. Tracks are connected only through nodes and
 * only along permitted movements: two tracks that merely cross on the map are
 * not connected (bridges, tunnels, or a missing crossing).
 */
export const TrackNodeSchema = z.object({
  id: z.string(),
  position: LngLatSchema,
  level: LevelSchema.default(0),
  kind: z.enum(['connection', 'buffer_stop']).default('connection'),
  /** auto: movements follow the geometry (no reversing); manual: as listed. */
  movementMode: z.enum(['auto', 'manual']).default('auto'),
  movements: z.array(MovementSchema).default([]),
  metadata: MetadataSchema.default({}),
});
export type TrackNode = z.infer<typeof TrackNodeSchema>;

/** Running direction permitted on a track, relative to its from → to orientation. */
export const TrackDirectionSchema = z.enum(['both', 'forward', 'backward']);
export type TrackDirection = z.infer<typeof TrackDirectionSchema>;

/**
 * One physical track between two nodes. The editable horizontal alignment is a
 * polygon of points of intersection (PIs) with a radius at each interior PI;
 * lines and circular arcs are derived from it (geo/track/alignment.ts).
 */
export const PhysicalTrackSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  fromNodeId: z.string(),
  toNodeId: z.string(),
  /** Interior PIs, [lng, lat]; the ends are the node positions. */
  points: z.array(LngLatSchema).default([]),
  /** Radius in metres at each interior PI; null = no curve (a kink). */
  radii: z.array(z.number().positive().finite().nullable()).default([]),
  direction: TrackDirectionSchema.default('both'),
  structure: StructureTypeSchema,
  level: LevelSchema.default(0),
  rightOfWay: RightOfWaySchema,
  /** Mode whose design rules (minimum radius) apply. */
  designMode: TransportModeSchema,
  speedLimitKmh: z.number().positive().nullable().default(null),
  /** Double track: both tracks share a group. */
  groupId: z.string().nullable().default(null),
  origin: z
    .object({
      source: z.enum(['user', 'osm']),
      ref: z.string().nullable().default(null),
      edited: z.boolean().default(false),
    })
    .default({ source: 'user', ref: null, edited: false }),
  metadata: MetadataSchema.default({}),
  notes: z.string().default(''),
});
export type PhysicalTrack = z.infer<typeof PhysicalTrackSchema>;

/** Tracks laid together (members are the tracks whose `groupId` is this id). */
export const TrackGroupSchema = z.object({
  id: z.string(),
  kind: z.literal('double'),
  /** Distance between track centres, metres. */
  spacingM: z.number().positive(),
});
export type TrackGroup = z.infer<typeof TrackGroupSchema>;

/** A traversal of (part of) one track; fractions are in the track's own from → to orientation. */
export const TrackStepSchema = z.object({
  trackId: z.string(),
  reversed: z.boolean(),
  from: z.number().min(0).max(1),
  to: z.number().min(0).max(1),
});
export type TrackStep = z.infer<typeof TrackStepSchema>;

export const TrackNetworkSchema = z.object({
  /** Origin of the project metric frame (geo/track/projection.ts); set by the first track. */
  frameOrigin: LngLatSchema.nullable().default(null),
  nodes: z.array(TrackNodeSchema).default([]),
  tracks: z.array(PhysicalTrackSchema).default([]),
  groups: z.array(TrackGroupSchema).default([]),
  /** Default running side for new double track. */
  runningSide: z.enum(['right', 'left']).default('right'),
  /** User overrides of the parameters in domain/trackParameters.ts, by id. */
  parameterOverrides: z.record(z.string(), z.number()).default({}),
});
export type TrackNetwork = z.infer<typeof TrackNetworkSchema>;

export const EMPTY_TRACK_NETWORK: TrackNetwork = {
  frameOrigin: null,
  nodes: [],
  tracks: [],
  groups: [],
  runningSide: 'right',
  parameterOverrides: {},
};

/**
 * How a line's geometry is produced. `coordinates` always holds the resulting
 * geometry that every measurement uses; the alignment keeps what the user edits.
 */
export const AlignmentSchema = z.discriminatedUnion('kind', [
  /** Straight segments between the vertices in `coordinates` (cycling, walking, custom). */
  z.object({ kind: z.literal('polyline') }),
  /**
   * Track-guided service routed over the physical track network. `path` is the
   * outbound route from the first to the last stop; `returnPath` the way back
   * (on double track the other track). Geometry is derived from the tracks.
   */
  z.object({
    kind: z.literal('track'),
    path: z.array(TrackStepSchema),
    returnPath: z.array(TrackStepSchema).nullable().default(null),
    /** routed: a permitted path exists; unrouted: see `message`. */
    status: z.enum(['routed', 'unrouted']),
    message: z.string().default(''),
  }),
  /** Street-following route through waypoints; one leg per pair of consecutive waypoints. */
  z.object({
    kind: z.literal('routed'),
    waypoints: z.array(LngLatSchema),
    legs: z.array(RouteLegSchema),
    /** Return direction where one-way streets force a different path; null = same streets. */
    returnCoordinates: z.array(LngLatSchema).nullable().default(null),
  }),
]);
export type Alignment = z.infer<typeof AlignmentSchema>;

/** Where a line came from. Imported existing infrastructure is reported differently until edited. */
export const LineOriginSchema = z.object({
  source: z.enum(['user', 'osm']),
  /** e.g. "relation/123456" for OpenStreetMap. */
  ref: z.string().nullable().default(null),
  /** True once the user changed the geometry of an imported line. */
  edited: z.boolean().default(false),
  /** Free-text status shown in the inspector, e.g. "Under construction". */
  status: z.string().default(''),
});
export type LineOrigin = z.infer<typeof LineOriginSchema>;

/** A crossover just before or after a station (in line direction), used for turnbacks and single-track working. */
export const CrossoverSchema = z.object({
  id: z.string(),
  stationId: z.string(),
  side: z.enum(['before', 'after']),
});
export type Crossover = z.infer<typeof CrossoverSchema>;

export const LineStopSchema = z.object({
  stationId: z.string(),
});
export type LineStop = z.infer<typeof LineStopSchema>;

export const TransportLineSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  shortName: z.string().max(8),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  mode: TransportModeSchema,
  customModeLabel: z.string().default(''),
  systemId: z.string().nullable(),
  direction: DirectionSchema,
  runningSide: z.enum(['right', 'left']),
  /** Resulting geometry, [lng, lat]. For rings the first coordinate is NOT repeated. */
  coordinates: z.array(LngLatSchema),
  alignment: AlignmentSchema.default({ kind: 'polyline' }),
  origin: LineOriginSchema.default({ source: 'user', ref: null, edited: false, status: '' }),
  crossovers: z.array(CrossoverSchema).default([]),
  /** Transit signal priority at traffic signals (tram, bus, BRT). */
  transitSignalPriority: z.boolean().default(false),
  segments: z.array(TrackSegmentSchema),
  /** Stops in line order (ordering is re-derived from chainage by geo/stations.ts). */
  stops: z.array(LineStopSchema),
  termination: LineTerminationSchema,
  servicePatterns: z.array(ServicePatternSchema),
  vehicleTypeId: z.string().nullable(),
  /** Vehicles (consists) assigned to the line; null = not set (the simulation runs every scheduled trip). */
  fleetSize: z.number().int().nonnegative().nullable().default(null),
  /** Units coupled per consist on this line; null = the vehicle profile's value. */
  consistUnits: z.number().int().positive().nullable().default(null),
  dwellTimeS: z.number().nonnegative(),
  maxSpeedKmh: z.number().positive(),
  metadata: MetadataSchema.default({}),
  notes: z.string().default(''),
});
export type TransportLine = z.infer<typeof TransportLineSchema>;

export const StationSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** 'user' names are never overwritten by suggestions. */
  nameSource: z.enum(['user', 'suggestion', 'generated']),
  nameSuggestion: z
    .object({ name: z.string(), sourceFeature: z.string(), distanceM: z.number(), provider: z.string() })
    .nullable()
    .default(null),
  position: LngLatSchema,
  construction: z.enum(['surface', 'underground', 'elevated']),
  platformType: z.enum(['side', 'island', 'separate', 'unknown']),
  /** Negative = depth below ground, positive = height above ground, metres. */
  verticalOffsetM: z.number().nullable().default(null),
  entrances: z.array(z.object({ id: z.string(), position: LngLatSchema, label: z.string() })).default([]),
  accessibility: z
    .object({
      stepFree: z.boolean().nullable(),
      elevators: z.number().int().nonnegative().nullable(),
      tactilePaving: z.boolean().nullable(),
    })
    .default({ stepFree: null, elevators: null, tactilePaving: null }),
  catchmentRadiusM: z.number().positive(),
  /** Tracks this station serves (platform tracks), as fractions along each track. */
  trackRefs: z.array(z.object({ trackId: z.string(), fraction: z.number().min(0).max(1) })).default([]),
  metadata: MetadataSchema.default({}),
  notes: z.string().default(''),
  imageUrls: z.array(z.string().url()).default([]),
});
export type Station = z.infer<typeof StationSchema>;

export const PlatformSchema = z.object({
  id: z.string(),
  stationId: z.string(),
  lineIds: z.array(z.string()),
  type: z.enum(['side', 'island', 'separate']),
  lengthM: z.number().positive().nullable(),
});
export type Platform = z.infer<typeof PlatformSchema>;

/** Out-of-station interchange between distinct stations (in-station interchange is implicit). */
export const InterchangeSchema = z.object({
  id: z.string(),
  stationIds: z.array(z.string()).min(2),
  walkTimeMin: z.number().nonnegative().nullable(),
  notes: z.string().default(''),
});
export type Interchange = z.infer<typeof InterchangeSchema>;

export const DepotSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: LngLatSchema,
  lineIds: z.array(z.string()),
});
export type Depot = z.infer<typeof DepotSchema>;

/** Track shared between lines: references ranges of each member line, not copied geometry. */
export const SharedTrackSchema = z.object({
  id: z.string(),
  members: z.array(z.object({ lineId: z.string(), fromFraction: z.number(), toFraction: z.number() })).min(2),
  notes: z.string().default(''),
});
export type SharedTrack = z.infer<typeof SharedTrackSchema>;

export const TransportSystemSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  visible: z.boolean().default(true),
});
export type TransportSystem = z.infer<typeof TransportSystemSchema>;

/**
 * A road traffic signal that trams and buses must obey in the simulation.
 * Timings are assumptions (real signal plans are rarely published) and say so.
 */
export const TrafficSignalSchema = z.object({
  id: z.string(),
  position: LngLatSchema,
  /** e.g. "node/123" when imported from OpenStreetMap. */
  ref: z.string().nullable().default(null),
  cycleS: z.number().positive(),
  greenS: z.number().positive(),
  offsetS: z.number().nonnegative().default(0),
  timingStatus: z.enum(['documented_default', 'user_override', 'calibrated', 'demonstration']),
  kind: z
    .enum([
      'intersection',
      'pedestrian_crossing',
      'tram_crossing',
      'brt_crossing',
      'railway_crossing',
      'station_approach',
      'user_defined',
    ])
    .default('intersection'),
  /** Who the signal controls; empty = not specified (it then applies to every tram and bus line nearby). */
  controls: z.array(z.enum(['cars', 'buses', 'trams', 'bicycles', 'pedestrians'])).default([]),
  /** Transit priority at this signal; the per-line switch still decides who uses it. */
  priority: z.enum(['unknown', 'none', 'extend_green', 'early_green', 'pre_emption']).default('unknown'),
  /** A fixed approximate delay per passing vehicle instead of the simulated cycle, seconds. */
  approxDelayS: z.number().nonnegative().nullable().default(null),
  /** Attached to one line or track: applies only there (otherwise to nearby lines). */
  attachedTo: z
    .object({ kind: z.enum(['line', 'track']), id: z.string() })
    .nullable()
    .default(null),
  source: z.enum(['manual', 'osm']).default('osm'),
  retrievedAt: z.string().nullable().default(null),
  confidence: ConfidenceSchema.default('unknown'),
  /** Imported signals stay "imported" until the user confirms them. */
  confirmation: z.enum(['imported', 'confirmed']).default('imported'),
  label: z.string().default(''),
  metadata: MetadataSchema.default({}),
});
export type TrafficSignal = z.infer<typeof TrafficSignalSchema>;

/**
 * Assumed signal timings for the simulation. Real signal plans are rarely
 * published, so these are PLACEHOLDERS (uncited) until the user enters local values.
 */
export const SignalSettingsSchema = z.object({
  defaultCycleS: z.number().positive(),
  defaultGreenS: z.number().positive(),
  /** Seconds by which transit signal priority shortens a red wait or extends green. */
  priorityAdjustmentS: z.number().nonnegative(),
  status: z.enum(['documented_default', 'user_override', 'calibrated', 'demonstration']),
});
export type SignalSettings = z.infer<typeof SignalSettingsSchema>;

export const PLACEHOLDER_SIGNAL_SETTINGS: SignalSettings = {
  defaultCycleS: 90,
  defaultGreenS: 45,
  priorityAdjustmentS: 10,
  status: 'demonstration',
};

export const AnalysisResultSchema = z.object({
  id: z.string(),
  scenarioId: z.string(),
  subject: z.object({ kind: z.enum(['scenario', 'system', 'line', 'station', 'segment']), id: z.string() }),
  metric: z.string(),
  label: z.string(),
  unit: z.string(),
  value: RangeSchema,
  method: z.string(),
  formula: z.string(),
  assumptionIds: z.array(z.string()),
  provenance: ProvenanceSchema,
  computedAt: z.string(),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const ScenarioSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(''),
  systems: z.array(TransportSystemSchema),
  trackNetwork: TrackNetworkSchema.default(EMPTY_TRACK_NETWORK),
  lines: z.array(TransportLineSchema),
  stations: z.array(StationSchema),
  platforms: z.array(PlatformSchema).default([]),
  interchanges: z.array(InterchangeSchema).default([]),
  depots: z.array(DepotSchema).default([]),
  sharedTracks: z.array(SharedTrackSchema).default([]),
  trafficSignals: z.array(TrafficSignalSchema).default([]),
  signalSettings: SignalSettingsSchema.default(PLACEHOLDER_SIGNAL_SETTINGS),
  vehicleTypes: z.array(VehicleTypeSchema),
  assumptionSetId: z.string().nullable(),
  /** Manual corrections to the generated schematic, in schematic pixels per station id. */
  schematicOffsets: z.record(z.string(), z.object({ dx: z.number(), dy: z.number() })).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(''),
  metadata: MetadataSchema.default({}),
  /** True for synthetic/demonstration projects. Shown prominently in the UI. */
  fictional: z.boolean(),
  mapView: z.object({ center: LngLatSchema, zoom: z.number(), bearing: z.number(), pitch: z.number() }),
  scenarios: z.array(ScenarioSchema).min(1),
  activeScenarioId: z.string(),
  assumptionSets: z.array(AssumptionSetSchema),
  datasetReferences: z.array(DatasetReferenceSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** Validate unknown data as a project. Returns readable error messages instead of throwing. */
export function parseProject(
  data: unknown,
): { ok: true; project: Project } | { ok: false; errors: string[] } {
  if (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { schemaVersion?: unknown }).schemaVersion === 'number' &&
    (data as { schemaVersion: number }).schemaVersion < SCHEMA_VERSION
  )
    return {
      ok: false,
      errors: [
        `This project was saved in an older, unpublished format (schema ${(data as { schemaVersion: number }).schemaVersion}). ` +
          `It cannot be opened by this version (schema ${SCHEMA_VERSION}); please start a new project.`,
      ],
    };
  const result = ProjectSchema.safeParse(data);
  if (result.success) {
    const refErrors = checkReferences(result.data);
    if (refErrors.length) return { ok: false, errors: refErrors };
    return { ok: true, project: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

/** Referential integrity: stops must reference existing stations, etc. */
export function checkReferences(project: Project): string[] {
  const errors: string[] = [];
  if (!project.scenarios.some((s) => s.id === project.activeScenarioId)) {
    errors.push(`activeScenarioId "${project.activeScenarioId}" does not match a scenario`);
  }
  for (const s of project.scenarios) {
    const stationIds = new Set(s.stations.map((st) => st.id));
    const lineIds = new Set(s.lines.map((l) => l.id));
    for (const line of s.lines) {
      for (const stop of line.stops) {
        if (!stationIds.has(stop.stationId)) {
          errors.push(
            `Scenario "${s.name}", line "${line.name}": stop references missing station ${stop.stationId}`,
          );
        }
      }
    }
    const net = s.trackNetwork;
    const nodeIds = new Set(net.nodes.map((n) => n.id));
    const trackIds = new Set(net.tracks.map((t) => t.id));
    for (const t of net.tracks) {
      if (!nodeIds.has(t.fromNodeId) || !nodeIds.has(t.toNodeId))
        errors.push(`Scenario "${s.name}": track ${t.id} references a missing node`);
      if (t.radii.length !== t.points.length)
        errors.push(`Scenario "${s.name}": track ${t.id} needs one radius entry per point`);
    }
    const groupIds = new Set(net.groups.map((g) => g.id));
    for (const t of net.tracks)
      if (t.groupId && !groupIds.has(t.groupId))
        errors.push(`Scenario "${s.name}": track ${t.id} references missing group ${t.groupId}`);
    for (const st of s.stations)
      for (const r of st.trackRefs)
        if (!trackIds.has(r.trackId))
          errors.push(`Scenario "${s.name}": station "${st.name}" references missing track ${r.trackId}`);
    for (const st of s.sharedTracks) {
      for (const m of st.members) {
        if (!lineIds.has(m.lineId)) errors.push(`Shared track ${st.id} references missing line ${m.lineId}`);
      }
    }
  }
  return errors;
}
