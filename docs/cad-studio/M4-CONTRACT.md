# M4 Build Contract — Chat proposals: propose → validate → merge → review → commit

Binding contract for M4 (DESIGN.md §2.4 + §2.6), set by the coordinator. M1–M3 contracts remain
in force. The M3 DiffRecord shape is a FROZEN public API — merge builds on it, never changes it.
Guiding rule from DESIGN.md, non-negotiable: human and LLM edit the same file through the same
validated door; only the human commits; a kid edit made while Claude is thinking must NEVER be
lost or blindly overwritten.

## Ownership

- **Builder A (server)**: server/src/ai.mjs (new proposeEdit mode), server/src/index.mjs
  (proposal jobs + endpoints), server/src/differ.mjs (ADD merge functions only — existing
  diff code and record shape untouched).
- **Builder B (Mat UI)**: server/public/edit.html, server/public/edit.js only.
- Neither touches schema.mjs, renderers, viewer, shelf.mjs, or designs/.

## 1. Proposal engine (A, ai.mjs)

- `proposeEdit({ design, message, chat, selection, findings, checkpoints, onProgress })` →
  `{ reply, summary, design }` — `design`/`summary` null for a prose-only turn.
- Prompt = GEOMETRY_RULES + the current draft JSON + context: selected part id (or none), the
  current Toy Doctor findings as shop-rule strings, the last ≤5 checkpoint summaries ("what the
  humans just did by hand"), the last ≤10 chat turns, then the kid's message.
- The model outputs ONE JSON object: `{ "reply": "2-3 playful sentences", "summary": "kid-language
  one-liner, ≤60 chars" | null, "design": { complete modified design.json } | null }`. Full-document
  replace, deliberately (DESIGN.md §2.4.2). Advice/questions → design null.
- Instructions the prompt must carry: keep `slug` and every existing part/hole/slit id EXACTLY
  (ids are the reference currency; renaming one breaks mechanisms and the merge); keep
  `parts[].layout` for parts you aren't moving; change only what the request needs.
- Reuse the validate/repair loop: validate the proposed design, on errors re-prompt with the
  error list (≤3 attempts, keep the first reply text). Unrepairable → `{ reply, error }` so the
  chat can say "I couldn't make that work" (never a dead proposal). Server forces `slug`,
  `createdAt`, `brief` back to the draft's values post-hoc. Heartbeat via onProgress like
  generateDesign; timeout 15 min.

## 2. Three-way merge (A, differ.mjs — new exports)

- `mergeDesigns({ base, ours, theirs })` → `{ merged, records, conflicts }`.
  - `theirs` = Claude's proposal, `ours` = the current draft, `base` = the draft snapshot the
    proposal was generated from. diff(base→theirs) = Claude's records; diff(base→ours) = the
    kid's. Apply Claude's records onto `ours`, keyed by (scope, ref, prop).
  - **Conflict** = both sides changed the same key to different values, or Claude removed what
    the kid edited (and vice versa). Conflicted keys default to OURS in `merged`; each conflict
    carries `{ key, yours: DiffRecord|null, theirs: DiffRecord }` with both kid-language labels
    for the two-ghost picker. Same key, same resulting value → not a conflict.
  - `records` = Claude's DiffRecords as applied (i.e. relabeled vs `ours` where needed), each
    tagged `from: "claude"`; conflicts appear in both lists.
  - Part added by Claude with an id that now collides with a kid-added part → suffix Claude's id
    (`-c`), never drop or overwrite.
- `applyChoices(mergeResult, choices)` (or an options arg on mergeDesigns) — `choices` maps
  conflict key → `"you" | "claude"`; returns the re-merged document. Pure functions, unit-probed.

## 3. Proposal endpoints (A, index.mjs)

In-memory jobs (reuse the generate-jobs pattern), at most one live proposal per slug (a new
POST supersedes the old). Nothing about a proposal is ever written to disk until accept.

- `POST /api/designs/:slug/propose` body `{ message, chat?, selection? }` → `{ jobId }`.
  Captures base = deep copy of the current draft design + `baseRev` + `baseHash` (sha1 of the
  canonical JSON) AT SUBMISSION. 404 if no design. `?mock=1` (or body `mock: true`) skips the
  CLI: deterministic scripted edit — stretch the selected (else first) part 2" taller via its
  path + summary "Stretched <Name> 2\" taller" + a canned reply — same code path after that
  point, so B and the verifier can exercise the whole pipeline in milliseconds.
- `GET /api/designs/:slug/propose/:jobId` → `{ status: "thinking"|"chat"|"ready"|"error",
  progress, reply?, summary?, error? }`. `chat` = prose-only turn (reply, nothing else).
- `POST /api/designs/:slug/propose/:jobId/merge` body `{ choices? }` → merges the proposal
  against the CURRENT draft now: `{ merged, changes, conflicts, findings, baseMoved }` —
  `findings` = structured findings of `merged` (the review lint banner), `baseMoved` = current
  draft hash ≠ baseHash. Stateless recompute; call it again after every picker tap.
- `POST .../propose/:jobId/accept` body `{ choices? }` — re-merge, validate; errors → 200
  `{ ok:false, errors }` (stay in review). Valid → draft := merged (rev bump), append checkpoint
  `{ author: "claude", summary: <Claude's one-liner> }`, job cleared, returns
  `{ ok:true, design, rev, findings, checkpointId }`.
- `POST .../propose/:jobId/reject` → job cleared, `{ ok: true }`.

## 4. Chat rail + Review mode (B)

- **Chat rail**: collapsible panel (B picks the dock; must not cover the mat or break M1–M3
  layouts) with transcript, input, and a status line. Kid + Claude bubbles; Claude thinking =
  live heartbeat bubble from job progress ("thinking about the geometry… 45s"), poll ~2s.
  **Editing stays fully live while Claude thinks** — no lock, PUTs keep flowing; the merge is
  what reconciles. Transcript persists per slug in sessionStorage. Prose turns just land in chat.
- **Proposal card** in the transcript when status=ready: Claude's reply + summary +
  **[Review it]**. Clicking Review: lock editing (the M3 compare lock), call `/merge`, then
  ghost-diff Review mode reusing the M3 machinery — dashed-gray CURRENT geometry under the
  merged proposal's ink, crimson tint on changes, right-side chip list from `changes` labels
  (click = zoom+flash). Banner: `Claude proposes: "<summary>" — [Keep it all] [No thanks]`, plus
  a lint line: "still passes every toy check" (green) or the failing findings (red). If
  `baseMoved`, add "you both edited while Claude thought" to the banner.
- **Conflict chips**: conflicts render as a two-ghost picker chip — "You: <yours.label> /
  Claude: <theirs.label> — tap the one you want", default YOU (visually marked). A tap calls
  `/merge` with updated choices and re-renders the ghosts live.
- **3D BEFORE/AFTER**: while reviewing, a toggle above the fold-up pane posts the current draft
  (BEFORE) or the merged doc (AFTER) to the viewer iframe via the existing
  `cuttingmat:design` postMessage. Never both at once (DESIGN.md veto on dual-doc ghosts in 3D).
- **[Keep it all]** → `/accept` (with choices) → unlock, refresh mat/inspector/viewer/findings,
  history strip gains a CRIMSON dot, chat gets "Added! ✓ <summary>", undo stack gets a
  pre-accept snapshot (Cmd-Z steps back across an accept). `ok:false` → stay in review, show
  the errors on the lint line. **[No thanks]** → `/reject`, unlock, chat notes "okay, tossed it."
- **ASK CLAUDE on Toy Doctor**: chips with no deterministic `fix` get an **ASK CLAUDE** button →
  opens the chat rail with the shop-rule message pre-filled ("Toy Doctor says: <message> — can
  you fix it?") and focuses the input (does not auto-send).

## 5. Acceptance (verifier, timed, real gestures; mock for mechanics, real CLI where marked)

1. Regression: six designs 0 errors; M1 stretch-print-measure; M2 Toy Doctor fix loop; M3
   checkpoint→restore→compare quick pass. All still green.
2. **Real CLI, prose turn** (/edit/pirate-sword): ask "what would make this sword stronger?" →
   chat reply arrives, NO proposal card, draft rev unchanged, no checkpoint written.
3. **Real CLI, edit turn**: "make the blade 2 inches longer" → thinking heartbeat visible →
   proposal card → Review: ghosts + a chip naming the blade part with a length quantity; lint
   banner green; 3D AFTER toggle shows the longer sword. Accept → draft path bbox ~2" taller,
   render the draft and MEASURE the printed blade against the 1" grid; crimson dot appears;
   history.jsonl's new last line has author "claude" and Claude's summary; chat confirms.
4. **Mock, concurrent edit**: start `?mock=1` proposal targeting the blade, MOVE the guard 1"
   while it runs, Review → accept → BOTH survive: guard stays at the kid's position, blade 2"
   taller, zero conflicts shown.
5. **Mock, conflict**: kid SIZEs the blade first, then a mock proposal that also resizes the
   blade → Review shows exactly one two-ghost conflict chip, default = kid's version (merged
   geometry proves it); tap Claude's side → ghosts re-render to Claude's length; accept →
   merged doc validates, checkpoint written, draft matches the picked side.
6. Reject path + ASK CLAUDE: reject a mock proposal → draft byte-identical, no checkpoint, chat
   notes it; make a non-deterministic finding (e.g. shrink an axle-budget-relevant dowel via
   hardware or use monster-truck's existing warns) → its chip shows ASK CLAUDE → click →
   chat input pre-filled with the shop-rule text, not auto-sent.
7. Zero console/page errors throughout (soft-mode rules); wall-times per flow; editing while
   Claude thinks must remain live (prove with a real gesture mid-job in point 4).
