# Cardboard Studio

A local family server where a parent and kid ideate and generate printable cardboard
build templates (cut sheets + assembly guides), structured like reuseandplay.com products.

## Run it

```sh
cd server && node src/index.mjs   # → http://localhost:4177
```

No API key needed: design generation shells out to the local `claude` CLI (subscription auth).

## Map

- `server/src/index.mjs` — Express app (ideate chat, generate jobs, files)
- `server/src/ai.mjs` — Claude CLI wrapper: ideation + design JSON generation with validate/repair loop
- `server/src/schema.mjs` — design JSON validation (paths in inches, y-down, M/L/H/V/C/S/Q/T/Z only, no arcs)
- `server/src/render/templates.mjs` — cut-sheet renderer: global inch-space layout, 1"/3" grids, 1" page overlap tiling, giant page numerals, labels, corrugation arrows
- `server/src/render/guide.mjs` — assembly guide renderer (cover → what-you-need → paper size → printer note → overlap → tracing → tips → Step pages → license)
- `server/src/render/pdfkit.mjs` — pdf-lib drawing primitives. **Gotcha:** pdf-lib `drawSvgPath` scales via CTM, so stroke width & dash arrays must be pre-divided by the scale factor (already handled in `drawPath`)
- `server/src/render/geometry.mjs` — SVG path parsing/bbox/sampling
- `server/src/pipeline.mjs` — load/save/renderBundle orchestration. `renderBundle()` persists the computed `templateGrid` via `saveDesign()`, so re-rendering a bundle rewrites that design's design.json (expected — don't be surprised by moving mtimes)
- `server/src/differ.mjs` — structural design differ: `diffDesigns(a,b)` → identity-keyed DiffRecords with kid-language quantified labels ("Sword Body: moved 2.9\" right"). This is M4's Review engine — its record shape is a public API
- `server/public/viewer.html` + `viewer.js` — 3D assembly viewer (Three.js r180/WebGL2, served locally at `/viewer/<slug>` + `/vendor/three/*`): extrudes parts from real cut paths, folds via a hinge TREE (outline cut by all referenced slit lines, BFS from largest region; parallel-slit curls are the degenerate case), FLAT⟷BUILT slider with step ticks, parts-list↔3D hover highlight. Contract: `reference/ASSEMBLY-SPEC.md`; the `assembly` block in design.json is required for new designs (AI-generated, schema-validated)
- `designs/<slug>/` — design.json + rendered PDFs per design; `designs/pirate-sword/` is the hand-crafted exemplar (also the AI few-shot example — keep it valid!)
- `reference/pdfs/` — the four real Reuse & Play bundles (the quality bar; personal use only, do not redistribute)
- `reference/FORMAT-SPEC.md` — reverse-engineered R&P format conventions. Read before touching renderers.

## The Cutting Mat (CAD, M1–M4 shipped)

