# M0+M1 Build Contract — Cutting Mat first playable

Binding contract between Builder A (pipeline/server) and Builder B (Mat UI), set by the
coordinator. Where DESIGN.md is silent, this document decides. Deviations require both
builders to agree via their return reports (coordinator reconciles).

## Ownership

- **Builder A**: server/src/schema.mjs, server/src/index.mjs, server/src/render/templates.mjs,
  server/src/ai.mjs, reference/MECHANICS-SPEC.md (id-refs note), designs/pirate-sword/design.json
  (id migration only).
- **Builder B**: server/public/edit.html (new), server/public/edit.js (new),
  server/public/index.html (Edit button), server/public/viewer.js + viewer.html (draft mode only).
- Neither touches the other's files. Guide renderer untouched in M1.

## 1. `parts[].layout` (additive, optional)

```json
"layout": { "x": 1.5, "y": 0.75, "rotDeg": 0 }
```
- Mat/template space: inches, y-down, same space the cut sheets print. Snap grid 0.25".
- Semantics: translate part geometry so its **pre-rotation bbox min-corner** lands at (x, y),
  then rotate by `rotDeg` **clockwise about the translated bbox center**. One shared mental
  model: `place(u,v) = R(rotDeg, center) · (u - bb.minX + x, v - bb.minY + y)`.
- Applies to ALL of the part's geometry (path, holes, slits, backing) as one rigid body.
- Renderer (A): when EVERY part has `layout`, skip shelf packing and place parts at their
  layouts (implement rotation by numerically transforming path data — parse, affine, re-serialize;
  do not rely on pdf-lib rotate). When any part lacks `layout`, fall back to auto-pack for all
  (no mixed mode in M1). Overview page + labels/key/reg-marks machinery must keep working in
  manual mode (labels may keep auto-planning).
- Validation (A): layout optional; if present needs finite x/y, rotDeg default 0; parts may
  overlap (warn "parts overlap on the mat — they'll print overlapping" — warning, not error).

## 2. Hole/slit ids + id references (M0 migration)

- `holes`/`slits` entries MAY be objects `{ "id": "h1", "d": "M ..." }` or legacy bare strings.
  All pipeline code paths (schema measures, templates drill marks, viewer hinges, guide figures)
  accept both shapes — A sweeps every consumer of `part.holes[i]` / `part.slits[i]`.
- `mechanisms[].bearings/hubs[].hole` and fitCheck `hole` refs accept an id string or legacy
  index int; validator warns on index form ("positional reference — will break if holes are
  inserted; use ids"). pirate-sword migrates fully to ids (few-shot teaches the id form);
  ai.mjs GEOMETRY_RULES + MECHANICS-SPEC examples show id form.

## 3. Draft endpoints (A implements; B consumes)

In-memory per-slug draft (Map), created lazily from disk:

- `GET /api/designs/:slug/draft` → `{ design, rev }`. On first access: deep-copy disk design;
  if any part lacks `layout`, initialize ALL layouts from the current `layoutParts()` auto-pack
  positions (rotDeg 0) so the Mat opens showing exactly what the sheets print today.
- `PUT /api/designs/:slug/draft` body `{ design, rev }` → validates (`validateDesign` with
  warnings collected). Errors: 400 `{ errors }`, draft unchanged. OK: bumps rev, returns
  `{ ok: true, rev, warnings }`. Stale rev: 409 `{ error: 'stale', rev }` (B reloads).
- `POST /api/designs/:slug/draft/render` → renders Letter+A4 templates + guide from the DRAFT
  into `designs/:slug/draft-preview/`, returns `{ files: [urls under /files/...] }`. Disk
  design.json untouched.
- `POST /api/designs/:slug/draft/save` → writes draft design to `designs/:slug/design.json`
  and re-renders the real bundle (existing renderBundle). Returns `{ ok, files }`.
- `DELETE /api/designs/:slug/draft` → discard.
- Route `GET /edit/:slug` → serves public/edit.html. (A adds route; B builds the page.)

## 4. Viewer draft mode (B implements, minimal)

`/viewer/:slug?draft=1`: viewer fetches `/api/designs/:slug/draft` (uses `.design`) instead of
`/api/designs/:slug`, and listens for `window.postMessage({ type: 'cuttingmat:design', design })`
→ rebuilds the scene preserving camera + slider t. The Mat embeds this iframe and posts the
working document debounced ~300ms after edits. No other viewer changes.

## 5. The Mat page (B): M1 verb set ONLY

- SVG canvas, real inches (CSS transform for zoom; fit design + 2" margin on open), 1"/3" grid
  identical in spirit to the sheets, y-down. Snap 0.25".
- Verbs: **MOVE** (drag body → layout.x/y), **TURN** (single rotate handle above selection →
  layout.rotDeg, snap 15° with Shift for free), **SIZE** (four corner handles = uniform scale
  about opposite corner; four edge handles = single-axis about opposite edge; live inch W×H
  readout; writes transformed path/holes/slits/backing — same affine to all; min size 0.15"),
  **COPIES** (stepper in inspector panel → `count`).
- Parts tray (left): one row per part, name + count, click selects, selection syncs both ways.
- Inspector (bottom or right): read-only pretty design.json, auto-scrolls to + flash-highlights
  the property that just changed. No editing in M1.
- Goal card on first open of pirate-sword: "Drag the blade tip to make it longer. Slide
  FLAT→BUILT. Print it." Dismissable, reappears via ?goal=1.
- PRINT button: PUT draft → POST draft/render → open the Letter template PDF in a new tab.
  SAVE button: POST draft/save with confirm dialog ("updates the design in your gallery").
- Undo/redo: in-page stack of document snapshots (Cmd/Ctrl-Z) — M1 is in-memory only, no
  checkpoint UI.
- Style: Cardboard Studio identity (paper #FAF6EF, ink #2B2523, kraft #C9AB84, crimson #A8214A),
  no external resources.
- index.html: each gallery card + detail view gets an "✏️ Edit on the Mat" link → /edit/:slug.

## 6. Acceptance (verifier runs, timed)

1. All six designs validate 0 errors; all bundles still render (legacy auto-pack path intact).
2. /edit/pirate-sword loads < 3s; parts appear at auto-pack positions on the grid.
3. Drag the sword-body SIZE edge handle to make the blade ~2" longer → inspector shows path
   change; viewer iframe updates within ~1s; PRINT produces a valid PDF whose sword measures
   ~2" longer against the 1" grid (Read the PDF and check).
4. MOVE a part 3" right → re-render → part moved on the sheets; overview page reflects it.
5. TURN the knuckle guard 90° → prints rotated; no clipped geometry.
6. Whole flow (open → stretch → slide FLAT→BUILT → print) under 5 minutes of wall time.
7. Zero console/page errors on /edit/pirate-sword and /viewer/pirate-sword?draft=1.
8. monster-truck (id-ref migrated? NO — only pirate-sword migrates in M0) still validates with
   its legacy index refs + the new warning present; all other designs unaffected.
