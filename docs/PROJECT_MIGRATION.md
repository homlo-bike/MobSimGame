# Project format and migration

## Schema 3 (current)

Schema 3 adds the physical track network (`scenario.trackNetwork`), station
track references (`station.trackRefs`), services on tracks
(`alignment.kind = 'track'`) and metadata fields (`metadata` on the project,
lines, stations, tracks and nodes). Rail lines no longer have spline alignments.
See [TRACK_ARCHITECTURE.md](TRACK_ARCHITECTURE.md).

## No migration from schema 1 or 2 (owner decision, 2026-10-20)

The project has not been published, so the owner chose to start the new format from
scratch instead of converting old documents:

- Opening a project file, a browser-stored project or a shared link saved in schema
  1 or 2 shows: "This project was saved in an older, unpublished format (schema N).
  It cannot be opened by this version (schema 3); please start a new project."
  Nothing is changed or overwritten.
- The backend accepts only schema 3 for new saves (`backend/app/schemas.py`).
- The bundled real-network examples are generated in schema 3 when they are opened.
  Each OpenStreetMap rail line becomes a double track fitted with lines and arcs
  (`geo/track/fit.ts`), with its stations on both tracks and a service routed over
  them. The track is marked as existing infrastructure. Lines that share streets in
  OpenStreetMap get separate track pairs; they are not merged.

## If a migration is wanted later

The pieces for a v2 → v3 conversion exist and are tested:

- `fitPiAlignment` turns sampled spline geometry into lines and arcs and reports
  the largest deviation;
- `createTracks` with per-point radii builds the double track;
- `addStationOnTracks` and `setServiceStops` attach stations and route the
  service.

A migration would also need:

- a backup of the original document;
- warnings when the fit deviates;
- a read-only fallback when conversion fails.

These are not implemented because no published projects exist.
