// Design spec validation. Returns a list of problems so the AI layer can
// self-repair and the renderer can trust its input.
//
// Two layers:
//  1. Per-path lint: syntax, size, closedness, holes/slits inside their part.
//  2. Cross-part fit: declarative `fitChecks` the design MUST carry whenever
//     parts physically meet. Each check names two measurements (or a target
//     number); the validator computes the real geometry and rejects the design
//     if they disagree. This is what catches a lid wrap that can't cover its
//     arch, or a keyhole that won't clear its button.

import { pathBBox, samplePath, pathD, entryId, slitPaths, partBBox, layoutMatrix } from './render/geometry.mjs';

const PATH_CMDS = /^[MLHVCSQTZmlhvcsqtz0-9eE+\-.,\s]+$/;
const THREE_D_CATEGORIES = new Set(['chest-boxes', 'furniture', 'vehicles', 'playsets', 'toy-car-garage']);
const HARDWARE_KINDS = new Set(['dowel', 'skewer', 'straw', 'string', 'brad', 'rubber-band', 'paper-clip']);
const ROUND_KINDS = new Set(['dowel', 'skewer', 'straw']);
const ROLLING_CATEGORIES = new Set(['vehicles', 'playsets']);
const LAYER_IN = 0.15; // single-wall corrugated thickness (default)
// The two named fits the whole product speaks in: LOOSE so it spins, SNUG so it
// grips. PUNCH offers these numbers, the linter recommends them, and the one-tap
// fixes write them — one number per fit, everywhere.
const LOOSE = 0.06;    // inside the bearing band [+0.04, +0.12]
const SNUG = 0.01;     // inside the hub band [−0.01, +0.03]

// Arc length of a path, sampled finely. Single-subpath fragments and closed
// outlines both work (Z contributes the closing edge, as it should).
export function pathLength(d) {
  const pts = samplePath(d, 48);
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return len;
}

// ------------------------------------------------------- deterministic fixes
// A finding carries a `fix` only when the right number is computable from the
// geometry itself (M2 contract §1): hole resizes to the middle of a tolerance
// band, and axle length to the middle of its legal window. Everything else is a
// judgement call and ships without one — the chip offers no button rather than
// a guess.
const round2 = (n) => Math.round(n * 100) / 100;

const holeResizeFix = (partId, holeId, diameterIn) => {
  if (!partId || !holeId || !Number.isFinite(diameterIn) || diameterIn <= 0) return undefined;
  const d = round2(diameterIn);
  return { label: `Resize to Ø ${d.toFixed(2)}"`, patch: { op: 'set-hole-diameter', part: partId, holeId, diameterIn: d } };
};

const hardwareLengthFix = (hardwareId, lengthIn) => {
  if (!hardwareId || !Number.isFinite(lengthIn) || lengthIn <= 0) return undefined;
  const L = Math.round(lengthIn * 4) / 4; // real dowels get cut to quarter inches
  return { label: `Cut it to ${L}"`, patch: { op: 'set-hardware-length', hardware: hardwareId, lengthIn: L } };
};

const bboxInside = (inner, outer, slack) =>
  inner.minX >= outer.minX - slack && inner.maxX <= outer.maxX + slack &&
  inner.minY >= outer.minY - slack && inner.maxY <= outer.maxY + slack;

// ------------------------------------------------------------- hole refs
// A hole reference is an ID ({"part": "body-core", "hole": "h1"}) — the stable
// reference currency — or the LEGACY positional index ({"hole": 0}), which is
// still accepted but warned: inserting a hole renumbers every later index and
// silently re-aims the mechanism.
function resolveHoleRef(part, ref, where, e, warn) {
  const holes = part.holes || [];
  if (typeof ref === 'string') {
    const idx = holes.findIndex((h) => entryId(h) === ref);
    if (idx < 0) {
      e(`${where}: part "${part.id}" has no hole with id "${ref}" ` +
        `(its hole ids: ${holes.map((h, i) => entryId(h) || `[${i}] (no id)`).join(', ') || 'none'})`,
        { part: part.id });
      return null;
    }
    return { idx, label: `"${ref}"`, id: ref };
  }
  const idx = Number.isInteger(ref) ? ref : 0;
  const id = entryId(holes[idx]) || null;
  warn(`${where}: hole ${idx} of "${part.id}" is a positional reference — will break if holes are ` +
    `inserted; use ids (give the hole an "id" and name it here).`,
    { code: 'positional-ref', part: part.id, holeId: id });
  if (!holes[idx]) {
    e(`${where}: part "${part.id}" has no holes[${idx}]`, { part: part.id });
    return null;
  }
  return { idx, label: `[${idx}]`, id };
}

