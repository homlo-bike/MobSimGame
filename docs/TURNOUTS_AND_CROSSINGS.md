# Turnouts and crossings

Status: **partly implemented**. Nodes with permitted movements are implemented;
typed turnout and crossing objects are **planned (Priority 2)** and are not
available yet.

## What exists now

- A **track node** joins any number of track ends. Each node lists its **permitted
  movements**, as pairs of track ends a train may pass between.
- **Automatic movements** follow the geometry: a pair is permitted where the two
  tracks leave the node more than 90° apart (no reversing).
  - Where a branch joins the middle of a track, this permits straight through and
    from the trailing side into the branch. It forbids the reversing move from the
    branch back the other way.
  - This is a geometric rule, not a turnout design rule.
- **Manual movements**: in the node inspector each pair can be allowed or forbidden.
  The node then keeps exactly the ticked movements, so the user can model, for
  example, a trailing-only connection or a disabled crossover.
- **No connection without a node**: tracks that cross without sharing a node are
  never connected. On the same level this is reported ("add a crossing, or put one
  track on another level").
- Validation reports nodes with three or more ends as "turnout or crossing type
  not specified" (information). It also reports connections whose tracks meet at a
  kink.
- The old "crossover before/after a station" markers on lines still drive the
  closure animation (turn back at a crossover). They are markers, not track
  objects.

## Planned (Priority 2)

A `TrackConnection` object at a node, with:

- **Kind**:
  - single turnout: left, right or curved;
  - crossover;
  - scissors crossover;
  - diamond crossing;
  - single slip;
  - double slip.
- **Ports**, mapped to track ends.
- **Movements** derived from the kind and editable.
- **Geometry and route attributes**: facing/trailing per movement, main and
  diverging route, and minimum radius of the diverging route (checked against the
  mode's cited rule where one exists).
- **Location and record keeping**: structure level, metadata, and validation status.

A diamond crossing will make two crossing tracks on the same level a recorded
crossing without a movement between them. Crossovers between the two tracks of a
double track will replace the station markers. No turnout geometry standard
(angles, lengths) will be hard-coded without a cited source; uncited values will be
placeholders with a range.
