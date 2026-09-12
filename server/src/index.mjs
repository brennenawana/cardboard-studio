// Cardboard Studio — local family design server.
// Run: node src/index.mjs   →  http://localhost:4177

import express from 'express';
import path from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, openSync, readSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ideate, generateDesign, proposeEdit } from './ai.mjs';
import { validateDesign } from './schema.mjs';
import { diffDesigns, mergeDesigns, canonicalJson } from './differ.mjs';
import { listDesigns, loadDesign, renderBundle, designDir, DESIGNS_DIR } from './pipeline.mjs';
import { renderTemplatePdf, layoutParts } from './render/templates.mjs';
import { renderGuidePdf } from './render/guide.mjs';
import { partBBox, entryId, pathD, pathBBox, transformPath } from './render/geometry.mjs';
import { shelfList, makeStarter } from './shelf.mjs';
import { PAGE } from './render/pdfkit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '10mb' }));
// API responses (esp. job polling) must never be cached — the family watches
// job.progress tick during multi-minute generations.
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.static(path.join(here, '../public')));
app.use('/files', express.static(DESIGNS_DIR));

// in-memory job registry for long-running generations
const jobs = new Map();

app.get('/api/designs', (_req, res) => {
  res.json(listDesigns());
});

app.get('/api/designs/:slug', (req, res) => {
  try {
    res.json(loadDesign(req.params.slug));
  } catch {
    res.status(404).json({ error: 'not found' });
  }
});