// Resolve one side of a fitCheck to { value, desc, part?, hole? } or null
// (error already pushed). `hole` is what lets a clearance failure carry a
// one-tap resize fix.
function resolveMeasure(ref, partsById, where, e, warn) {
  if (typeof ref === 'number') return { value: ref, desc: `${ref}"` };
  if (!ref || typeof ref !== 'object') {
    e(`${where}: measurement must be a number, {"valueIn": n}, or {"part", "measure", ...}`);
    return null;
  }
  if (typeof ref.valueIn === 'number') return { value: ref.valueIn, desc: `${ref.valueIn}"` };
  const part = partsById.get(ref.part);
  if (!part) {
    e(`${where}: unknown part "${ref.part}"`);
    return null;
  }
  const bb = pathBBox(part.path);
  if (!bb) {
    e(`${where}: part "${ref.part}" outline could not be measured`);
    return null;
  }
  switch (ref.measure) {
    case 'width': return { value: bb.width, desc: `${ref.part} width ${bb.width.toFixed(2)}"`, part: ref.part };
    case 'height': return { value: bb.height, desc: `${ref.part} height ${bb.height.toFixed(2)}"`, part: ref.part };
    case 'perimeter': {
      const v = pathLength(part.path);
      return { value: v, desc: `${ref.part} perimeter ${v.toFixed(2)}"`, part: ref.part };
    }
    case 'length': {
      if (typeof ref.d !== 'string' || !ref.d.trim()) {
        e(`${where}: measure "length" needs "d" — a path fragment copied from part "${ref.part}" (e.g. its curved edge)`);
        return null;
      }
      const fb = pathBBox(ref.d);
      if (!fb) {
        e(`${where}: could not parse "d" fragment`);
        return null;
      }
      if (!bboxInside(fb, bb, 0.25)) {
        e(`${where}: the "d" fragment lies outside part "${ref.part}" — copy the edge coordinates exactly from that part's path`);
        return null;
      }
      const v = pathLength(ref.d);
      return { value: v, desc: `${ref.part} edge length ${v.toFixed(2)}"`, part: ref.part };
    }
    case 'holeWidth':
    case 'holeHeight': {
      const seat = resolveHoleRef(part, ref.hole, where, e, warn);
      if (!seat) return null;
      const hb = pathBBox(pathD(part.holes[seat.idx]));
      if (!hb) {
        e(`${where}: hole ${seat.label} of "${ref.part}" could not be measured`, { part: ref.part, holeId: seat.id });
        return null;
      }
      const v = ref.measure === 'holeWidth' ? hb.width : hb.height;
      return {
        value: v,
        desc: `${ref.part} hole ${ref.measure === 'holeWidth' ? 'width' : 'height'} ${v.toFixed(2)}"`,
        part: ref.part,
        hole: { part: ref.part, holeId: seat.id },
      };
    }
    default:
      e(`${where}: unknown measure "${ref.measure}" (use width, height, perimeter, length, holeWidth, holeHeight)`);
      return null;
  }
}

// Parts that are actually built into the toy: the ones the assembly poses. A
// part no instance places is not attached to anything yet, so it cannot "meet"
// another part and cannot owe a fit check — the assembly-coverage warning is
// the honest complaint about it. (This is what lets the Cutting Mat's Shelf
// drop a part onto a design without instantly bricking the document; the
// moment that part joins the assembly, its fit check is owed again.) Designs
// with no usable assembly block fall back to counting every part, so the
// generation loop's gate is unchanged for them.
function assembledPartIds(design, partsById) {
  const instances = Array.isArray(design.assembly?.instances) ? design.assembly.instances : null;
  if (!instances) return new Set(partsById.keys());
  const ids = new Set();
  for (const inst of instances) {
    if (inst && typeof inst === 'object' && typeof inst.part === 'string' && partsById.has(inst.part)) ids.add(inst.part);
  }
  return ids;
}

function checkFits(design, partsById, e, warn) {
  const checks = design.fitChecks;
  if (assembledPartIds(design, partsById).size > 1 && (!Array.isArray(checks) || checks.length === 0)) {
    e('multi-part designs must declare fitChecks — one numeric check for every place two parts meet ' +
      '(curved wrap length vs arc length, slot width vs tab thickness, keyhole vs button, lid vs box opening)');
    return;
  }
  for (const [i, chk] of (checks || []).entries()) {
    const where = `fitChecks[${i}]${chk?.reason ? ` (${chk.reason})` : ''}`;
    if (!chk || typeof chk !== 'object') { e(`${where}: must be an object`); continue; }
    const a = resolveMeasure(chk.a, partsById, `${where}.a`, e, warn);
    const b = resolveMeasure(chk.b, partsById, `${where}.b`, e, warn);
    if (!a || !b) continue;
    const op = chk.op || 'match';
    const at = { code: 'fit-failure', part: a.part || b.part || null, holeId: a.hole?.holeId || b.hole?.holeId || null };
    if (op === 'match') {
      const tol = typeof chk.toleranceIn === 'number' ? chk.toleranceIn : 0.125;
      const diff = Math.abs(a.value - b.value);
      if (diff > tol) {
        e(`${where}: FIT FAILURE — ${a.desc} vs ${b.desc} differ by ${diff.toFixed(2)}" (allowed ${tol}"). ` +
          'Adjust the geometry so these physically fit.', at);
      }
    } else if (op === 'clearance') {
      const min = typeof chk.minIn === 'number' ? chk.minIn : 0.05;
      const max = typeof chk.maxIn === 'number' ? chk.maxIn : 0.6;
      const gap = a.value - b.value;
      // The clearance band has a middle, and when the loose side is a hole that
      // middle is a hole diameter — a fix the Toy Doctor can just apply.
      const fix = a.hole ? holeResizeFix(a.hole.part, a.hole.holeId, b.value + (min + max) / 2) : undefined;
      if (gap < min) {
        e(`${where}: FIT FAILURE — ${a.desc} must exceed ${b.desc} by at least ${min}" (actual gap ${gap.toFixed(2)}"). It will jam or not fit.`,
          { ...at, fix });
      } else if (gap > max) {
        e(`${where}: FIT FAILURE — ${a.desc} exceeds ${b.desc} by ${gap.toFixed(2)}" (max ${max}"). Too sloppy to work.`,
          { ...at, fix });
      }
    } else if (op === 'atLeast') {
      if (a.value < b.value - 0.001) {
        e(`${where}: FIT FAILURE — ${a.desc} must be at least ${b.desc}.`, at);
      }
    } else {
      e(`${where}: unknown op "${op}" (use match, clearance, atLeast)`);
    }
  }
}

// Parts with a fan of >=5 long parallel slits are bend scores for a curved
// panel; a smooth curve needs them close together.
function checkBendScores(part, bb, where, e) {
  const slits = slitPaths(part).map(pathBBox).filter(Boolean);
  if (slits.length < 5 || !bb) return;
  const horiz = slits.filter(s => s.width > s.height * 5 && s.width >= 0.7 * bb.width);
  const vert = slits.filter(s => s.height > s.width * 5 && s.height >= 0.7 * bb.height);
  const group = horiz.length >= 5
    ? horiz.map(s => (s.minY + s.maxY) / 2)
    : vert.length >= 5 ? vert.map(s => (s.minX + s.maxX) / 2) : null;
  if (!group) return;
  group.sort((x, y) => x - y);
  let maxGap = 0;
  for (let i = 1; i < group.length; i++) maxGap = Math.max(maxGap, group[i] - group[i - 1]);
  if (maxGap > 1.1) {
    e(`${where}: bend score slits are up to ${maxGap.toFixed(2)}" apart — a smooth curve needs scores no more than 0.8" apart (0.5" for tight curves). Add more slits.`,
      { code: 'bend-scores', part: part.id });
  }
}

