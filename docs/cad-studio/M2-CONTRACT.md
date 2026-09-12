# M2 Build Contract — Cardboard verbs + Toy Doctor

Binding contract for M2 (DESIGN.md §2.6), set by the coordinator. M1-CONTRACT.md remains in
force (layout semantics, draft endpoints, ownership style). Where DESIGN.md is silent, this
document decides.

## Ownership

- **Builder A (pipeline)**: server/src/schema.mjs, server/src/shelf.mjs (NEW),
  server/src/index.mjs, reference/MECHANICS-SPEC.md (small additions only).
- **Builder B (Mat UI)**: server/public/edit.html, server/public/edit.js.
- Neither touches renderers, viewer, ai.mjs, or designs/ this milestone.

## 1. Structured lint findings (A)

`validateDesign(design, { findings })` fills an array of structured findings (legacy
string-array behavior unchanged for old callers):

```json
{ "level": "error" | "warn",
  "code": "bearing-fit" | "hub-fit" | "bearing-length" | "axle-budget" | "wheel-sweep" |
          "tipping" | "ground-clearance" | "solid-core" | "fit-failure" | "overlap" |
          "bend-scores" | "positional-ref" | "durability" | "other",
  "message": "shop-rule phrasing, one sentence",
  "anchor": { "part": "guard-bowl", "holeId": "h1", "slitId": null, "instanceId": null },
  "fix": {                                    // present ONLY when deterministically computable
    "label": "Resize to Ø 0.31\"",
    "patch": { "op": "set-hole-diameter", "part": "body-core", "holeId": "h1", "diameterIn": 0.31 }
          // or { "op": "set-hardware-length", "hardware": "axle-dowel", "lengthIn": 7.5 }
  } }
```

