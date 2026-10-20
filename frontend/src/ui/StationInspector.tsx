import { useEffect, useRef, useState } from 'react';
import type { Scenario, Station, TransportLine } from '../domain/schema';
import {
  addExistingStationToLine,
  applyNameSuggestion,
  deleteStation,
  isInterchange,
  linesServingStation,
  removeStopFromLine,
  renameStation,
  updateStation,
} from '../domain/network';
import { useStore } from '../store/projectStore';
import { backendProviders, mockProviders } from '../providers/registry';
import { resolvedName, type NameSuggestion } from '../names/suggest';
import { lookupStationNames } from '../names/lookup';
import { Badge, Button, Checkbox, SelectField, Section } from './primitives';
import { CommitField } from './CommitField';
import { getMapInstance } from '../map/mapInstance';
import { createLogger } from '../util/logger';
import {
  rerouteServices,
  setServiceStops,
  setStationTrack,
  stationLevel,
  suggestStationTracks,
} from '../domain/serviceRouting';
import { parameterValue } from '../domain/trackParameters';
import { MetadataEditor } from './MetadataEditor';
import { StationLayoutSection } from './StationLayoutSection';
import { WalkingLinksSection } from './WalkingLinksSection';
import {
  deleteStationObject,
  STATION_LEVELS,
  stationLevelLabel,
  stationObjectLevel,
  updateStationLayout,
} from '../domain/stationLayout';
import { BUS_STOP_TYPE_LABELS, stationKind, type StationKind } from '../domain/stationKinds';

const KIND_LABELS: Record<StationKind, string> = {
  rail: 'Rail station',
  bus: 'Bus stop',
  mixed: 'Rail station and bus stop',
  other: 'Stop',
  orphan: 'Not served by any line',
};

const log = createLogger('station-inspector');

