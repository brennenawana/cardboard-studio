// The Shape Shelf — starter parts, compiled to plain paths.
//
// Nobody should have to draw a curve to make a part: the kid drags a starter
// onto the Mat, turns a couple of dials, and gets a real cut outline. These are
// PURE functions (no I/O, no ids, no layout): each returns a bare part
//
//     { name, count: 1, path, holes: [], slits: [], corrugation }
//
// in inches, y-down, bbox min-corner exactly at (0, 0) — the same space the cut
// sheets print. The CLIENT assigns part/hole/slit ids and the layout position
// when it inserts the result (contract M2 §2).
//
// Curves are cubics only (M/L/C/Q/Z) — the schema forbids arcs.

const KAPPA = 0.5522847498307936; // circle-to-cubic magic number
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const fmt = (n) => String(r4(n));
const pt = (x, y) => `${fmt(x)} ${fmt(y)}`;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Smallest hole/feature the schema will let through as cuttable.
const MIN_CUT = 0.16;

// ---------------------------------------------------------------- primitives

// Circle as four cubics, starting at the west point (the form the exemplar
// designs and the AI few-shot already use).
function circlePath(cx, cy, r) {
  const k = r * KAPPA;
  return [
    `M ${pt(cx - r, cy)}`,
    `C ${pt(cx - r, cy - k)} ${pt(cx - k, cy - r)} ${pt(cx, cy - r)}`,
    `C ${pt(cx + k, cy - r)} ${pt(cx + r, cy - k)} ${pt(cx + r, cy)}`,
    `C ${pt(cx + r, cy + k)} ${pt(cx + k, cy + r)} ${pt(cx, cy + r)}`,
    `C ${pt(cx - k, cy + r)} ${pt(cx - r, cy + k)} ${pt(cx - r, cy)}`,
    'Z',
  ].join(' ');
}

// Axis-aligned rectangle with optional equal-radius rounded corners (cubics).
function rectPath(w, h, radius = 0) {
  const r = clamp(radius, 0, Math.min(w, h) / 2);
  if (r < 1e-4) {
    return `M ${pt(0, 0)} L ${pt(w, 0)} L ${pt(w, h)} L ${pt(0, h)} Z`;
  }
  const k = r * KAPPA;
  return [
    `M ${pt(r, 0)}`,
    `L ${pt(w - r, 0)}`,
    `C ${pt(w - r + k, 0)} ${pt(w, r - k)} ${pt(w, r)}`,
    `L ${pt(w, h - r)}`,
    `C ${pt(w, h - r + k)} ${pt(w - r + k, h)} ${pt(w - r, h)}`,
    `L ${pt(r, h)}`,
    `C ${pt(r - k, h)} ${pt(0, h - r + k)} ${pt(0, h - r)}`,
    `L ${pt(0, r)}`,
    `C ${pt(0, r - k)} ${pt(r - k, 0)} ${pt(r, 0)}`,
    'Z',
  ].join(' ');
}

// Trim point r away from corner C toward P.
function trim(C, P, r) {
  const dx = P[0] - C[0], dy = P[1] - C[1];
  const len = Math.hypot(dx, dy) || 1;
  return [C[0] + (dx / len) * r, C[1] + (dy / len) * r];
}

// ------------------------------------------------------------------ starters

function panel({ width, height, radius }) {
  return {
    name: `Panel ${fmt(width)} × ${fmt(height)}`,
    count: 1,
    path: rectPath(width, height, radius),
    holes: [],
    slits: [],
    corrugation: 'horizontal',
  };
}

function wheel({ diameter, hubHole }) {
  const r = diameter / 2;
  const holes = [];
  if (hubHole > 0) {
    // A hole must stay cuttable and must leave a rim: the dial can ask for
    // silly numbers, the geometry never obliges.
    const d = clamp(Math.max(hubHole, MIN_CUT), MIN_CUT, diameter * 0.7);
    holes.push(circlePath(r, r, d / 2));
  }
  return {
    name: `Wheel Ø ${fmt(diameter)}`,
    count: 1,
    path: circlePath(r, r, r),
    holes,
    slits: [],
    corrugation: 'horizontal',
  };
}