- Deterministic fixes in M2: hole resizes (bearing-fit → axle Ø + 0.06; hub-fit → axle Ø + 0.01;
  clearance-type fitChecks on holes → band midpoint) and hardware length (axle-budget → midpoint
  of the legal window, rounded to 1/4"). Everything else ships without `fix`.
- `PUT /api/designs/:slug/draft` response gains `"findings": [...]` next to the existing
  `warnings` strings. `GET .../draft` also returns current findings.
- Draft init (A, in index.mjs): backfill missing hole/slit ids per part (h1..hN / s1..sN in
  array order) so chips and fixes have stable anchors. Mechanism index refs stay untouched
  (they still resolve; positional-ref warning still fires).

## 2. Shape Shelf starters (A: server; B: UI)

`server/src/shelf.mjs` — pure functions, no I/O. Endpoints (A, index.mjs):
- `GET /api/shelf` → `[{ id, name, emoji?, params: [{ key, label, min, max, step, default, unit }] }]`
- `POST /api/shelf/make` body `{ starter, params }` → `{ part }` where part =
  `{ name, count: 1, path, holes: [], slits: [], corrugation }` (plain paths, inches, y-down,
  bbox min at 0,0; ids assigned by the CLIENT when inserting).

Starters (all params are dial-adjustable at creation time only, per DESIGN):
- `panel` — Rectangle/Panel: width 1–20 (default 6), height 1–20 (default 4), corner radius 0–1 (0).
- `wheel` — Disc/Wheel: diameter 1–8 (4.75), hubHole Ø 0–1 (0.26 → a centered hole when > 0).
- `strip` — Strip: length 2–24 (7.5), width 0.5–4 (2.2), slits 0–24 (10) evenly-spaced full-span
  score lines perpendicular to length (the curl pattern).
- `blade` — Blade: length 6–30 (16), width 1–4 (2), a clean tapered sword-blade outline with a
  curved tip (cubics, symmetric).
- `tab` — Glue Tab: width 0.5–3 (1), depth 0.5–2 (1), trapezoid with rounded outer corners.

## 3. Mat verbs (B)

Toolbar gains **PUNCH** and **FOLD** (with a CURL toggle inside FOLD). M1 verbs unchanged.

- **PUNCH** (non-modal — no hardware-first order): activate, click a spot on the selected part →
  circular hole (id assigned) + a fit chooser popover anchored to it listing each round hardware
  item in the design — chips **"LOOSE so it spins" (Ø = axle + 0.06")** and **"SNUG so it grips"
  (Ø = axle + 0.01")** — plus, when the design has no round hardware, the standard kinds
  (1/4" dowel, 1/8" skewer, straw 0.28"). A drag-ring on the hole resizes with live Ø readout
  (drag yes, typing never). Holes render on the mat exactly as templates draw them (crosshair +
  Ø label comes free at print).
- **FOLD**: activate, drag across the selected part → straight dashed score line (slit, id
  assigned), snapped to 0°/90° when within 10°, else free angle; line trims to the part outline
  with a small overhang. **CURL** toggle: same drag defines the span, a count stepper (2–24)
  fans evenly-spaced parallel lines; stepper edits live until deselect.
- Everything undoes/redoes through the existing snapshot stack; every mutation PUTs (debounced)
  and refreshes findings.

## 4. Shelf + hardware tray (B)

- Left tray, above the parts list: **SHELF** section fed by GET /api/shelf. Drag a starter onto
  the mat → dial popover (sliders/steppers per param spec) with live ghost preview → confirm
  inserts the part (client assigns part id/name-dedup, layout at drop point, snap 1/4").
- **HARDWARE** section: chips for the design's hardware entries plus the standard kinds, each
  drawn to TRUE SCALE at current zoom (a 1/4" dowel chip is actually 0.25" thick on the mat's
  scale) with label. Dragging a standard chip into the tray area of the design adds a
  hardware[] entry (default label/count/source per MECHANICS-SPEC kinds). Dragging a PUNCHED
  hole near a hardware chip re-snaps its Ø to that hardware's LOOSE/SNUG (nearest band edge,
  chooser popover reopens to pick which).

## 5. Toy Doctor strip (B)

- Horizontal strip between mat and inspector: one chip per finding — green none / yellow warn /
  red error, shop-rule message, anchored part name.
- Click a chip → mat pans/zooms to the anchored geometry and flashes it (holes/slits flash
  their path; part-level anchors flash the outline). Viewer-pane highlight is OPTIONAL in M2.
- Chips with `fix` show a one-tap **FIX** button: apply the patch op locally
  (`set-hole-diameter` = scale that hole's path uniformly about its own center to the target Ø;
  `set-hardware-length` = set the number), push undo snapshot, PUT, re-render chips. The fix is
  visible geometry change, never silent.
- Strip is live: refreshes on every PUT response.

## 6. Acceptance (verifier, timed, playwright-driven real gestures)

1. Regression: all six designs validate 0 errors; M1 acceptance §6.3 (blade stretch → print
   measure) still passes end-to-end.
2. /edit/pirate-treasure-chest: PUNCH a hole on the lid-wrap with "SNUG" for the standard 1/4"
   dowel → hole Ø 0.26 ± 0.005 in the draft JSON; crosshair + "Ø 0.26 — punch or drill" appears
   in the printed draft-preview sheet (Read the PDF).
3. FOLD: on a fresh `panel` starter dragged from the Shelf (8×5), drag a vertical fold line →
   slit with id appears, dashed on mat, dashed on print. CURL with count 8 → 8 evenly-spaced
   slits (measure spacing in the JSON ≤ 0.8" apart for the span used).
4. Shelf: drag a `wheel` (Ø 4) onto the mat of a scratch design → part lands at drop point,
   prints on re-render, inspector flashed.
5. Toy Doctor: in /edit/monster-truck, use the drag-ring to shrink one wheel-disc hub hole to
   ~Ø 0.15 → red hub-fit chip appears with shop-rule text; click chip → mat zooms + flashes that
   hole; click FIX → hole returns to Ø 0.26 ± 0.005, chip clears, undo restores the bad state and
   the chip returns (then redo the fix). Truck's positional-ref warnings appear as yellow chips.
6. Zero console/page errors on all touched pages; wall-time report for flows 2–5.
