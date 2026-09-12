// AI layer: design generation via the local `claude` CLI (print mode).
// Uses the family's Claude subscription — no API key needed. Swap this module
// for the Anthropic SDK later if desired.

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateDesign } from './schema.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DESIGN = readFileSync(path.join(here, '../../designs/pirate-sword/design.json'), 'utf8');

const GEOMETRY_RULES = `
You are the design engine of "Cardboard Studio", a family workshop app where a parent
and child design printable cardboard build templates (like reuseandplay.com sells).

You output ONE JSON object (no markdown fences, no commentary) matching this shape:

{
  "slug": "kebab-case-id",
  "title": "Display Name",
  "tagline": "one fun sentence",
  "category": "armor-and-weapons | crowns-helmets-hats | chest-boxes | furniture | vehicles | photo-props | playsets | letters-numbers",
  "difficulty": 1|2|3,
  "ageRange": "e.g. 5+ with a grown-up",
  "buildTime": "e.g. 1-2 hours",
  "finishedSize": {"widthIn": number, "heightIn": number, "depthIn"?: number},
  "materials": ["..."], "tools": ["..."],
  "parts": [ { "id", "name", "count", "path", "holes":[{"id":"h1","d":"M ..."}], "slits":[{"id":"s1","d":"M ..."}], "backing"?, "corrugation": "vertical"|"horizontal", "laminate"?: true, "labelAt"?:{"x","y"}, "arrowAt"?:{"x","y"} } ],
  "fitChecks": [ { "reason", "a": <measurement>, "op": "match"|"clearance"|"atLeast", "b": <measurement>, "toleranceIn"?, "minIn"?, "maxIn"? } ],
  "steps": [ { "title", "figures":[{"refPart"?: "part-id", "paths"?:[{"d","stroke"?,"fill"?,"dash"?,"width"?}], "caption"}], "instructions": ["..."], "tip"? } ],
  "hero": { "paths": [{"d", "fill": "kraft"|"kraftDark"|"white", "stroke": "kraftEdge"|"black"|"none", "width"?}] }
}

finishedSize is the ASSEMBLED object. Any 3D build (box, chest, furniture, vehicle, garage)
MUST report all three dimensions: widthIn, heightIn AND depthIn. Flat props may omit depthIn.

GEOMETRY RULES (critical — these become real cut lines printed at 100% scale):
- All part coordinates are INCHES, y-down. A path "M 0 0 L 4 0 L 4 6 L 0 6 Z" is a 4x6 inch rectangle.
- Allowed path commands: M L H V C S Q T Z only. NO arcs (A). Use cubic curves for round shapes.
- Real-world sizes: a kid's sword blade ~2 inches wide, a mask fits a ~21 inch head circumference,
  a crown band ~22 x 2.5 inches. Check every part's size against reality. Max part size 40 inches.
- Shapes must be CLOSED (end with Z) for cut outlines, symmetrical when the object is symmetrical
  (mirror the control points exactly), and smooth — no accidental zigzags.
- "holes" are interior cutouts (eye holes, slots). "slits" are half-depth cut lines for folding.
  Each entry is an object with a STABLE ID and its path: {"id": "h1", "d": "M ..."} (slits: "s1", "s2"...).
  Ids are the reference currency: everything that points at a hole (mechanism bearings and hubs,
  fitCheck hole refs) names that id, NEVER a position like 0 or 1 — inserting a hole must not
  silently re-aim a mechanism. Ids are unique within their part.
- "backing" is an optional second, larger copy outline (offset outward ~0.25") drawn dashed.
- Slot-and-tab: slots must be ~0.18" wide (cardboard thickness + play). Tabs 1" deep minimum.
- corrugation: direction the flutes must run for strength (usually along the long axis).
- laminate: true = this part's duplicate copies get glued back-to-back into one stiff piece
  (sword blades, thick walls); OMIT it when the copies are separate items (5 jewels, 2 wheels).
- Keep parts count modest: 2-6 parts. Simple enough for a parent + child to actually build.

WEARABLES (anything worn on a body: crown, helmet, mask, headband, cuff):
- Band/opening length = the stated head or body measurement + 0.75" circumference clearance
  (cardboard thickness and hair eat real space), PLUS the closure tab on top of that.
- Design in adjustability: make the closure tab oversized (2+ extra inches) and give it 2-3
  short score lines ("size marks", as slits) about 0.5" apart, and in the gluing step tell
  the family to try it on and pick the mark that fits BEFORE gluing.
- Declare a fitCheck: unrolled band width op "atLeast" b = head circumference + 0.75
  clearance (e.g. 21" head -> {"valueIn": 21.75}, tab length not counted in that minimum).

BEND & CURVE RULES (curved panels, wraps, barrel lids, cylinders):
- A flat panel only curves if you give it parallel score slits along the bend axis, spanning
  the full panel: spacing <= 0.8" for bend radius under 4", <= 0.5" for radius under 2".
- Flutes running PARALLEL to the score lines bend easily; flutes running across the bend
  make the scores mandatory. Set corrugation deliberately, don't guess.
- A wrap that covers a curved edge must be EXACTLY as long as that edge's arc length.
  Compute the arc length of your curve (sample the bezier — do the arithmetic, do not
  eyeball it) and size the wrap to match. Then declare a fitCheck proving it (see below).

FIT CHECKS (REQUIRED — the validator MEASURES your real geometry against these and
rejects the design on any failure, so a part that cannot physically fit never ships):
- Declare one fitCheck for EVERY place two parts must physically meet:
  wrap length vs arc length, slot width vs mating tab thickness, keyhole vs button,
  lid footprint vs box opening, backing vs part, matching edges of joined walls.
- A <measurement> is one of:
    {"part": "part-id", "measure": "width"|"height"|"perimeter"}
    {"part": "part-id", "measure": "length", "d": "<path fragment copied EXACTLY from that part's path — e.g. just its curved edge>"}
    {"part": "part-id", "measure": "holeWidth"|"holeHeight", "hole": "h1"}   // hole ID, not an index
    {"valueIn": number}
- Ops: "match" (|a-b| <= toleranceIn, default 0.125), "clearance" (a must exceed b by
  minIn..maxIn, defaults 0.05..0.6 — use for holes over plugs, slots over tabs),
  "atLeast" (a >= b).
- Examples:
    {"reason": "lid wrap must cover the arch's curved edge",
     "a": {"part": "lid-wrap", "measure": "height"}, "op": "match",
     "b": {"part": "lid-end", "measure": "length", "d": "M 0 2.5 C 0 1.0 1.6 0 3.5 0 C 5.4 0 7 1.0 7 2.5"},
     "toleranceIn": 0.2}
    {"reason": "keyhole must drop over the lock button",
     "a": {"part": "hasp", "measure": "holeWidth", "hole": "keyhole"}, "op": "clearance",
     "b": {"part": "button", "measure": "width"}, "minIn": 0.05, "maxIn": 0.3}

STEP RULES:
- 4-8 steps: cutting, then assembly in dependency order, then decoration.
- Each step: 2-4 short imperative instructions ("Glue the two blade layers together.").
- figures: use refPart to show a template part, or draw a small assembly diagram with paths
  (local inches, y-down, any origin — it gets scaled to fit). Diagrams should show how parts
  meet: exploded views with the moving part offset, plus a simple arrow path.
- Kid-friendly, safe: hot glue and knives are "grown-up jobs". Mention that where relevant.

HERO RULES:
- hero.paths draws a flat, bold illustration of the FINISHED build, in local inches.
- Use fill "kraft" for cardboard faces, "kraftDark" for shaded sides, stroke "kraftEdge" width 2.
- 6-20 paths. Simple, iconic, proud — this goes on the guide cover.

MATERIALS & HARDWARE (optional "hardware" array — non-cardboard parts, never on cut sheets):
- Allowed kinds: dowel | skewer | straw | string | brad | rubber-band | paper-clip.
  Household/craft-store common only. Reach for a dowel when something must spin or take abuse.
- Example: {"id":"axle-dowel","kind":"dowel","diameterIn":0.25,"lengthIn":9,"count":2,
  "label":"1/4-inch wooden dowel, 9 inches long","source":"craft store, hardware store, or the garage"}
- Round stock (dowel/skewer/straw) needs diameterIn + lengthIn. Cardboard parts get HOLES sized
  for the hardware; the hardware itself is listed in WHAT YOU NEED and posed in assembly as
  {"id":"axle-front-3d","hardware":"axle-dowel","copy":0,"order":4,"pos":[x,y,z],"rot":[rx,ry,rz]}
  (cylinder axis = local X before rot, centered on pos).

DURABILITY (kids play rough — every build must survive being stepped on):
- Vehicles get a SOLID stacked core: one profile part with laminate: true and count "as many as
  needed" to reach >= 0.9" total thickness (6+ layers at 0.15"), with the axle holes passing
  through the stack — like commercial cardboard toys. Never hang an axle in a single 0.15" wall.
- Anything gripped or swung (a body, a blade, a handle) is >= 3 laminated layers or a closed box.
- Avoid big single-layer panels: over 40 in² will crease — laminate or box them.

MECHANISMS (declare one for anything meant to move; v1 type "revolute" = the rolling-wheel pattern):
- {"type":"revolute","id":"front-axle","axle":"axle-dowel",
   "bearings":[{"part":"body-core","hole":"h-axle-front"}],  // LOOSE holes the axle spins in (hole IDs)
   "hubs":[{"part":"wheel-disc","hole":"h-hub"}],            // SNUG holes glued to the axle (hole IDs)
   "spins":["wheel-fl","wheel-fr"]}                          // assembly instance ids that rotate with the axle
- The validator MEASURES your real hole geometry (do the arithmetic when drawing the circles):
  bearing hole Ø = axle Ø + 0.04..0.12 (free spin, no slop); hub hole Ø = axle Ø − 0.01..+0.03
  (press fit + glue); bearing/hub holes must be circles.
- Total bearing thickness >= 2× axle Ø (3× is better). Axle length = bearing span + 2× wheel
  stack + 0.2" washer gaps, at most 1.5" spare beyond that.
- Wheel radius + 0.25" clearance must clear the body outline everywhere above the axle hole.
- Rolling toys need ground clearance — nothing but the wheels within 0.5 inch of the floor.

ASSEMBLY (REQUIRED — powers the 3D fold-up preview):
- Add "assembly": {"thicknessIn": 0.15, "instances": [...]} with one instance per physical
  copy of every part, giving its FINAL pose in the finished toy: world inches, y-up, ground
  y=0; part-local X=u, Y=-v, Z=out of the front face; "pos" = where the part origin lands,
  "rot" = degrees applied X→Y→Z, "order" = build sequence (equal orders move together),
  "step" = the steps[] index it belongs to, "mirror": true for back-side copies.
- Folds: a part's straight slits that span it are hinge lines; {"folds":[{"slit":"all","angleDeg":17}]}
  bends the part at every hinge by that angle (positive = toward the front face), so many small
  equal angles curl a slitted strip into an arc (10 slits × 17° ≈ 170° C-curl) and a single
  {"slit":2,"angleDeg":90} makes a box-wall fold. Example instance:
  {"id":"guard","part":"guard-bowl","copy":0,"order":2,"step":4,"pos":[3.85,0.1,4.62],
   "rot":[180,0,-90],"folds":[{"slit":"all","angleDeg":17}]}
`;

