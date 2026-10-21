# Turnouts and crossings

Status: **implemented (R5)** for single turnouts, diamond crossings and single and
double slips at a node. Crossover objects (two turnouts placed as a pair) and turnout
geometry generated from a design are not available yet.

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
- Validation reports nodes with three or more ends and no turnout or crossing as
  information. It also reports connections whose tracks meet at a kink.
- The old "crossover before/after a station" markers on lines still drive the
  closure animation (turn back at a crossover). They are markers, not track
  objects.

## Turnouts and crossings at a node (R5)

In the node inspector, **Turnout or crossing** sets the type of a node where three or
four track ends meet:

- **Turnout (single switch)**, three ends. The switch toe is the end from which both
  others are reached without reversing; of the other two, the one closer to straight
  through is the main route, the other the diverging route. Permitted movements: toe ↔
  main and toe ↔ diverging (never main ↔ diverging).
- **Diamond crossing**, four ends paired into the two routes closest to straight. Trains
  cannot change between the routes.
- **Single slip** adds one movement between the routes (chosen in the inspector);
  **double slip** adds both movements that need no reversing.

The movements follow the type (`movementMode: 'turnout'`); ticking a movement by hand
switches the node to manual movements, and a button returns to the turnout's.

### Designs

A turnout takes a **standard design** or **own values** (radius and speed of the
diverging route, from the manufacturer):

| Design (Deutsche Bahn) | Radius | Inclination | Frog | Diverging speed | Angle α |
| --- | --- | --- | --- | --- | --- |
| EW 190-1:7,5 | 190 m | 1:7.5 | curved | 40 km/h | 7.5946° |
| EW 190-1:9 | 190 m | 1:9 | straight | 40 km/h | – |
| EW 300-1:9 | 300 m | 1:9 | curved | 50 km/h | 6.3402° |
| EW 500-1:12 | 500 m | 1:12 | curved | 60 km/h | 4.7636° |
| EW 500-1:14 | 500 m | 1:14 | straight | 60 km/h | – |
| EW 760-1:14 | 760 m | 1:14 | curved | 80 km/h | 4.0856° |
| EW 1200-1:18,5 | 1200 m | 1:18.5 | curved | 100 km/h | 3.0941° |
| EW 2500-1:26,5 | 2500 m | 1:26.5 | curved | 130 km/h | 2.1611° |

Source: table of Deutsche Bahn standard simple turnouts (Regelweichen) in "Weiche
(Schienenverkehr)", German Wikipedia (CC BY-SA 4.0),
https://de.wikipedia.org/wiki/Weiche_(Schienenverkehr), read 21 October 2026. These are
railway designs. No public source with tram or metro turnout values was found
(BOStrab and VDV texts could not be read at the time), so for those modes the radius
and speed are user input; no value is assumed.

### Checks and simulation

- A type whose number of ends does not match the node, or geometry that does not form
  a turnout or crossing, is an error.
- A turnout without a design or own values is reported as information.
- **Smooth junction**: where the diverging track curves more tightly than the turnout's
  radius, a warning names both radii. A diverging track that leaves the node at an
  angle is reported by the existing kink check.
- **Speed**: with train physics (R15a), a train taking the diverging route keeps to its
  speed over the first element (arc or straight) of the diverging track from the node;
  the speed limit holds until the tail has passed. The constant-rate model does not
  apply turnout speeds.

## Not yet available

- Crossover objects (two turnouts and the connecting track placed as a pair, replacing
  the "crossover before/after a station" markers), scissors crossovers.
- Turnout geometry generated from a design (switch length, frog position, clearance
  point), and three-way or curved turnouts.
- Tram and metro turnout catalogues with cited values.