app.post('/api/ideate', async (req, res) => {
  try {
    const result = await ideate(req.body.history || []);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

app.post('/api/generate', (req, res) => {
  const brief = req.body.brief;
  if (!brief) return res.status(400).json({ error: 'brief required' });
  const id = Math.random().toString(36).slice(2, 10);
  const job = {
    id, status: 'running', log: ['starting the design engine...'],
    progress: '', slug: null, title: null, error: null, startedAt: Date.now(),
  };
  jobs.set(id, job);
  (async () => {
    try {
      const design = await generateDesign(brief, {
        onProgress: (msg, { transient } = {}) => {
          if (transient) { job.progress = msg; return; }
          job.progress = '';
          job.log.push(msg);
        },
      });
      job.title = design.title;
      job.log.push('rendering template sheets + guide PDFs...');
      const { files } = await renderBundle(design);
      job.status = 'done';
      job.slug = design.slug;
      job.progress = '';
      job.log.push(`done: ${files.join(', ')}`);
    } catch (err) {
      job.status = 'error';
      job.error = String(err.message);
      job.progress = '';
      job.log.push('ERROR: ' + job.error);
    }
  })();
  res.json({ jobId: id });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'unknown job' });
  res.json(job);
});

// re-render an edited design.json (power-user path: edit file, hit re-render)
app.post('/api/designs/:slug/render', async (req, res) => {
  try {
    const design = req.body.design || loadDesign(req.params.slug);
    const errors = validateDesign(design);
    if (errors.length) return res.status(400).json({ errors });
    const { files } = await renderBundle(design);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// ---------------------------------------------------------------------------
// Cutting Mat drafts: one in-memory working copy per slug, created lazily from
// disk. The Mat edits the draft; disk design.json only changes on SAVE.

const drafts = new Map(); // slug -> { design, rev }

// A design opened on the Mat must show exactly what its sheets print today, so
// on first open every part gets the layout the auto-packer would have given it
// (bbox min-corner in global template inches, no rotation). Once every part has
// a layout the renderer stops packing and honours them (contract §1).
function initLayouts(design) {
  const parts = (design.parts || []);
  if (!parts.length || parts.every(p => p && p.layout && Number.isFinite(p.layout.x) && Number.isFinite(p.layout.y))) return;
  const { placed } = layoutParts(parts, 'letter');
  const byId = new Map(placed.map(p => [p.part.id, p]));
  for (const part of parts) {
    const spot = byId.get(part.id);
    const bb = partBBox(part);
    if (!spot || !bb) continue;
    part.layout = {
      x: +(bb.minX + spot.offsetX).toFixed(4),
      y: +(bb.minY + spot.offsetY).toFixed(4),
      rotDeg: 0,
    };
  }
}

// Every hole and slit needs a stable name before the Mat can pin a lint chip or
// a one-tap fix to it, so the draft backfills the missing ones on first open
// (h1..hN / s1..sN in array order, legacy bare strings promoted to {id, d}).
// Mechanism refs that still point at INDICES keep working untouched — the
// positional-reference warning is what asks the design to move to ids.
function initEntryIds(design) {
  for (const part of design.parts || []) {
    if (!part || typeof part !== 'object') continue;
    for (const [key, prefix] of [['holes', 'h'], ['slits', 's']]) {
      const list = part[key];
      if (!Array.isArray(list) || !list.length) continue;
      const taken = new Set(list.map(entryId).filter(Boolean));
      part[key] = list.map((entry, i) => {
        if (entryId(entry)) return entry;
        const d = pathD(entry);
        if (typeof d !== 'string') return entry;
        let n = i + 1;
        while (taken.has(`${prefix}${n}`)) n++;
        taken.add(`${prefix}${n}`);
        return { id: `${prefix}${n}`, d };
      });
    }
  }
}

// The Toy Doctor's chips: the same problems as `warnings`, structured and
// anchored to the geometry that is wrong.
function findingsFor(design) {
  const findings = [];
  try { validateDesign(design, { findings }); } catch { /* a broken doc still opens */ }
  return findings;
}

function getDraft(slug) {
  let draft = drafts.get(slug);
  if (!draft) {
    const design = structuredClone(loadDesign(slug)); // throws when unknown
    initLayouts(design);
    initEntryIds(design);
    draft = { design, rev: 1 };
    drafts.set(slug, draft);
  }
  return draft;
}

app.get('/api/designs/:slug/draft', (req, res) => {
  try {
    const { design, rev } = getDraft(req.params.slug);
    res.json({ design, rev, findings: findingsFor(design) });
  } catch {
    res.status(404).json({ error: 'not found' });
  }
});

// M1 contract §3: a rejected draft is 400 { errors } and a stale rev is 409.
// `?soft=1` reports those same two outcomes as a 200 { ok: false, ... } body
// instead — same validation, same draft state, byte-identical payload fields.
// The Mat asks for it because a red Toy Doctor chip is a NORMAL state of the
// tool (the kid is mid-edit, the lint strip is doing its job) and a browser
// turns every 4xx into a console error, which made "zero console errors" a
// promise the editor could not keep. Callers that omit the flag see the
// contract's status codes unchanged.
app.put('/api/designs/:slug/draft', (req, res) => {
  const soft = req.query.soft === '1' || req.query.soft === 'true';
  const fail = (status, body) => (soft ? res.json({ ok: false, ...body }) : res.status(status).json(body));
  let current;
  try {
    current = getDraft(req.params.slug);
  } catch {
    return res.status(404).json({ error: 'not found' });
  }
  const { design, rev } = req.body || {};
  if (!design || typeof design !== 'object') return fail(400, { errors: ['body needs { design, rev }'] });
  if (rev !== undefined && rev !== current.rev) {
    return fail(409, { error: 'stale', stale: true, rev: current.rev });
  }
  const warnings = [], findings = [];
  const errors = validateDesign(design, { warnings, findings });
  if (errors.length) return fail(400, { errors, findings });
  current.design = design;
  current.rev += 1;
  res.json({ ok: true, rev: current.rev, warnings, findings });
});

app.delete('/api/designs/:slug/draft', (req, res) => {
  drafts.delete(req.params.slug);
  res.json({ ok: true });
});

// Render the DRAFT into designs/<slug>/draft-preview/ — the real bundle and
// design.json are untouched, so PRINT never overwrites the gallery copy.
app.post('/api/designs/:slug/draft/render', async (req, res) => {
  const slug = req.params.slug;
  let draft;
  try {
    draft = getDraft(slug);
  } catch {
    return res.status(404).json({ error: 'not found' });
  }
  try {
    const { design } = draft;
    const errors = validateDesign(design);
    if (errors.length) return res.status(400).json({ errors });

    const doc = structuredClone(design);
    const { width, height } = layoutParts(doc.parts, 'letter');
    const { w: pw, h: ph } = PAGE.letter;
    const cols = Math.max(1, Math.ceil((width - 1) / (pw - 1)));
    const rows = Math.max(1, Math.ceil((height - 1) / (ph - 1)));
    doc.templateGrid = { cols, rows };
    doc.templatePages = cols * rows;

    const dir = path.join(designDir(slug), 'draft-preview');
    mkdirSync(dir, { recursive: true });
    const base = slug.replace(/-/g, '_');
    const files = [];
    const write = (name, bytes) => {
      writeFileSync(path.join(dir, name), bytes);
      files.push(`/files/${slug}/draft-preview/${name}`);
    };
    write(`${base}_template_Lettersize.pdf`, await renderTemplatePdf(doc.parts, { paper: 'letter' }));
    write(`${base}_template_A4.pdf`, await renderTemplatePdf(doc.parts, { paper: 'a4' }));
    write(`${base}_guide.pdf`, await renderGuidePdf(doc));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// SAVE: the draft becomes the design — written to disk and re-rendered.
app.post('/api/designs/:slug/draft/save', async (req, res) => {
  let draft;
  try {
    draft = getDraft(req.params.slug);
  } catch {
    return res.status(404).json({ error: 'not found' });
  }
  try {
    const { design } = draft;
    const errors = validateDesign(design);
    if (errors.length) return res.status(400).json({ errors });
    const { files } = await renderBundle(structuredClone(design));
    res.json({ ok: true, files });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// ---------------------------------------------------------------------------
// History: append-only checkpoints (M3 contract §1-§2, DESIGN.md §2.2).
//
// `designs/<slug>/history.jsonl` — one JSON record per line, one line per
// checkpoint, holding a FULL immutable snapshot of the design:
//
//   { id, author, summary, ts, base, design }
//
// The file is never rewritten and never truncated. Restore does not rewind the
// log, it APPENDS the old document as the new head — so the strip of dots only
// ever grows and no edit anybody made can be lost by pressing the wrong thing.
// That property is also what makes the write path simple: one append per
// checkpoint, flushed to disk, nothing to reconcile.

const historyPath = (slug) => path.join(designDir(slug), 'history.jsonl');
const designExists = (slug) => existsSync(path.join(designDir(slug), 'design.json'));

// A crashed or half-flushed append leaves a partial LAST line. Reading skips
// any line that will not parse (with a warning) instead of throwing, because a
// truncated tail must cost the family one checkpoint, never the whole history.
function readHistory(slug) {
  const file = historyPath(slug);
  if (!existsSync(file)) return []; // no file yet = no history, not an error
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    console.warn(`history ${slug}: unreadable (${err.message}) — treating as empty`);
    return [];
  }
  const out = [];
  raw.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      console.warn(`history ${slug}: skipping unreadable line ${i + 1} (partial write?)`);
      return;
    }
    if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string') {
      console.warn(`history ${slug}: skipping line ${i + 1} (not a checkpoint record)`);
      return;
    }
    out.push(rec);
  });
  return out;
}

const checkpointMeta = ({ id, author, summary, ts, base }) => ({ id, author, summary, ts, base: base ?? null });

function nextCheckpointId(history) {
  let max = 0;
  for (const rec of history) {
    const m = /^cp-(\d+)$/.exec(rec.id || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `cp-${max + 1}`;
}

// The validator gate: a checkpoint is a place the family can safely come back
// to, so a broken document never becomes one. Returns { errors } (file
// untouched) or { record } (already appended and flushed).
function appendCheckpoint(slug, { author, summary, design, base }) {
  if (!design || typeof design !== 'object') return { errors: ['no design to checkpoint'] };
  const errors = validateDesign(design);
  if (errors.length) return { errors };

  const history = readHistory(slug);
  const record = {
    id: nextCheckpointId(history),
    author: (typeof author === 'string' && author.trim()) ? author.trim().slice(0, 40) : 'you',
    summary: (typeof summary === 'string' && summary.trim()) ? summary.trim().slice(0, 200) : 'Checkpoint',
    ts: new Date().toISOString(),
    base: base !== undefined ? base : (history.length ? history[history.length - 1].id : null),
    design,
  };

  mkdirSync(designDir(slug), { recursive: true });
  const file = historyPath(slug);
  // A kill mid-write leaves a partial LAST line with no newline on the end.
  // Appending straight onto it would glue the new record to the fragment and
  // lose BOTH, so a torn tail is closed off first — still pure append, the
  // bytes already on disk are never touched.
  const fd = openSync(file, 'a+'); // O_APPEND: every write lands at the end
  try {
    const size = statSync(file).size;
    let lead = '';
    if (size > 0) {
      const last = Buffer.alloc(1);
      readSync(fd, last, 0, 1, size - 1);
      if (last[0] !== 0x0a) lead = '\n';
    }
    writeSync(fd, lead + JSON.stringify(record) + '\n');
    fsyncSync(fd);                              // survive a kill right after the reply
  } finally {
    closeSync(fd);
  }
  return { record };
}

app.get('/api/designs/:slug/checkpoints', (req, res) => {
  const slug = req.params.slug;
  if (!designExists(slug)) return res.status(404).json({ error: 'not found' });
  res.json({ checkpoints: readHistory(slug).map(checkpointMeta) }); // chronological, no bodies
});

// `design` defaults to the CURRENT draft — and deliberately does not create one:
// "checkpoint what's on the mat" is meaningless when nobody has opened the mat.
app.post('/api/designs/:slug/checkpoints', (req, res) => {
  const slug = req.params.slug;
  if (!designExists(slug)) return res.status(404).json({ error: 'not found' });
  const { author, summary, design } = req.body || {};
  let snapshot = design;
  if (!snapshot) {
    const draft = drafts.get(slug);
    if (!draft) return res.status(404).json({ error: 'no draft to checkpoint' });
    snapshot = draft.design;
  }
  const { errors, record } = appendCheckpoint(slug, { author, summary, design: snapshot });
  if (errors) return res.status(400).json({ errors });
  res.json({ id: record.id, ts: record.ts });
});

// --- diff: registered BEFORE /checkpoints/:id so "diff" is never read as an id
function resolveSide(slug, side) {
  if (side && typeof side === 'object') return { design: side, meta: null };       // raw body (M4)
  if (typeof side !== 'string' || !side) return null;
  if (side === 'draft') {
    try {
      const { design, rev } = getDraft(slug);
      return { design, meta: { id: 'draft', summary: 'now', rev } };
    } catch { return null; }
  }
  if (side === 'saved') {
    try { return { design: loadDesign(slug), meta: { id: 'saved', summary: 'the saved design' } }; } catch { return null; }
  }
  const rec = readHistory(slug).find((r) => r.id === side);
  return rec ? { design: rec.design, meta: checkpointMeta(rec) } : null;
}

function respondDiff(res, slug, aSide, bSide) {
  const a = resolveSide(slug, aSide);
  if (!a) return res.status(404).json({ error: `unknown "a": ${typeof aSide === 'string' ? aSide : 'body'}` });
  const b = resolveSide(slug, bSide);
  if (!b) return res.status(404).json({ error: `unknown "b": ${typeof bSide === 'string' ? bSide : 'body'}` });
  res.json({ changes: diffDesigns(a.design, b.design), a: a.meta, b: b.meta });
}

app.get('/api/designs/:slug/checkpoints/diff', (req, res) => {
  const slug = req.params.slug;
  if (!designExists(slug)) return res.status(404).json({ error: 'not found' });
  respondDiff(res, slug, req.query.a, req.query.b === undefined ? 'draft' : req.query.b);
});

// Same differ, raw documents: M4 diffs a proposal that is not a checkpoint yet.
// Either side may still be a name ("cp-3", "draft", "saved") for mixed compares.
app.post('/api/designs/:slug/checkpoints/diff', (req, res) => {
  const slug = req.params.slug;
  if (!designExists(slug)) return res.status(404).json({ error: 'not found' });
  const { a, b } = req.body || {};
  respondDiff(res, slug, a, b === undefined ? 'draft' : b);
});

app.get('/api/designs/:slug/checkpoints/:id', (req, res) => {
  const slug = req.params.slug;
  if (!designExists(slug)) return res.status(404).json({ error: 'not found' });
  const rec = readHistory(slug).find((r) => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'unknown checkpoint' });
  res.json(rec);
});

// Restore = "put that snapshot back on the mat", and it is itself an event in
// the history: the log grows by one line, it never rewinds. Undo (in the Mat)
// steps back across this like any other edit.
app.post('/api/designs/:slug/draft/restore', (req, res) => {
  const slug = req.params.slug;
  if (!designExists(slug)) return res.status(404).json({ error: 'not found' });
  const wanted = (req.body || {}).checkpoint;
  const rec = readHistory(slug).find((r) => r.id === wanted);
  if (!rec) return res.status(404).json({ error: 'unknown checkpoint' });

  let draft;
  try {
    draft = getDraft(slug);
  } catch {
    return res.status(404).json({ error: 'not found' });
  }

  const snapshot = structuredClone(rec.design);
  // Append FIRST: if the snapshot no longer validates (a hand-edited history
  // file), the draft on the mat must be left exactly as the kid left it.
  const { errors, record } = appendCheckpoint(slug, {
    author: 'you',
    summary: `restored "${rec.summary}"`,
    design: snapshot,
    base: rec.id,
  });
  if (errors) return res.status(400).json({ errors });

  draft.design = structuredClone(snapshot);
  draft.rev += 1;
  res.json({ design: draft.design, rev: draft.rev, findings: findingsFor(draft.design), checkpointId: record.id });
});

// ---------------------------------------------------------------------------
// Chat proposals (M4 contract §3, DESIGN.md §2.4): propose → validate → merge
// → review → commit. Human and robot edit the same document through the same
// validated door, and ONLY the human commits.
//
// Nothing about a proposal touches disk until accept. The job holds the base
// the proposal was generated from (a deep copy + its hash), so a kid who keeps
// editing while Claude thinks can never have their work attributed to the robot
// or silently overwritten by it — the merge reconciles the two, and a genuine
// same-property clash becomes a two-ghost picker instead of a lost edit.
//
// At most ONE live proposal per slug: a second POST supersedes the first, and
// the superseded job's async tail is dropped on the floor when it lands.

const proposals = new Map(); // slug -> job
const hashDesign = (design) => createHash('sha1').update(canonicalJson(design)).digest('hex');

// The identity fields the model is never allowed to move (ai.mjs forces them
// on the proposal; the merge re-forces them because `ours` could in principle
// carry a hand-edited one).
function forceIdentity(doc, draft) {
  const out = doc;
  out.slug = draft.slug;
  if (draft.createdAt !== undefined) out.createdAt = draft.createdAt;
  if (draft.brief !== undefined) out.brief = draft.brief;
  return out;
}

// `?mock=1` — the scripted proposal. No CLI, no waiting: stretch one part 2"
// taller and hand back the same { reply, summary, design } shape the model
// produces, so every millisecond after this point is the REAL pipeline
// (validate → merge → conflicts → accept → checkpoint). The stretch scales the
// outline about its top edge and RIDES the holes and score lines along without
// resizing them — a stretched blade must not turn its round holes into ovals.
function mockProposal(design, selection) {
  const doc = structuredClone(design);
  const parts = doc.parts || [];
  const part = parts.find((p) => p && p.id === selection) || parts.find((p) => p && typeof p.path === 'string');
  if (!part) return { reply: "There's nothing on the mat to stretch yet!", summary: null, design: null };
  const bb = pathBBox(part.path);
  if (!bb || !(bb.height > 0.01)) return { reply: "I couldn't measure that piece.", summary: null, design: null };

  const sy = (bb.height + 2) / bb.height;
  const stretch = [1, 0, 0, sy, 0, bb.minY * (1 - sy)];   // scale in y about the top edge
  part.path = transformPath(part.path, stretch);
  if (typeof part.backing === 'string') part.backing = transformPath(part.backing, stretch);
  for (const key of ['holes', 'slits']) {
    const list = part[key];
    if (!Array.isArray(list)) continue;
    part[key] = list.map((entry) => {
      const d = pathD(entry);
      if (typeof d !== 'string') return entry;
      const eb = pathBBox(d);
      if (!eb) return entry;
      const cy = (eb.minY + eb.maxY) / 2;
      const moved = transformPath(d, [1, 0, 0, 1, 0, (sy - 1) * (cy - bb.minY)]);
      return typeof entry === 'string' ? moved : { ...entry, d: moved };
    });
  }
  const name = (part.name || part.id || 'that piece').trim();
  return {
    reply: `Nice — I gave the ${name} another two inches. Take a look and tell me if it's too much!`,
    summary: `Stretched ${name} 2" taller`.slice(0, 60),
    design: doc,
  };
}

function liveProposal(slug, jobId) {
  const job = proposals.get(slug);
  return job && job.id === jobId ? job : null;
}

const proposalStatus = (job) => ({
  jobId: job.id,
  status: job.status,
  progress: job.progress || '',
  reply: job.reply,
  summary: job.summary,
  error: job.error,
  baseRev: job.baseRev,
  elapsedMs: Date.now() - job.startedAt,
});

app.post('/api/designs/:slug/propose', (req, res) => {
  const slug = req.params.slug;
  let draft;
  try {
    draft = getDraft(slug);
  } catch {
    return res.status(404).json({ error: 'not found' });
  }
  const { message, chat, selection, mock } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message required' });
  const useMock = req.query.mock === '1' || req.query.mock === 'true' || mock === true;

  const previous = proposals.get(slug);
  if (previous) previous.superseded = true;   // its result, if it ever lands, is stale

  const base = structuredClone(draft.design);
  const job = {
    id: Math.random().toString(36).slice(2, 10),
    slug,
    status: 'thinking',
    progress: 'thinking about the geometry... (0s)',
    reply: null, summary: null, design: null, error: null,
    base, baseRev: draft.rev, baseHash: hashDesign(base),
    message: message.trim(),
    startedAt: Date.now(),
    superseded: false,
  };
  proposals.set(slug, job);

  (async () => {
    try {
      const result = useMock
        ? mockProposal(base, typeof selection === 'string' ? selection : null)
        : await proposeEdit({
          design: base,
          message: job.message,
          chat: Array.isArray(chat) ? chat : [],
          selection: typeof selection === 'string' ? selection : null,
          findings: findingsFor(base),
          checkpoints: readHistory(slug).map(checkpointMeta),
          onProgress: (msg, { transient } = {}) => { job.progress = msg; },
        });
      if (job.superseded) return;
      job.reply = result.reply || 'Here you go!';
      if (result.design) {
        job.design = forceIdentity(result.design, base);
        job.summary = result.summary || 'Claude changed the design';
        job.status = 'ready';
      } else {
        job.summary = null;
        job.status = 'chat';           // a question got an answer — nothing to review
        if (result.error) job.error = result.error;
      }
      job.progress = '';
    } catch (err) {
      if (job.superseded) return;
      job.status = 'error';
      job.error = String(err.message);
      job.progress = '';
    }
  })();

  res.json({ jobId: job.id, status: job.status, baseRev: job.baseRev });
});

app.get('/api/designs/:slug/propose/:jobId', (req, res) => {
  const job = liveProposal(req.params.slug, req.params.jobId);
  if (!job) return res.status(404).json({ error: 'unknown proposal' });
  res.json(proposalStatus(job));
});

// Stateless: the merge is recomputed against the draft AS IT IS NOW, every
// time. That is what lets the two-ghost picker just ask again after each tap,
// and what makes "the kid kept editing during review" harmless.
function computeMerge(job, draft, choices) {
  const result = mergeDesigns({ base: job.base, ours: draft.design, theirs: job.design, choices });
  forceIdentity(result.merged, draft.design);
  return result;
}

app.post('/api/designs/:slug/propose/:jobId/merge', (req, res) => {
  const slug = req.params.slug;
  const job = liveProposal(slug, req.params.jobId);
  if (!job) return res.status(404).json({ error: 'unknown proposal' });
  if (job.status !== 'ready' || !job.design) return res.status(400).json({ error: `proposal is "${job.status}" — nothing to merge` });
  let draft;
  try {
    draft = getDraft(slug);
  } catch {
    return res.status(404).json({ error: 'not found' });
  }
  const { merged, records, conflicts, renames } = computeMerge(job, draft, (req.body || {}).choices);
  res.json({
    merged,
    changes: records,
    conflicts,
    renames,
    findings: findingsFor(merged),
    baseMoved: hashDesign(draft.design) !== job.baseHash,
    summary: job.summary,
    rev: draft.rev,
  });
});

// Accept is the ONLY moment a proposal becomes real, and it is still gated by
// the same validator every human edit passes. A merged document that does not
// validate is not an error page — it is a 200 that keeps the family in Review
// mode with the reasons on the lint line.
app.post('/api/designs/:slug/propose/:jobId/accept', (req, res) => {
  const slug = req.params.slug;
  const job = liveProposal(slug, req.params.jobId);
  if (!job) return res.status(404).json({ error: 'unknown proposal' });
  if (job.status !== 'ready' || !job.design) return res.status(400).json({ error: `proposal is "${job.status}" — nothing to accept` });
  let draft;
  try {
    draft = getDraft(slug);
  } catch {
    return res.status(404).json({ error: 'not found' });
  }
  const { merged, records, conflicts } = computeMerge(job, draft, (req.body || {}).choices);
  const findings = [];
  const errors = validateDesign(merged, { findings });
  if (errors.length) return res.json({ ok: false, errors, findings, changes: records, conflicts, merged });

  // Checkpoint FIRST (it re-validates and can still say no): if the history
  // write fails the mat is left exactly as the kid left it.
  const { errors: cpErrors, record } = appendCheckpoint(slug, {
    author: 'claude',
    summary: job.summary || 'Claude changed the design',
    design: structuredClone(merged),
  });
  if (cpErrors) return res.json({ ok: false, errors: cpErrors, findings, changes: records, conflicts, merged });

  draft.design = merged;
  draft.rev += 1;
  proposals.delete(slug);
  res.json({ ok: true, design: draft.design, rev: draft.rev, findings, checkpointId: record.id, changes: records });
});

app.post('/api/designs/:slug/propose/:jobId/reject', (req, res) => {
  const slug = req.params.slug;
  const job = liveProposal(slug, req.params.jobId);
  if (!job) return res.status(404).json({ error: 'unknown proposal' });
  proposals.delete(slug);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// The Shape Shelf: starters compiled to plain paths server-side, so nobody has
// to draw a curve to make a part. Pure geometry — the client assigns ids and
// the layout when it drops the result on the Mat.

app.get('/api/shelf', (_req, res) => {
  res.json(shelfList());
});

app.post('/api/shelf/make', (req, res) => {
  const { starter, params } = req.body || {};
  const made = makeStarter(starter, params || {});
  if (!made) return res.status(400).json({ error: `unknown starter "${starter}"` });
  res.json({ part: made.part, params: made.params });
});

// --- the Mat ---
app.get('/edit/:slug', (_req, res) => {
  const page = path.join(here, '../public/edit.html');
  if (!existsSync(page)) return res.status(503).type('text/plain').send('the Cutting Mat page is not built yet');
  res.sendFile(page);
});

// --- 3D viewer ---
app.get('/vendor/three/three.module.js', (_req, res) =>
  res.type('application/javascript').sendFile(path.join(here, '../node_modules/three/build/three.module.js')));
// r180 splits the build: three.module.js does `import ... from './three.core.js'`
app.get('/vendor/three/three.core.js', (_req, res) =>
  res.type('application/javascript').sendFile(path.join(here, '../node_modules/three/build/three.core.js')));
app.get('/vendor/three/OrbitControls.js', (_req, res) =>
  res.type('application/javascript').sendFile(path.join(here, '../node_modules/three/examples/jsm/controls/OrbitControls.js')));
app.get('/viewer/:slug', (_req, res) => res.sendFile(path.join(here, '../public/viewer.html')));

const PORT = process.env.PORT || 4177;
app.listen(PORT, () => {
  console.log(`Cardboard Studio → http://localhost:${PORT}`);
});
