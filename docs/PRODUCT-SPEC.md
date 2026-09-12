# Cardboard Studio — Product Specification

**What the product is, who it serves, what it must do, and the rules it must obey — described
completely enough to build, without prescribing how to build it.**

> **Read this first.** This document is deliberately implementation-neutral. It states behaviour,
> data meaning, domain rules, and acceptance criteria. It does not choose a language, a framework,
> a storage format, a network protocol, a rendering library, a layout algorithm, or a delivery
> order. Those are the building team's decisions. Where a number appears (1-inch grid, axle
> diameter + 0.06", 45-second pause), it is a **product requirement** derived from physical
> reality or from the printed-output standard the product is measured against — not a suggestion.
>
> Conventions: **MUST** = required for the product to be correct. **SHOULD** = required unless the
> team can show it conflicts with a MUST. **MAY** = permitted, not required. Requirements are
> grouped by section number so they can be cited in review.

---

## Table of contents

- **Part I — The product**: 1. Summary · 2. Users and use cases · 3. Principles · 4. Glossary
- **Part II — The document**: 5. The design document · 6. Coordinate and unit conventions
- **Part III — Surfaces**: 7. The Workshop · 8. The printable bundle · 9. The fold-up view ·
  10. The Cutting Mat · 11. The design assistant
- **Part IV — Rules**: 12. Validation and the toy-statics rule engine
- **Part V — Collaboration**: 13. Drafts, history, proposals, and merge
- **Part VI — Qualities**: 14. Non-functional requirements
- **Part VII — Proof**: 15. Quality bar and acceptance
- **Part VIII — Ahead**: 16. The ideal end state · 17. Deliberate non-goals

---

# Part I — The product

## 1. Summary

Cardboard Studio is a private family workshop application. A parent and a child invent a cardboard
toy together in conversation, and the product turns that idea into a **buildable printed template
bundle**: actual-size cut sheets they tape together and trace onto cardboard from the recycling
pile, plus an illustrated step-by-step assembly guide. Between the idea and the printer sits an
editor — the **Cutting Mat** — where the family can change the design directly, with the design
assistant proposing changes they review and approve, and a live 3D preview that folds the flat
parts up into the finished toy as they work.

Three things separate it from a clip-art or shape-generator product:

1. **The output is a real manufacturing document.** Everything printed is at 100% scale. A one-inch
   grid square measures one inch with a ruler. Parts that span several sheets re-align exactly when
   the sheets are overlapped. The bar is a commercially sold cardboard-template bundle, and the
   test is always *"could a parent and kid actually build from this?"*
2. **The designs are functional toys, not shapes.** Wheels must spin on their axles, lids must
   close over their boxes, a sword must survive being swung at a sibling. The product measures the
   real geometry of every design against physical rules before it will print, and it explains
   failures in shop language.
3. **The child is an author, not a consumer.** Every automated edit is proposed and reviewed, never
   silently applied; the child's own edits always win by default; nothing anybody makes can be lost
   by pressing the wrong button.

## 2. Users and use cases

### 2.1 Who uses it

| User | Description | What they need |
|---|---|---|
| **The child** (primary, ~5–12) | Has the idea, drives the ideation chat, drags things on the Mat, decides what to keep. May not read fluently, may not know fractions, will not read documentation. | Direct manipulation, plain words, immediate visible feedback, no syntax, no way to break anything permanently. |
| **The parent** (co-pilot) | Runs the printer, holds the knife, judges whether the build is realistic, keeps the session moving. | Trustworthy output, honest warnings, a print that works the first time, no surprise cost. |
| **The design assistant** (non-human author) | Generates the first design from a brief and proposes edits on request. | A single well-defined document to read and write, a validator that tells it what is wrong, and a review gate it cannot bypass. |

There is no account system, no multi-tenancy, and no audience beyond the household. The product
serves one family on their own equipment.

### 2.2 The five use cases the product exists for

**UC-1 — Invent and print (the core loop).**
A child says "a dragon shield!". The family talks with the assistant until the idea is concrete —
what it is, roughly how big, what it must do. The product generates a complete design, checks that
every part physically fits, renders the printable bundle, and offers it. The family prints the cut
sheets at actual size, tapes them, traces onto cardboard, and builds using the guide.
*Success: a finished cardboard toy in the child's hands the same afternoon.*

**UC-2 — Change something (the edit loop).**
The blade is too short; the wheels are too small; the crown doesn't fit. The family opens the
design on the Cutting Mat, drags the part to a new size, watches the 3D preview fold up with the
change, and prints again. No text editing, no numbers typed, no regeneration from scratch.
*Success: a targeted change, printed and verified, in minutes.*

**UC-3 — Ask for help (the collaboration loop).**
The change is beyond dragging — "make the guard swoopier", "add a handle on the back", "why does
this wobble?". The family asks in chat. The assistant answers, or proposes a complete edit that the
family reviews as a visible before/after overlay and then keeps or discards.
*Success: the child understands and chooses; the assistant never changes the toy by itself.*

**UC-4 — Fix a real-world failure (the diagnostic loop).**
Something is wrong: the axle binds, the toy tips over, a panel creases. The product has already
said so — the same rules run continuously while editing, surfacing plain-language findings pinned
to the exact geometry at fault, with one-tap corrections where the correct number is computable.
*Success: the family fixes the toy before wasting a print run and an hour of cutting.*

**UC-5 — Go back (the safety loop).**
An edit turned out badly, or somebody wants yesterday's version. The design's history shows every
saved state, who made it, and what changed, and any of them can be brought back — without
destroying anything made since.
*Success: no fear of experimenting.*

### 2.3 The session the product is designed around

A realistic session is 20–90 minutes at a kitchen table, with a laptop, a printer, a stack of
flattened boxes, tape, a pencil, a craft knife in an adult's hand, and a hot glue gun. The child's
attention is the scarcest resource in the system. Every requirement in this document should be read
against that: **a wait longer than a few seconds needs something to watch; an error needs a
sentence a nine-year-old can act on; a print that comes out at 94% scale wastes the whole
afternoon.**

## 3. Principles

These decide arguments. When two requirements conflict, the earlier principle wins.

**P-1 — The printed sheet is the product.** Screens are intermediate. Everything else in the system
exists to make an accurate piece of paper. Any feature that improves the screen at the expense of
the print is wrong.

**P-2 — Actual size, always.** No scaling, no "fit to page", no approximation. A dimension in the
document is a dimension on the cardboard.

**P-3 — Toys must work.** Correctness is measured against physics — fits, clearances, stiffness,
stability — computed from the real geometry, never from what the design claims about itself.

**P-4 — One document.** There is exactly one representation of a design. No source/derived pair, no
recipe that recompiles over hand edits, no second format for the editor. Every tool — generator,
validator, renderers, 3D view, editor, assistant — reads and writes the same document.

**P-5 — Literal geometry.** Shapes are stored as explicit coordinates. There are no parameters,
expressions, formulas, or dependency graphs inside the document. Nothing cascades; nothing can
break by recomputation.

**P-6 — Symmetric editors, asymmetric commit rights.** The child, the parent, and the assistant all
edit the same document through the same validated door. Only a human commits. The assistant's work
is always staged for review.

**P-7 — Nothing is ever lost.** History only grows. Undo covers human and machine edits equally.
Concurrent edits reconcile; they never overwrite.

**P-8 — Failures are sentences, not codes.** Every problem the product detects is explained in shop
language, pointed at the geometry that is wrong, and — where the right number is computable from
the geometry — offered as a one-tap correction. Where it is not computable, the product offers no
button rather than a guess.

**P-9 — No syntax, ever, for the child.** No typed coordinates, no expressions, no path data, no
units to convert. The canvas is drawn at true scale on the same grid the paper carries, so the
deepest abstraction in drafting — units and scale — does not exist in the interface.

**P-10 — What is shown, works.** No disabled buttons, no stubs, no tools that only do half of what
their name says.

**P-11 — Household materials only.** Corrugated cardboard from the recycling, plus a short list of
things a family already has or can buy at any craft or hardware store. Nothing custom, nothing
ordered, nothing exotic.

**P-12 — Private by default.** A family's designs, conversations, and history live on the family's
own equipment, and the product must be usable with no account. The one boundary is the AI provider
an adult chooses: asking the assistant sends the design and the conversation to it. That choice is
theirs, it is stated plainly where it is made, and a provider that keeps everything inside the house
must remain one of the options (§14.2).

## 4. Glossary

