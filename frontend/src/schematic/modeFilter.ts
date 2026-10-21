/**
 * One schematic network per rail mode. Pure.
 */
import type { Scenario, TransportMode } from '../domain/schema';
import { isRailMode } from '../domain/tracks';

/** Rail modes that have at least one line, in the order of the lines. */
export function schematicModes(scenario: Scenario): TransportMode[] {
  return [...new Set(scenario.lines.map((l) => l.mode).filter(isRailMode))];
}

/** The scenario reduced to the lines of one mode and the stations they serve. */
export function scenarioForMode(scenario: Scenario, mode: TransportMode): Scenario {
  const lines = scenario.lines.filter((l) => l.mode === mode);
  const served = new Set(lines.flatMap((l) => l.stops.map((s) => s.stationId)));
  return { ...scenario, lines, stations: scenario.stations.filter((s) => served.has(s.id)) };
}
