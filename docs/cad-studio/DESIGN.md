# Cutting Mat — the Cardboard Studio CAD

**Synthesis of concepts A (kid-first), B (document-first), C (material-verbs), honoring three judge
verdicts (lens winners: A on learnability, B on round-trip integrity, B on buildability).**

The tool is a structured, direct-manipulation editor over the existing `design.json` — a 2D cutting
mat that is literally the printed template, a live 3D fold-up pane, and a chat rail where Claude
proposes reviewable edits to the same file. No new format, no parametric timeline, no expressions,
nothing that can cascade. The worst outcome of any edit, by any hand, is a colored lint chip with a
sentence — never a broken recompute.

---

## 1. The five headline decisions

1. **Document model — `design.json`, unchanged in role, literal coordinates only.** One
   representation, no gen recipes, no params/expressions. One tiny additive schema change: stable
   `id`s on holes and slits so diffs anchor on identity, not array position — and those ids are
   the **reference currency**: mechanisms (bearings/hubs), fitCheck hole refs, and any future
   cross-reference point at hole/slit ids, never array indices. Legacy index refs stay readable
   during migration; the validator warns on them.
2. **History model — append-only full snapshots per design, never inside the file.** Onshape's
   version-dots idea, not Fusion's timeline. Every accepted change (human or LLM) is a checkpoint
   `{author, summary, timestamp, baseCheckpoint}`; diffs are *computed views*, never storage; one
   uniform undo that also undoes the robot.
3. **Interaction model — the Mat: a true-scale 2D canvas on the printed 1-inch grid, six working
   verbs (MOVE / TURN / SIZE / COPIES / PUNCH / FOLD), Shape Shelf starters instead of drawing,
   live 3D fold-up as the reward loop, Toy Doctor lint chips with one-tap deterministic fixes.**
   Every verb shown on screen works on day one.
4. **LLM loop — symmetric editors, asymmetric commit rights.** Claude reads the head document +
   selection + lint + recent history, returns a full modified `design.json`; the server
   validates/repairs, records the base checkpoint hash, computes a per-object/per-property
   structural diff, three-way merges, and stages a **proposal** the kid reviews as a ghost overlay
   with kid-language chips. Nothing is ever silently applied.
5. **MVP cut — first playable requires zero new AI machinery.** Milestone 1's acceptance test:
   open a pirate-sword remix, drag the blade 2 inches longer, slide FLAT→BUILT, press Print, hold
   a valid PDF — under 5 minutes, no chat involved. Whole-proposal accept/reject ships in v1;
   part-group Keep/Nope is the first v1.x milestone, and the diff machinery is built for it from
   day one.

---

## 2. Core decisions with rationale

### 2.1 Document model: literal `design.json`, single representation