`/edit/<slug>` — kid-friendly editor over design.json. True-scale SVG Mat (1" grid, snap 1/4"),
verbs MOVE/TURN/SIZE/COPIES writing `parts[].layout {x,y,rotDeg}` and transformed paths, plus
M2's **PUNCH** (click → hole + LOOSE/SNUG fit chooser + drag-ring) and **FOLD/CURL** (drag →
dashed slit; stepper fans N parallel scores); parts tray, Shape Shelf starters (`/api/shelf`,
`/api/shelf/make` → `server/src/shelf.mjs`), true-scale hardware chips, flash-highlighting
read-only inspector, goal card, **Toy Doctor** chip strip (structured findings from
`validateDesign(design, { findings })`, click-to-zoom+flash, one-tap deterministic fixes), live
fold-up via `/viewer/<slug>?draft=1` (postMessage `cuttingmat:design`). Server keeps an in-memory
draft per slug: GET/PUT(+rev, 409 on stale)/DELETE `/api/designs/:slug/draft`, POST
`.../draft/render` (to `draft-preview/`), POST `.../draft/save`. M3 adds **history**: append-only
JSONL checkpoints at `designs/<slug>/history.jsonl` — `{id:"cp-N", author:"you"|"claude", summary,
ts, base, design}`, validator-gated, fsync'd, torn trailing lines skipped on read; the file is
NEVER rewritten (restore APPENDS a new checkpoint). Endpoints: GET/POST `.../checkpoints`, GET
`.../checkpoints/:id`, GET|POST `.../checkpoints/diff` (`b=draft` allowed; POST takes raw design
bodies — M4 reuses it), POST `.../draft/restore`. Mat gets a history strip (kraft you / crimson
claude dots, [Restore][Compare] popover, ghost-diff compare with edit lock + zoomable labels) and
checkpoint triggers: 45s post-mutation debounce, SAVE, PRINT, pagehide beacon (`?fastcp=<ms>`
shortens the debounce for tests; never fires with zero mutations or a standing red error).
M4 adds **chat proposals**: a right-rail chat where Claude proposes reviewable edits —
`proposeEdit()` in ai.mjs (full-document replace, ONE JSON `{reply,summary,design}`, validate/repair
loop, ids/slug/layout preservation enforced), POST `.../propose` (`?mock=1` = scripted stretch for
tests) → job poll → stateless POST `.../propose/:id/merge` (three-way vs the CURRENT draft via
`mergeDesigns`/`applyChoices` in differ.mjs — base captured at submission, conflicts default to the
kid) → Review mode on the M3 ghost machinery (two-ghost conflict picker, 3D BEFORE/AFTER toggle,
lint banner) → accept (validates, claude-authored crimson checkpoint, Cmd-Z steps across it) or
reject (draft byte-identical). Editing stays LIVE while Claude thinks — the merge is what
reconciles. Toy Doctor chips without a deterministic fix get ASK CLAUDE (prefills chat, never
auto-sends). `putDraft()` skips no-op PUTs (`lastPutBody`), so a chat send doesn't burn a rev.
Contracts: `docs/cad-studio/M1-CONTRACT.md`–`M4-CONTRACT.md`; product design:
`docs/cad-studio/DESIGN.md` (M5 pending: part-group Keep/Nope partial accept, checkpoint
thumbnails, laminate section view, 3D place-and-snap). holes/slits accept `{id,d}` or
legacy strings; mechanisms/fitChecks reference holes by id (index form warns) — helpers in
geometry.mjs.

Two rules that are easy to break and cost a whole print run:
- `PUT .../draft` answers an invalid document with 400 (M1 contract) — the Mat adds `?soft=1`
  to get that same outcome as 200 `{ ok: false, errors, findings }`, because a red Toy Doctor
  chip is a normal editing state and a 4xx makes the browser log a console error.
- Manual layouts print in absolute inch-space tiled from (0,0), so `manualLayout()` slides the
  WHOLE arrangement to keep it EDGE_PAD inside the origin. Without that, anything dragged above
  or left of 0 (SIZE by the north handle does it in one gesture) silently vanishes off the
  sheets. Relative positions are what the Mat promises; absolute origin is not.

## Mechanics (Phase 3)

Designs are functional toys, not shapes: `hardware[]` (dowels, skewers, straws, string,
brads — real dimensions, never on cut sheets), `mechanisms[]` (revolute: axle + loose
bearings + snug hubs + spinning instances), and a toy-statics linter in schema.mjs that
measures real geometry (bearing/hub fits, bearing length, axle budget, wheel sweep,
tipping ratio, solid-core durability rules). Contract: `reference/MECHANICS-SPEC.md`.
Viewer renders hardware as wood cylinders and has a ROLL toggle (kinematic, no-slip).
Small holes get drill/punch crosshair marks on templates; hardware lists in the guide.

## Design JSON contract

Part paths are REAL CUT LINES printed at 100% scale: coordinates in inches, y-down.
`holes` = interior cutouts, `slits` = dashed score lines, `backing` = dashed larger copy,
`corrugation` = flute direction arrow. Steps carry `figures` (refPart or custom paths) +
imperative `instructions`. `hero.paths` = flat cover illustration (kraft/kraftDark fills).

## Quality process

The project is developed via a "gauntlet": blind critics compare our output against the real
R&P PDFs (anonymized copies) and name the biggest gap; builders fix; repeat until ours wins.
Judge criterion: "which one could a parent and kid actually build from" — never branding.