export function StationInspector({ station, scenario }: { station: Station; scenario: Scenario }) {
  const commit = useStore((s) => s.commitScenario);
  const select = useStore((s) => s.select);
  const fictional = useStore((s) => s.project.fictional);
  const [suggestions, setSuggestions] = useState<NameSuggestion[] | null>(null);
  const [suggestStatus, setSuggestStatus] = useState('');
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle');
  const lines = linesServingStation(scenario, station.id);
  const kind = stationKind(scenario, station);
  const otherLines = scenario.lines.filter((l) => !lines.includes(l));
  const patch = (p: Partial<Station>, label = 'Station updated') =>
    commit(updateStation(scenario, station.id, p), label);

  // Cancel a running lookup when the inspector closes or shows another station.
  const lookup = useRef<AbortController | null>(null);
  useEffect(() => () => lookup.current?.abort(), []);

  const suggest = async () => {
    lookup.current?.abort();
    const ctrl = new AbortController();
    lookup.current = ctrl;
    setLookupState('loading');
    setSuggestStatus('Looking up nearby features…');
    const provider = fictional ? mockProviders.osm : backendProviders.osm;
    // The application language first (OSM name:<lang>), then the local name.
    const language = (document.documentElement.lang || navigator.language || 'en').split('-')[0];
    const outcome = await lookupStationNames(station.position, provider, { language, signal: ctrl.signal });
    if (outcome.status === 'cancelled' || ctrl.signal.aborted) return;
    if (outcome.status === 'error' || outcome.status === 'timeout')
      log.warn('station name lookup failed', { status: outcome.status });
    setSuggestions(outcome.suggestions);
    setSuggestStatus([outcome.message, outcome.attribution].filter(Boolean).join(' '));
    setLookupState(outcome.status === 'ok' ? 'idle' : outcome.status === 'empty' ? 'empty' : 'error');
  };

  return (
    <div>
      <Section title="Station" id="station-inspector">
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <Badge tone={kind === 'orphan' ? 'warn' : 'neutral'}>{KIND_LABELS[kind]}</Badge>
          {isInterchange(scenario, station.id) && <Badge>Interchange ({lines.length} lines)</Badge>}
          <Badge tone={station.nameSource === 'user' ? 'ok' : 'neutral'}>
            Name:{' '}
            {station.nameSource === 'user'
              ? 'user-edited (protected)'
              : station.nameSource === 'suggestion'
                ? 'accepted suggestion'
                : 'generated'}
          </Badge>
        </div>
        <CommitField
          label="Name"
          value={station.name}
          onCommit={(v) => {
            if (!v.trim()) return 'Name is required';
            commit(renameStation(scenario, station.id, v), 'Station renamed');
          }}
          hint="Names you type are never replaced by suggestions."
        />
        <Button onClick={suggest} disabled={lookupState === 'loading'}>
          {lookupState === 'loading'
            ? 'Looking up…'
            : lookupState === 'error'
              ? 'Try again'
              : 'Suggest names from nearby features'}
        </Button>
        <p
          className={`mt-1 text-xs ${lookupState === 'error' ? 'font-medium text-red-800' : 'text-slate-600'}`}
          aria-live="polite"
          data-testid="name-lookup-status"
        >
          {lookupState === 'error' && '⛔ '}
          {suggestStatus}
        </p>
        {suggestions && (
          <ul className="mt-1 space-y-1 text-sm" aria-label="Name suggestions">
            {suggestions.slice(0, 8).map((s) => {
              const finalName = resolvedName(scenario, s, station.id);
              return (
                <li
                  key={s.name}
                  className={`rounded border p-1 ${s.coordinateFallback ? 'border-dashed border-slate-400' : 'border-slate-300'}`}
                >
                  <strong>{s.name}</strong>
                  {s.coordinateFallback && <Badge tone="warn">Last resort</Badge>}
                  <span className="block text-xs text-slate-600">
                    {s.coordinateFallback
                      ? s.sourceFeature
                      : `Source: ${s.sourceFeature} · ${s.distanceM} m away · ${s.provider}`}
                  </span>
                  {finalName !== s.name && (
                    <span className="block text-xs text-amber-900">
                      Already used in this project: saved as “{finalName}”.
                    </span>
                  )}
                  <div className="mt-1 flex gap-1">
                    <Button
                      onClick={() => {
                        if (station.nameSource === 'user') {
                          // An explicit accept by the user is itself a user decision.
                          commit(renameStation(scenario, station.id, finalName), 'Suggestion accepted');
                        } else {
                          commit(
                            applyNameSuggestion(scenario, station.id, s, s.qualifier),
                            'Suggestion accepted',
                          );
                        }
                        setSuggestions(null);
                      }}
                    >
                      Accept
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setSuggestions(suggestions.filter((x) => x !== s))}
                    >
                      Reject
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-700">
          Position [lon, lat]: {station.position[0].toFixed(6)}, {station.position[1].toFixed(6)}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => getMapInstance()?.flyTo({ center: station.position, zoom: 16 })}
          >
            Show on map
          </button>
        </p>
      </Section>

      <StationLayoutSection station={station} scenario={scenario} />

      <Section title="Construction and access" id="station-construction">
        {station.layout && (
          <SelectField
            label="Level"
            value={String(stationObjectLevel(scenario, station))}
            onChange={(e) => {
              const level = Number(e.target.value);
              commit(
                updateStationLayout(scenario, station.id, { level }).scenario,
                `"${station.name}" moved to ${stationLevelLabel(level).toLowerCase()}`,
              );
            }}
            options={STATION_LEVELS.map((l) => ({ value: String(l), label: stationLevelLabel(l) }))}
            hint="The station's tracks follow. Stations on other levels may stand above or below it."
          />
        )}
        <SelectField
          label="Construction"
          value={station.construction}
          onChange={(e) => {
            const construction = e.target.value as Station['construction'];
            // A station object rebuilds its tracks on the new level.
            if (station.layout)
              commit(
                updateStationLayout(scenario, station.id, { construction }).scenario,
                `"${station.name}" is now ${construction}`,
              );
            else patch({ construction });
          }}
          options={[
            { value: 'surface', label: 'Surface' },
            { value: 'underground', label: 'Underground' },
            { value: 'elevated', label: 'Elevated' },
          ]}
        />
        {(kind === 'bus' || kind === 'mixed') && (
          <SelectField
            label="Bus stop type"
            value={station.busStopType}
            onChange={(e) =>
              patch({ busStopType: e.target.value as Station['busStopType'] }, 'Stop type changed')
            }
            options={Object.entries(BUS_STOP_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          />
        )}
        <SelectField
          label="Platforms"
          value={station.platformType}
          onChange={(e) => patch({ platformType: e.target.value as Station['platformType'] })}
          options={[
            { value: 'unknown', label: 'Not specified' },
            { value: 'side', label: 'Side platforms' },
            { value: 'island', label: 'Island platform' },
            { value: 'separate', label: 'Separate platforms' },
          ]}
        />
        <CommitField
          label="Depth (negative) or elevation (positive)"
          unit="m relative to ground"
          type="number"
          min={-200}
          max={100}
          step="any"
          value={station.verticalOffsetM}
          onCommit={(v) => patch({ verticalOffsetM: v === '' ? null : Number(v) })}
        />
        <CommitField
          label="Catchment radius"
          unit="m"
          type="number"
          min={50}
          max={5000}
          value={station.catchmentRadiusM}
          onCommit={(v) => patch({ catchmentRadiusM: Number(v) })}
          hint="Default from the mode's walking-catchment rule of thumb; adjust to local evidence."
        />
        <fieldset className="mb-2">
          <legend className="text-xs font-medium text-slate-800">Accessibility (unknown until set)</legend>
          <Checkbox
            label="Step-free access"
            checked={station.accessibility.stepFree === true}
            onChange={(v) => patch({ accessibility: { ...station.accessibility, stepFree: v } })}
          />
          <Checkbox
            label="Tactile paving"
            checked={station.accessibility.tactilePaving === true}
            onChange={(v) => patch({ accessibility: { ...station.accessibility, tactilePaving: v } })}
          />
          <CommitField
            label="Elevators"
            type="number"
            min={0}
            max={50}
            value={station.accessibility.elevators}
            onCommit={(v) =>
              patch({ accessibility: { ...station.accessibility, elevators: v === '' ? null : Number(v) } })
            }
          />
        </fieldset>
        <CommitField label="Notes" value={station.notes} onCommit={(v) => patch({ notes: v })} />
        <MetadataEditor
          value={station.metadata}
          onChange={(metadata) => patch({ metadata }, 'Station details changed')}
          idPrefix={`station-${station.id}`}
        />
        <CommitField
          label="Image URL (https)"
          value={station.imageUrls[0] ?? ''}
          onCommit={(v) => {
            if (v && !/^https:\/\//.test(v)) return 'Use an https:// URL';
            patch({ imageUrls: v ? [v] : [] });
          }}
          hint="Images are linked, not uploaded; the browser loads them from that address."
        />
        <p className="text-xs text-slate-700">
          Entrances: {station.entrances.length} (entrance editing is planned for Phase 2)
        </p>
      </Section>

      <Section title={`Tracks at this station (${station.trackRefs.length})`} id="station-tracks">
        {(() => {
          const net = scenario.trackNetwork;
          const radius = parameterValue(net, 'stationTrackSearchM');
          const near = suggestStationTracks(scenario, station.position, stationLevel(station));
          const ids = [
            ...new Set([...station.trackRefs.map((r) => r.trackId), ...near.map((h) => h.track.id)]),
          ];
          if (!ids.length)
            return (
              <p className="text-sm text-slate-700">
                No track within {radius} m on this level. Services on tracks can only call at stations on
                tracks.
              </p>
            );
          return (
            <>
              <p className="mb-1 text-xs text-slate-600">
                Tracks within {radius} m on the same level are suggested (set the distance under Track
                parameters). Services stop on the ticked tracks.
              </p>
              <ul className="space-y-0.5 text-sm">
                {ids.map((id) => {
                  const i = net.tracks.findIndex((t) => t.id === id);
                  const t = net.tracks[i];
                  if (!t) return null;
                  const served = station.trackRefs.some((r) => r.trackId === id);
                  const hit = near.find((h) => h.track.id === id);
                  const cid = `st-${station.id}-trk-${id}`;
                  return (
                    <li key={id} className="flex items-center gap-2">
                      <input
                        id={cid}
                        type="checkbox"
                        checked={served}
                        onChange={(e) =>
                          commit(
                            setStationTrack(scenario, station.id, id, e.target.checked),
                            e.target.checked
                              ? 'Track added to the station'
                              : 'Track removed from the station',
                          )
                        }
                      />
                      <label htmlFor={cid} className="flex-1">
                        {t.name || `Track ${i + 1}`}
                        <span className="text-xs text-slate-600">
                          {hit
                            ? ` · ${hit.distanceM.toFixed(1)} m away`
                            : ' · further away or on another level'}
                        </span>
                      </label>
                      <button
                        type="button"
                        className="text-xs underline"
                        onClick={() => select({ kind: 'track', id })}
                      >
                        show
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          );
        })()}
      </Section>

      <WalkingLinksSection station={station} scenario={scenario} />

      <Section title={`Lines at this station (${lines.length})`} id="station-lines">
        <ul className="mb-2 space-y-0.5 text-sm">
          {lines.map((l: TransportLine) => (
            <li key={l.id} className="flex items-center gap-1">
              <span aria-hidden className="inline-block h-3 w-4 rounded-sm" style={{ background: l.color }} />
              <button
                type="button"
                className="flex-1 text-start underline"
                onClick={() => select({ kind: 'line', id: l.id })}
              >
                {l.name}
              </button>
              <Button
                variant="ghost"
                aria-label={`Remove from ${l.name}`}
                onClick={() =>
                  commit(
                    l.alignment.kind === 'track'
                      ? setServiceStops(
                          scenario,
                          l.id,
                          l.stops.filter((x) => x.stationId !== station.id).map((x) => x.stationId),
                        )
                      : removeStopFromLine(scenario, l.id, station.id),
                    'Stop removed',
                  )
                }
              >
                ✕
              </Button>
            </li>
          ))}
        </ul>
        {otherLines.length > 0 && (
          <SelectField
            label="Make this station a stop of another line (interchange)"
            value=""
            onChange={(e) =>
              e.target.value &&
              commit(
                otherLines.find((l) => l.id === e.target.value)?.alignment.kind === 'track'
                  ? setServiceStops(scenario, e.target.value, [
                      ...otherLines.find((l) => l.id === e.target.value)!.stops.map((x) => x.stationId),
                      station.id,
                    ])
                  : addExistingStationToLine(scenario, e.target.value, station.id),
                'Station shared',
              )
            }
            options={[
              { value: '', label: 'Choose a line…' },
              ...otherLines
                .filter((l) => l.alignment.kind !== 'track' || station.trackRefs.length > 0)
                .map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
        )}
        <Button
          variant="danger"
          onClick={() => {
            commit(
              station.layout
                ? deleteStationObject(scenario, station.id)
                : rerouteServices(
                    deleteStation(scenario, station.id),
                    lines.filter((l) => l.alignment.kind === 'track').map((l) => l.id),
                  ),
              `Station "${station.name}" deleted`,
            );
            select(null);
          }}
        >
          Delete station
        </Button>
      </Section>
    </div>
  );
}