function runClaude(prompt, { maxTurns = 1, timeoutMs = 480000, onData } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      ['-p', '--output-format', 'text', '--max-turns', String(maxTurns)],
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, env: { ...process.env } },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`claude CLI failed: ${err.message}\n${stderr?.slice(0, 2000) || ''}`));
        resolve(stdout);
      }
    );
    if (onData) child.stdout.on('data', (chunk) => onData(chunk.length));
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function extractJson(text) {
  // strip fences if the model added them despite instructions
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object found in model output');
  return JSON.parse(raw.slice(start, end + 1));
}

// Conversational ideation — returns { reply, readyBrief? }
export async function ideate(history) {
  const convo = history.map(m => `${m.role === 'user' ? 'FAMILY' : 'STUDIO'}: ${m.text}`).join('\n');
  const prompt = `You are the friendly workshop guide of "Cardboard Studio", helping a parent and child
invent a cardboard build project (like the templates on reuseandplay.com: swords, helmets,
crowns, toy garages, shelves, masks, playsets...).

Chat so far:
${convo}

Reply as STUDIO in 2-5 short, playful sentences. Ask at most one question. Help them converge
on ONE buildable idea with a rough size. When (and only when) the idea feels settled, end your
reply with a line in exactly this form:
BRIEF: <one-paragraph build brief with object, size in inches, key features, difficulty>

Output only your reply text.`;
  const out = await runClaude(prompt);
  const briefMatch = out.match(/^BRIEF:\s*(.+)$/ms);
  return {
    reply: out.replace(/^BRIEF:.*$/ms, '').trim(),
    brief: briefMatch ? briefMatch[1].trim() : null,
  };
}