// ------------------------------------------------------------- hardware
// Non-cardboard parts (dowels, skewers, string...) — never on cut sheets,
// listed in WHAT YOU NEED, posed as cylinders in the 3D viewer.
function checkHardware(design, e) {
  const byId = new Map();
  const hw = design.hardware;
  if (hw === undefined) return byId;
  if (!Array.isArray(hw)) { e('hardware must be an array'); return byId; }
  for (const [i, h] of hw.entries()) {
    const where = `hardware[${i}]${h?.id ? ` (${h.id})` : ''}`;
    if (!h || typeof h !== 'object') { e(`${where}: must be an object`); continue; }
    if (!h.id || typeof h.id !== 'string') e(`${where}: missing id`);
    else if (byId.has(h.id)) e(`${where}: duplicate hardware id "${h.id}"`);
    else byId.set(h.id, h);
    if (!HARDWARE_KINDS.has(h.kind)) {
      e(`${where}: kind must be one of ${[...HARDWARE_KINDS].join(', ')} (household/craft-store parts only)`);
    }
    if (ROUND_KINDS.has(h.kind)) {
      if (!(typeof h.diameterIn === 'number' && h.diameterIn > 0 && h.diameterIn <= 1)) {
        e(`${where}: round stock (${h.kind}) needs diameterIn (0 < d ≤ 1 inch)`);
      }
      if (!(typeof h.lengthIn === 'number' && h.lengthIn > 0 && h.lengthIn <= 48)) {
        e(`${where}: round stock (${h.kind}) needs lengthIn (0 < L ≤ 48 inches)`);
      }
    }
    if (h.count !== undefined && !(Number.isInteger(h.count) && h.count >= 1)) {
      e(`${where}: count must be a positive integer`);
    }
    if (!h.label || typeof h.label !== 'string') {
      e(`${where}: missing label — the shopping-list line, e.g. "1/4-inch wooden dowel, 9 inches long"`);
    }
  }
  return byId;
}

// ------------------------------------------------- toy-statics helpers