`design.json` stays the ONLY document — the same file the validator (`schema.mjs`), toy-statics
linter, template/guide PDF renderers, and 3D viewer already consume. The editor treats it as a flat
addressable scene graph (B's Figma framing): objects are parts, holes, slits, hardware entries,
mechanisms, assembly instances, steps; a canvas edit is a property write; an LLM edit is a JSON
edit; diffs are per-object/per-property and therefore renderable and (eventually) partially
acceptable.

Geometry is **literal coordinates, always** (C's posture, demanded as a graft by two judges):

- **No per-part `gen` recipes** (A's proposal). Two judges independently ruled the dual
  representation fatal — the recompile-on-save precedence rule silently clobbers any hand or LLM
  edit to the raw path, and "cracks the egg" is a mystery box even with a warning dialog. Shelf
  starters keep their kid-friendly dials (wheel diameter, slit count, fit choice) **at creation
  time only**; the dial output compiles immediately to a plain path and the dial state is
  discarded. Re-parameterizing later is a job for SIZE handles or the chat.
- **No `params`/expression block** (B's v1.1 proposal). All three judges killed it: expression
  strings inside numeric fields fork the schema contract, reintroduce cascade, and are a syntax —
  the thing this product exists to not teach. "Change one number, everything updates" is served by
  coherent stretch handles, and — the honest answer for this codebase — by asking Claude, whose
  dependent-feature recompute is exactly what a timeline automates, but reviewable
  (verification-based parametrics: fitChecks re-verify, they never drive).

**One additive schema change** (required by the round-trip judge): holes and slits gain optional
stable `id`s (editor-assigned, e.g. `"h1"`, `"s3"`; renderers unchanged). Without them, an LLM
inserting a hole at index 0 shifts every index and corrupts diff attribution, chip highlighting,
and partial acceptance. The same insertion also silently re-aims every mechanism:
`mechanisms[].bearings/hubs` and fitCheck hole refs historically point at holes by array index
(`{"part": "body-core", "hole": 0}`) — the exact positional-reference failure class this design
rejects. So the ids are also the **reference currency**: every cross-reference (bearings, hubs,
fitCheck hole refs, anything future) names a hole/slit id, never an index. The schema accepts the
legacy index form during migration, the validator warns on it, and the pipeline — linter
resolution, MECHANICS-SPEC examples, the `ai.mjs` prompt, the exemplar — migrates in M0. Design
intent lives in `fitChecks` and the statics linter — checks that verify and flag, never
constraints that drive and break.

*Rejected at judgment: Fusion-style operation history as truth (cascading breakage, the file
becomes a program the LLM must simulate), OpenSCAD code-first UI for the kid (the LLM already
plays the programmatic role), a separate editor-native format (two sources of truth), a
sketch-constraint solver (solver mystery vs. the linter's plain sentences).*

### 2.2 History model: append-only snapshots, about the file, never in the file

`designs/<slug>/history/` holds an append-only log of **full immutable snapshots** of
`design.json`, each with metadata `{author: "kid"|"parent"|"claude", summary, timestamp,
baseCheckpoint}`. Checkpoints are written on every accepted LLM proposal and on every debounced
human save-pause (game-autosave feel). Restore writes the old document as the new head — itself a
checkpoint; history never rewrites. Diffs between any two checkpoints are **computed** by the same
structural differ Review mode uses (build it once) and rendered as ghost geometry + plain-language
chips ("Blade: 12in → 14in", "New part: Crossguard"). This is B's mechanism carrying A's UX:
author-colored dots naming every hand ("You: moved wheel hole" / "Claude: lengthened blade"), one
uniform undo stack across human and robot, and — per the buildability judge — a **labeled list**
in v1, not an auto-rendered thumbnail filmstrip (thumbnails are v1.x). C's ledger-of-JSON-diffs is
dead: diff-chain reconstruction is precisely the drift mechanism the round-trip lens exists to
catch. Branching collapses to the operation the studio already has: **Remix duplicates the design
folder into a new slug.** The only scrubbable "timeline" a kid ever sees is the assembly itself —
the existing FLAT⟷BUILT slider, where glue order drives build steps (C's one keeper of an idea
about time).

*Rejected: Fusion's replayed timeline (its own community documents "models impossible to edit"),
Onshape's branch/merge graph UI (ceremony a 12-year-old doesn't need), diff-chains as storage.*

### 2.3 Interaction model: the Mat, six verbs that all work, Shelf instead of drawing

One screen (`/edit/:slug`). **Center: the Mat** — an SVG canvas in real inches, y-down, on the
same 1"/3" gray grid the printed cut sheets use; screen = paper, so the deepest CAD abstraction
(units and scale) simply doesn't exist. Snap at 1/4". **Left: the Shape Shelf + parts tray +
hardware shelf.** Starters (Rectangle/Panel, Disc/Wheel, Strip with slit-count dial, Blade, Tab)
drag onto the mat and compile instantly to plain paths — nobody must draw a curve to make a part.
Hardware chips (dowel, skewer, straw, string, brad, rubber band, paper clip) are **drawn to true
scale** so a dowel visually explains its own hole size. **Right: the fold-up pane** — the existing
Three.js viewer embedded via iframe, re-fed the working document (debounced ~300ms), FLAT⟷BUILT
slider always visible. **Bottom: Toy Doctor lint strip + chat rail.**

Six verbs on a selected part — A's verb economy with C's material-verb names wherever they are
honest, plain words everywhere else (learnability judge's graft):

| Verb | Gesture | Writes |
|---|---|---|
| **MOVE** | drag, snaps 1/4" | part layout position |
| **TURN** | rotate handle | part orientation |
| **SIZE** | corner/edge handles, live inch readouts; scales the whole path coherently | `part.path` |
| **COPIES** | ×N stepper (laminated stacks are big N; laminate lives in the inspector) | `count` / `laminate` |
| **PUNCH** | click a spot → hole appears with a fit chooser: **"LOOSE so it spins" / "SNUG so it grips"**, diameters taken verbatim from the linter's tolerance bands; dragging a hole near a hardware chip snaps to its fits. **Non-modal** — no pick-hardware-first order dependency | `holes[]` (+ crosshair marks on templates for free) |
| **FOLD** | drag a straight line across a part → dashed score line; a CURL helper fans N parallel lines (the knuckle-guard pattern) | `slits[]` — and **only** `slits[]`: fold *angles* are owned by `assembly.instances[].folds` per ASSEMBLY-SPEC and are set in the 3D/assembly context or by chat, never from the 2D tool |

Rules the judges made non-negotiable:

- **The verb set shown equals the verb set that works.** FOLD ships in v1 (A's deferral of BEND
  was ruled fatal); GLUE/DOWEL are *not* toolbar verbs in v1 — dowels arrive via PUNCH fits +
  chat-authored mechanisms, so no stub buttons exist.
- **No anchor dots by default.** Freeform point-edit is the one pro tool, behind an explicit
  double-click — never the default rendering of a selected part (B's pen-tool cliff, killed).
- **No modes, no overloading.** MOVE/SIZE/point-edit are distinct verbs, not three behaviors of
  one DRAG; TURN exists (B omitted rotate — killed).
- **The Toy Doctor**: validator + statics linter run continuously; green/yellow/red chips pinned
  to the offending geometry in both panes, phrased as shop rules ("this axle wobbles — bearing is
  shorter than 2× its width"), click-to-zoom. Where the linter can compute a fix (resize hole to
  fit band), the chip carries a **one-tap deterministic fix** — deterministic fixes stay
  deterministic and visible, never robot magic. Where it can't, the chip offers "ask Claude to
  fix", which hands that specific failing check to the chat.
- **First run is a remix, not a blank page**, opened with B's **three-line goal card** (the honest
  analogue of Tinkercad's instruction panel, replacing A's overclaimed "hints are the tutorial"):
  *"Drag the blade tip to make it longer. Slide FLAT→BUILT. Print it."*
- **Assembly in v1**: drag-to-reorder Build Order list + chat placement ("put the guard on the
  grip"). **No numeric nudge fields** — typing coordinates is the abstraction this product exists
  to remove (learnability judge's veto). 3D face-snap glue and hole-onto-axle drag are v1.x.

*Rejected: 3D-first solid modeling (all six shipped designs are flat parts + folds + hardware),
freeform bezier as the primary creation path, modal hardware-first PUNCH, C's fold-angle dial in
2D, unlabeled "score"/"laminate" jargon on the toolbar.*

### 2.4 LLM loop: propose → validate → merge → review → commit

Human and LLM edit the same file through the same validated door; only the human commits.

1. **READ** — each chat turn sends Claude the current `design.json`, the spec context `ai.mjs`
   already uses, **the selection + current lint output** ("kid has guard-bowl selected, lint says
   curl too shallow" — C's graft, endorsed by two judges), and **the last few checkpoint labels +
   diffs** so it knows what the humans just did by hand (A's graft, endorsed by the round-trip
   judge). The head checkpoint hash is recorded as the proposal's base.
2. **EDIT** — Claude returns prose or a complete modified `design.json`. Full-document replace,
   deliberately: LLMs botch positional patches, docs are 18–38KB, and the server owning the diff
   is what makes everything downstream possible.
3. **VALIDATE** — the existing validate/repair loop runs server-side before the kid ever sees the
   proposal; failures are auto-repaired or rejected.
4. **MERGE** — three-way merge at the property level against the recorded base (stable ids are
   the anchors). Unrelated edits never conflict. A true same-property conflict renders as the
   two-ghost picker in kid language: *"You made the blade 14in, Claude made it 16 — tap the one
   you want"* (default: keep yours). A's badge UX survives as the surface; B's base-hash mechanism
   is what's underneath — "re-diff with a badge" without a recorded base was ruled fatal because
   it can attribute the kid's own edit to the robot.
5. **REVIEW** — the Mat enters Review mode: before-geometry as dashed gray ghosts under the
   proposal's ink; changed parts pulse; kid-language chips ("Blade: longer, 12→14in", "Wheel
   hole: now snug") hover-highlight their geometry in 2D **and** 3D; a lint banner says "still
   passes all 8 toy checks" or shows what broke. The 3D pane shows the **whole proposal document
   fed to the same viewer with a before/after toggle** — never a dual-document ghost render inside
   the 985-line viewer (buildability judge's veto; this is also the resolved form of A's
   "hold-to-peek"). The ghost-diff is the pedagogy: every accepted robot edit shows which handles
   would have done it by hand.
6. **COMMIT** — Accept writes head + a checkpoint authored "Claude: <its one-line summary>";
   Reject discards. v1 is whole-proposal accept/reject; **part-group Keep/Nope is milestone M5**,
   already supported by the diff/merge machinery.

*Rejected: silent/live LLM co-editing (destroys authorship and the learning channel), JSON-patch
wire formats, full CRDT multiplayer (one family + a turn-based robot), C's no-concurrency-story
(ruled fatal — a kid edit during LLM thinking must never be lost or blindly overwritten).*

### 2.5 Primitive set (summary)

- **Verbs (v1, all functional):** MOVE, TURN, SIZE, COPIES, PUNCH, FOLD.
- **Pro tool:** point-edit behind double-click (no recipes exist, so nothing "cracks" — it's just
  the expert gesture).
- **Shelf starters:** Rectangle/Panel, Disc/Wheel (diameter + fit dial), Strip (slit-count dial),
  Blade, Tab — dials at creation time only, compiled to plain paths server-side.
- **Inspector:** name, count, corrugation, laminate stepper (section view of the 0.15"/layer
  stack is v1.x).
- **Hardware shelf:** the seven allowed kinds, true scale, drop-in adds to `hardware[]`.

### 2.6 MVP cut with build-order milestones

Reuses ~90% of the existing stack: Express server, `schema.mjs` validate + statics linter,
template/guide PDF renderers, `geometry.mjs`, the Three.js viewer, the `ai.mjs` Claude CLI wrapper
with validate/repair.

- **M0 — Draft plumbing + id-reference migration.** In-memory working-draft endpoint per open
  design (`GET/PUT /api/designs/:slug/draft`); viewer embedded via **iframe pointed at the draft
  endpoint — zero refactor of viewer.js** (the `build(design)` extraction is a later optimization,
  not a foundation; buildability judge's substitution for B's refactor prerequisite). Plus the
  reference migration: `schema.mjs` accepts hole refs by id (`{"part": "body-core", "hole": "h1"}`)
  alongside the legacy index form and warns on indices; the statics linter resolves both;
  MECHANICS-SPEC examples, `ai.mjs` GEOMETRY_RULES, and the pirate-sword exemplar move to id refs
  so the few-shot teaches the id form.
- **M1 — First playable.** `/edit/:slug` page: SVG Mat rendering parts from `design.json`
  (path parsing ported from `geometry.mjs`), MOVE/TURN/SIZE/COPIES, selection-synced parts tray,
  inspector, grid, Print button calling the existing PDF renderers. **Acceptance test (also the
  first-run script):** remix pirate-sword, drag the blade 2in longer, slide FLAT→BUILT, print,
  hold the PDF — under 5 minutes, no AI machinery.
- **M2 — Cardboard verbs + Toy Doctor.** PUNCH with the two named fits from the linter's bands;
  FOLD slit tool + CURL helper; Shape Shelf starters (server-side pure functions → plain paths);
  continuous lint chips pinned to geometry with one-tap deterministic fixes; goal card; hole/slit
  stable-id assignment on edit.
- **M3 — History.** Checkpoint writes (accepted proposals + debounced saves), history strip of
  author-colored labeled dots, restore, two-checkpoint ghost-diff view — the structural differ is
  built here and shared with M4's Review mode.
- **M4 — Chat proposals.** `ai.mjs` "edit this design" mode with selection+lint+history context;
  base-hash recording; server-side per-object/per-property differ (~150 lines); three-way merge
  with the two-ghost conflict picker; Review mode with whole-proposal accept/reject, chips,
  before/after 3D toggle; "ask Claude to fix" on non-deterministic lint chips.
- **M5 (v1.x, in order):** part-group Keep/Nope partial acceptance → checkpoint thumbnails →
  laminate section view → 3D place-and-snap assembly (face-to-face, hole-onto-axle) + glue-order
  auto-writing steps → mirror/symmetry tools.

---

## 3. Main screen wireframe

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ ◀ Gallery   PIRATE SWORD (remix)          [Undo] [Redo]   ○●○●○ history   [PRINT] │
├──────────────┬──────────────────────────────────────────────┬──────────────────────┤
│ SHAPE SHELF  │  THE MAT                    1in grid = paper │  FOLD-UP (3D viewer) │
│ ┌──────────┐ │  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐   │                      │
│ │▭ Panel   │ │  ·   ┌─────────────────────────┐         ·   │        /\            │
│ │◯ Wheel   │ │  ·   │  sword-body      ▣──▣   │         ·   │       /  \_____      │
│ │≡ Strip   │ │  ·   └──────────▣──────────────┘         ·   │      | ()_____/      │
│ │▷ Blade   │ │  ·        ▣ = SIZE handles (live inches) ·   │      |  |            │
│ │▭ Tab     │ │  ·   ┌─────────┐   ⊙ hole «LOOSE·spins»  ·   │      |__|            │
│ └──────────┘ │  ·   │ guard   │   ╌╌╌ FOLD score line   ·   │                      │
│ PARTS        │  ·   └─────────┘                         ·   │  FLAT ⟷──●──⟶ BUILT │
│ ▸ sword-body │  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘   │  [▶ Play] [Reset]    │
│ ▸ guard  ×1  │  [MOVE] [TURN] [SIZE] [COPIES] [PUNCH] [FOLD]│  (iframe: viewer fed │
│ ▸ grip   ×2  │                                              │   by draft endpoint) │
│ HARDWARE     ├──────────────────────────────────────────────┴──────────────────────┤
│ ▬ dowel 1/4" │ TOY DOCTOR  ● grip hole too tight for dowel — [Fix it]  ○ 8/8 checks│
│ ∿ rubber band├─────────────────────────────────────────────────────────────────────┤
│ (true scale) │ CHAT  「make the guard swoopier」→ ghost preview → [Keep] [Nope]     │
└──────────────┴─────────────────────────────────────────────────────────────────────┘
```

Review mode overlays dashed gray before-geometry under proposal ink on the Mat; the 3D pane gets a
BEFORE/AFTER toggle; the chat rail becomes the change-chip list.

---

## 4. Exact relationship to the existing pipeline

| Existing asset | Role in Cutting Mat |
|---|---|
| `design.json` (per `reference/FORMAT-SPEC.md`) | THE document. Editor reads/writes it directly. Additive changes only: optional stable `id`s on `holes[]`/`slits[]` entries, and id-based hole refs in `mechanisms[]`/`fitChecks` (legacy index refs readable, warned). |
| `server/src/schema.mjs` (validator + statics linter) | Runs continuously on the draft → Toy Doctor chips; runs on every LLM proposal before review; resolves hole refs by id, accepts the legacy index form with a warning (M0). Fit bands feed PUNCH's LOOSE/SNUG presets. |
| `server/src/render/templates.mjs`, `guide.mjs`, `pdfkit.mjs` | Untouched. The PRINT button calls them; hole crosshair marks appear on templates for free. |
| `server/src/render/geometry.mjs` | Path parse/bbox/sample math ported to (or served for) the Mat's SVG canvas. |
| `server/public/viewer.html` / `viewer.js` | Untouched in v1. Embedded as an iframe fed by the new in-memory draft endpoint; fold semantics, FLAT⟷BUILT, ROLL all come free. `assembly.instances[].folds` remains the sole owner of fold angles. |
| `server/src/ai.mjs` (Claude CLI + validate/repair) | Reused as the proposal engine with an "edit this design" prompt mode and enriched READ context (selection, lint, recent checkpoints). GEOMETRY_RULES move to id-based hole refs in M0. |
| `server/src/index.mjs` (Express) | Gains: `GET /edit/:slug`, draft endpoints, `POST .../checkpoint`, proposal stage/accept/reject endpoints. |
| `designs/<slug>/` | Gains `history/` (snapshot JSONs + metadata). Remix = folder copy to a new slug (existing pattern). |
| `designs/pirate-sword/` (exemplar) | Stays valid, stays the few-shot example — gains hole ids + id refs in M0 so the few-shot teaches the id form; legacy index designs stay readable. |

---

## 5. Conflict resolutions (who was overridden, and why)

1. **Gen recipes.** Judge 1 asked to *fix* A's crack-the-egg with an explicit dialog; Judges 2 and
   3 ruled the dual representation itself fatal. **Overrode Judge 1's repair in favor of
   removal** — with no persisted recipe there is nothing to crack, which also satisfies Judge 1's
   underlying nothing-surprising rule. Buildability (no schema fork) and round-trip safety (no
   recompile clobber) outrank the elegance of editable dials.
2. **Partial acceptance timing.** Judge 2 wanted part-group Keep/Nope *in* the MVP; Judge 3 ruled
   partial-accept-in-v1 a fatal scope flaw. **Overrode Judge 2 on timing only**: whole-proposal
   accept/reject ships first (M4), part-group Keep/Nope is the immediate next milestone (M5), and
   Judge 2's actual mechanism demands — base hash, stable ids, property-level differ, three-way
   merge — are all in v1, so no rework is incurred. Buildability outranks completeness.
3. **FOLD in v1.** Concept A deferred BEND; Judge 1 ruled visible-but-broken verbs fatal.
   **Sided with Judge 1**: the FOLD slit tool ships in M2. Reconciled with Judge 3's veto of C's
   angle dial by scoping FOLD to `slits[]` only — fold *angles* stay owned by
   `assembly.instances[].folds`.
4. **3D proposal preview.** Judge 1 grafted A's simultaneous kraft/blue ghost + hold-to-peek in
   3D; Judge 3 ruled dual-document rendering inside viewer.js a fatal viewer repaint. **Overrode
   Judge 1's rendering detail**: a before/after toggle feeding the whole proposal doc to the
   unmodified viewer delivers the same A/B comparison at zero viewer cost. 2D keeps the full
   simultaneous ghost overlay, which is where the pedagogy lives anyway.
5. **The lint "fix it" button.** Judges 2 and 3 grafted C's hand-the-check-to-Claude; Judge 1
   ruled LLM-mediated *deterministic* fixes fatal. **Both survive, partitioned**: computable fixes
   are one-tap deterministic and visible; only non-computable checks get "ask Claude to fix".
6. **Numeric assembly nudge.** A's v1 fallback; Judge 1 ruled typed coordinates fatal. **Sided
   with Judge 1**: v1 assembly fallback is Build Order list + chat placement only.
7. **Verb naming.** C's material verbs are the best idea in the field (Judge 1) but "score" and
   "laminate" as labels are a hidden tutorial (Judge 1's flaw). **Split the difference**: PUNCH
   and FOLD keep material names because kids' hands know them; SCORE becomes FOLD's rendering,
   LAMINATE becomes a plain stepper in the inspector.
8. **Viewer refactor.** B made `build(design)` extraction a v1 prerequisite; Judge 3 vetoed.
   **Sided with Judge 3**: iframe + draft endpoint in v1; refactor only if debounce latency
   demands it.

---

## 6. Decisions we are deliberately NOT making yet

- **`params`/expressions in the document** — killed for v1 *and* v1.1 by all three judges; will
  not be reconsidered until literal-coordinates + LLM-as-parametric-engine demonstrably fails a
  real family.
- **Persisted shape recipes** of any kind — same bar as above.
- **Realtime co-editing / CRDTs** — one family plus a turn-based robot needs base-hash merge, not
  Figma's sync engine.
- **Branch/merge UI** beyond Remix-a-copy.
- **A 2D constraint solver** — fitChecks that verify and flag beat constraints that drive and
  fight the kid's drag.
- **3D face-snap GLUE / drag-assembly and DOWEL-as-a-verb** — v1.x (M5); until then assembly
  edits flow through the Build Order list and chat.
- **fitCheck authoring UI** — the LLM writes fitChecks when asked to "lock" a relationship.
- **Editing `steps` and `hero` art on the canvas** — remains Claude's job via chat; it is already
  good at them.
- **Checkpoint thumbnails / filmstrip** — labeled, author-colored list first; thumbnails need a
  renderer we refuse to build before M5.
- **Freeform bezier pen as a primary tool** — point-edit stays behind double-click; the Shelf +
  SIZE + chat cover shape creation.
- **New mechanism types** beyond revolute — the linter and viewer define what exists; the editor
  surfaces, never invents.