// ---------------------------------------------------------------------------
// M4 — "edit this design" mode (contract §1).
//
// The kid types into the Mat's chat rail; Claude answers in prose, or in prose
// PLUS a complete modified design.json. Full-document replace is deliberate
// (DESIGN.md §2.4.2): LLMs botch positional patches, and the server owning the
// diff/merge is what makes Review mode and the two-ghost picker possible.
//
// Everything that keeps this safe lives here:
//   - the ids are the reference currency, so the prompt says KEEP THEM, twice;
//   - the same validate/repair loop generation uses, capped at 3 tries, with
//     the FIRST reply text kept (the kid asked one question, they get one
//     answer — the repair rounds are the machine talking to itself);
//   - slug / createdAt / brief are forced back to the draft's values, so a
//     rename can never fork the design's folder;
//   - a part Claude did not mention keeps the layout the kid gave it, so an
//     omitted `layout` reads as "didn't move it" rather than as a conflict
//     with every MOVE the kid made while Claude was thinking.

const PROPOSE_OUTPUT = `
OUTPUT CONTRACT — output ONE JSON object, no markdown fences, no commentary:

{
  "reply":   "2-3 playful sentences to the kid, in the workshop's voice",
  "summary": "kid-language one-liner naming what you changed, 60 characters MAX" | null,
  "design":  { ...the COMPLETE modified design.json... } | null
}

- If the message is a QUESTION, or asks for advice, or you are not changing the
  toy: "design": null and "summary": null. Just answer in "reply". Never invent
  an edit nobody asked for.
- If you ARE changing the toy: "design" is the WHOLE document (every part, step,
  fitCheck, hero path — not a fragment, not a patch), and "summary" reads like a
  kid saying what happened: "Blade is 2\\" longer", "Wheels got bigger".
- Change ONLY what the request needs. Everything else comes through untouched.

IDS ARE THE REFERENCE CURRENCY — the single rule that breaks the toy if broken:
- Keep "slug" EXACTLY as it is.
- Keep every existing part id, hole id and slit id EXACTLY as it is. Renaming
  one silently unhooks the mechanisms, the assembly instances, the fit checks
  and the family's edit history from the geometry they point at.
- Keep each part's "layout" ({x, y, rotDeg} — where it sits on the cutting mat)
  exactly as given for every part you are not deliberately moving. The family
  arranges the sheets by hand; do not re-pack them.
- New parts/holes/slits get new ids in the same style.
- Keep the geometry honest: if you stretch a part, update anything measured
  against it (fitChecks, assembly poses, step figures) so it still validates.
`;