// Five or more parallel scores IS a curve, and the shop rule (and the linter)
// says a curve needs its scores no more than 0.8" apart. Rather than hand back a
// part that fails validation, the strip adds the lines its span needs — and the
// adjusted count comes back in `params`, so the dial shows what it actually made.
function normalizeStrip(v) {
  const n = Math.round(v.slits);
  return n >= 5 ? { ...v, slits: Math.min(24, Math.max(n, Math.ceil(v.length / 0.8) - 1)) } : v;
}

function strip({ length, width, slits }) {
  const n = Math.round(clamp(slits, 0, 24));
  const lines = [];
  // Evenly spaced across the span, none on the two cut edges: gap = L/(n+1).
  for (let i = 1; i <= n; i++) {
    const x = (length * i) / (n + 1);
    lines.push(`M ${pt(x, 0)} L ${pt(x, width)}`);
  }
  return {
    name: `Strip ${fmt(length)} × ${fmt(width)}`,
    count: 1,
    path: rectPath(length, width, 0),
    holes: [],
    // score lines run across the strip, so the curl bends around them
    slits: lines,
    corrugation: 'vertical',
  };
}

// A sword blade: a straight ricasso, a long hollow taper, and an ogival point.
// Symmetric about the centre line by construction — the bottom edge is the top
// edge's mirror, walked backwards.
function blade({ length: L, width: W }) {
  const yc = W / 2;             // centre line
  const h = W / 2;              // half width at the base
  const xs = 0.04 * L;          // shoulder: full width this far out
  const xt = 0.68 * L;          // where the long body hands over to the point
  const ht = 0.80 * h;          // half width at the start of the point
  const span = xt - xs, tip = L - xt;

  // top edge, base → point: a barely-there hollow along the body, then an
  // ogival point over the last third — the way a real blade is ground.
  const taperTop = `C ${pt(xs + 0.5 * span, yc - h * 0.998)} ${pt(xt - 0.35 * span, yc - ht * 1.03)} ${pt(xt, yc - ht)}`;
  const pointTop = `C ${pt(xt + 0.42 * tip, yc - ht * 0.93)} ${pt(L - 0.2 * tip, yc - ht * 0.38)} ${pt(L, yc)}`;
  // bottom edge, point → base (mirror, reversed)
  const pointBot = `C ${pt(L - 0.2 * tip, yc + ht * 0.38)} ${pt(xt + 0.42 * tip, yc + ht * 0.93)} ${pt(xt, yc + ht)}`;
  const taperBot = `C ${pt(xt - 0.35 * span, yc + ht * 1.03)} ${pt(xs + 0.5 * span, yc + h * 0.998)} ${pt(xs, yc + h)}`;

  const path = [
    `M ${pt(0, 0)}`, `L ${pt(xs, 0)}`, taperTop, pointTop,
    pointBot, taperBot, `L ${pt(0, W)}`, 'Z',
  ].join(' ');

  return { name: `Blade ${fmt(L)}"`, count: 1, path, holes: [], slits: [], corrugation: 'horizontal' };
}

// Glue tab: attaches along y = 0 (the fold edge, full width) and tapers away
// so it slides under its neighbour; the two outer corners are rounded so they
// never catch a fingernail.
function tab({ width: w, depth: d }) {
  const inset = Math.min(0.25 * w, 0.4 * d);
  const flat = w - 2 * inset;
  const slant = Math.hypot(inset, d);
  const r = Math.min(0.12, 0.35 * d, 0.4 * flat, 0.3 * slant);
  const C1 = [w - inset, d], C2 = [inset, d];
  const a1 = trim(C1, [w, 0], r), b1 = trim(C1, C2, r);
  const a2 = trim(C2, C1, r), b2 = trim(C2, [0, 0], r);
  const path = [
    `M ${pt(0, 0)}`, `L ${pt(w, 0)}`,
    `L ${pt(a1[0], a1[1])}`, `Q ${pt(C1[0], C1[1])} ${pt(b1[0], b1[1])}`,
    `L ${pt(a2[0], a2[1])}`, `Q ${pt(C2[0], C2[1])} ${pt(b2[0], b2[1])}`,
    `L ${pt(0, 0)}`, 'Z',
  ].join(' ');
  return { name: `Glue Tab ${fmt(w)} × ${fmt(d)}`, count: 1, path, holes: [], slits: [], corrugation: 'horizontal' };
}