| Term | Meaning |
|---|---|
| **Design** | One toy: the complete document describing its parts, rules, steps and artwork. Identified by a stable, human-readable slug. |
| **Bundle** | The printable output of a design: cut sheets in each supported paper size, plus the assembly guide. |
| **Part** | One cardboard shape to be traced and cut, possibly cut more than once. |
| **Outline** | A part's exterior cut line: a closed shape. |
| **Hole** | An interior cut-out in a part (eye hole, axle hole, slot). |
| **Slit / score line** | A line cut part-way through the cardboard so the part bends there. Also called a score or crease. |
| **Backing** | An optional second, slightly larger copy of a part, drawn as a dashed outline, used as an underlay layer. |
| **Corrugation** | The direction of the flutes inside corrugated cardboard. Strength and bendability depend on it. |
| **Laminate** | Gluing a part's identical copies face-to-face into one thicker, stiffer piece. |
| **Hardware** | A non-cardboard component: dowel, skewer, straw, string, brad, rubber band, paper clip. Never appears on a cut sheet. |
| **Mechanism** | A declared moving joint — which parts spin on which hardware, and which holes are loose and which are tight. |
| **Assembly** | The description of where every piece ends up in the finished toy, and how each part folds. Drives the 3D preview and the build order. |
| **Fit check** | A declared measurement relationship between two pieces that the product verifies against the real geometry ("this wrap must be as long as that curved edge"). |
| **Finding** | One problem the rule engine detected, in plain language, anchored to specific geometry, sometimes carrying a correction. |
| **The Mat** | The editing canvas: the printed template, at true scale, that can be manipulated directly. |
| **Toy Doctor** | The always-on presentation of findings while editing. |
| **Draft** | The in-progress working state of a design being edited, distinct from the last saved version. |
| **Checkpoint** | An immutable, complete snapshot of a design with an author and a one-line summary. |
| **Proposal** | A complete edited design offered by the assistant, staged for human review. |
| **Remix** | A copy of an existing design under a new identity, edited independently. |

---

# Part II — The document

## 5. The design document

### 5.1 Status

A **design document** is the single, complete, self-contained description of one toy (P-4). It MUST
be sufficient on its own to produce the cut sheets, the assembly guide, the 3D preview, and every
validation result. No part of a design may live outside it except its history (§13.2) and its
rendered output.

The document MUST be human-readable and hand-editable. A family member or engineer able to read
structured text MUST be able to open a design, understand it, change a number, and have the product
accept the result if it is valid — including designs written entirely by hand.

### 5.2 Identity and metadata

Every design MUST carry:

- **Slug** — a stable lowercase hyphenated identifier, unique across the family's designs. It names
  the design's storage location and its addresses in the interface. It MUST NOT change after
  creation; renaming a design changes its title, never its slug.
- **Title** — the display name ("Pirate Cutlass").
- **Tagline** — one enthusiastic sentence describing the finished toy.
- **Category** — one of: armor and weapons; crowns, helmets and hats; chests and boxes; furniture;
  vehicles; photo props; playsets; garages and car play; letters and numbers. Category affects
  rules (§12.7, §12.9) and MUST be validated against the known set.
- **Difficulty** — 1, 2, or 3.
- **Age range** and **build time** — short human strings shown to the family before they commit an
  afternoon.
- **Finished size** — the assembled object's width and height in inches, plus depth. Depth is
  REQUIRED for any category that produces a three-dimensional object (boxes, furniture, vehicles,
  playsets, garages); flat props MAY omit it. Each dimension MUST be positive and at most 96
  inches.
- **Materials** and **Tools** — human-readable lists shown on the guide's "what you need" page.
- **Creation timestamp** and the originating **brief** (§7.2), when the design was generated rather
  than hand-written.

### 5.3 Parts

A design MUST have at least one part. Each part carries:

- **Identifier** — stable and unique within the design. Identifiers are the product's *reference
  currency* (§5.9); they MUST NOT change once assigned.
- **Name** — human-readable, shown on the cut sheet label and in every list ("Sword Body").
- **Count** — how many times this shape must be cut. A positive whole number.
- **Outline** — the exterior cut line, as a closed shape in inches (§6.1).
- **Holes** — zero or more interior cut-outs, each with its own stable identifier and shape.
- **Slits** — zero or more score lines, each with its own stable identifier and shape.
- **Backing** (optional) — one larger outline drawn dashed, meaning "cut a second, larger copy of
  this".
- **Corrugation** — `vertical` or `horizontal`: the direction the cardboard's flutes must run for
  this part.
- **Laminate** (optional) — true when the part's copies are glued into one stiff stack; absent when
  the copies are separate items (five jewels, two wheels). This distinction changes structural
  calculations (§12.7) and the guide's wording.
- **Label position** and **arrow position** (optional) — preferred spots for the printed part label
  and corrugation arrow, which the sheet renderer MAY override to avoid collisions (§8.3).
- **Layout** (optional) — where the part sits on the printed sheet, as a position and a rotation in
  the shared template space (§6.2). Present when a human has arranged the sheet by hand.

### 5.4 Fit checks

A **fit check** is a declared, machine-verifiable statement about how two pieces meet. Each carries:

- A **reason** in plain language ("lid wrap must cover the arch's curved edge").
- Two **measurements**, each being either a literal inch value or a measurement taken from real
  geometry: a part's width, height, or outline perimeter; the length of a named edge of a part; or
  the width or height of a named hole.
- An **operation**: `match` (the two agree within a tolerance, default ⅛"), `clearance` (the first
  exceeds the second by between a minimum and maximum, default 0.05"–0.6"), or `atLeast` (the first
  is at least the second).

Fit checks are **verification, never construction**: they measure and report, they never move
geometry (P-5). See §12.4 for when they are required and how they are enforced.

### 5.5 Hardware