export async function proposeEdit({
  design, message, chat = [], selection = null, findings = [], checkpoints = [],
  maxAttempts = 3, onProgress = () => {},
} = {}) {
  if (!design || typeof design !== 'object') throw new Error('proposeEdit needs the current design');
  if (typeof message !== 'string' || !message.trim()) throw new Error('proposeEdit needs a message');

  const partList = (design.parts || [])
    .map((p) => `  - ${p.id} ("${p.name || p.id}")${p.count > 1 ? ` ×${p.count}` : ''}`).join('\n');
  const selected = selection && typeof selection === 'string'
    ? `The kid has "${selection}" selected on the mat right now — if the request says "it" or "this", they almost certainly mean that part.`
    : 'Nothing is selected on the mat right now.';
  const lint = (findings || []).length
    ? `The Toy Doctor currently says:\n${findings.slice(0, 12).map((f) => `  - [${f.level || 'warn'}] ${f.message}`).join('\n')}`
    : 'The Toy Doctor is happy with this design right now — do not break that.';
  const hands = (checkpoints || []).length
    ? `What the humans just did by hand (newest last), so you do not undo it:\n${checkpoints.slice(-5).map((c) => `  - ${c.author === 'claude' ? 'Claude' : 'They'}: ${c.summary}`).join('\n')}`
    : 'No hand edits recorded yet.';
  const convo = (chat || []).slice(-10)
    .map((m) => `${m.role === 'assistant' || m.role === 'claude' ? 'STUDIO' : 'KID'}: ${String(m.text || '').slice(0, 1200)}`)
    .join('\n');

  const context = `
YOU ARE EDITING AN EXISTING DESIGN — not inventing a new one.

Parts in this design:
${partList || '  (none)'}

${selected}

${lint}

${hands}
${convo ? `\nThe chat so far:\n${convo}\n` : ''}
THE CURRENT DESIGN JSON (this is the document you are editing):
${JSON.stringify(design)}

THE KID JUST SAID:
${message.trim()}
`;

  let firstReply = null;
  let lastErrors = null;
  let lastJson = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onProgress(attempt === 1
      ? 'reading your design and thinking it over...'
      : `attempt ${attempt}/${maxAttempts}: fixing ${lastErrors.length} problem${lastErrors.length === 1 ? '' : 's'} with the idea...`);

    const repair = lastErrors
      ? `\n\nYour previous proposal broke the shop rules. Fix ALL of these and output the corrected COMPLETE JSON object (same "reply", same shape):\n${lastErrors.map((x) => '- ' + x).join('\n')}\n\nYour previous "design" was:\n${JSON.stringify(lastJson).slice(0, 20000)}`
      : '';
    const prompt = `${GEOMETRY_RULES}\n${context}\n${PROPOSE_OUTPUT}${repair}\n\nOutput the JSON object now.`;

    const started = Date.now();
    let bytes = 0;
    const tick = () => {
      const secs = Math.round((Date.now() - started) / 1000);
      onProgress(bytes
        ? `writing the change... ${(bytes / 1024).toFixed(1)} KB so far (${secs}s)`
        : `thinking about the geometry... (${secs}s)`, { transient: true });
    };
    const beat = setInterval(tick, 5000);
    tick();
    let out;
    try {
      out = await runClaude(prompt, { timeoutMs: 900000, onData: (n) => { bytes += n; } });
    } finally {
      clearInterval(beat);
    }

    let parsed;
    try {
      parsed = extractJson(out);
    } catch (err) {
      lastErrors = [`output was not valid JSON: ${err.message}`];
      lastJson = out.slice(0, 4000);
      onProgress('that answer was not valid JSON — asking again...');
      continue;
    }

    if (firstReply === null && typeof parsed.reply === 'string' && parsed.reply.trim()) {
      firstReply = parsed.reply.trim();
    }
    const reply = firstReply || 'Here you go!';

    // Prose turn: a question got an answer, nothing to review.
    if (!parsed.design || typeof parsed.design !== 'object') {
      onProgress('answered without changing anything.');
      return { reply, summary: null, design: null };
    }

    const proposal = normalizeProposal(parsed.design, design);
    onProgress(`checking the change: ${proposal.parts?.length || 0} parts, ${proposal.fitChecks?.length || 0} fit checks...`);
    const errors = validateDesign(proposal);
    if (!errors.length) {
      onProgress('the change passes every toy check.');
      return { reply, summary: cleanSummary(parsed.summary), design: proposal };
    }
    lastErrors = errors;
    lastJson = proposal;
    onProgress(`found ${errors.length} problem${errors.length === 1 ? '' : 's'} — e.g. "${errors[0].slice(0, 140)}"`);
  }

  // Never a dead proposal: the chat still gets to say something honest.
  return {
    reply: firstReply || "I couldn't make that work without breaking the toy.",
    summary: null,
    design: null,
    error: `couldn't make that change work after ${maxAttempts} tries: ${(lastErrors || []).slice(0, 3).join(' / ')}`,
  };
}

