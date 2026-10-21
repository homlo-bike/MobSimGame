/**
 * Text view of the schematic (R11): every line with its stations in order and, for each
 * station, what a passenger needs to know there — other lines, walking links to other
 * modes (with walking time), access facilities, terminal. Pure; the structured
 * alternative to the drawing.
 */
import type { Scenario } from '../domain/schema';
import { accessFacilities, ACCESS_FACILITY_LABELS } from '../domain/stationAccess';
import { linksOfStation, linkWalkMin, otherStation } from '../domain/walkingLinks';
import type { SchematicLayout } from './layout';

export interface TextStop {
  stationId: string;
  name: string;
  terminal: boolean;
  /** Short names of the other lines calling here. */
  otherLines: string[];
  /** Walking links to stations of other modes. */
  walks: { stationId: string; name: string; lines: string[]; minutes: number | null; calculated: boolean }[];
  /** Access facilities, e.g. "Elevator". */
  access: string[];
}

export interface TextLine {
  lineId: string;
  name: string;
  shortName: string;
  color: string;
  ring: boolean;
  stops: TextStop[];
}

export function schematicTextView(scenario: Scenario, layout: SchematicLayout): TextLine[] {
  const byId = new Map(layout.stations.map((s) => [s.id, s]));
  const lineName = new Map(scenario.lines.map((l) => [l.id, l.shortName || l.name]));
  const linesAt = (stationId: string) =>
    scenario.lines.filter((l) => l.stops.some((s) => s.stationId === stationId)).map((l) => l.id);
  return layout.lines.map((l) => ({
    lineId: l.id,
    name: l.name,
    shortName: l.shortName,
    color: l.color,
    ring: l.ring,
    stops: l.stationIds.map((id) => {
      const st = scenario.stations.find((x) => x.id === id);
      const s = byId.get(id);
      return {
        stationId: id,
        name: s?.name ?? st?.name ?? id,
        terminal: s?.terminal ?? false,
        otherLines: linesAt(id)
          .filter((x) => x !== l.id)
          .map((x) => lineName.get(x) ?? x),
        walks: linksOfStation(scenario, id).flatMap((link) => {
          const o = otherStation(scenario, link, id);
          if (!o) return [];
          const w = linkWalkMin(scenario, link);
          return [
            {
              stationId: o.id,
              name: o.name,
              lines: linesAt(o.id).map((x) => lineName.get(x) ?? x),
              minutes: w.minutes,
              calculated: w.calculated,
            },
          ];
        }),
        access: st ? accessFacilities(st.accessibility).map((f) => ACCESS_FACILITY_LABELS[f]) : [],
      };
    }),
  }));
}

/** Walking links between two stations both drawn in the schematic. */
export function schematicWalks(scenario: Scenario, layout: SchematicLayout) {
  const byId = new Map(layout.stations.map((s) => [s.id, s]));
  return scenario.interchanges.flatMap((link) => {
    const [a, b] = link.stationIds.map((id) => byId.get(id));
    if (!a || !b) return [];
    return [{ id: link.id, a, b, minutes: linkWalkMin(scenario, link).minutes }];
  });
}
