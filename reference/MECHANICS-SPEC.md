# Mechanics Spec — hardware, mechanisms, and the toy-statics linter

Phase 3 of Cardboard Studio: designs stop being shapes and become functional toys.
Principles: kids play rough (durability is a requirement, not a nice-to-have);
moving parts must actually move; physics is consulted at design time via
deterministic checks computed from the real geometry; materials beyond cardboard
are welcome when they're household/craft-store common (wooden dowel: yes;
custom plastic fender: no).

## design.json additions

### hardware — non-cardboard parts (not cut from templates)

```json
"hardware": [
  {
    "id": "axle-dowel",
    "kind": "dowel",              // dowel | skewer | straw | string | brad | rubber-band | paper-clip
    "diameterIn": 0.25,           // for round stock
    "lengthIn": 9,
    "count": 2,
    "label": "1/4-inch wooden dowel, 9 inches long",
    "source": "craft store, hardware store, or the garage"
  }
]
```
- Hardware appears in the guide's WHAT YOU NEED under a HARDWARE heading (label + count
  + source), in steps, and in the 3D viewer (dowels/skewers/straws render as cylinders,
  wood color #D9C29A, darker ends).
- Hardware is NEVER on the cut sheets, but holes that receive hardware are: any part
  hole ≤ 0.75" across gets a crosshair center mark and a small diameter label on the
  template ("Ø 0.31” — punch or drill").

### mechanisms — how parts move

```json
"mechanisms": [
  {
    "type": "revolute",                       // the rolling-wheel pattern (v1: only type)
    "id": "front-axle",
    "axle": "axle-dowel",                     // hardware id (round stock)
    "bearings": [ { "part": "body-core", "hole": "h-axle-front" } ],  // LOOSE holes the axle spins in
    "hubs": [ { "part": "wheel-disc", "hole": "h-hub" } ],            // SNUG holes glued to the axle
    "spins": ["wheel-fl", "wheel-fl-ring", "wheel-fr", "wheel-fr-ring"]  // assembly instance ids that rotate with the axle
  }
]
```

#### Hole references are IDs, never indices

A part's `holes[]` / `slits[]` entries are objects carrying a stable id:
`{"id": "h-axle-front", "d": "M ..."}` (bare path strings are the legacy form and
still parse). Every cross-reference — `mechanisms[].bearings[].hole`,
`mechanisms[].hubs[].hole`, and fitCheck `{"measure": "holeWidth", "hole": ...}` —
names that **id**. The legacy positional form (`"hole": 0`) is still accepted so
existing designs keep validating, but the validator warns:
*"positional reference — will break if holes are inserted; use ids"*. Inserting a
hole at index 0 otherwise re-aims every mechanism silently, and diff attribution
in the editor loses its anchor.

### assembly — hardware instances

Assembly instances may reference hardware instead of a part:
```json
{ "id": "axle-front-3d", "hardware": "axle-dowel", "copy": 0, "order": 4,
  "pos": [x,y,z], "rot": [rx,ry,rz] }   // cylinder axis = local X before rot
```

## The toy-statics linter (schema.mjs — errors unless noted)

Computed from real geometry, never from declared intent:

1. **Bearing fit** (per revolute): each bearing hole diameter − axle diameter must be
   in [0.04", 0.12"] (free spin, no slop). Measured from the actual hole path.
2. **Hub fit**: each hub hole diameter − axle diameter in [−0.01", +0.03"]
   (press fit + glue).

> **The two named fits.** Inside those bands the product speaks in exactly two numbers:
> **LOOSE so it spins = axle Ø + 0.06"** and **SNUG so it grips = axle Ø + 0.01"**. The
> Mat's PUNCH chips offer them, the linter recommends them, and the one-tap fixes write
> them — one number per fit, everywhere, so the chip text and the FIX button never
> disagree.

3. **Bearing length**: summed thickness of bearing parts (layers × 0.15") ≥ 2× axle
   diameter — a short bearing wobbles. Warn < 3×.
4. **Axle length budget**: axle length ≥ bearing span + 2×(hub stack thickness) + 0.2"
   washer gaps, and ≤ that + 1.5" (no saber sticking out).
5. **Wheel sweep**: wheel radius + 0.25" clears every arch point through full rotation
   (reuses the arch-clearance fitCheck machinery).
6. **Tipping ratio** (rolling toys, i.e. any design with a revolute): outer track width
   ÷ estimated CG height (assembled bbox height × 0.45) ≥ 1.1, else warn "tippy".
7. **Durability lints**:
   - A design in vehicles/playsets with a revolute must have a SOLID CORE: some part
     with count ≥ 6 identical stacked layers (or declared stack reaching ≥ 0.9")
     that the bearings pass through. Error if bearings sit in walls < 0.45" thick.
   - Any part named as graspable mass (vehicles: the body; swords: the blade) must be
     ≥ 3 laminated layers or a closed box — warn otherwise.
   - Single-layer parts with area > 40 in² warn ("laminate or box this — it will crease").
8. **Ground clearance** (designs with a revolute): ground level = the minimum world-y
   over all `spins` instances' geometry (the wheel bottoms), computed with the same
   assembly world-transform machinery as the tipping check; every non-spin instance —
   body parts AND hardware cylinders — must keep its lowest world point ≥ 0.35" above
   that line (error naming the instance and its actual gap; warn under 0.5"). A belly
   or bumper at wheel level beaches the toy: it rests on cardboard and cannot roll.

Backward compatibility: `hardware`/`mechanisms` are optional; all lints above fire only
when mechanisms exist (durability warnings may fire generally but never error on
legacy designs).

### Structured findings (what the Toy Doctor reads)

`validateDesign(design, { warnings, findings })` fills `findings` with the same problems
as the legacy strings — same count, same order, same severity — but pinned to geometry:

```json
{ "level": "error", "code": "bearing-fit",
  "message": "…BEARING FIT — hole [0] of \"body-core\" is Ø 0.27\" on a Ø 0.25\" axle…",
  "anchor": { "part": "body-core", "holeId": "h1", "slitId": null, "instanceId": null },
  "fix": { "label": "Resize to Ø 0.31\"",
           "patch": { "op": "set-hole-diameter", "part": "body-core", "holeId": "h1",
                      "diameterIn": 0.31 } } }
```

Codes: `bearing-fit`, `hub-fit`, `bearing-length`, `axle-budget`, `wheel-sweep`,
`tipping`, `ground-clearance`, `solid-core`, `fit-failure`, `overlap`, `bend-scores`,
`positional-ref`, `durability`, `other`. `anchor` always carries all four keys (null
where they don't apply).

A `fix` appears **only where the right number falls out of the geometry**: bearing-fit →
axle Ø + LOOSE, hub-fit → axle Ø + SNUG, a clearance `fitCheck` whose loose side is a
hole → the middle of that check's band, and axle-budget → the middle of the legal length
window cut to a quarter inch (`set-hardware-length`). Everything else ships without one:
a chip with no button is honest, a guessed fix is not. Fixes need a hole **id**, which is
why the Mat's draft backfills `h1..hN` / `s1..sN` on open.

## Viewer (viewer.js)

- Hardware instances render as cylinders (CylinderGeometry, axis = local X):
  length, diameter from hardware; wood material; included in build animation.
- Instances listed in a mechanism's `spins` rotate about their axle's world axis:
  during the build sweep give wheels a quarter-turn settle; add a **ROLL** toggle that
  translates the whole finished toy along the ground with spin rotation = distance ÷
  wheel radius (kinematic — honest motion, no simulation theater).

## Prompt (ai.mjs GEOMETRY_RULES)

New sections, compact:
- MATERIALS & HARDWARE: the allowed kinds with the dowel example; "reach for a dowel
  when something must spin or take abuse".
- DURABILITY: "kids play rough — this must survive being stepped on: vehicles get a
  solid stacked core (one profile part, count 'as many as needed' to reach the target
  width, like commercial cardboard toys); anything gripped is ≥3 layers".
- MECHANISMS: the revolute schema + the numbers (bearing +0.04..0.12, hub −0.01..+0.03,
  bearing length ≥ 2× dia) + "declare a mechanism for anything meant to move".