Zero or more non-cardboard components. Each carries a stable identifier, a **kind** from the
permitted list (dowel, skewer, straw, string, brad, rubber band, paper clip — P-11), the dimensions
its kind requires (round stock MUST declare diameter and length), a **count**, a shopping-list
**label** ("¼-inch wooden dowel, 9 inches long"), and a **source** hint ("craft store, hardware
store, or the garage").

Hardware MUST NOT appear on cut sheets. It MUST appear in the guide's what-you-need list, in the
steps that use it, and in the 3D preview.

### 5.6 Mechanisms

Zero or more declared moving joints. The product supports one kind today: a **revolute** joint —
the rolling-wheel pattern. A revolute mechanism carries a stable identifier, the **hardware** item
serving as its axle (which MUST be round stock), a set of **bearings** (part + hole references
naming the loose holes the axle spins inside), a set of **hubs** (part + hole references naming the
tight holes glued to the axle), and the set of **assembled pieces that spin with it**.

A design MUST declare a mechanism for anything intended to move. The rule engine measures whether
the declared mechanism can actually work (§12.6).

### 5.7 Assembly

The assembly block describes the finished toy. It carries the **cardboard thickness** used for the
build (0.1"–0.25"; single-wall is 0.15") and a list of **instances**. Each instance places one
physical copy of one part — or one piece of hardware — and carries:

- A stable **identifier**.
- Which **part** (and which copy number) or which **hardware** item it places.
- Its **final position and orientation** in the finished toy (§6.3).
- A **build order** value. Instances sharing a value are assembled at the same time; gaps between
  values are meaningful (they give a long fold more time in the animation, §9.3).
- The **step** it belongs to, so the preview can caption itself from the written instructions.
- Whether it is **mirrored** (a back-side copy).
- Its **folds**: for each hinge in the part, how far it bends. A fold may name one slit or apply the
  same angle to every slit. No angle may exceed 178°.

**Folds live here and only here.** A part's slits say *where* it bends; the assembly says *how far*
(§10.4). This separation is required so that the same part can be used bent differently in two
places, and so that 2D editing can never silently change the 3D shape.

Assembly SHOULD cover every copy of every part. A part no instance places is not attached to
anything, and is treated accordingly by the rules (§12.4).

### 5.8 Steps and cover art

**Steps** are the written build, in dependency order: 4–8 of them for a typical design. Each step
carries a **title** ("Step 3. The Knuckle Guard"), 2–4 short imperative **instructions** ("Glue the
two blade layers together."), zero or more **figures**, an optional **check** line telling the
family how to know the step worked, and an optional **tip**.

A **figure** is a diagram drawn from the same geometry as the cut sheets — never a photograph and
never separately authored artwork. A figure may show one part's template outline; several real
parts placed in a shared space to show how they meet (including ghosted placements meaning "this is
where it lands"); free-drawn diagram paths; labelled arrows showing alignment or glue direction;
and callout text.

**Cover art** is a flat, bold illustration of the finished build, drawn as filled shapes in the
same coordinate style. It appears on the guide's cover and as the design's thumbnail in the
gallery. 6–20 shapes: simple, iconic, proud.

### 5.9 Identifiers are the reference currency

Every cross-reference in a design — a mechanism naming a bearing hole, a fit check naming a hole to
measure, a figure naming a part, an assembly instance naming a part or a slit — MUST name a stable
identifier, never a position in a list.

This is a hard requirement with three consequences the product depends on:

1. Inserting a hole cannot silently re-aim a mechanism at the wrong hole.
2. Differences between two versions of a design can be attributed to the right object, which is
   what makes review, history, and merge possible (§13).
3. A finding can be pinned to the geometry that is wrong, which is what makes the Toy Doctor and
   one-tap fixes possible (§12.10).

Positional references MAY be accepted for backward compatibility with documents written before this
rule, but the product MUST report each one as a warning naming the risk, and MUST NOT produce new
ones. Any part, hole, or slit lacking an identifier MUST be given one automatically when a design is
opened for editing.

## 6. Coordinate and unit conventions

### 6.1 Shape coordinates

- All part geometry is expressed in **inches**, with **y increasing downward** — the orientation of
  a sheet of paper read normally.
- Shapes use straight segments and polynomial curves only. **Elliptical arcs are not permitted**;
  round shapes are drawn with cubic curves. (This is a portability requirement: every consumer of
  the document — sheet renderer, 3D preview, editor canvas, measurement code — must interpret shapes
  identically, and the smaller the shape vocabulary, the cheaper that guarantee is.)
- A part outline MUST be **closed** — it must return to its starting point — because it is a cut
  line.
- Holes and slits are expressed in the same space as their part's outline. Holes MUST lie entirely
  inside the outline. Slits MUST lie within the outline.

### 6.2 Template space (2D)

The cut sheets exist in one shared **global inch space**, y-down, with its origin at the top-left of
the assembled sheet layout. All parts are placed in this one space; pages are windows onto it
(§8.2). The editor canvas MUST be the same space at true scale, so that what the family arranges on
screen is literally what prints.

When parts carry hand-authored layout positions, the semantics MUST be unambiguous and shared by
every consumer: **the part's un-rotated bounding box's minimum corner lands at the given position,
and the part then rotates by the given angle about the centre of that placed box.** The whole part —
outline, holes, slits, backing — moves as one rigid body.

### 6.3 World space (3D)

The finished toy exists in a **y-up** space measured in inches, with the ground plane at y = 0
representing the table. A part's own 2D coordinates map into its local 3D frame such that the
template's x runs along local X, the template's downward y runs along local −Y, and thickness
extrudes toward +Z, out of the part's front face. A positive fold angle bends the far side of the
hinge toward the front face — so that the printed front becomes the inside of a curl.

---

# Part III — Surfaces

The product presents four surfaces. Each MUST be reachable directly and durably: a design, its 3D
preview, and its editor each have a stable address a family member can bookmark or return to.

## 7. The Workshop

The Workshop is the front door: where designs are invented and where finished bundles are collected.

### 7.1 The gallery

- MUST list every design the family has made, each showing its cover art as a thumbnail, its title,
  tagline, category, and difficulty.
- Each entry MUST offer: the printable files, the 3D preview, and the editor.
- Selecting a design MUST show its detail: the same summary information, its finished size, age
  range, build time, the full downloadable bundle, and a preview of its parts.

### 7.2 Ideation

- The family converses with the design assistant in short turns. The assistant MUST reply briefly
  and playfully, ask at most one question per turn, and steer toward exactly one buildable idea
  with a rough size.
- The assistant MUST be able to accept an empty prompt ("surprise us") and propose something.
- When and only when the idea is concrete enough to build, the product MUST offer a **build brief**:
  a short paragraph naming the object, its size in inches, its key features, and its difficulty.
  The brief is the contract between conversation and generation.
- The family MUST be able to see the brief, and MUST explicitly choose to generate from it. The
  product MUST NOT begin generating on its own.

### 7.3 Generation

- Generating a design from a brief is a long operation — **minutes, not seconds**. The product MUST
  treat it as a job: the family gets a live progress account of what is happening and how long it
  has been going, and the page MUST be safe to leave and come back to.
- Progress MUST be informative rather than decorative: what stage the work is at, how much of the
  design has been drafted, and — when a draft fails its checks — how many problems were found and
  an example of one.
- Generation MUST be **validated before delivery**: no design that violates the rules in §12 is ever
  handed to the family. When a draft fails, the product MUST feed the specific failures back for
  correction and retry, at least twice, before giving up.
- On failure the product MUST say so plainly, in the family's language, without leaving a
  half-created design in the gallery.
- On success the product MUST render the full bundle and add the design to the gallery.

### 7.4 Re-rendering and remixing

- Any design MUST be re-renderable on demand, producing a fresh bundle from the current document.
  This is what makes hand-editing the document a supported workflow (§5.1).
- **Remix** MUST duplicate a design under a new slug, with its own independent history. This is the
  product's only branching concept (§17).

## 8. The printable bundle

The bundle is the product (P-1). Its standard is the commercial cardboard-template bundle described
in the project's format reference, and every requirement in this section exists because a family
building from paper needs it.

### 8.1 What a bundle contains

- **Cut sheets in US Letter.**
- **Cut sheets in A4**, as a genuinely separate tiling of identical geometry — never a scaled copy
  (P-2). The same design tiles differently onto a narrower, taller page, and both MUST be correct.
- **One assembly guide**, page size Letter portrait.
- File names MUST identify the design and the paper standard unambiguously.

### 8.2 Cut sheets: the grid and the tiling

- Every page MUST carry a **1-inch light grid** and a **3-inch heavier grid**, edge to edge, behind
  everything else. The grid is **global**: it continues seamlessly across page boundaries so that
  parts spanning several sheets re-align when the sheets are joined.
- Adjacent pages MUST **overlap by one inch**. The family overlaps the physical sheets until the
  visible grid squares are exactly one inch and three inches, and tapes them there.
- Every page MUST carry a **giant, pale page numeral** behind the artwork, numbered within its file.
- Every page MUST carry a **footer** stating which sheet it is, of how many, and which sheet joins
  it on which side.
- **Registration marks** MUST be printed at identical global coordinates inside each overlap strip,
  so that matching marks on two sheets confirm alignment. They MUST be placed where they do not
  collide with cut lines.
- No geometry may be placed where a home printer cannot print it: all content MUST stay at least
  ~0.35" inside the page edge. **This requirement survives hand-arranged layouts**: if a family
  arranges parts such that some geometry would fall outside the printable area, the product MUST
  slide the entire arrangement as one rigid body to bring it back inside, preserving every relative
  position exactly. Losing a part off the edge of the sheets silently is a defect of the highest
  severity — it wastes a whole print run and is invisible until the cardboard is already cut.

### 8.3 Cut sheets: the artwork

- **Cut lines** — part outlines and holes — MUST be bold, solid black, unmistakably heavier than
  anything else on the page.
- **Score lines** (slits) MUST be thin and dashed, visibly different from cut lines, and MUST carry
  or reference the instruction that they are cut part-way through from the back.
- **Backing outlines** MUST be dashed grey and annotated as a second, larger copy.
- Every part MUST carry a **label** stating its name and how many to cut ("Sword Body — 2 pcs").
  Labels MUST: never cross another part's cut lines, never overlap another label, never be clipped
  by a page edge, and MAY be rotated to read along a tall narrow part. A label that cannot be placed
  legibly on a page MUST be omitted from that page rather than printed broken.
- Every part MUST carry a **corrugation arrow** showing which way the flutes must run.
- Every **hole 0.75" or smaller** MUST carry a crosshair centre mark and a small diameter note
  ("Ø 0.31" — punch or drill"), placed under the same collision rules as labels. Identical holes on
  one part MAY share one note.
- Each bundle MUST include a **key**: the cut-versus-score legend, the piece list with counts, the
  lamination note where relevant, a printed one-inch scale check, and a map of how the sheets tile.
  The key MUST be placed in provably empty space, never over artwork.
- The cut sheets MUST open with a **layout overview page** showing the whole arrangement in
  miniature, so the family can see what they are about to tape together.
- Parts MAY span pages freely; the grid and overlap system is what reassembles them. When parts are
  auto-arranged, the arrangement SHOULD avoid splitting a part across a seam if it fits on one page,
  and SHOULD fill each sheet before starting the next, so no sheet prints as empty grid.

### 8.4 The assembly guide

The guide MUST follow this page sequence. Each page's *content* is required; its visual treatment
is not specified here beyond legibility.

1. **Cover** — the design's title, "step by step guide", the cover art, and the studio's identity.
2. **What you need** — materials, hardware (with counts and where to get it), tools, and a **safety
   note** stating that craft knives and hot glue are grown-up jobs and naming what the child does
   instead (trace, fold, tape, decorate).
3. **Paper size** — a comparison of A4 and Letter with dimensions in both millimetres and inches,
   an explanation of which file to print, and what differs between them.
4. **Printer setup** — a prominent warning that the printer MUST be set to 100% / actual size, with
   an annotated illustration of the relevant print-dialog setting. This page prevents the single
   most expensive failure in the whole product.
5. **Page overlap and positioning** — numbered explanation of the overlap margin, the 1-inch and
   3-inch grids, and how to align to a 3×3 square; plus a map of how this design's sheets arrange.
6. **Tracing** — at least two methods (cut out the template and trace around it; tape it down and
   transfer by pressure or tracing wheel), as numbered steps.
7. **Working with cardboard** — flute direction, cutting score lines so a panel bends smoothly,
   creasing them, and the technique for peeling one face layer to make a clean glue surface.
8. **Cutting and gluing tips** — how to cut cardboard safely (sharp blade, metal straightedge,
   several light passes) and how to glue it (hot glue for structure, white glue for laminating).
9. **Sizing** — for anything worn on the body, how to measure the wearer and which score mark to
   choose before gluing.
10. **Step pages** — one titled section per step, each combining its figures, its numbered
    instructions, its check line, and its tip.
11. **Back page** — the studio's mark, the personal-use license, and attribution.

Requirements that hold throughout the guide:

- Instructions MUST be terse, imperative, and friendly. Safety notes appear where the danger is.
- Every figure MUST be generated from the design's own geometry, so that a diagram can never
  disagree with the cut sheet.
- Where the design has hardware, the guide MUST say what it is, how much of it, and where to get it.
- Page count follows content; the guide MUST NOT pad or truncate steps to fit a page target.

## 9. The fold-up view

An interactive three-dimensional view of the design, in the browser, with no installation.

### 9.1 What it shows

- Every part extruded to the design's real cardboard thickness, using the **actual cut paths** —
  including holes and the real outline. It MUST NOT use a simplified or separately authored model.
- Cardboard-like surfacing: kraft faces, darker cut edges, and crisp edge lines so the shapes read
  as die-cut board. A contact shadow on the ground plane.
- Hardware rendered at true dimensions as wooden stock.
- A background and palette consistent with the rest of the product.

### 9.2 Folding

- A part's slits that run all the way across it are **hinges**. The part's surface is divided by
  those lines into regions, and the regions hinge relative to one another by the angles the assembly
  declares.
- Hinges MUST be handled as a **tree, not a chain**: a box net has one flat region with flaps
  folding away from it in several directions, and each flap's own sub-flaps folding again. A fan of
  parallel slits (a curled knuckle guard, a crown band) is the simple case of the same mechanism.
- Holes and short slits that do not span the part are not hinges; they belong to whichever region
  contains them.
- A crease is a very tight bend; the same mechanism produces both a box corner and a smooth curl,
  matching how cardboard actually behaves.

### 9.3 The build animation

- A single **FLAT ⟷ BUILT** control sweeps the whole design between two poses.
- At FLAT, every piece lies flat on the table, unfolded, arranged in a non-overlapping spread that
  roughly matches the cut-sheet layout.
- At BUILT, every piece is in its final place in the finished toy.
- In between, each piece moves during the window its build order gives it, with successive orders
  overlapping slightly so the assembly reads as a continuous process. Position, orientation, and
  fold angles all animate together and ease in and out.
- The control MUST show **step markers**, and the view MUST caption itself with the current step's
  title as the sweep passes it, so the animation and the written guide are visibly the same build.
- A play/pause control MUST sweep the whole build in roughly eight seconds. A reset control MUST
  restore the default camera.
- The camera MUST frame the assembled toy automatically on open, and MUST be orbitable, and MUST NOT
  be lost when the scene is rebuilt after an edit.

### 9.4 Motion and linkage

- Pieces that spin with a mechanism MUST rotate about their real axle axis.
- For designs with a rolling mechanism, a **ROLL** control MUST move the finished toy along the
  ground with wheel rotation matching distance travelled — honest kinematics, never a canned
  animation.
- A **parts list** beside the view MUST let the family highlight a part and see exactly which pieces
  in the 3D scene it becomes, and the reverse. This is the link between the flat sheet and the
  finished object, and it is how a family works out which traced shape is which.

### 9.5 Draft mode

The fold-up view MUST be able to show work in progress rather than the saved design, and MUST accept
live updates while the family edits — rebuilding the scene without losing the camera position or the
FLAT⟷BUILT position (§10.2).

## 10. The Cutting Mat

The Mat is the editor: a true-scale two-dimensional canvas that *is* the printed template, with the
fold-up view beside it, findings beneath it, and the assistant in a rail alongside.

### 10.1 The canvas

- MUST render the design at **true scale** on the same 1-inch and 3-inch grid the sheets print, in
  the same orientation (P-9). Zoom and pan are available; the grid and the inch readouts stay
  honest at every zoom.
- MUST open showing exactly what the design's sheets currently print, so that the editor and the
  printer never disagree at the moment of opening.
- MUST snap movement and sizing to **quarter inches** by default, and rotation to 15°, with a
  modifier to move freely.
- MUST draw holes, score lines, and backing outlines exactly as the sheets draw them, so that
  reading the Mat teaches reading the sheet.
- MUST support selection, and selection MUST stay synchronised between the canvas, the parts list,
  and the inspector.

### 10.2 The panes

- **Parts tray** — one row per part with its name and count; selecting either way.
- **Shape shelf** — a small set of starter shapes the family can drag onto the Mat instead of
  drawing: a panel, a disc or wheel, a slitted strip, a blade, and a glue tab. Each starter offers a
  few plain dials at the moment of creation (width and height; diameter and hub hole; length, width
  and number of score lines). Once created, a starter is an ordinary part with ordinary coordinates:
  **the dials are not remembered and nothing recompiles later** (P-5). Re-shaping later is done with
  the sizing handles or by asking the assistant.
- **Hardware shelf** — the permitted hardware kinds, **drawn at true scale on the Mat's grid**, so a
  quarter-inch dowel chip is visibly a quarter inch. Dragging one into the design adds it to the
  design's hardware list. A true-scale dowel visually explains its own hole size, which is the point.
- **Inspector** — the design's underlying document, readable, which MUST scroll to and briefly
  highlight whatever property just changed. This is the product's honesty mechanism: every gesture
  visibly writes something specific, and a curious child or parent can watch it happen.
- **Fold-up pane** — the 3D view (§9), fed the working state and updated within about a second of an
  edit, with the FLAT⟷BUILT control always visible.
- **Toy Doctor strip** — the findings (§10.5).
- **Chat rail** — the assistant (§10.7). It MUST NOT cover the Mat.
- **Goal card** — on first opening a design, three short lines telling the family what to try
  ("Drag the blade tip to make it longer. Slide FLAT→BUILT. Print it."). Dismissible, and
  recallable.

### 10.3 The working state

- Editing operates on a **draft** — a working copy distinct from the saved design. Printing a draft,
  previewing it, and editing it MUST NOT alter the gallery's copy of the design.
- The draft MUST be validated continuously as it changes. **An invalid draft is a normal state of
  editing**, not an error condition: the family is mid-gesture and the findings strip is doing its
  job. The product MUST hold an invalid draft, show what is wrong, and keep working — while
  refusing to let it become a saved design or a checkpoint (§12.11).
- **PRINT** MUST render the current draft to a preview bundle the family can print immediately,
  without touching the saved design.
- **SAVE** MUST write the draft as the design and re-render its real bundle, after confirming.
- Discarding the draft MUST be possible, returning to the last saved state.
- Undo and redo MUST cover every change in the editor — including restores from history and
  accepted assistant proposals (P-7).

### 10.4 The verbs

Six verbs, every one of them fully functional (P-10):

| Verb | Gesture | Effect |
|---|---|---|
| **MOVE** | Drag the part | Changes where it sits on the sheet. |
| **TURN** | Rotate handle | Changes its orientation on the sheet. |
| **SIZE** | Corner and edge handles, with live inch readouts | Rescales the whole part coherently — outline, holes, slits and backing together. Corner handles scale uniformly about the opposite corner; edge handles scale one axis about the opposite edge. Minimum feature size is enforced. |
| **COPIES** | A stepper | Changes how many to cut. Laminated stacks are simply large counts. |
| **PUNCH** | Click a spot on a part | Creates a hole, and offers a fit chooser (§10.6). The hole can then be resized by dragging a ring, with a live diameter readout. Dragging a hole near a hardware chip re-offers that hardware's fits. |
| **FOLD** | Drag a line across a part | Creates a score line, snapped to horizontal or vertical when close, trimmed to the part's outline. A **CURL** helper turns one drag into a fan of evenly spaced parallel score lines, with a live count. |

Rules that bound the verb set:

- **PUNCH and FOLD MUST be non-modal** — no "choose the hardware first, then punch" ordering.
- **FOLD writes score lines only.** Fold *angles* belong to the assembly (§5.7) and are set in the
  three-dimensional context or by asking the assistant. A two-dimensional tool must never silently
  change the finished shape.
- Freeform point-by-point editing is the one expert tool, and MUST be reachable only by deliberate
  action, never the default rendering of a selected part.
- **No typed coordinates anywhere** (P-9). Positions, sizes, and angles are set by gesture with live
  readouts.
- Every gesture writes a specific, visible property; nothing cascades to anything else.

### 10.5 Toy Doctor

- The full rule engine (§12) MUST run continuously against the draft and present its findings as a
  strip of chips: green when the design passes, amber for warnings, red for errors.
- Each chip MUST state the problem as a shop rule in one sentence ("this axle wobbles — the bearing
  is shorter than twice its width"), name the part at fault, and — on click — zoom the Mat to the
  offending geometry and flash it.
- Chips whose correct value is computable from the geometry MUST carry a one-tap **FIX** that
  applies the correction as a visible geometry change, recorded in undo like any other edit.
- Chips whose correct value is a judgement call MUST NOT carry a fix. They MUST instead offer to
  hand that specific finding to the assistant — pre-filling the chat with the shop-rule sentence and
  letting the family press send themselves, never sending automatically (P-8, P-6).

### 10.6 The two named fits

The product speaks about round holes in exactly two numbers, everywhere — in the PUNCH chooser, in
findings, and in one-tap fixes:

- **LOOSE so it spins** — hole diameter = axle diameter **+ 0.06"**.
- **SNUG so it grips** — hole diameter = axle diameter **+ 0.01"**.

These sit inside the tolerance bands the rule engine enforces (§12.6). The requirement is that the
chooser, the finding, and the fix can never disagree with one another: one number per fit, defined
once, used by every surface.

### 10.7 History and the assistant on the Mat

The Mat MUST present the design's history as a compact strip of markers in chronological order,
coloured by author (the family in kraft, the assistant in crimson), each naming what changed, with
the ability to restore any of them or compare any of them against the current state (§13.2).

The Mat MUST present the assistant as a chat rail that proposes reviewable edits (§13.3). While the
assistant is thinking, **editing stays completely live** — the family keeps working, and
reconciliation happens at review time, not by locking them out.

## 11. The design assistant

The assistant is a functional component with three jobs. This section states what it must do and the
guarantees around it; it does not specify how it is implemented — and deliberately does not name
which AI service performs it, because that is a setting the family controls (§11.5, §14.2).

### 11.1 Its three modes

1. **Ideate** (§7.2) — converse toward one buildable idea and produce a brief.
2. **Generate** (§7.3) — turn a brief into a complete, valid design document.
3. **Propose** (§13.3) — read the design a family is editing and answer their request, either in
   prose or with a complete edited design.

### 11.2 What it must be told

For a proposal, the assistant MUST be given: the complete current working document; what the family
currently has selected; the current findings (so it does not "fix" one thing by breaking another);
the recent history summaries (so it knows what the humans just did by hand and does not undo it);
and the recent conversation.

### 11.3 Guarantees

- **G-1 — Validated before shown.** No design the assistant produces reaches the family without
  passing the rule engine. When it fails, the product MUST tell the assistant exactly what failed
  and let it correct, bounded by a small number of attempts, before reporting an honest failure.
- **G-2 — Never silently applied.** An edit from the assistant is always staged for human review
  (P-6).
- **G-3 — Identity preserved.** The assistant MUST NOT change the design's slug, or rename any
  existing part, hole, or slit identifier. Renaming one unhooks the mechanisms, assembly, fit checks
  and history from the geometry they describe. The product MUST enforce this on the result, not
  merely request it.
- **G-4 — Arrangement preserved.** A part the assistant was not asked to move MUST keep the position
  the family gave it on the sheet. An omitted layout means "didn't move it", never "re-pack the
  sheet".
- **G-5 — Whole documents.** The assistant returns complete documents, not partial edits. What is
  reviewed, merged, and recorded is a whole state.
- **G-6 — Scope discipline.** The assistant MUST change only what the request needs, and MUST NOT
  invent edits nobody asked for. A question gets an answer and no proposal.
- **G-7 — Honest failure.** If the request cannot be satisfied without breaking the toy, the
  assistant MUST say so in the chat. There is no such thing as a dead proposal that silently
  disappears.
- **G-8 — Watchable work.** Any assistant operation taking more than a few seconds MUST report live
  progress in terms the family understands.

### 11.4 What it must know

The assistant's instructions MUST carry the full domain rules this document specifies — the
coordinate conventions (§6), real-world sizing sanity, the geometry constraints (§6.1), the
wearable, bending, slot-and-tab and durability rules (§12.7–§12.9), the mechanism tolerances
(§12.6), the fit-check requirement (§12.4), the step and cover-art conventions (§5.8), and the
identifier rule (§5.9). It SHOULD also be given at least one complete, high-quality design as a
worked example, and that example MUST itself always be valid.

### 11.5 The provider contract

The assistant is a **role, not a vendor**. The product MUST NOT be built around one AI service; which
service performs the work is a setting an adult chooses (§14.2). Any provider is usable if it can:

- **Take the whole picture in one request.** A long instruction (several thousand words of domain
  rules), a complete design document (tens of kilobytes), the current findings, the recent history
  summaries, and the recent conversation, together.
- **Return a whole document in one response.** The assistant replaces documents rather than patching
  them (G-5), so the response budget MUST accommodate a complete design.
- **Hold a single request open for several minutes** (§14.3).
- **Report that it is working**, so watchable work (G-8) is possible. Where a provider cannot report
  incremental progress, the product MUST still show elapsed time and MUST NOT present a frozen
  screen.
- **Follow a strict output contract.** The product MUST tolerate a provider that wraps or decorates
  the structured answer anyway, and MUST treat an answer it cannot read as a failed attempt under
  G-1 — a retry, never an error shown to the family.
- **Be capable enough to pass the rule engine.** A provider that cannot produce geometry satisfying
  §12 within G-1's retry budget is not a supported provider, and the product MUST NOT present it as
  one. The generation scenario in §15.3 is the test.

A provider that cannot meet this contract MUST be refused when it is configured, with a plain
explanation, rather than discovered halfway through a generation (§14.2.5).

---

# Part IV — Rules

## 12. Validation and the toy-statics rule engine

### 12.1 Status and severity

One rule engine serves the whole product. It runs on generated designs before they are delivered, on
every proposal before review, continuously on the draft while editing, and before any state is
saved or recorded.

- An **error** means the design cannot ship: it will not generate, will not save, will not become a
  checkpoint. Errors are things that are physically wrong or structurally broken.
- A **warning** means the design ships but the family is told: it will probably disappoint, wear
  out, or look incomplete.

The engine MUST be **measurement-based**: it computes real geometry and compares it against physical
rules. It MUST NOT trust anything a design says about itself.

### 12.2 Document rules

- Title present; slug present and well-formed; at least one part; at least one step.
- Finished size present with the dimensions its category requires (§5.2), each positive and ≤ 96".
- Category, corrugation direction, hardware kind, and every other enumerated value drawn from the
  known set.

### 12.3 Geometry rules

- Shapes parse, use only the permitted vocabulary (§6.1), and are measurable.
- Any single shape is at most 40 inches in either dimension (figures and cover art, which are
  diagrams rather than cut lines, may be larger); no feature smaller than 0.15" in both dimensions,
  because it cannot be cut.
- Part outlines are closed.
- Holes lie inside their part; slits do not extend outside it.
- Every part identifier is unique in the design; every hole and slit identifier is unique within its
  part.
- **Bend scores**: a part whose intended curvature requires bending MUST carry parallel score lines
  spanning it, spaced at most 0.8" apart for a bend radius under 4", and at most 0.5" for a radius
  under 2".
- **Sheet overlap**: parts whose placements overlap on the sheet produce a warning — they will print
  on top of each other.

### 12.4 Fit checks

- Any design in which **more than one assembled part** exists MUST declare at least one fit check.
  Parts no assembly instance places are not yet attached to anything and do not owe a fit check —
  which is what lets a family drop a new part onto the Mat without instantly breaking the document.
  The moment such a part joins the assembly, its fit check is owed again.
- A design SHOULD declare one fit check for **every place two parts physically meet**: a wrap's
  length against the arc length of the edge it covers, a slot's width against the tab that enters
  it, a keyhole against its button, a lid's footprint against its box opening, the mating edges of
  joined walls.
- Every declared check MUST be evaluated against real measured geometry, and a failure is an error
  naming both measurements and the reason the check exists.
- A check measuring a named edge MUST verify that the named edge actually belongs to the part it
  claims.

### 12.5 Hardware rules

- Hardware kinds are limited to the permitted list (P-11).
- Round stock MUST declare a diameter and a length; every item MUST declare a count and a
  human-readable label.

### 12.6 Mechanism rules (the working-toy rules)

For each declared revolute mechanism, computed from the real hole geometry:

| Code | Rule | Severity |
|---|---|---|
| `bearing-fit` | Each bearing hole's diameter minus the axle diameter is between **+0.04"** and **+0.12"** — free spin, no slop. | error |
| `hub-fit` | Each hub hole's diameter minus the axle diameter is between **−0.01"** and **+0.03"** — a press fit that glue can hold. | error |
| `bearing-length` | The summed thickness of the material the axle passes through is at least **2× the axle diameter**. Under **3×** warns: a short bearing wobbles. | error / warn |
| `axle-budget` | The axle is at least the bearing span plus both hub stacks plus 0.2" of clearance, and at most 1.5" longer than that — long enough to work, not a spear sticking out of the toy. | error |
| `wheel-sweep` | The wheel's radius plus 0.25" clears every point of the body above the axle, through a full rotation. | error |
| `tipping` | For rolling toys, the outer track width divided by the estimated centre-of-gravity height is at least 1.1. | warn |
| `ground-clearance` | Nothing except the wheels comes within **0.35"** of the ground defined by the wheel bottoms — under **0.5"** warns. A belly or bumper at wheel level beaches the toy: it rests on cardboard and cannot roll. | error / warn |

Bearing and hub holes MUST be round. Every rule above is computed with the same assembly placement
mathematics the 3D view uses, so that what the rules measure and what the family sees are the same
object.

### 12.7 Durability rules

Kids play rough; durability is a requirement, not a nicety.

| Code | Rule | Severity |
|---|---|---|
| `solid-core` | A vehicle or playset with a rolling mechanism MUST have a solid stacked core: one profile part laminated to at least ~0.9" total thickness (six or more layers), with the axle holes passing through the stack. An axle hung in a wall thinner than 0.45" is an error. | error |
| `durability` (graspable mass) | Anything gripped or swung — a vehicle body, a sword blade, a handle — should be at least three laminated layers or a closed box. | warn |
| `durability` (large panel) | A single-layer part larger than about 40 square inches will crease; laminate or box it. | warn |

### 12.8 Wearable rules

For anything worn — crown, helmet, mask, headband, cuff:

- The band or opening length MUST be the stated body measurement plus **0.75"** of circumference
  clearance (cardboard thickness and hair consume real space), **plus** the closure tab on top of
  that.
- Adjustability MUST be designed in: an oversized closure tab with two or three short score marks
  about half an inch apart, and a step that tells the family to try it on and choose a mark before
  gluing.
- The clearance MUST be declared as a fit check so the validator enforces it.

### 12.9 Construction conventions

- **Slot and tab**: slots are about 0.18" wide (one cardboard thickness plus play); tabs are at
  least 1" deep.
- **Corrugation**: flutes run along the axis that needs strength, or parallel to a bend that must be
  smooth. Direction is a decision, not a default.
- **Part count**: a typical design has 2–6 distinct part types. Simple enough for a parent and child
  to actually finish.
- **Assembly coverage**: the assembly SHOULD place every copy of every part; otherwise the preview
  is visibly incomplete, and the product warns.
- **Fold limits**: cardboard thickness between 0.1" and 0.25"; no hinge folds more than 178°.

### 12.10 Findings as a product surface

Every problem the engine reports MUST be expressible as a **finding** carrying:

- a **severity** (error or warning);
- a **code** from a stable vocabulary — the codes in §12.6–§12.7 plus fit failure, sheet overlap,
  bend scores, positional reference, and a general category — so that interfaces can group and
  style them;
- a **message**: one shop-rule sentence, naming the real measurement that is wrong;
- an **anchor**: which part, and which hole, slit, or assembled piece the problem is attached to, so
  any surface can point at it;
- an optional **fix**: a label and a precise correction, present **only where the correct number
  falls out of the geometry** (a bearing hole resized to the loose fit; a hub hole to the snug fit;
  a clearance hole to the middle of its permitted band; an axle cut to the middle of its legal
  length, rounded to a quarter inch — real dowels get cut to quarter inches). Everywhere else, no
  fix: a finding with no button is honest, a guessed fix is not (P-8).

The list of findings MUST correspond exactly, in count and order and severity, to the list of
problems the engine reports in any other form. There is one rule engine and one truth about a
design's health.

### 12.11 Gates

The rule engine is the single door every change passes through (P-6):

- A **generated** design with errors is never delivered.
- A **proposed** design with errors is never shown for review; the assistant is asked to correct it.
- A **merged** proposal with errors does not commit; the family stays in review and sees why.
- A **saved** design, and a **recorded checkpoint**, must be error-free — a place the family can
  come back to must be a place that works.
- A **draft being edited** may hold errors freely (§10.3), and this is the only exception.

---

# Part V — Collaboration

## 13. Drafts, history, proposals, and merge

### 13.1 The working state

- Each design being edited has **one working draft per design**, shared by every surface looking at
  it. The Mat, the fold-up pane, the findings, and the print preview all describe the same working
  state.
- The draft MUST carry a **revision counter**. A change submitted against a stale revision MUST be
  rejected rather than applied, and the editor MUST resynchronise. This is what makes two windows on
  the same design safe.
- Drafts are working state, not archives. It is acceptable for a draft to be lost when the product
  restarts, provided the saved design and the history survive (§14.4) and the editor recreates the
  draft from the saved design on next open.

### 13.2 History

- Every design MUST have a **history**: an ordered series of **checkpoints**, each holding a
  **complete immutable snapshot** of the design, an **author** (the family or the assistant), a
  **one-line summary in the family's language**, a timestamp, and the checkpoint it was based on.
- **History only ever grows** (P-7). Restoring an earlier checkpoint MUST **append** that state as a
  new checkpoint; it MUST NOT rewind, rewrite, or delete anything. Nothing anyone made can be lost
  by pressing the wrong marker.
- Checkpoints MUST be recorded when: the family pauses for about 45 seconds after making changes;
  they save; they print; or they leave the page with unsaved changes. Never two in a row with no
  change between them, and never while a red finding stands unresolved (§12.11).
- Summaries MUST be automatic and specific, in kid language, most significant first, and short
  (~60 characters): "Stretched Sword Body 2" longer", "Punched Ø 0.26" hole in Lid Wrap", "Turned
  Knuckle Guard 90°", "8 new score lines on Panel". Several changes collapse to the most significant
  plus a count.
- History MUST survive a restart of the product, and MUST tolerate an interrupted write: a
  half-written record costs at most that one checkpoint, never the whole history.
- The family MUST be able to **restore** any checkpoint, and to **compare** any checkpoint against
  the current state, seeing the old geometry ghosted beneath the new, the changes highlighted, and a
  list of what changed in plain language — where selecting an item zooms to the geometry it
  describes. Editing is held still while comparing, and resumes on exit.

### 13.3 Proposals

An assistant edit follows one path, and there is no other path by which it can reach the design:

1. **Request.** The family types into the chat. The product captures the working state at that
   moment as the proposal's **base**.
2. **Think.** The assistant works, reporting progress. **The family keeps editing throughout** —
   the product MUST NOT lock the Mat while the assistant thinks.
3. **Check.** The product validates the result (§11.3 G-1) and enforces the identity and arrangement
   guarantees (G-3, G-4).
4. **Merge.** The proposal is reconciled against the working state **as it is now** — not as it was
   when the request was made — by comparing both against the captured base. Changes that touch
   different things merge without comment. A genuine clash, where both hands changed the same
   property to different values, becomes a **conflict** (§13.5).
5. **Review.** The family sees the proposed result on the Mat: the current geometry ghosted beneath
   the proposal's, changes highlighted, a list of changes in plain language, a **before/after toggle
   in the 3D view**, and a line saying whether the result still passes every rule. The 3D view MUST
   show one document at a time, never a blended one.
6. **Decide.** **Keep** commits the merged result, records a checkpoint authored by the assistant
   carrying its own one-line summary, and puts the pre-acceptance state on the undo stack so the
   family can step back across it. **No thanks** discards it, leaving the working state exactly as
   it was, byte for byte, with nothing recorded.

At most one proposal is live per design at a time; a new request supersedes the old. Nothing about a
proposal is recorded anywhere until the family keeps it.

### 13.4 Understanding changes

The product MUST be able to describe the difference between any two versions of a design as a list
of discrete, identity-anchored changes — this same description serves history comparison, proposal
review, and (in future) partial acceptance. Each change MUST name:

- whether something was added, removed, or altered;
- what kind of thing it is (a part, a hole, a score line, a placement, a shape, a count, a piece of
  hardware, a mechanism, an assembled piece, a step, a fit check, or a piece of the design's
  metadata);
- which object, **by identity, not by position** (§5.9);
- which property, and its value before and after;
- and a **plain-language label** naming the part and saying what physically changed, quantified
  where quantifying is cheap: *"Sword Body: moved 2.9" right"*, *"Blade: 12" → 14" long"*,
  *"Wheel hole: now snug"*, *"Panel: 8 new score lines"*.

Rules for these labels, because they are the product surface the family actually reads: never show
internal field names or raw document structure; a part that only moved produces a movement change,
not a shape change; adding one hole to a part produces one "hole added" change, not "this part
changed".

### 13.5 Conflicts

- A conflict exists only when both hands changed the same property of the same object to **different
  values**. The same change made twice is not a conflict.
- Conflicts MUST default to **the family's version**.
- Each conflict MUST be presented as a plain choice showing both sides in the same language as every
  other change: *"You made the blade 14 inches, Claude made it 16 — tap the one you want."*
  Choosing re-renders the preview immediately.
- If the assistant adds something whose identifier collides with something the family added
  meanwhile, the product MUST keep both by re-identifying the assistant's — never drop or overwrite.
- The product MUST tell the family when the working state moved while the assistant was thinking,
  so an unexpected difference in the review has an explanation.

### 13.6 Authorship

Every recorded state names who made it. The history strip distinguishes the family's work from the
assistant's at a glance. This is a pedagogical requirement as much as a bookkeeping one: the child
should always be able to see which changes were theirs, and every accepted assistant edit is shown
as a change they could have made by hand with the same tools.

---

# Part VI — Qualities

## 14. Non-functional requirements

### 14.1 Deployment and privacy

- The product MUST run entirely on the family's own equipment, reachable from the household's own
  machines, with **no account, no sign-in, and no third-party service holding the family's designs,
  conversations, or history** (P-12). The single exception is the AI provider an adult has chosen
  (§14.2), which necessarily receives the design document and the conversation for the request it is
  asked to perform — and which MAY be a model running on the family's own hardware, in which case
  nothing leaves the house at all.
- The product MUST be startable with a single command and MUST need no configuration beyond that.
- The interface MUST work in a current browser with no installation, no plug-in, and no external
  content delivery network at run time. Everything the pages need MUST be served locally, so the
  product keeps working on a flaky home connection.

### 14.2 The AI provider: choice, default, and cost

*Which providers are supported is a product requirement. How they are reached is not.*

#### 14.2.1 The setting

- The product MUST offer a settings surface where an adult chooses which provider performs the
  assistant's work (§11.1), and MUST allow that choice to be changed or removed at any time with no
  effect on any existing design, bundle, or history.
- The choice MUST persist across restarts and MUST be stored on the family's own equipment.
- Where a provider offers several models, the product SHOULD let the family choose between them. It
  MAY allow the assistant's three modes to use different providers or models — ideation is a cheap
  conversation, generation is the expensive one — and where it does, each MUST be configured and
  labelled separately so nobody has to guess which one a given action will bill.

#### 14.2.2 What must be supported

At minimum these classes, plus a way to describe a provider the product has never heard of:

| Class | Must work with | What it costs the family |
|---|---|---|
| **Subscription-backed assistant**, already installed and authorised on the machine | Claude Code on a Claude subscription; ChatGPT/Codex on an OpenAI subscription; comparable tooling such as opencode pointed at a subscription | Nothing extra — it is included in a subscription they already pay for |
| **Metered API credential** | Anthropic, OpenAI, Google, Z.AI, and aggregators or agent tooling that front several of them (OpenRouter-style services, opencode pointed at a key) | Billed per request, to the family, by that provider |
| **Local or self-hosted model**, running on the household's own hardware | any runtime that serves a model over the household network | Nothing, and no content leaves the house |
| **Anything else** | a generic configuration naming the service, the model, the credential and the address | Whatever that provider charges |

- The **default MUST be a subscription-backed provider** wherever one is available on the machine.
- The product MUST NOT use a metered credential unless an adult has explicitly selected it and
  cleared the warning in §14.2.3 — not by falling back to one it found in the environment, and not
  by inheriting one from another tool.
- The product MUST NOT ship with, embed, or require a credential of its own.

#### 14.2.3 The metered-provider warning

Selecting a metered provider MUST present a clear warning that takes an explicit confirmation before
it takes effect. The warning MUST state, in plain language:

- that from this point **every request costs money**, charged by that provider directly to the
  family, and that the product cannot cap or refund it;
- **which actions are expensive**: generating a design is one very large request and may be retried
  up to three times when validation fails (§7.3); every chat turn in the editor sends the entire
  design document (§11.2, G-5), so a long editing session is many large requests;
- that **a child using the product unattended will incur those charges**;
- where to turn it off again.

The warning MUST NOT be a one-time notice that then disappears. While a metered provider is
selected, the product MUST show a **persistent, visible indicator** on every surface that can start a
request — ideation, generation, and the editor's chat rail. It SHOULD show how many requests the
current session has made, and where the provider reports usage, what they have cost.

#### 14.2.4 Credentials

- Credentials MUST be stored on the family's own equipment and MUST NEVER be written into a design
  document, a checkpoint, a rendered bundle, or a log.
- After entry, a credential MUST NOT be displayed again in full, and MUST be removable in one
  action.
- The product MUST NOT transmit a credential anywhere except to the provider it belongs to.

#### 14.2.5 Verifying a provider

- On configuring a provider, the product MUST verify it with a single cheap round-trip and report
  either success or a plain-language failure — "that key was rejected", "that model cannot hold a
  design document", "that command isn't installed" — naming what to do about it.
- A provider that cannot meet the contract in §11.5 MUST be refused at configuration time. Finding
  out three minutes into a generation is not acceptable.

#### 14.2.6 With no provider at all

The product MUST be fully usable with no AI provider configured. The gallery, the Cutting Mat and
all six verbs, the Shape Shelf, the rule engine and Toy Doctor, the fold-up view, printing, saving,
history, restore and compare MUST all work exactly as specified. Only ideation, generation, and
proposals are unavailable, and the product MUST say so and explain how to enable them rather than
presenting controls that do nothing (P-10).

### 14.3 Performance

| Operation | Requirement |
|---|---|
| Opening the editor for a design | Interactive within a few seconds. |
| Any direct-manipulation gesture | Immediate on-canvas response; no perceptible lag. |
| 3D preview reflecting an edit | Within about a second. |
| Continuous validation while editing | Fast enough to run on every change without interrupting a gesture. |
| Rendering a printable bundle | Seconds, not minutes. |
| Generating a new design | Minutes are acceptable, with live progress; the product MUST allow generous time (on the order of fifteen minutes) before declaring failure, because a complex design genuinely takes that long. |
| Assistant proposals | Minutes are acceptable, with live progress and unrestricted editing meanwhile. |

These budgets assume a provider that meets §11.5. A slower or smaller model changes the assistant's
numbers — generation and proposals — and nothing else on this table; the product MUST NOT let a slow
provider make the Mat, the rule engine, the 3D view, or printing any slower.

Complex requests need compact briefs: a design with more than about six distinct part types is at
the edge of what one generation pass handles well, and the product SHOULD steer ideation toward
something achievable rather than accept a brief it will fail to satisfy.

### 14.4 Durability and safety of work

- Saved designs and history MUST survive restarts, crashes, and power loss.
- A write interrupted mid-record MUST cost at most that record.
- No operation available to the family may destroy work irrecoverably except an explicit,
  confirmed deletion.
- Printing or previewing MUST never mutate the saved design.

### 14.5 Interface quality

- The interface MUST be usable by a child who cannot read fluently: large targets, plain words,
  visible consequences, immediate feedback.
- No error dialog may ever be the primary way a problem is communicated; problems belong in the
  findings strip in shop language (P-8).
- The product MUST be visually coherent across all its surfaces — the Workshop, the Mat, the 3D
  view, and the printed documents share one identity (warm paper, dark ink, kraft, a single accent).
- Ordinary use MUST NOT produce browser console errors. An invalid draft is a normal state and MUST
  NOT be reported as a failure to the browser (§10.3).

### 14.6 Content and physical safety

- The product MUST route knife work, hot glue, and drilling to adults explicitly, in the guide and
  in the steps where they occur.
- Generated content MUST be age-appropriate for the child using it.
- The product MUST NOT propose materials or techniques outside the household set (P-11).

### 14.7 Intellectual property

- Reference material used to derive the output format is for private study only and MUST NOT be
  redistributed with the product.
- Generated bundles MUST carry the studio's own identity and a personal-use statement. The product
  MUST NOT imitate another company's branding on its output.

---

# Part VII — Proof

## 15. Quality bar and acceptance

### 15.1 The bar

The product is measured against **real, commercially sold cardboard-template bundles**, on one
criterion only: *which one could a parent and child actually build from?* Not which is prettier, not
which is better branded.

The product's development method MUST reflect that: improvements are judged by **blind comparison**
— a reviewer who does not know which bundle is which names the biggest gap, the gap is fixed, and
the comparison is repeated until the product's output wins. This is a requirement on how the team
decides the work is good, not a suggestion about process.

### 15.2 What "done" means for each surface

**The bundle is done when** a family who has never seen the product can print the sheets, confirm a
grid square measures one inch with a ruler, tape the sheets using the printed marks, trace every
part, and build the toy using only the guide — without asking a question the documents do not
answer.

**The Mat is done when** a child can open a design, change it by dragging, watch it fold up, print
it, and hold a correct piece of paper — with no typing and no adult intervention.

**The rule engine is done when** a design that passes it can be built, and a design that fails it
tells the family what to change in a sentence they act on without help.

**The assistant is done when** it never changes a toy without permission, never loses the family's
work, never breaks a design it was asked to improve, and says so honestly when it cannot do what was
asked.

### 15.3 End-to-end acceptance scenarios

These are the tests that prove the product, and they MUST be verified against real artefacts —
printed output measured, screens looked at — not against the code's own belief about what it did.

1. **Invent and print.** From an empty conversation, reach a brief, generate a design, and render a
   bundle. The design passes every rule. Print the cut sheets at 100%: a 1-inch grid square measures
   1 inch, and a 3-inch square measures 3 inches. Overlap two adjacent sheets using the registration
   marks: the grid is continuous and a part spanning the seam is continuous.
2. **A4 and Letter.** Both tilings of the same design are complete, at identical true scale, with no
   geometry lost off any page.
3. **Stretch and print.** Open a design on the Mat, drag a part 2 inches longer, print, and measure
   the printed part against the printed grid: it is 2 inches longer. Whole flow under five minutes.
4. **Move and turn.** Move a part three inches and rotate another 90°; re-render; both changes
   appear on the sheets, with nothing clipped and the overview page updated.
5. **Off-origin safety.** Drag a part above and to the left of the sheet origin, print, and confirm
   every part still appears on the sheets in its correct relative position.
6. **Punch and drill mark.** Punch a hole with the SNUG fit for a quarter-inch dowel; the hole is
   0.26" in the document, and the printed sheet shows a crosshair and a diameter note.
7. **Fold and curl.** Draw a score line on a fresh part: it appears dashed on the Mat and dashed on
   the print. Fan it to eight lines: the spacing is even and within the bend-radius rule.
8. **Diagnose and fix.** Shrink a wheel's hub hole until it will not grip: a red finding appears
   naming the problem in shop language; selecting it zooms and flashes that hole; the one-tap fix
   restores a working diameter; undo brings the fault back and the finding returns.
9. **Fold-up fidelity.** The 3D preview folds the same design the sheets print — a box net closes
   into a box, a slitted strip curls into a guard — and the FLAT⟷BUILT sweep matches the written
   step order.
10. **Rolling toy.** A vehicle's wheels turn on their axles, the toy rolls with wheel rotation
    matching distance, nothing but the wheels touches the ground, and the design passes every
    mechanism rule.
11. **History.** Make two bursts of edits: two checkpoints appear with sensible summaries. Restore
    the first: the geometry reverts on the Mat and in a freshly printed sheet, and a third checkpoint
    appears recording the restore. The history file has grown, never shrunk. Undo steps back across
    the restore.
12. **Survives restart.** Restart the product: history is intact, the design opens, restoring an
    earlier checkpoint still works.
13. **Ask a question.** Ask the assistant something that is not an edit: an answer arrives, no
    proposal is offered, and the design is untouched.
14. **Ask for an edit.** Ask for a change: progress is visible, a proposal arrives, review shows the
    change ghosted with a plain-language description and a green rule check, the 3D after-view shows
    it, and accepting produces a measurably changed printed sheet plus a checkpoint authored by the
    assistant.
15. **Edit while it thinks.** Start a request, then move a different part while it works. Accept:
    both changes survive, with no conflict raised.
16. **Conflict.** Change something, then accept a proposal that changed the same thing differently.
    Exactly one choice is presented, defaulting to the family's version; choosing the other updates
    the preview; accepting produces the chosen result.
17. **Reject.** Decline a proposal: the working state is byte-identical to before, and nothing was
    recorded.
18. **Nothing breaks.** Every existing design still passes every rule, and every bundle still
    renders, after any change to the product.
19. **Switching providers.** Select a metered provider: the warning appears, naming the cost, the
    expensive actions, and how to undo it, and nothing changes until it is confirmed. Confirm it: the
    persistent metered indicator appears on every surface that can start a request, and a generation
    completes through that provider. Switch back to a subscription-backed provider: the indicator
    disappears. Configure a provider that cannot hold a design document: it is refused at
    configuration time with a plain reason, not mid-generation.
20. **No provider at all.** With every provider removed, open a design, edit it with all six verbs,
    clear a finding with a one-tap fix, watch it fold up, print a correct sheet, checkpoint it and
    restore it. Only the chat and the generate action are unavailable, and each explains how to turn
    them on.

---

# Part VIII — Ahead

## 16. The ideal end state

Everything in Parts I–VII describes the product as it must be. This section describes where it is
going. These are statements of desired functionality, not a delivery plan.

### 16.1 Reviewing changes piece by piece

Today a proposal is kept or discarded whole. In the ideal state the family reviews it **part by
part** — keeping the longer blade, declining the new pommel — with each change carrying its own
keep-or-decline choice, grouped by the part it affects. Everything in §13.4's change description
exists to support this; the requirement is the interface and the partial application, not new
machinery underneath.

### 16.2 A history you can see

Checkpoints become visual: each marker shows a small picture of the design at that moment, so the
family scrubs a filmstrip of their own work rather than reading labels. The same rendering makes the
change list richer — a before/after thumbnail per changed part.

### 16.3 Seeing through the cardboard

A section view showing a laminated stack as the layers it really is — how many sheets thick a part
is, where the axle passes through them, which layers are glued to which. Thickness is currently the
least visible property of a design and the one most responsible for whether a toy survives.

### 16.4 Building in three dimensions

Assembly is currently authored by a build-order list and by asking the assistant. In the ideal state
the family assembles the toy directly in the 3D view: dragging a part until its face snaps flat
against another, dropping a wheel onto an axle until its hole lines up, setting a fold angle by
pulling the flap. The order in which they glue things becomes the build order, and the build order
writes the first draft of the steps.

### 16.5 Symmetry and mirroring

Tools for the things a family naturally wants and currently cannot express: "make the other side
match this one", "mirror this part", "put one on each side". The document stays literal (P-5) — the
tool produces the mirrored geometry once, it does not create a live relationship.

### 16.6 More kinds of motion

Today a design can declare one kind of joint: something that spins. The ideal state adds the other
mechanisms a cardboard toy wants — a hinge that opens and closes, a slider that travels in a track,
a lever, a linkage, a simple gear pair, a string-and-pulley lift — each with its own physical rules
in the engine and its own honest motion in the preview. The rule is unchanged: **the engine and the
preview define what exists, and the editor surfaces what they define; the editor never invents a
mechanism the product cannot check.**

### 16.7 Bigger builds

Large products in this category ship as several sub-assemblies, each with its own template set (a
garage's base, tower, ramp, and lift). The ideal state lets one design be a **product of several
assemblies**, each printing its own sheets and its own guide section, with fit checks spanning the
boundaries between them.

### 16.8 Richer materials

Double-wall board for parts that need it, with thickness carried per part rather than per design,
and every structural rule computed from the real thickness. A "what this will take" estimate — how
much cardboard, how many boxes of what size — before the family commits.

### 16.9 A guide that shows more

Step diagrams that exploit the 3D assembly the product already knows: automatic exploded views,
automatic "before and after" pairs per step, automatic highlighting of the part being added. The
guide's figures should never have to be authored separately from the build.

### 16.10 Sharing, on the family's terms

An exportable bundle a family can hand to a friend or print at a copy shop, and a way to bring one
back in. Optional, explicit, and never automatic (P-12).

### 16.11 A catalogue of starts

A larger library of starter shapes and starter designs covering the whole category range — armour
and weapons, crowns and helmets, chests and boxes, furniture, vehicles, photo props, playsets,
garages, giant letters and numbers — so that "surprise us" always has somewhere good to begin, and
so a first-time family never faces a blank page.

## 17. Deliberate non-goals

These are decided, and reopening one requires evidence that the current design has failed a real
family.

- **No parameters, formulas, or expressions inside a design.** "Change one number and everything
  updates" is served by coherent sizing handles and by asking the assistant — reviewably — not by
  making the document a program (P-5).
- **No persisted shape recipes.** Starter dials exist at the moment of creation and are then gone.
  Two representations of one shape is the failure mode this product is built to avoid (P-4).
- **No operation-history model.** History is complete snapshots, not a replayable list of operations
  that can break when an earlier one is edited.
- **No branch-and-merge interface.** Branching is remixing a design into a new one.
- **No real-time multi-user co-editing.** One family and a turn-based assistant need reconciliation,
  not a synchronisation engine.
- **No constraint solver.** Checks that verify and explain beat constraints that drive geometry and
  fight the child's hand.
- **No freeform pen as the primary way to make shapes.** Starters, sizing, and the assistant cover
  shape creation; point-by-point editing stays an expert tool behind a deliberate gesture.
- **No typed coordinates anywhere in the child's path** (P-9).
- **No feature that only exists in the interface.** A verb on screen does what its name says, or it
  is not on screen (P-10).
- **No materials outside the household set** (P-11).
- **No cloud dependency for the core loop.** Everything but the assistant — gallery, editing, rules,
  fold-up view, printing, history — MUST work with no network at all, and the assistant's provider is
  the family's choice, including one that runs in the house (P-12, §14.2).
- **No provider lock-in, and no metered billing by default.** The product is never built around one
  AI service, and never spends a family's money without an adult explicitly turning that on
  (§14.2.3).

---

*This specification describes Cardboard Studio completely at the level of what it does and the rules
it obeys. Every technology choice, data format, internal boundary, and build order remains open.*
