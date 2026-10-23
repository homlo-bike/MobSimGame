import { modeSetting, setLineInherits } from '../domain/inheritance';
import { useMemo, useState } from 'react';
import { buildLineModel, roundTripS } from '../simulation/engine';
import { spareRatioOf } from '../domain/trackParameters';
import { bbox, lineString } from '@turf/turf';
import type {
  EndType,
  LineTermination,
  RightOfWay,
  Scenario,
  StructureType,
  TrackCount,
  TransportLine,
} from '../domain/schema';
import { MODES, RIGHT_OF_WAY_LABELS, STRUCTURE_LABELS } from '../domain/modes';
import {
  addExistingStationToLine,
  addStationAtChainage,
  detectSharedTracks,
  isRing,
  joinLines,
  lineLengthM,
  orderedStops,
  removeStopFromLine,
  reverseLineDirection,
  setLineAlignmentKind,
  toggleCrossover,
  splitLine,
  updateLine,
} from '../domain/network';
import { ALIGNMENT_LABELS, type AlignmentKind } from '../domain/alignment';
import { mergeWithNext, splitSegmentsAt, updateSegment } from '../geo/segments';
import { pathCoordinates } from '../geo/geometry';
import { formatDistance } from '../analysis/units';
import { useStore } from '../store/projectStore';
import { getMapInstance } from '../map/mapInstance';
import { Badge, Button, Checkbox, SelectField, Section } from './primitives';
import { DisruptionPanel } from './DisruptionPanel';
import { RoutePanel } from './RoutePanel';
import { wireSummary } from '../domain/overheadWire';
import { SIGNAL_MODES } from '../domain/signals';
import { CommitField } from './CommitField';
import { FindingsList } from './FindingsList';
import { validateLine } from '../validation/validate';
import { moveServiceStop, platformLabel, rerouteServices, setServiceStops } from '../domain/serviceRouting';
import { MetadataEditor } from './MetadataEditor';
import { deleteLineWithNotice } from '../store/trackActions';
import { describeDirection } from '../domain/direction';
import {
  compatibleVehicles,
  consistLengthM,
  usesVehicles,
  VEHICLE_CATEGORY_LABELS,
} from '../domain/vehicles';
import { lineFleet } from '../analysis/fleet';
import { LineEnergy } from './LineEnergy';

const END_LABELS: Record<EndType, string> = {
  terminal_station: 'Terminal station',
  reversing_siding: 'Reversing siding',
  turnback: 'Turnback',
  depot: 'Depot',
};