// The one-liner rides on a checkpoint dot and inside a banner, so it is capped
// hard rather than trusted.
function cleanSummary(s) {
  if (typeof s !== 'string' || !s.trim()) return 'Claude changed the design';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= 60 ? t : t.slice(0, 59).replace(/\s+\S*$/, '') + '…';
}

// Identity the model is not allowed to move, plus the layout safety net.
function normalizeProposal(proposal, current) {
  const out = structuredClone(proposal);
  out.slug = current.slug;
  if (current.createdAt !== undefined) out.createdAt = current.createdAt; else delete out.createdAt;
  if (current.brief !== undefined) out.brief = current.brief; else delete out.brief;
  const layouts = new Map((current.parts || []).map((p) => [p && p.id, p && p.layout]));
  for (const part of out.parts || []) {
    if (!part || typeof part !== 'object') continue;
    const had = layouts.get(part.id);
    if (had && (!part.layout || typeof part.layout !== 'object')) part.layout = structuredClone(had);
  }
  return out;
}

// Full design generation with validation + self-repair loop.
// onProgress(msg, { transient }) — transient messages are "still working" heartbeats
// meant to replace each other in the UI; the rest are milestones.
export async function generateDesign(brief, { maxAttempts = 3, onProgress = () => {} } = {}) {
  let lastErrors = null;
  let lastJson = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onProgress(attempt === 1
      ? 'sketching parts, steps and fit checks (the slow, thinking part)...'
      : `attempt ${attempt}/${maxAttempts}: fixing ${lastErrors.length} problem${lastErrors.length === 1 ? '' : 's'} from the last draft...`);
    const repair = lastErrors
      ? `\n\nYour previous attempt had these problems — fix ALL of them and output the corrected complete JSON:\n${lastErrors.map(x => '- ' + x).join('\n')}\n\nPrevious JSON:\n${JSON.stringify(lastJson).slice(0, 20000)}`
      : `\n\nHere is a complete example of a valid design for a different project (match its structure and quality):\n${EXAMPLE_DESIGN}`;
    const prompt = `${GEOMETRY_RULES}\n\nBUILD BRIEF:\n${brief}${repair}\n\nOutput the JSON object now.`;

    // heartbeat: elapsed time + how much of the design has streamed out so far.
    // Fires immediately and then every 5s, so job.progress is never empty
    // during the long claude call.
    const started = Date.now();
    let bytes = 0;
    const tick = () => {
      const secs = Math.round((Date.now() - started) / 1000);
      onProgress(bytes
        ? `writing the design... ${(bytes / 1024).toFixed(1)} KB drafted (${secs}s)`
        : `thinking about the geometry... (${secs}s)`, { transient: true });
    };
    const beat = setInterval(tick, 5000);
    tick();
    let out;
    try {
      out = await runClaude(prompt, { timeoutMs: 900000, onData: (n) => { bytes += n; } });
    } finally {
      clearInterval(beat);
    }

    let design;
    try {
      design = extractJson(out);
    } catch (err) {
      lastErrors = [`output was not valid JSON: ${err.message}`];
      lastJson = out.slice(0, 4000);
      onProgress('draft was not valid JSON — asking for a rewrite...');
      continue;
    }
    onProgress(`checking geometry: ${design.parts?.length || 0} parts, ${design.fitChecks?.length || 0} fit checks, ${design.steps?.length || 0} steps...`);
    const errors = validateDesign(design);
    if (!errors.length) {
      onProgress('all measurements check out — every joint fits.');
      design.createdAt = new Date().toISOString();
      design.brief = brief;
      return design;
    }
    lastErrors = errors;
    lastJson = design;
    onProgress(`found ${errors.length} problem${errors.length === 1 ? '' : 's'} — e.g. "${errors[0].slice(0, 140)}"`);
  }
  throw new Error(`design failed validation after ${maxAttempts} attempts:\n${(lastErrors || []).join('\n')}`);
}