function polygonArea(d) {
  const pts = samplePath(d);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

// Measure a part hole as a circle: center, bbox dims, mean diameter,
// and whether it is round enough for fit math to mean anything.
function holeCircle(part, idx) {
  const d = pathD((part.holes || [])[idx]);
  if (typeof d !== 'string') return null;
  const bb = pathBBox(d);
  if (!bb) return null;
  return {
    cx: (bb.minX + bb.maxX) / 2, cy: (bb.minY + bb.maxY) / 2,
    w: bb.width, h: bb.height, dia: (bb.width + bb.height) / 2,
    round: Math.abs(bb.width - bb.height) <= 0.08,
  };
}

// How many stacked layers one physical piece of this part has.
const layersOf = (part) => part.laminate ? Math.max(1, part.count || 1) : 1;

// Densely resample a path's polyline (~0.1" steps) — samplePath only emits
// endpoints for straight segments, and closest-approach tests (wheel sweep)
// need points along the middle of long edges too.
function densePoints(d, step = 0.1) {
  const pts = samplePath(d);
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
    for (let j = 0; j < n; j++) out.push([x1 + (x2 - x1) * j / n, y1 + (y2 - y1) * j / n]);
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}

const DEG = Math.PI / 180;
// Assembly rotation convention: degrees applied X→Y→Z (see ASSEMBLY-SPEC).
function rotXYZ([x, y, z], [rx, ry, rz]) {
  let a = rx * DEG, c = Math.cos(a), s = Math.sin(a);
  [y, z] = [y * c - z * s, y * s + z * c];
  a = ry * DEG; c = Math.cos(a); s = Math.sin(a);
  [x, z] = [x * c + z * s, -x * s + z * c];
  a = rz * DEG; c = Math.cos(a); s = Math.sin(a);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

// World-space corners of an assembly instance's bounding volume
// (part slab or hardware cylinder; local X=u, Y=-v, Z=out; axis of a
// cylinder = local X, centered on its origin). Null when unmeasurable.
function instanceCorners(inst, partsById, hardwareById, t) {
  if (!Array.isArray(inst.pos) || inst.pos.length !== 3 || inst.pos.some(n => !Number.isFinite(n))) return null;
  if (!Array.isArray(inst.rot) || inst.rot.length !== 3 || inst.rot.some(n => !Number.isFinite(n))) return null;
  const local = [];
  if (inst.hardware !== undefined) {
    const hw = hardwareById.get(inst.hardware);
    if (!hw || !Number.isFinite(hw.lengthIn)) return null;
    const r = (hw.diameterIn || 0.1) / 2, hl = hw.lengthIn / 2;
    for (const x of [-hl, hl]) for (const y of [-r, r]) for (const z of [-r, r]) local.push([x, y, z]);
  } else {
    const part = partsById.get(inst.part);
    if (!part) return null;
    const bb = pathBBox(part.path);
    if (!bb) return null;
    for (const u of [bb.minX, bb.maxX]) for (const v of [bb.minY, bb.maxY]) for (const z of [0, t]) local.push([u, -v, z]);
  }
  return local.map(p => {
    const [x, y, z] = rotXYZ(p, inst.rot);
    return [x + inst.pos[0], y + inst.pos[1], z + inst.pos[2]];
  });
}

// ------------------------------------------------- mechanisms + statics
// Reference validation, then the toy-statics linter: every number below is
// measured from the real hole/outline geometry, never from declared intent.
function checkMechanisms(design, partsById, hardwareById, e, warn) {
  const mechs = design.mechanisms;
  if (mechs === undefined) return;
  if (!Array.isArray(mechs)) return void e('mechanisms must be an array');
  const t = typeof design.assembly?.thicknessIn === 'number' ? design.assembly.thicknessIn : LAYER_IN;
  const instances = Array.isArray(design.assembly?.instances)
    ? design.assembly.instances.filter(x => x && typeof x === 'object') : [];
  const instById = new Map(instances.filter(x => typeof x.id === 'string').map(x => [x.id, x]));
  const rolling = ROLLING_CATEGORIES.has(design.category);
  const mids = new Set();

  for (const [i, m] of mechs.entries()) {
    const where = `mechanisms[${i}]${m?.id ? ` (${m.id})` : ''}`;
    if (!m || typeof m !== 'object') { e(`${where}: must be an object`); continue; }
    if (m.type !== 'revolute') { e(`${where}: type must be "revolute" (the only mechanism type in v1)`); continue; }
    if (!m.id || typeof m.id !== 'string') e(`${where}: missing id`);
    else if (mids.has(m.id)) e(`${where}: duplicate mechanism id "${m.id}"`);
    else mids.add(m.id);

    const axle = hardwareById.get(m.axle);
    if (!axle) { e(`${where}: axle "${m.axle}" is not a hardware id`); continue; }
    if (!ROUND_KINDS.has(axle.kind) || !(axle.diameterIn > 0)) {
      e(`${where}: axle hardware "${m.axle}" must be round stock (dowel/skewer/straw) with a diameterIn`);
      continue;
    }
    const axleD = axle.diameterIn;

    const resolveSeats = (list, name) => {
      if (!Array.isArray(list) || list.length === 0) {
        e(`${where}: ${name} must be a non-empty array of {"part": id, "hole": "hole-id"}`);
        return null;
      }
      const seats = [];
      let ok = true;
      for (const [j, s] of list.entries()) {
        const sw = `${where}.${name}[${j}]`;
        const part = partsById.get(s?.part);
        if (!part) { e(`${sw}: unknown part "${s?.part}"`); ok = false; continue; }
        const ref = resolveHoleRef(part, s.hole, sw, e, warn);
        if (!ref) { ok = false; continue; }
        const hole = holeCircle(part, ref.idx);
        if (!hole) {
          e(`${sw}: hole ${ref.label} of part "${part.id}" could not be measured`, { part: part.id, holeId: ref.id });
          ok = false; continue;
        }
        seats.push({ part, idx: ref.label, hole, holeId: ref.id });
      }
      return ok ? seats : null;
    };
    const bearings = resolveSeats(m.bearings, 'bearings');
    const hubs = resolveSeats(m.hubs, 'hubs');
    if (Array.isArray(m.spins)) {
      for (const [j, sid] of m.spins.entries()) {
        if (!instById.has(sid)) e(`${where}.spins[${j}]: "${sid}" is not an assembly instance id`);
      }
    } else if (m.spins !== undefined) {
      e(`${where}: spins must be an array of assembly instance ids that rotate with the axle`);
    }
    if (!bearings || !hubs) continue;

    // 1. bearing fit: hole Ø − axle Ø in [0.04, 0.12] — free spin, no slop.
    //    LOOSE = axle + 0.06" is the number PUNCH offers, so it is the number
    //    the one-tap fix writes.
    for (const b of bearings) {
      const sw = `${where}: BEARING FIT — hole ${b.idx} of "${b.part.id}"`;
      const at = { code: 'bearing-fit', part: b.part.id, holeId: b.holeId };
      if (!b.hole.round) {
        e(`${sw} measures ${b.hole.w.toFixed(2)}"×${b.hole.h.toFixed(2)}" — a bearing must be a circle. ` +
          `Redraw it as a circle of Ø ${(axleD + LOOSE).toFixed(2)}".`, at);
      } else {
        const gap = b.hole.dia - axleD;
        if (gap < 0.04 - 1e-9 || gap > 0.12 + 1e-9) {
          e(`${sw} is Ø ${b.hole.dia.toFixed(2)}" on a Ø ${axleD.toFixed(2)}" axle (clearance ${gap >= 0 ? '+' : ''}${gap.toFixed(2)}") — ` +
            `a bearing needs +0.04"..+0.12" to spin freely without wobble. Resize the hole to Ø ${(axleD + LOOSE).toFixed(2)}".`,
            { ...at, fix: holeResizeFix(b.part.id, b.holeId, axleD + LOOSE) });
        }
      }
    }
    // 2. hub fit: hole Ø − axle Ø in [−0.01, +0.03] — press fit + glue
    for (const h of hubs) {
      const sw = `${where}: HUB FIT — hole ${h.idx} of "${h.part.id}"`;
      const at = { code: 'hub-fit', part: h.part.id, holeId: h.holeId };
      if (!h.hole.round) {
        e(`${sw} measures ${h.hole.w.toFixed(2)}"×${h.hole.h.toFixed(2)}" — a hub must be a circle. ` +
          `Redraw it as a circle of Ø ${(axleD + SNUG).toFixed(2)}".`, at);
      } else {
        const gap = h.hole.dia - axleD;
        if (gap < -0.01 - 1e-9 || gap > 0.03 + 1e-9) {
          e(`${sw} is Ø ${h.hole.dia.toFixed(2)}" on a Ø ${axleD.toFixed(2)}" axle (${gap >= 0 ? '+' : ''}${gap.toFixed(2)}") — ` +
            `a hub must press-fit and glue: −0.01"..+0.03". Resize the hole to Ø ${(axleD + SNUG).toFixed(2)}".`,
            { ...at, fix: holeResizeFix(h.part.id, h.holeId, axleD + SNUG) });
        }
      }
    }
    // 3. bearing length: total bearing thickness ≥ 2× axle Ø (3× runs true)
    const bearingThk = bearings.reduce((s, b) => s + layersOf(b.part) * t, 0);
    const seat0 = { part: bearings[0]?.part.id || null, holeId: bearings[0]?.holeId || null };
    if (bearingThk < 2 * axleD - 1e-9) {
      e(`${where}: BEARING LENGTH — total bearing thickness ${bearingThk.toFixed(2)}" is under 2× the axle Ø ` +
        `(${(2 * axleD).toFixed(2)}") — a short bearing wobbles. Stack more layers where the axle passes through ` +
        `(laminate: true, higher count).`, { code: 'bearing-length', ...seat0 });
    } else if (bearingThk < 3 * axleD - 1e-9) {
      warn(`${where}: bearing thickness ${bearingThk.toFixed(2)}" is under 3× the axle Ø — more stacked layers will run smoother.`,
        { code: 'bearing-length', ...seat0 });
    }
    // 4. axle length budget: span + wheel stacks + washer gaps, max +1.5" spare
    const hubPartIds = new Set(hubs.map(h => h.part.id));
    const spinHubCount = (Array.isArray(m.spins) ? m.spins : [])
      .map(sid => instById.get(sid)).filter(x => x && hubPartIds.has(x.part)).length;
    const hubStack = spinHubCount > 0
      ? (spinHubCount * t) / 2                                    // per-side wheel stack, from real instances
      : hubs.reduce((s, h) => s + layersOf(h.part) * t, 0);       // fallback: declared hub stacks
    const minLen = bearingThk + 2 * hubStack + 0.2;
    if (Number.isFinite(axle.lengthIn)) {
      // legal window is [minLen, minLen + 1.5]; its middle, cut to a quarter inch
      const at = { code: 'axle-budget', ...seat0, fix: hardwareLengthFix(m.axle, minLen + 0.75) };
      if (axle.lengthIn < minLen - 1e-9) {
        e(`${where}: AXLE LENGTH — "${m.axle}" is ${axle.lengthIn}" but needs at least ${minLen.toFixed(2)}" ` +
          `(bearing span ${bearingThk.toFixed(2)}" + wheel stacks 2×${hubStack.toFixed(2)}" + 0.2" washer gaps). Lengthen the axle.`, at);
      } else if (axle.lengthIn > minLen + 1.5 + 1e-9) {
        e(`${where}: AXLE LENGTH — "${m.axle}" is ${axle.lengthIn}" but everything on it only needs ${minLen.toFixed(2)}" ` +
          `(+1.5" max), so ${(axle.lengthIn - minLen).toFixed(2)}" of bare dowel would stick out like a saber. ` +
          `Shorten it to ~${(minLen + 0.5).toFixed(1)}".`, at);
      }
    }
    // 5. wheel sweep: wheel radius + 0.25" must clear the arch (all outline
    //    points above the axle hole; below = the ground opening, allowed)
    let wheelR = 0;
    for (const h of hubs) {
      for (const [x, y] of samplePath(h.part.path)) {
        wheelR = Math.max(wheelR, Math.hypot(x - h.hole.cx, y - h.hole.cy));
      }
    }
    if (wheelR > 0) {
      for (const b of bearings) {
        let worst = null;
        for (const [x, y] of densePoints(b.part.path)) {
          if (y >= b.hole.cy - 0.05) continue;
          const d = Math.hypot(x - b.hole.cx, y - b.hole.cy);
          if (d < wheelR + 0.25 && (!worst || d < worst.d)) worst = { x, y, d };
        }
        if (worst) {
          e(`${where}: WHEEL SWEEP — wheel radius ${wheelR.toFixed(2)}" + 0.25" clearance hits the outline of ` +
            `"${b.part.id}" at (${worst.x.toFixed(1)}, ${worst.y.toFixed(1)}), only ${worst.d.toFixed(2)}" from the axle hole. ` +
            `Enlarge the wheel arch or shrink the wheel.`, { code: 'wheel-sweep', part: b.part.id, holeId: b.holeId });
        }
      }
    }
    // 6. tipping ratio: outer track ÷ estimated CG height ≥ 1.1 (warn)
    const axleInst = instances.find(x => x.hardware === m.axle);
    const spinInsts = (Array.isArray(m.spins) ? m.spins : []).map(sid => instById.get(sid)).filter(Boolean);
    if (axleInst && spinInsts.length) {
      const all = instances.flatMap(x => instanceCorners(x, partsById, hardwareById, t) || []);
      const spinCorners = spinInsts.flatMap(x => instanceCorners(x, partsById, hardwareById, t) || []);
      const axis = Array.isArray(axleInst.rot) && axleInst.rot.length === 3 && axleInst.rot.every(Number.isFinite)
        ? rotXYZ([1, 0, 0], axleInst.rot) : null;
      if (all.length && spinCorners.length && axis) {
        const ys = all.map(p => p[1]);
        const height = Math.max(...ys) - Math.min(...ys);
        const proj = spinCorners.map(p => p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2]);
        const track = Math.max(...proj) - Math.min(...proj);
        const cg = height * 0.45;
        if (cg > 0.01 && track / cg < 1.1) {
          warn(`${where}: TIPPY — outer track width ${track.toFixed(1)}" ÷ estimated CG height ${cg.toFixed(1)}" = ` +
            `${(track / cg).toFixed(2)} (want ≥ 1.1). Widen the wheel track or lower the body.`,
            { code: 'tipping', ...seat0 });
        }
      }
    }
    // 7. durability: rolling toys need their bearings in a solid stacked core
    if (rolling) {
      const hasCore = bearings.some(b => layersOf(b.part) >= 6 || layersOf(b.part) * t >= 0.9 - 1e-9);
      if (!hasCore) {
        e(`${where}: SOLID CORE — a rolling toy needs its bearings in a solid stacked core: one bearing part with ` +
          `laminate: true and enough copies to reach ≥ 0.9" total (6+ layers at 0.15"). Kids stand on these.`,
          { code: 'solid-core', ...seat0 });
      }
      for (const b of bearings) {
        const thk = layersOf(b.part) * t;
        if (thk < 0.45 - 1e-9) {
          e(`${where}: THIN BEARING WALL — the axle rides in "${b.part.id}", only ${thk.toFixed(2)}" thick (< 0.45"). ` +
            `The hole will ovalize in an afternoon of play. Laminate more layers where the axle passes through.`,
            { code: 'solid-core', part: b.part.id, holeId: b.holeId });
        }
      }
    }
  }

  // 8. ground clearance: the wheels define the floor. Ground = the lowest
  //    world point of all spins instances (the wheel bottoms); every other
  //    instance — body parts and hardware cylinders alike — must keep its
  //    lowest world point ≥ 0.35" above that (0.5" runs true). A belly or
  //    bumper at wheel level beaches the toy: it rests on cardboard and
  //    cannot roll.
  const spinIds = new Set(mechs.flatMap(m =>
    (m && typeof m === 'object' && m.type === 'revolute' && Array.isArray(m.spins)) ? m.spins : []));
  if (spinIds.size) {
    let ground = Infinity;
    for (const inst of instances) {
      if (!spinIds.has(inst.id)) continue;
      const corners = instanceCorners(inst, partsById, hardwareById, t);
      if (corners) for (const p of corners) ground = Math.min(ground, p[1]);
    }
    if (Number.isFinite(ground)) {
      for (const inst of instances) {
        if (spinIds.has(inst.id)) continue;
        const corners = instanceCorners(inst, partsById, hardwareById, t);
        if (!corners) continue;
        const gap = Math.min(...corners.map(p => p[1])) - ground;
        const label = inst.hardware !== undefined ? `hardware ${inst.hardware}` : inst.part;
        const at = { code: 'ground-clearance', part: inst.part ?? null, instanceId: inst.id };
        if (gap < 0.35 - 1e-9) {
          e(`GROUND CLEARANCE — instance "${inst.id}" (${label}) has its lowest point only ${gap.toFixed(2)}" above ` +
            `the wheel-bottom ground line (need ≥ 0.35", want ≥ 0.5"). The toy rests on it instead of rolling — ` +
            `raise or shrink it so only the wheels touch the floor.`, at);
        } else if (gap < 0.5 - 1e-9) {
          warn(`GROUND CLEARANCE — instance "${inst.id}" (${label}) sits only ${gap.toFixed(2)}" above the ` +
            `wheel-bottom ground line (want ≥ 0.5") — a rug or a bump will beach it.`, at);
        }
      }
    }
  }
}

// ------------------------------------------------------------------ layout
// `parts[].layout` {x, y, rotDeg} is where the part sits on the Cutting Mat —
// the same inch-space, y-down, that the cut sheets print. Optional: a design
// without layouts is auto-packed exactly as before.
function checkLayout(part, where, e, at) {
  const L = part.layout;
  if (L === undefined) return;
  if (!L || typeof L !== 'object' || Array.isArray(L)) {
    return void e(`${where}.layout: must be an object {"x", "y", "rotDeg"?} in mat inches`, at);
  }
  for (const k of ['x', 'y']) {
    if (!Number.isFinite(L[k])) e(`${where}.layout.${k}: must be a finite number of inches (mat space, y-down)`, at);
  }
  if (L.rotDeg !== undefined && !Number.isFinite(L.rotDeg)) {
    e(`${where}.layout.rotDeg: must be a finite number of degrees (clockwise, default 0)`, at);
  }
}

// Placed (post-layout) bbox of a part: rotate the pre-rotation bbox corners.
function laidOutBBox(part) {
  const bb = partBBox(part);
  if (!bb) return null;
  const m = layoutMatrix(part.layout, bb);
  const xs = [], ys = [];
  for (const x of [bb.minX, bb.maxX]) {
    for (const y of [bb.minY, bb.maxY]) {
      xs.push(m[0] * x + m[2] * y + m[4]);
      ys.push(m[1] * x + m[3] * y + m[5]);
    }
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

// Overlapping parts on the mat are allowed (a kid may stack them mid-edit) but
// they print on top of each other, so say so.
function checkLayoutOverlaps(parts, warn) {
  const boxes = [];
  for (const part of parts) {
    if (!part || !part.layout || !Number.isFinite(part.layout.x) || !Number.isFinite(part.layout.y)) continue;
    const bb = laidOutBBox(part);
    if (bb) boxes.push({ id: part.id, bb });
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].bb, b = boxes[j].bb;
      const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
      if (ox > 0.02 && oy > 0.02) {
        warn(`parts overlap on the mat — they'll print overlapping ("${boxes[i].id}" and "${boxes[j].id}")`,
          { code: 'overlap', part: boxes[i].id });
      }
    }
  }
}

// General durability lints — warnings only (legacy designs must never error).
function checkDurability(design, warn) {
  const parts = (design.parts || []).filter(p => p && typeof p === 'object');
  const gripRe = { 'vehicles': /body/i, 'armor-and-weapons': /blade/i }[design.category];
  if (gripRe) {
    for (const part of parts) {
      if (!gripRe.test(part.id || '') && !gripRe.test(part.name || '')) continue;
      if (!(part.laminate && (part.count || 1) >= 3)) {
        warn(`durability: "${part.id}" looks like the graspable mass — make it ≥ 3 laminated layers ` +
          `(laminate: true, count ≥ 3) or a closed box, or it will crush in play.`,
          { code: 'durability', part: part.id });
      }
    }
  }
  for (const part of parts) {
    if (part.laminate || typeof part.path !== 'string') continue;
    if ((part.slits || []).length >= 2) continue; // folds/curls into 3D structure — already "boxed"
    const area = polygonArea(part.path);
    if (area > 40) {
      warn(`durability: single-layer part "${part.id}" is ~${Math.round(area)} in² — laminate or box this — it will crease.`,
        { code: 'durability', part: part.id });
    }
  }
}

// `assembly` (see reference/ASSEMBLY-SPEC.md) is REQUIRED: it drives the 3D
// fold-up viewer, and a design without it ships with no 3D preview. Making its
// absence a validation error means the generation self-repair loop forces the
// model to supply it. Copy coverage is a warning only — a partial assembly
// still previews.
function checkAssembly(design, partsById, hardwareById, e, warn) {
  const asm = design.assembly;
  if (asm === undefined) {
    return void e('missing assembly block — every design needs one (see the ASSEMBLY section of the rules): thicknessIn + one instance per part copy with order, pos, rot, and folds for anything that bends');
  }
  if (!asm || typeof asm !== 'object' || Array.isArray(asm)) return void e('assembly must be an object');
  if (!(typeof asm.thicknessIn === 'number' && asm.thicknessIn >= 0.1 && asm.thicknessIn <= 0.25)) {
    e('assembly.thicknessIn must be a number between 0.1 and 0.25 inches (single-wall corrugated ≈ 0.15)');
  }
  if (!Array.isArray(asm.instances) || asm.instances.length === 0) {
    return void e('assembly.instances must be a non-empty array');
  }
  const seen = new Set();
  const covered = new Map(); // partId -> Set(copy)
  for (const [i, inst] of asm.instances.entries()) {
    const where = `assembly.instances[${i}]${inst?.id ? ` (${inst.id})` : ''}`;
    if (!inst || typeof inst !== 'object') { e(`${where}: must be an object`); continue; }
    if (!inst.id || typeof inst.id !== 'string') e(`${where}: missing id`);
    else if (seen.has(inst.id)) e(`${where}: duplicate instance id "${inst.id}"`);
    else seen.add(inst.id);
    // hardware instance: a posed cylinder (dowel/skewer/straw), not a part
    if (inst.hardware !== undefined) {
      if (inst.part !== undefined) e(`${where}: give either "part" or "hardware", not both`);
      const hw = hardwareById.get(inst.hardware);
      if (!hw) { e(`${where}: unknown hardware "${inst.hardware}"`); continue; }
      const hcopy = inst.copy ?? 0;
      const hcount = hw.count || 1;
      if (!Number.isInteger(hcopy) || hcopy < 0 || hcopy >= hcount) {
        e(`${where}: copy must be an integer 0..${hcount - 1} (hardware "${hw.id}" has count ${hcount})`);
      }
      if (!Number.isFinite(inst.order)) e(`${where}: order must be a number (build sequence)`);
      for (const key of ['pos', 'rot']) {
        const v = inst[key];
        if (!Array.isArray(v) || v.length !== 3 || v.some((x) => !Number.isFinite(x))) {
          e(`${where}: ${key} must be an array of 3 finite numbers (cylinder axis = local X before rot)`);
        }
      }
      if (inst.folds !== undefined) e(`${where}: hardware instances are rigid cylinders — no folds`);
      continue;
    }
    const part = partsById.get(inst.part);
    if (!part) { e(`${where}: unknown part "${inst.part}"`); continue; }
    const copy = inst.copy ?? 0;
    const count = part.count || 1;
    if (!Number.isInteger(copy) || copy < 0 || copy >= count) {
      e(`${where}: copy must be an integer 0..${count - 1} (part "${part.id}" has count ${count})`);
    } else {
      if (!covered.has(part.id)) covered.set(part.id, new Set());
      covered.get(part.id).add(copy);
    }
    if (!Number.isFinite(inst.order)) e(`${where}: order must be a number (build sequence; equal orders animate together)`);
    const nSteps = (design.steps || []).length;
    if (inst.step !== undefined && !(Number.isInteger(inst.step) && inst.step >= 0 && inst.step < nSteps)) {
      e(`${where}: step must be an integer index into steps (0..${nSteps - 1})`);
    }
    for (const key of ['pos', 'rot']) {
      const v = inst[key];
      if (!Array.isArray(v) || v.length !== 3 || v.some((x) => !Number.isFinite(x))) {
        e(`${where}: ${key} must be an array of 3 finite numbers`);
      }
    }
    if (inst.folds !== undefined) {
      if (!Array.isArray(inst.folds)) { e(`${where}: folds must be an array`); continue; }
      const nSlits = (part.slits || []).length;
      for (const [j, f] of inst.folds.entries()) {
        const fw = `${where}.folds[${j}]`;
        if (!f || typeof f !== 'object') { e(`${fw}: must be an object`); continue; }
        if (f.slit === 'all') {
          if (!nSlits) e(`${fw}: part "${part.id}" has no slits to fold at`);
        } else if (!(Number.isInteger(f.slit) && f.slit >= 0 && f.slit < nSlits)) {
          e(`${fw}: slit must be "all" or a slit index 0..${nSlits - 1} of part "${part.id}"`);
        }
        if (!(typeof f.angleDeg === 'number' && Math.abs(f.angleDeg) <= 178)) {
          e(`${fw}: angleDeg must be a number with |angle| ≤ 178 per hinge`);
        }
      }
    }
  }
  // every copy of every part SHOULD appear in a multi-part design — warn, don't reject
  if ((design.parts || []).length > 1) {
    for (const part of design.parts) {
      const got = covered.get(part.id)?.size || 0;
      if (got < (part.count || 1)) {
        warn(`assembly covers ${got}/${part.count} copies of part "${part.id}" — the 3D preview will look incomplete`,
          { part: part.id });
      }
    }
  }
}

// `warnings` collects the legacy strings; `findings` collects the same problems
// as structured records — same count, same order, same severity — so the Toy
// Doctor can pin each one to its geometry and offer the fixes that are
// computable. Old callers pass neither and see no change.
export function validateDesign(design, { warnings, findings } = {}) {
  const errors = [];
  const record = (level, message, meta) => {
    if (!findings) return;
    const f = {
      level,
      code: meta?.code || 'other',
      message,
      anchor: {
        part: meta?.part ?? null,
        holeId: meta?.holeId ?? null,
        slitId: meta?.slitId ?? null,
        instanceId: meta?.instanceId ?? null,
      },
    };
    if (meta?.fix) f.fix = meta.fix;
    findings.push(f);
  };
  const e = (msg, meta) => { errors.push(msg); record('error', msg, meta); };
  const warn = (msg, meta) => {
    console.warn(`schema warning: ${msg}`);
    if (warnings) warnings.push(msg);
    record('warn', msg, meta);
  };

  if (!design || typeof design !== 'object') {
    record('error', 'design must be a JSON object');
    return ['design must be a JSON object'];
  }
  if (!design.title) e('missing title');
  if (!design.slug || !/^[a-z0-9-]+$/.test(design.slug)) e('slug must be kebab-case (a-z, 0-9, -)');
  if (!Array.isArray(design.parts) || design.parts.length === 0) e('parts must be a non-empty array');
  if (!Array.isArray(design.steps) || design.steps.length === 0) e('steps must be a non-empty array');

  const fs = design.finishedSize;
  if (!fs || typeof fs.widthIn !== 'number' || typeof fs.heightIn !== 'number') {
    e('finishedSize must include numeric widthIn and heightIn');
  } else {
    for (const k of ['widthIn', 'heightIn', 'depthIn']) {
      if (fs[k] !== undefined && !(typeof fs[k] === 'number' && fs[k] > 0 && fs[k] <= 96)) {
        e(`finishedSize.${k} must be a positive number of inches (max 96)`);
      }
    }
    if (THREE_D_CATEGORIES.has(design.category) && typeof fs.depthIn !== 'number') {
      e(`category "${design.category}" is a 3D build — finishedSize must also include depthIn (the third dimension)`);
    }
  }

  const checkPath = (d, where, { maxIn = 40, at } = {}) => {
    if (typeof d !== 'string' || !d.trim()) return void e(`${where}: path is empty`, at);
    if (!PATH_CMDS.test(d)) return void e(`${where}: path contains unsupported commands (only M L H V C S Q T Z allowed — no arcs)`, at);
    const bb = pathBBox(d);
    if (!bb) return void e(`${where}: path could not be parsed`, at);
    if (bb.width > maxIn || bb.height > maxIn) e(`${where}: path is ${bb.width.toFixed(1)}x${bb.height.toFixed(1)} inches — too large (max ${maxIn}")`, at);
    if (bb.width < 0.15 && bb.height < 0.15) e(`${where}: path is under 0.15" — too small to cut`, at);
    return bb;
  };

  const partsById = new Map();
  const ids = new Set();
  for (const [i, part] of (design.parts || []).entries()) {
    const where = `parts[${i}] (${part?.id || '?'})`;
    const anchor = { part: part?.id || null };
    if (!part.id) e(`${where}: missing id`, anchor);
    else if (ids.has(part.id)) e(`${where}: duplicate id`, anchor);
    else { ids.add(part.id); partsById.set(part.id, part); }
    if (!part.name) e(`${where}: missing name`, anchor);
    if (!Number.isInteger(part.count) || part.count < 1) e(`${where}: count must be a positive integer`, anchor);
    const bb = checkPath(part.path, `${where}.path`, { at: anchor });
    if (bb) {
      // cut outlines must be closed
      const pts = samplePath(part.path);
      const [fx, fy] = pts[0], [lx, ly] = pts[pts.length - 1];
      if (Math.hypot(lx - fx, ly - fy) > 0.05) {
        e(`${where}.path: outline is not closed — it must end with Z back at its start point to be cuttable`, anchor);
      }
      // holes/slits entries: {"id": "h1", "d": "M ..."} or a bare path string
      const entryIds = new Set();
      const readEntry = (entry, ew, at) => {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          if (typeof entry.d !== 'string') { e(`${ew}: object form needs a "d" path string`, at); return null; }
          const id = entry.id;
          if (id !== undefined) {
            if (typeof id !== 'string' || !id.trim()) e(`${ew}: id must be a non-empty string`, at);
            else if (entryIds.has(id)) e(`${ew}: duplicate id "${id}" on part "${part.id}"`, at);
            else entryIds.add(id);
          }
          return entry.d;
        }
        if (typeof entry === 'string') return entry;
        e(`${ew}: must be a path string or {"id", "d"}`, at);
        return null;
      };
      for (const [j, h] of (part.holes || []).entries()) {
        const at = { part: part.id, holeId: entryId(h) || null };
        const d = readEntry(h, `${where}.holes[${j}]`, at);
        if (d === null) continue;
        const hb = checkPath(d, `${where}.holes[${j}]`, { at });
        if (hb && !bboxInside(hb, bb, 0.02)) e(`${where}.holes[${j}]: hole sticks outside the part outline — holes must be fully inside the part`, at);
      }
      for (const [j, s] of (part.slits || []).entries()) {
        const at = { part: part.id, slitId: entryId(s) || null };
        const d = readEntry(s, `${where}.slits[${j}]`, at);
        if (d === null) continue;
        const sb = checkPath(d, `${where}.slits[${j}]`, { at });
        if (sb && !bboxInside(sb, bb, 0.05)) e(`${where}.slits[${j}]: slit extends outside the part outline`, at);
      }
      checkBendScores(part, bb, where, e);
    }
    if (part.backing) checkPath(part.backing, `${where}.backing`, { at: anchor });
    if (part.corrugation && !['vertical', 'horizontal'].includes(part.corrugation)) {
      e(`${where}: corrugation must be "vertical" or "horizontal"`, anchor);
    }
    checkLayout(part, where, e, anchor);
  }
  checkLayoutOverlaps(design.parts || [], warn);

  for (const [i, step] of (design.steps || []).entries()) {
    const where = `steps[${i}]`;
    if (!step.title) e(`${where}: missing title`);
    if (!Array.isArray(step.instructions) || !step.instructions.length) e(`${where}: instructions must be a non-empty array of strings`);
    for (const [j, fig] of (step.figures || []).entries()) {
      if (fig.refPart && !ids.has(fig.refPart)) e(`${where}.figures[${j}]: refPart "${fig.refPart}" does not match any part id`);
      for (const [k, p] of (fig.paths || []).entries()) checkPath(p.d, `${where}.figures[${j}].paths[${k}]`, { maxIn: 60 });
    }
  }

  for (const [k, p] of (design.hero?.paths || []).entries()) checkPath(p.d, `hero.paths[${k}]`, { maxIn: 60 });

  const hardwareById = checkHardware(design, e);
  checkFits(design, partsById, e, warn);
  checkAssembly(design, partsById, hardwareById, e, warn);
  checkMechanisms(design, partsById, hardwareById, e, warn);
  checkDurability(design, warn);

  return errors;
}