// -------------------------------------------------------------------- shelf

// Every dial is a creation-time dial (DESIGN §2.5): once the part is on the Mat
// it is edited with the verbs like any other part.
export const STARTERS = [
  {
    id: 'panel', name: 'Panel', emoji: '▭', make: panel,
    params: [
      { key: 'width', label: 'width', min: 1, max: 20, step: 0.25, default: 6, unit: 'in' },
      { key: 'height', label: 'height', min: 1, max: 20, step: 0.25, default: 4, unit: 'in' },
      { key: 'radius', label: 'corner round', min: 0, max: 1, step: 0.125, default: 0, unit: 'in' },
    ],
  },
  {
    id: 'wheel', name: 'Wheel', emoji: '⚪', make: wheel,
    params: [
      { key: 'diameter', label: 'across', min: 1, max: 8, step: 0.25, default: 4.75, unit: 'in' },
      { key: 'hubHole', label: 'hub hole', min: 0, max: 1, step: 0.01, default: 0.26, unit: 'in' },
    ],
  },
  {
    id: 'strip', name: 'Strip', emoji: '〰', make: strip, normalize: normalizeStrip,
    params: [
      { key: 'length', label: 'length', min: 2, max: 24, step: 0.25, default: 7.5, unit: 'in' },
      { key: 'width', label: 'width', min: 0.5, max: 4, step: 0.1, default: 2.2, unit: 'in' },
      { key: 'slits', label: 'curl lines', min: 0, max: 24, step: 1, default: 10, unit: '' },
    ],
  },
  {
    id: 'blade', name: 'Blade', emoji: '🗡', make: blade,
    params: [
      { key: 'length', label: 'length', min: 6, max: 30, step: 0.5, default: 16, unit: 'in' },
      { key: 'width', label: 'width', min: 1, max: 4, step: 0.1, default: 2, unit: 'in' },
    ],
  },
  {
    id: 'tab', name: 'Glue Tab', emoji: '🔖', make: tab,
    params: [
      { key: 'width', label: 'width', min: 0.5, max: 3, step: 0.25, default: 1, unit: 'in' },
      { key: 'depth', label: 'depth', min: 0.5, max: 2, step: 0.25, default: 1, unit: 'in' },
    ],
  },
];

const byId = new Map(STARTERS.map(s => [s.id, s]));

// The wire shape of GET /api/shelf — no functions.
export const shelfList = () => STARTERS.map(({ id, name, emoji, params }) => ({ id, name, emoji, params }));

export const getStarter = (id) => byId.get(id) || null;

// Snap a dial value onto its declared range/step; anything unusable falls back
// to the default, so a bad request can never produce a bad path.
export function resolveParams(starter, params = {}) {
  const out = {};
  for (const p of starter.params) {
    const raw = params?.[p.key];
    let v = typeof raw === 'string' ? Number(raw) : raw;
    if (!Number.isFinite(v)) v = p.default;
    v = clamp(v, p.min, p.max);
    if (p.step) v = clamp(p.min + Math.round((v - p.min) / p.step) * p.step, p.min, p.max);
    out[p.key] = r4(v);
  }
  return out;
}

// starter id + dial values → a bare part (no id, no layout).
export function makeStarter(id, params = {}) {
  const starter = getStarter(id);
  if (!starter) return null;
  const values = starter.normalize
    ? starter.normalize(resolveParams(starter, params))
    : resolveParams(starter, params);
  const part = starter.make(values);
  return { part, params: values };
}