export function LineInspector({ line, scenario }: { line: TransportLine; scenario: Scenario }) {
  const commit = useStore((s) => s.commitScenario);
  const select = useStore((s) => s.select);
  const announce = useStore((s) => s.announce);
  const unitSystem = useStore((s) => s.unitSystem);
  const [joinTarget, setJoinTarget] = useState('');
  const total = lineLengthM(line);
  const stops = orderedStops(line, scenario.stations);
  const patch = (p: Partial<TransportLine>, label = 'Line updated') =>
    commit(updateLine(scenario, line.id, p), label);
  const pattern = line.servicePatterns[0]!;
  const patchPattern = (p: Partial<typeof pattern>) =>
    patch({ servicePatterns: [{ ...pattern, ...p }, ...line.servicePatterns.slice(1)] }, 'Service updated');
  const vehicle = scenario.vehicleTypes.find((v) => v.id === line.vehicleTypeId);
  const vehicleChoices = compatibleVehicles(scenario.vehicleTypes, line.mode);
  // Cycle time from one simulated round trip at the design headway (not limited by the fleet).
  const simulatedCycleMin = useMemo(() => {
    if (!usesVehicles(line.mode)) return undefined;
    const m = buildLineModel({ ...line, fleetSize: null }, scenario);
    return m ? roundTripS(m) / 60 : undefined;
  }, [line, scenario]);
  const fleet = usesVehicles(line.mode) ? lineFleet(line, scenario, { cycleMin: simulatedCycleMin }) : null;
  const consistLength = consistLengthM(line, vehicle);
  const onTracks = line.alignment.kind === 'track';
  const notServed = scenario.stations.filter(
    (s) => !line.stops.some((x) => x.stationId === s.id) && (!onTracks || s.trackRefs.length > 0),
  );
  const findings = validateLine(line, scenario);
  const byStation = new Map(scenario.stations.map((s) => [s.id, s]));
  const chainage = new Map(stops.map((s) => [s.station.id, s.chainageM]));
  // Track services keep the user's stop order (the route follows it).
  const stopList = onTracks
    ? line.stops
        .map((x) => byStation.get(x.stationId))
        .filter((st): st is NonNullable<typeof st> => !!st)
        .map((station) => ({ station, chainageM: chainage.get(station.id) ?? 0 }))
    : stops;
  const alignmentChoices = (Object.keys(ALIGNMENT_LABELS) as AlignmentKind[]).filter((k) => k !== 'track');

  const zoomTo = () => {
    const map = getMapInstance();
    const coords = pathCoordinates(line.coordinates, isRing(line));
    if (!map || coords.length < 2) return;
    const b = bbox(lineString(coords));
    map.fitBounds(
      [
        [b[0], b[1]],
        [b[2], b[3]],
      ],
      { padding: 60, maxZoom: 16 },
    );
  };

  const setTermination = (kind: LineTermination['kind']) => {
    if (kind === 'ends')
      patch({ termination: { kind: 'ends', start: 'terminal_station', end: 'terminal_station' } });
    else if (kind === 'ring') patch({ termination: { kind: 'ring' } });
    else patch({ termination: { kind: 'loop', note: '' } });
  };

  return (
    <div>
      <Section title="Line" id="line-inspector">
        <div className="mb-2 flex flex-wrap gap-1">
          <Button onClick={zoomTo}>Zoom to line</Button>
          <Button
            variant="danger"
            onClick={() => {
              deleteLineWithNotice(line.id);
              select(null);
            }}
          >
            Delete line
          </Button>
        </div>
        <CommitField
          label="Name"
          value={line.name}
          onCommit={(v) => (v.trim() ? patch({ name: v.trim() }) : 'Name is required')}
        />
        <CommitField
          label="Short name (≤ 8 characters)"
          value={line.shortName}
          onCommit={(v) => (v.length <= 8 ? patch({ shortName: v }) : 'At most 8 characters')}
        />
        <div className="mb-2">
          <label htmlFor="line-color" className="block text-xs font-medium text-slate-800">
            Colour
          </label>
          <input
            id="line-color"
            type="color"
            value={line.color}
            onChange={(e) => patch({ color: e.target.value }, 'Colour changed')}
            className="h-8 w-16 rounded border border-slate-500"
          />
        </div>
        {line.origin.source === 'osm' && (
          <p className="mb-2 text-xs text-slate-700">
            <Badge>{line.origin.edited ? 'Edited OSM line' : 'Existing (OpenStreetMap)'}</Badge>{' '}
            {line.origin.status && <strong>{line.origin.status}. </strong>}
            {line.origin.edited
              ? 'Findings apply in full because the geometry was changed.'
              : 'Findings are informational until you edit the geometry.'}
          </p>
        )}
        <p className="mb-2 text-sm">
          <span className="font-medium">Transport mode:</span> {MODES[line.mode].label}{' '}
          <span className="text-xs text-slate-600">
            (fixed: every mode has its own infrastructure, so a line cannot change mode)
          </span>
        </p>
        {onTracks ? (
          <p className="mb-2 text-xs text-slate-700">
            <Badge>Runs on tracks</Badge> The route follows the physical tracks between its stations, in stop
            order. Edit the tracks to change the geometry.
          </p>
        ) : (
          <SelectField
            label="Alignment"
            value={line.alignment.kind}
            onChange={(e) =>
              commit(
                setLineAlignmentKind(scenario, line.id, e.target.value as AlignmentKind),
                'Alignment changed',
              )
            }
            options={alignmentChoices.map((k) => ({ value: k, label: ALIGNMENT_LABELS[k] }))}
            hint={
              line.alignment.kind === 'routed'
                ? 'The route follows streets between the waypoints you place.'
                : 'Straight segments between the points you place.'
            }
          />
        )}
        {line.mode === 'custom' && (
          <CommitField
            label="Custom mode label"
            value={line.customModeLabel}
            onCommit={(v) => patch({ customModeLabel: v })}
          />
        )}
        <fieldset className="mb-2">
          <legend className="text-xs font-medium text-slate-800">Direction</legend>
          {(['bidirectional', 'one_way'] as const).map((d) => (
            <label key={d} className="me-3 inline-flex items-center gap-1 text-sm">
              <input
                type="radio"
                name={`dir-${line.id}`}
                checked={line.direction === d}
                onChange={() => patch({ direction: d }, 'Direction changed')}
              />
              {d === 'one_way' ? 'One-way (drawn direction)' : 'Both directions'}
            </label>
          ))}
          <p className="text-sm text-slate-800" data-testid="direction-description">
            {describeDirection(line, scenario)}
          </p>
          {onTracks ? (
            <>
              <p className="text-xs text-slate-600">
                With both directions the return trip is routed separately, so on double track it uses the
                other track.
              </p>
              <Button
                className="mt-1"
                disabled={line.stops.length < 2}
                onClick={() =>
                  commit(
                    setServiceStops(
                      scenario,
                      line.id,
                      [...line.stops].reverse().map((x) => x.stationId),
                    ),
                    'Service direction reversed',
                  )
                }
              >
                ⇄ Reverse stop order
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-slate-600">
                Each track carries one direction. With both directions, double-track segments get a parallel
                track for the return (arrows on the map show the direction of travel).
              </p>
              <Button
                className="mt-1"
                onClick={() => commit(reverseLineDirection(scenario, line.id), 'Line direction reversed')}
              >
                ⇄ Reverse drawn direction
              </Button>
            </>
          )}
        </fieldset>
        {!onTracks && (
          <SelectField
            label="Running side"
            value={line.runningSide}
            onChange={(e) => patch({ runningSide: e.target.value as 'left' | 'right' })}
            options={[
              { value: 'right', label: 'Right-hand running' },
              { value: 'left', label: 'Left-hand running' },
            ]}
          />
        )}
        <SelectField
          label="Line ends"
          value={line.termination.kind}
          onChange={(e) => setTermination(e.target.value as LineTermination['kind'])}
          options={[
            { value: 'ends', label: 'Two ends (terminal, siding, turnback or depot)' },
            { value: 'ring', label: 'Circular / ring line' },
            { value: 'loop', label: 'User-defined turning loop' },
          ]}
          hint="A line is complete only when it ends at terminal stations or closes as a loop or ring."
        />
        {line.termination.kind === 'ends' && (
          <div className="grid grid-cols-2 gap-2">
            {(['start', 'end'] as const).map((k) => (
              <SelectField
                key={k}
                label={k === 'start' ? 'Start configuration' : 'End configuration'}
                value={line.termination.kind === 'ends' ? line.termination[k] : 'terminal_station'}
                onChange={(e) =>
                  line.termination.kind === 'ends' &&
                  patch({ termination: { ...line.termination, [k]: e.target.value as EndType } })
                }
                options={Object.entries(END_LABELS).map(([value, label]) => ({ value, label }))}
              />
            ))}
          </div>
        )}
        <p className="text-sm text-slate-800">
          Length: <strong>{formatDistance(total, unitSystem)}</strong> · Stations:{' '}
          <strong>{stops.length}</strong>
        </p>
      </Section>

      <RoutePanel line={line} scenario={scenario} />
      <WirePanel line={line} scenario={scenario} />
      {line.alignment.kind === 'track' && (
        <Section title="Route over tracks" id="line-track-route">
          <p className="text-sm" data-testid="track-route-status">
            {line.alignment.status === 'routed' ? '✓ Routed over tracks' : '⛔ Not routed'}
            {line.alignment.status === 'routed' &&
              ` · ${line.alignment.path.length} track section(s)${line.alignment.returnPath ? ` out, ${line.alignment.returnPath.length} back` : ''}`}
          </p>
          {line.alignment.message && <p className="text-sm text-amber-900">{line.alignment.message}</p>}
          <Button
            className="mt-1"
            onClick={() => commit(rerouteServices(scenario, [line.id]), 'Service rerouted')}
          >
            Route again
          </Button>
        </Section>
      )}
      <Section title="Service (illustrative)" id="line-service">
        <div className="grid grid-cols-2 gap-2">
          <CommitField
            label="Peak headway"
            unit="min"
            type="number"
            min={0.5}
            max={240}
            step="any"
            value={pattern.peakHeadwayMin}
            onCommit={(v) => patchPattern({ peakHeadwayMin: Number(v) })}
          />
          <CommitField
            label="Off-peak headway"
            unit="min"
            type="number"
            min={0.5}
            max={240}
            step="any"
            value={pattern.offPeakHeadwayMin}
            onCommit={(v) => patchPattern({ offPeakHeadwayMin: Number(v) })}
          />
          <CommitField
            label="Service start"
            type="time"
            value={pattern.serviceStart}
            onCommit={(v) => (/^\d{2}:\d{2}$/.test(v) ? patchPattern({ serviceStart: v }) : 'Use HH:MM')}
          />
          <CommitField
            label="Service end"
            type="time"
            value={pattern.serviceEnd}
            onCommit={(v) => (/^\d{2}:\d{2}$/.test(v) ? patchPattern({ serviceEnd: v }) : 'Use HH:MM')}
          />
          {(
            [
              ['dwellTimeS', 'Dwell time per stop', 's', 0, 600],
              ['maxSpeedKmh', 'Maximum speed', 'km/h', 1, 400],
            ] as const
          ).map(([key, label, unit, min, max]) => (
            <div key={key}>
              <CommitField
                label={label}
                unit={unit}
                type="number"
                min={min}
                max={max}
                value={line[key]}
                // An entered value is the line's own (it no longer follows the project).
                onCommit={(v) =>
                  patch({ [key]: Number(v), inherits: line.inherits.filter((k) => k !== key) })
                }
              />
              <Checkbox
                label={`Project setting (${modeSetting(scenario, line.mode, key)} ${unit})`}
                checked={line.inherits.includes(key)}
                onChange={(v) =>
                  commit(
                    setLineInherits(scenario, line.id, key, v),
                    v ? `${label}: project setting` : `${label}: own value`,
                  )
                }
              />
            </div>
          ))}
        </div>
        {SIGNAL_MODES.includes(line.mode) && (
          <Checkbox
            label="Transit signal priority"
            checked={line.transitSignalPriority}
            onChange={(v) =>
              patch(
                { transitSignalPriority: v },
                v ? 'Signal priority switched on' : 'Signal priority switched off',
              )
            }
            hint={`At traffic signals green is extended or red shortened by up to ${scenario.signalSettings.priorityAdjustmentS} s (set under Traffic signals).`}
          />
        )}
        {usesVehicles(line.mode) && (
          <>
            <SelectField
              label="Vehicle type"
              value={line.vehicleTypeId ?? ''}
              onChange={(e) => patch({ vehicleTypeId: e.target.value || null })}
              options={[
                { value: '', label: 'None selected' },
                ...vehicleChoices.map((v) => ({
                  value: v.id,
                  label: `${v.name} · ${VEHICLE_CATEGORY_LABELS[v.category]} · ${v.capacity} pax`,
                })),
              ]}
              hint={
                vehicle
                  ? `${vehicle.status === 'demonstration' ? 'Placeholder profile. ' : ''}${vehicle.source}`
                  : vehicleChoices.length
                    ? 'Capacity results need a vehicle type.'
                    : `No ${MODES[line.mode].label.toLowerCase()} vehicle profile yet: add one under Vehicle profiles.`
              }
            />
            {vehicleChoices.some((v) => v.id !== line.vehicleTypeId) && (
              <fieldset className="mb-2" data-testid="accepted-types">
                <legend className="text-xs font-medium">
                  Also accepts (surplus vehicles of these types can fill a place)
                </legend>
                {vehicleChoices
                  .filter((v) => v.id !== line.vehicleTypeId)
                  .map((v) => (
                    <Checkbox
                      key={v.id}
                      label={`${v.name} · ${v.capacity} pax`}
                      checked={line.acceptedVehicleTypeIds.includes(v.id)}
                      onChange={(on) =>
                        patch(
                          {
                            acceptedVehicleTypeIds: on
                              ? [...line.acceptedVehicleTypeIds, v.id]
                              : line.acceptedVehicleTypeIds.filter((x) => x !== v.id),
                          },
                          on ? `${line.name} accepts ${v.name}` : `${line.name} no longer accepts ${v.name}`,
                        )
                      }
                    />
                  ))}
                <p className="text-xs text-slate-600">
                  The main type above sets how many vehicles the line needs; capacity and drawing follow each
                  vehicle's own type.
                </p>
              </fieldset>
            )}
            <div className="grid grid-cols-2 gap-2">
              <CommitField
                label="Units per consist"
                unit={vehicle ? `profile: ${vehicle.unitsPerConsist}` : undefined}
                type="number"
                min={1}
                max={20}
                step={1}
                value={line.consistUnits}
                onCommit={(v) =>
                  v === '' || Number.isInteger(Number(v))
                    ? patch({ consistUnits: v === '' ? null : Number(v) }, 'Consist changed')
                    : 'Whole numbers only'
                }
              />
              <CommitField
                label="Vehicles in service at the peak"
                unit={fleet ? `empty = calculated (${fleet.peakRequired})` : 'empty = calculated'}
                type="number"
                min={0}
                max={10000}
                step={1}
                value={line.fleetSize}
                onCommit={(v) =>
                  v === '' || Number.isInteger(Number(v))
                    ? patch({ fleetSize: v === '' ? null : Number(v) }, 'Fleet changed')
                    : 'Whole numbers only'
                }
              />
              <CommitField
                label="Expected peak demand"
                unit="passengers/hour/direction at the busiest point"
                type="number"
                min={0}
                max={200000}
                step={1}
                value={line.peakDemandPphpd}
                onCommit={(v) =>
                  v === '' || Number(v) >= 0
                    ? patch({ peakDemandPphpd: v === '' ? null : Number(v) }, 'Expected demand changed')
                    : 'Zero or more'
                }
                hint="Your estimate until the ridership estimate is available; it sizes the fleet with the vehicle capacity."
              />
              <CommitField
                label="Expected off-peak demand"
                unit="passengers/hour/direction at the busiest point"
                type="number"
                min={0}
                max={200000}
                step={1}
                value={line.offPeakDemandPphpd}
                onCommit={(v) =>
                  v === '' || Number(v) >= 0
                    ? patch({ offPeakDemandPphpd: v === '' ? null : Number(v) }, 'Expected demand changed')
                    : 'Zero or more'
                }
                hint="Used for how full vehicles are outside the peak periods (vehicle info window)."
              />
            </div>
            {fleet && (
              <div className="text-sm text-slate-800" data-testid="fleet-summary">
                <p>
                  Calculated: <strong>{fleet.peakRequired}</strong> vehicle(s) in service at the peak +{' '}
                  {fleet.spares} spare = {fleet.peakRequired + fleet.spares} ({fleet.offPeakRequired}{' '}
                  off-peak).
                  {line.fleetSize !== null && line.fleetSize !== fleet.peakRequired && (
                    <Button
                      variant="ghost"
                      className="ms-1"
                      onClick={() => patch({ fleetSize: null }, 'Fleet follows the calculation')}
                    >
                      Use calculated
                    </Button>
                  )}
                </p>
                <ul className="list-disc ps-5 text-xs text-slate-700">
                  <li>
                    Round trip {Math.round(fleet.cycleMin)} min (
                    {fleet.cycleSource === 'simulation' ? 'simulated' : 'estimate with placeholder speeds'}
                    ).
                  </li>
                  <li>
                    Headway {fleet.designHeadwayMin.toFixed(1)} min
                    {fleet.demandHeadwayMin !== null && fleet.demandHeadwayMin < fleet.policyHeadwayMin
                      ? ` for the expected demand (timetable ${fleet.policyHeadwayMin} min)`
                      : ' from the timetable'}
                    : vehicles = ⌈round trip / headway⌉; spares{' '}
                    {Math.round(spareRatioOf(scenario.trackNetwork, line.mode).value * 100)}% (Project
                    preferences → Modes).
                  </li>
                  {fleet.demandHeadwayMin === null && (
                    <li>Enter the expected peak demand to size the fleet for it.</li>
                  )}
                  {line.fleetSize !== null && (
                    <li>
                      With {line.fleetSize} vehicle(s) the line runs every{' '}
                      {fleet.effectiveHeadwayMin.toFixed(1)} min.
                    </li>
                  )}
                  {consistLength !== null && <li>Consist length {consistLength} m.</li>}
                  {fleet.peakCapacityPphpd !== null && (
                    <li>
                      Capacity {Math.round(fleet.peakCapacityPphpd).toLocaleString()}{' '}
                      passengers/hour/direction
                      {fleet.loadRatio !== null && ` · expected load ${Math.round(fleet.loadRatio * 100)} %`}.
                    </li>
                  )}
                </ul>
                {fleet.shortfall > 0 && (
                  <strong className="block text-red-900">
                    ⛔ {fleet.shortfall} vehicle(s) short: the line runs every{' '}
                    {fleet.effectiveHeadwayMin.toFixed(1)} min instead of {fleet.designHeadwayMin.toFixed(1)}.
                  </strong>
                )}
                {fleet.loadRatio !== null && fleet.loadRatio > 1 && (
                  <strong className="block text-amber-900">
                    ⚠ The expected demand exceeds the capacity offered: more vehicles, longer consists or a
                    larger vehicle.
                  </strong>
                )}
              </div>
            )}
            <LineEnergy line={line} scenario={scenario} />
          </>
        )}
      </Section>

      {onTracks ? (
        <Section title={`Sections (${line.segments.length})`} id="line-segments">
          <p className="mb-1 text-xs text-slate-600">
            Structure, right of way and track count come from the tracks the service uses. Select a track on
            the map to change them.
          </p>
          <ol className="space-y-0.5 text-sm">
            {line.segments.map((seg, i) => (
              <li key={seg.id}>
                {i + 1}. {formatDistance(seg.fromFraction * total, unitSystem)} –{' '}
                {formatDistance(seg.toFraction * total, unitSystem)}: {STRUCTURE_LABELS[seg.structure]},{' '}
                {RIGHT_OF_WAY_LABELS[seg.rightOfWay].toLowerCase()},{' '}
                {seg.tracks === 'double' ? 'double' : 'single'} track
              </li>
            ))}
          </ol>
        </Section>
      ) : (
        <Section title={`Segments (${line.segments.length})`} id="line-segments">
          <p className="mb-1 text-xs text-slate-600">
            Each segment sets the structure, right of way and track count for part of the line. Map pattern:
            solid = surface, dashed = underground/tunnel, dotted = elevated, long dash = bridge.
          </p>
          <ol className="space-y-2">
            {line.segments.map((seg, i) => (
              <li key={seg.id} className="rounded border border-slate-300 p-2">
                <p className="text-xs font-semibold text-slate-800">
                  Segment {i + 1}: {formatDistance(seg.fromFraction * total, unitSystem)} –{' '}
                  {formatDistance(seg.toFraction * total, unitSystem)}
                </p>
                <div className="grid grid-cols-3 gap-1">
                  <SelectField
                    label="Structure"
                    value={seg.structure}
                    onChange={(e) =>
                      patch(
                        {
                          segments: updateSegment(line.segments, seg.id, {
                            structure: e.target.value as StructureType,
                          }),
                        },
                        'Segment structure changed',
                      )
                    }
                    options={Object.entries(STRUCTURE_LABELS).map(([value, label]) => ({ value, label }))}
                  />
                  <SelectField
                    label="Right of way"
                    value={seg.rightOfWay}
                    onChange={(e) =>
                      patch({
                        segments: updateSegment(line.segments, seg.id, {
                          rightOfWay: e.target.value as RightOfWay,
                        }),
                      })
                    }
                    options={Object.entries(RIGHT_OF_WAY_LABELS).map(([value, label]) => ({ value, label }))}
                  />
                  <SelectField
                    label="Tracks / lanes"
                    value={seg.tracks}
                    onChange={(e) =>
                      patch({
                        segments: updateSegment(line.segments, seg.id, {
                          tracks: e.target.value as TrackCount,
                        }),
                      })
                    }
                    options={[
                      { value: 'double', label: 'Double' },
                      { value: 'single', label: 'Single' },
                    ]}
                  />
                </div>
                {seg.tracks === 'double' && line.direction === 'bidirectional' && (
                  <Checkbox
                    label="Swap track sides on this segment"
                    hint={`Trains run on the ${
                      (line.runningSide === 'right') !== seg.flipped ? 'right' : 'left'
                    } here (e.g. through a flying junction).`}
                    checked={seg.flipped}
                    onChange={(v) =>
                      patch(
                        { segments: updateSegment(line.segments, seg.id, { flipped: v }) },
                        v ? 'Track sides swapped on segment' : 'Track sides restored on segment',
                      )
                    }
                  />
                )}
                <CommitField
                  label="Speed limit"
                  unit="km/h, empty = line maximum"
                  type="number"
                  min={1}
                  max={400}
                  value={seg.speedLimitKmh}
                  onCommit={(v) =>
                    patch({
                      segments: updateSegment(line.segments, seg.id, {
                        speedLimitKmh: v === '' ? null : Number(v),
                      }),
                    })
                  }
                />
                <CommitField
                  label="Notes (portal, ramp, transition)"
                  value={seg.notes}
                  onCommit={(v) => patch({ segments: updateSegment(line.segments, seg.id, { notes: v }) })}
                />
                <div className="flex flex-wrap gap-1">
                  <Button
                    onClick={() =>
                      patch(
                        { segments: splitSegmentsAt(line.segments, (seg.fromFraction + seg.toFraction) / 2) },
                        'Segment split',
                      )
                    }
                  >
                    Split in half
                  </Button>
                  {i < line.segments.length - 1 && (
                    <Button
                      onClick={() =>
                        patch({ segments: mergeWithNext(line.segments, seg.id) }, 'Segments merged')
                      }
                    >
                      Merge with next
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <CommitField
            label="Split a segment at chainage"
            unit="m from line start"
            type="number"
            min={0}
            max={Math.floor(total)}
            value={null}
            onCommit={(v) => {
              const f = Number(v) / total;
              if (!(f > 0 && f < 1)) return 'Chainage must be inside the line';
              patch({ segments: splitSegmentsAt(line.segments, f) }, 'Segment split');
            }}
          />
        </Section>
      )}

      <Section title={`Stations on this line (${stopList.length})`} id="line-stops">
        {onTracks && (
          <p className="mb-1 text-xs text-slate-600">
            The service calls at the stations in this order; ▲ ▼ change the order and the route follows.
          </p>
        )}
        <ol className="mb-2 space-y-0.5 text-sm">
          {stopList.map((s, i) => (
            <li key={s.station.id} className="flex items-center gap-1">
              <button
                type="button"
                className="flex-1 text-start underline"
                onClick={() => select({ kind: 'station', id: s.station.id })}
              >
                {i + 1}. {s.station.name}
              </button>
              <span className="text-xs text-slate-600">{formatDistance(s.chainageM, unitSystem)}</span>
              {onTracks && s.station.trackRefs.length > 1 && (
                <select
                  aria-label={`Platform at ${s.station.name}`}
                  className="max-w-28 rounded border border-slate-300 text-xs"
                  value={line.stops.find((x) => x.stationId === s.station.id)?.trackId ?? ''}
                  onChange={(e) =>
                    commit(
                      setServiceStops(
                        scenario,
                        line.id,
                        line.stops.map((x) =>
                          x.stationId === s.station.id ? { ...x, trackId: e.target.value || null } : x,
                        ),
                      ),
                      'Platform changed',
                    )
                  }
                >
                  <option value="">Any platform</option>
                  {s.station.trackRefs.map((r) => (
                    <option key={r.trackId} value={r.trackId}>
                      {platformLabel(scenario, r.trackId)}
                    </option>
                  ))}
                </select>
              )}
              {onTracks &&
                ([-1, 1] as const).map((d) => (
                  <Button
                    key={d}
                    variant="ghost"
                    disabled={d === -1 ? i === 0 : i === stopList.length - 1}
                    aria-label={`Move ${s.station.name} ${d === -1 ? 'earlier' : 'later'}`}
                    onClick={() =>
                      commit(moveServiceStop(scenario, line.id, s.station.id, d), 'Stop order changed')
                    }
                  >
                    {d === -1 ? '▲' : '▼'}
                  </Button>
                ))}
              {MODES[line.mode].guided &&
                (['before', 'after'] as const).map((side) => {
                  const on = line.crossovers.some((c) => c.stationId === s.station.id && c.side === side);
                  return (
                    <button
                      key={side}
                      type="button"
                      aria-pressed={on}
                      title={`Crossover ${side} ${s.station.name}: trains can change track and turn back here`}
                      aria-label={`Crossover ${side} ${s.station.name}`}
                      onClick={() =>
                        commit(
                          toggleCrossover(scenario, line.id, s.station.id, side),
                          on
                            ? `Crossover ${side} ${s.station.name} removed`
                            : `Crossover ${side} ${s.station.name} added`,
                        )
                      }
                      className={`rounded border px-1 text-xs ${
                        on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600'
                      }`}
                    >
                      {side === 'before' ? '×◂' : '▸×'}
                    </button>
                  );
                })}
              <Button
                variant="ghost"
                aria-label={`Remove ${s.station.name} from ${line.name}`}
                onClick={() =>
                  commit(
                    onTracks
                      ? setServiceStops(
                          removeStopFromLine(scenario, line.id, s.station.id),
                          line.id,
                          line.stops.filter((x) => x.stationId !== s.station.id),
                        )
                      : removeStopFromLine(scenario, line.id, s.station.id),
                    'Stop removed',
                  )
                }
              >
                ✕
              </Button>
            </li>
          ))}
        </ol>
        {MODES[line.mode].guided && (
          <p className="mb-1 text-xs text-slate-600">
            ×◂ / ▸× add a crossover before or after a station (in drawn direction). Trains use them to change
            track and turn back when a section is closed.
          </p>
        )}
        {!onTracks && (
          <CommitField
            label="Add a station at chainage"
            unit="m from line start"
            type="number"
            min={0}
            max={Math.floor(total)}
            value={null}
            onCommit={(v) => {
              const res = addStationAtChainage(scenario, line.id, Number(v));
              if (res.error) return res.error;
              commit(res.scenario, res.reused ? 'Existing station shared' : 'Station added');
            }}
          />
        )}
        {onTracks && !notServed.length && (
          <p className="text-xs text-slate-600">Place stations on tracks to add them to this service.</p>
        )}
        {notServed.length > 0 && (
          <SelectField
            label={
              onTracks
                ? 'Add a station (at the end of the service)'
                : 'Add an existing station (shared / interchange)'
            }
            value=""
            onChange={(e) =>
              e.target.value &&
              commit(
                onTracks
                  ? setServiceStops(scenario, line.id, [
                      ...line.stops.map((x) => x.stationId),
                      e.target.value,
                    ])
                  : addExistingStationToLine(scenario, line.id, e.target.value),
                'Station added to the service',
              )
            }
            options={[
              { value: '', label: 'Choose a station…' },
              ...notServed.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        )}
      </Section>

      <Section title="Details" id="line-metadata">
        <MetadataEditor
          value={line.metadata}
          onChange={(metadata) => patch({ metadata }, 'Line details changed')}
          idPrefix={`line-${line.id}`}
        />
      </Section>
      {!onTracks && (
        <Section title="Edit operations" id="line-ops">
          {!isRing(line) && (
            <CommitField
              label="Split line at chainage"
              unit="m"
              type="number"
              min={1}
              max={Math.floor(total) - 1}
              value={null}
              onCommit={(v) => {
                const f = Number(v) / total;
                if (!(f > 0.01 && f < 0.99)) return 'Choose a point inside the line';
                commit(splitLine(scenario, line.id, f), 'Line split into two');
              }}
            />
          )}
          {scenario.lines.length > 1 && !isRing(line) && (
            <div className="flex items-end gap-1">
              <div className="flex-1">
                <SelectField
                  label="Join with line"
                  value={joinTarget}
                  onChange={(e) => setJoinTarget(e.target.value)}
                  options={[
                    { value: '', label: 'Choose…' },
                    ...scenario.lines
                      .filter((l) => l.id !== line.id && !isRing(l))
                      .map((l) => ({ value: l.id, label: l.name })),
                  ]}
                />
              </div>
              <Button
                className="mb-2"
                disabled={!joinTarget}
                onClick={() => {
                  const res = joinLines(scenario, line.id, joinTarget);
                  if (res.error) announce(res.error);
                  else commit(res.scenario, 'Lines joined');
                  setJoinTarget('');
                }}
              >
                Join
              </Button>
            </div>
          )}
          <Button
            onClick={() => {
              const shared = detectSharedTracks(scenario);
              commit(
                { ...scenario, sharedTracks: shared },
                `${shared.length} shared track section(s) recorded`,
              );
            }}
          >
            Detect shared track
          </Button>
          {scenario.sharedTracks.some((st) => st.members.some((m) => m.lineId === line.id)) && (
            <p className="mt-1 text-sm">
              <Badge>Shared track</Badge> This line shares track with{' '}
              {scenario.sharedTracks
                .filter((st) => st.members.some((m) => m.lineId === line.id))
                .flatMap((st) =>
                  st.members
                    .filter((m) => m.lineId !== line.id)
                    .map((m) => scenario.lines.find((l) => l.id === m.lineId)?.name),
                )
                .join(', ')}
              .
            </p>
          )}
        </Section>
      )}
      <DisruptionPanel line={line} scenario={scenario} />
      <Section title="Validation" id="line-findings">
        <FindingsList findings={findings} />
      </Section>
    </div>
  );
}

/** Overhead wire of a trolleybus line: it follows the route, shared with other trolleybus lines. */
function WirePanel({ line, scenario }: { line: TransportLine; scenario: Scenario }) {
  const unitSystem = useStore((s) => s.unitSystem);
  const w = wireSummary(scenario, line);
  if (!w) return null;
  const name = (id: string) => scenario.lines.find((l) => l.id === id)?.name ?? id;
  const overhead = w.railCrossings.filter((x) => x.overhead).length;
  return (
    <Section title="Overhead wire" id="line-wire">
      <p className="text-sm">
        Wire along the whole route: <strong>{formatDistance(w.lengthM, unitSystem)}</strong>
      </p>
      {w.sharedWith.length > 0 && (
        <ul className="mt-1 list-disc ps-5 text-sm" aria-label="Wire shared with">
          {w.sharedWith.map((s) => (
            <li key={s.lineId}>
              Shared with {name(s.lineId)} over {formatDistance(s.lengthM, unitSystem)}
            </li>
          ))}
        </ul>
      )}
      {w.railCrossings.length > 0 && (
        <p className="mt-1 text-sm">
          {overhead > 0 && <>⚠ Crosses {overhead} rail overhead line(s) on the same level. </>}
          {w.railCrossings.length - overhead > 0 && (
            <>Crosses {w.railCrossings.length - overhead} track(s) whose electrification is not specified.</>
          )}{' '}
          See the findings below.
        </p>
      )}
    </Section>
  );
}
