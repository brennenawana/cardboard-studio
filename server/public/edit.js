// Cardboard Studio — THE CUTTING MAT (/edit/:slug), M1 verb set.
//
// One screen: parts tray | SVG mat in real inches | 3D fold-up iframe, with a
// read-only design.json inspector across the bottom. The document is the real
// design.json, fetched from (and pushed back to) the in-memory draft endpoints
// (M1 contract §3). Verbs: MOVE (drag → layout.x/y), TURN (knob → layout.rotDeg),
// SIZE (corner/edge handles → transformed path/holes/slits/backing), COPIES
// (stepper → part.count).
//
// Layout semantics (contract §1): translate a part so its PRE-ROTATION bbox
// min-corner lands at (layout.x, layout.y), then rotate clockwise about the
// translated bbox centre:  place(p) = R(rotDeg, C) · (p − bb.min + xy).

const $ = (s) => document.querySelector(s);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const SNAP = 0.25;          // the mat's snap grid, in inches
const MIN_SIZE = 0.15;      // smallest a part may be scaled to, in inches
const PPI = 72;             // screen px per inch at zoom 1
const snap = (v, on = true) => (on ? Math.round(v / SNAP) * SNAP : v);

/* ================================================================
   SVG path parsing — ported from server/src/render/geometry.mjs
   (same sampling approach viewer.js uses). Inches, y-down,
   commands M L H V C S Q T Z only.
   ================================================================ */
const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi;

function parsePath(d) {
  const segs = [];
  const re = /([MLHVCSQTZAmlhvcsqtza])([^MLHVCSQTZAmlhvcsqtza]*)/g;
  let m;
  while ((m = re.exec(d))) {
    segs.push({ cmd: m[1], nums: (m[2].match(NUM) || []).map(Number) });
  }
  return segs;
}

function samplePath(d, curveSteps = 16) {
  const segs = parsePath(d);
  const pts = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let prevCtrl = null, prevCmd = '';
  const push = (x, y) => pts.push([x, y]);
  const bez3 = (p0, p1, p2, p3) => {
    for (let i = 1; i <= curveSteps; i++) {
      const t = i / curveSteps, u = 1 - t;
      push(
        u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
        u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]
      );
    }
  };
  const bez2 = (p0, p1, p2) => {
    for (let i = 1; i <= curveSteps; i++) {
      const t = i / curveSteps, u = 1 - t;
      push(u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0], u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1]);
    }
  };
  for (const { cmd, nums } of segs) {
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    let i = 0;
    const n = () => nums[i++];
    while (i < nums.length || (C === 'Z' && i === 0)) {
      switch (C) {
        case 'M': {
          let x = n(), y = n();
          if (rel) { x += cx; y += cy; }
          cx = x; cy = y; sx = x; sy = y; push(x, y);
          while (i < nums.length) {
            let lx = n(), ly = n();
            if (rel) { lx += cx; ly += cy; }
            cx = lx; cy = ly; push(lx, ly);
          }
          break;
        }
        case 'L': {
          let x = n(), y = n();
          if (rel) { x += cx; y += cy; }
          cx = x; cy = y; push(x, y);
          break;
        }
        case 'H': { let x = n(); if (rel) x += cx; cx = x; push(cx, cy); break; }
        case 'V': { let y = n(); if (rel) y += cy; cy = y; push(cx, cy); break; }
        case 'C': {
          let x1 = n(), y1 = n(), x2 = n(), y2 = n(), x = n(), y = n();
          if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
          bez3([cx, cy], [x1, y1], [x2, y2], [x, y]);
          prevCtrl = [x2, y2]; cx = x; cy = y;
          break;
        }
        case 'S': {
          let x2 = n(), y2 = n(), x = n(), y = n();
          if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
          const refl = (prevCmd === 'C' || prevCmd === 'S') && prevCtrl
            ? [2*cx - prevCtrl[0], 2*cy - prevCtrl[1]] : [cx, cy];
          bez3([cx, cy], refl, [x2, y2], [x, y]);
          prevCtrl = [x2, y2]; cx = x; cy = y;
          break;
        }
        case 'Q': {
          let x1 = n(), y1 = n(), x = n(), y = n();
          if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; }
          bez2([cx, cy], [x1, y1], [x, y]);
          prevCtrl = [x1, y1]; cx = x; cy = y;
          break;
        }
        case 'T': {
          let x = n(), y = n();
          if (rel) { x += cx; y += cy; }
          const refl = (prevCmd === 'Q' || prevCmd === 'T') && prevCtrl
            ? [2*cx - prevCtrl[0], 2*cy - prevCtrl[1]] : [cx, cy];
          bez2([cx, cy], refl, [x, y]);
          prevCtrl = refl; cx = x; cy = y;
          break;
        }
        case 'Z': { cx = sx; cy = sy; push(cx, cy); i = Infinity; break; }
        default: i = Infinity;
      }
      prevCmd = C;
      if (C === 'Z') break;
    }
  }
  return pts;
}

function pathBBox(d) {
  const pts = samplePath(d);
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

const bboxCache = new Map();
function bboxOfPath(d) {
  let bb = bboxCache.get(d);
  if (!bb) { bb = pathBBox(d); bboxCache.set(d, bb); }
  return bb;
}

// bbox of everything belonging to a part (outline + holes + slits + backing)
function partBBox(part) {
  const boxes = [part.path, ...holePaths(part), ...slitPaths(part)]
    .concat(part.backing ? [part.backing] : [])
    .map(bboxOfPath).filter(Boolean);
  if (!boxes.length) return null;
  const r = boxes.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
  }));
  return { ...r, width: r.maxX - r.minX, height: r.maxY - r.minY };
}

// holes/slits may be bare strings or {id, d} objects (M0 migration) — read both
const dOf = (entry) => (typeof entry === 'string' ? entry : (entry && entry.d) || '');
const withD = (entry, d) => (typeof entry === 'string' ? d : { ...entry, d });
const holePaths = (part) => (part.holes || []).map(dOf).filter(Boolean);
const slitPaths = (part) => (part.slits || []).map(dOf).filter(Boolean);

// Rewrite a path through an affine map f(x,y) → [x,y]. Absolute output;
// H/V become L. Bezier control points map affinely, and the S/T reflected
// control point is affine-covariant, so those commands survive unchanged.
function mapPath(d, f) {
  const segs = parsePath(d);
  const out = [];
  const fmt = (v) => String(Math.round(v * 1e4) / 1e4);
  const P = (x, y) => { const p = f(x, y); return fmt(p[0]) + ' ' + fmt(p[1]); };
  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const { cmd, nums } of segs) {
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') { out.push('Z'); cx = sx; cy = sy; continue; }
    let i = 0, first = true;
    const n = () => nums[i++];
    while (i < nums.length) {
      if (C === 'M') {
        let x = n(), y = n();
        if (rel) { x += cx; y += cy; }
        out.push((first ? 'M ' : 'L ') + P(x, y));
        if (first) { sx = x; sy = y; }
        cx = x; cy = y;
      } else if (C === 'L') {
        let x = n(), y = n();
        if (rel) { x += cx; y += cy; }
        out.push('L ' + P(x, y)); cx = x; cy = y;
      } else if (C === 'H') {
        let x = n();
        if (rel) x += cx;
        out.push('L ' + P(x, cy)); cx = x;
      } else if (C === 'V') {
        let y = n();
        if (rel) y += cy;
        out.push('L ' + P(cx, y)); cy = y;
      } else if (C === 'C') {
        let x1 = n(), y1 = n(), x2 = n(), y2 = n(), x = n(), y = n();
        if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
        out.push('C ' + P(x1, y1) + ' ' + P(x2, y2) + ' ' + P(x, y)); cx = x; cy = y;
      } else if (C === 'S') {
        let x2 = n(), y2 = n(), x = n(), y = n();
        if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
        out.push('S ' + P(x2, y2) + ' ' + P(x, y)); cx = x; cy = y;
      } else if (C === 'Q') {
        let x1 = n(), y1 = n(), x = n(), y = n();
        if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; }
        out.push('Q ' + P(x1, y1) + ' ' + P(x, y)); cx = x; cy = y;
      } else if (C === 'T') {
        let x = n(), y = n();
        if (rel) { x += cx; y += cy; }
        out.push('T ' + P(x, y)); cx = x; cy = y;
      } else {
        break; // unsupported command (arcs are schema-forbidden)
      }
      first = false;
    }
  }
  return out.join(' ');
}

/* ================================================================
   Auto-pack fallback (mirrors layoutParts() in render/templates.mjs)
   — used only when a draft arrives with parts that have no layout.
   ================================================================ */
function autoPackLayouts(parts) {
  const EDGE_PAD = 0.35, LAYOUT_PAD = 0.6, OVERLAP = 1.0;
  const pw = 8.5, ph = 11;
  const usableRight = pw - EDGE_PAD, stepH = ph - OVERLAP;
  const items = parts.map((part) => ({ part, bb: partBBox(part) })).filter((it) => it.bb);
  items.sort((a, b) => b.bb.height - a.bb.height);
  const avoidSeam = (y, h) => {
    if (h > ph - OVERLAP - 2 * EDGE_PAD) return y;
    const row = Math.max(0, Math.floor(y / stepH));
    const rowBottom = row * stepH + ph;
    return y + h > rowBottom ? (row + 1) * stepH + OVERLAP + 0.15 : y;
  };
  let shelfY = EDGE_PAD, shelfH = 0, cursorX = EDGE_PAD, placedAny = false;
  for (const { part, bb } of items) {
    if (placedAny && cursorX + bb.width > usableRight) {
      shelfY += shelfH + LAYOUT_PAD; cursorX = EDGE_PAD; shelfH = 0;
    }
    if (cursorX === EDGE_PAD) { shelfY = avoidSeam(shelfY, bb.height); shelfH = bb.height; }
    else shelfH = Math.max(shelfH, bb.height);
    part.layout = { x: +cursorX.toFixed(4), y: +shelfY.toFixed(4), rotDeg: 0 };
    cursorX += bb.width + LAYOUT_PAD;
    placedAny = true;
  }
}

/* ================================================================
   Document state
   ================================================================ */
const slug = decodeURIComponent(
  new URLSearchParams(location.search).get('slug') ||
  location.pathname.split('/').filter(Boolean).pop() || '');

let design = null;
let rev = 0;
let mock = false;              // true while the draft endpoints are not up
let selId = null;
const undoStack = [], redoStack = [];
let drag = null;               // live gesture
let zoom = 1;
let matBox = { minX: 0, minY: 0, w: 12, h: 14 };
let viewerReady = false, viewerPending = false;

/* ---- M2 state (verbs PUNCH/FOLD, shelf, hardware, Toy Doctor) ---- */
let verb = 'select';        // 'select' | 'punch' | 'fold'
let curlOn = false;         // CURL toggle inside FOLD
let curlLive = null;        // the curl still being tuned by the stepper
let curlCount = 8;
let findings = [];          // Toy Doctor chips
let ghostPath = null;       // shelf drop preview, in mat space
let ghostLines = [];        // FOLD / CURL preview lines, in mat space
let flashGeo = null;        // geometry flashed by a Toy Doctor chip
let flashTimer = null;
let hotChipKey = null;      // hardware chip under a dragged hole

const svg = $('#mat');
const clone = (v) => JSON.parse(JSON.stringify(v));
const partById = (id) => (design.parts || []).find((p) => p.id === id);
const selPart = () => (selId ? partById(selId) : null);

function layoutOf(part) {
  const bb = partBBox(part) || { minX: 0, minY: 0, width: 1, height: 1 };
  const l = part.layout || {};
  return {
    bb,
    x: Number.isFinite(l.x) ? l.x : bb.minX,
    y: Number.isFinite(l.y) ? l.y : bb.minY,
    rot: Number.isFinite(l.rotDeg) ? l.rotDeg : 0,
  };
}

// Everything a gesture needs: the placed box, its rotation, and the mat-space
// mapping of a pre-rotation placed point.
function placement(part) {
  const { bb, x, y, rot } = layoutOf(part);
  const w = bb.width, h = bb.height;
  const cx = x + w / 2, cy = y + h / 2;
  const a = rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const rp = (px, py) => {
    const dx = px - cx, dy = py - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  };
  return { bb, x, y, w, h, rot, cx, cy, rp, tx: x - bb.minX, ty: y - bb.minY };
}

// the 8 SIZE handles + their opposite anchors, in pre-rotation placed space
function handlePoints(pl) {
  const { x, y, w, h } = pl;
  const mx = x + w / 2, my = y + h / 2;
  return [
    { id: 'nw', p: [x, y],          a: [x + w, y + h], axes: 'xy' },
    { id: 'ne', p: [x + w, y],      a: [x, y + h],     axes: 'xy' },
    { id: 'se', p: [x + w, y + h],  a: [x, y],         axes: 'xy' },
    { id: 'sw', p: [x, y + h],      a: [x + w, y],     axes: 'xy' },
    { id: 'n',  p: [mx, y],         a: [mx, y + h],    axes: 'y' },
    { id: 's',  p: [mx, y + h],     a: [mx, y],        axes: 'y' },
    { id: 'w',  p: [x, my],         a: [x + w, my],    axes: 'x' },
    { id: 'e',  p: [x + w, my],     a: [x, my],        axes: 'x' },
  ];
}

/* ================================================================
   Mat rendering
   ================================================================ */
function placedBounds(part) {
  const pl = placement(part);
  const cs = [[pl.x, pl.y], [pl.x + pl.w, pl.y], [pl.x + pl.w, pl.y + pl.h], [pl.x, pl.y + pl.h]]
    .map(([px, py]) => pl.rp(px, py));
  return {
    minX: Math.min(...cs.map((c) => c[0])), maxX: Math.max(...cs.map((c) => c[0])),
    minY: Math.min(...cs.map((c) => c[1])), maxY: Math.max(...cs.map((c) => c[1])),
  };
}

function contentBounds() {
  const bs = (design.parts || []).map(placedBounds);
  // in compare mode the ghost is content too, or a part that used to sit
  // off to the left would be drawn outside the canvas
  if (cmp && cmp.old) {
    for (const p of cmp.old.parts || []) if (cmp.ghostParts.has(p.id)) bs.push(placedBounds(p));
  }
  if (!bs.length) return { minX: 0, minY: 0, maxX: 8.5, maxY: 11 };
  return {
    minX: Math.min(...bs.map((b) => b.minX)), maxX: Math.max(...bs.map((b) => b.maxX)),
    minY: Math.min(...bs.map((b) => b.minY)), maxY: Math.max(...bs.map((b) => b.maxY)),
  };
}

// The mat only ever grows, so the canvas never jumps under a moving pointer.
function updateMatBox() {
  const c = contentBounds();
  const want = {
    minX: Math.min(0, c.minX - 2), minY: Math.min(0, c.minY - 2),
    maxX: Math.max(8.5, c.maxX + 2), maxY: Math.max(11, c.maxY + 2),
  };
  const cur = { minX: matBox.minX, minY: matBox.minY, maxX: matBox.minX + matBox.w, maxY: matBox.minY + matBox.h };
  const box = {
    minX: Math.min(cur.minX, want.minX), minY: Math.min(cur.minY, want.minY),
    maxX: Math.max(cur.maxX, want.maxX), maxY: Math.max(cur.maxY, want.maxY),
  };
  matBox = { minX: box.minX, minY: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function gridSvg() {
  const { minX, minY, w, h } = matBox;
  let out = `<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="#fff"/>`;
  const line = (x1, y1, x2, y2, heavy) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${heavy ? '#b9ae9c' : '#ddd6c9'}" ` +
    `stroke-width="${heavy ? 1.3 : 0.8}" vector-effect="non-scaling-stroke"/>`;
  for (let gx = Math.ceil(minX); gx <= minX + w; gx++) out += line(gx, minY, gx, minY + h, gx % 3 === 0);
  for (let gy = Math.ceil(minY); gy <= minY + h; gy++) out += line(minX, gy, minX + w, gy, gy % 3 === 0);
  return out;
}

function partSvg(part) {
  const pl = placement(part);
  const t = `rotate(${+pl.rot.toFixed(3)} ${+pl.cx.toFixed(4)} ${+pl.cy.toFixed(4)}) ` +
            `translate(${+pl.tx.toFixed(4)} ${+pl.ty.toFixed(4)})`;
  // outline + holes in one evenodd path so holes read as real cut-outs
  const outline = [part.path, ...holePaths(part)].join(' ');
  let g = `<g class="part${part.id === selId ? ' sel' : ''}" data-part="${esc(part.id)}" transform="${t}">`;
  g += `<path class="p-out" d="${esc(outline)}"/>`;
  if (part.backing) g += `<path class="p-back" d="${esc(part.backing)}"/>`;
  for (const s of slitPaths(part)) g += `<path class="p-slit" d="${esc(s)}"/>`;
  g += '</g>';
  // name label rides above the placed box, unrotated so it stays readable
  const b = placedBounds(part);
  g += `<text class="p-name" x="${b.minX}" y="${b.minY - 0.07}" ` +
       `font-size="${(12 / (PPI * zoom)).toFixed(4)}">${esc(part.name || part.id)}` +
       `${(part.count || 1) > 1 ? ' ×' + part.count : ''}</text>`;
  return g;
}

function overlaySvg() {
  const part = selPart();
  if (!part || locked) return '';        // comparing: no grab handles to tempt anyone
  const pl = placement(part);
  const px = 1 / (PPI * zoom);          // one screen pixel, in inches
  const hs = 5 * px;                     // half a handle
  const corners = [[pl.x, pl.y], [pl.x + pl.w, pl.y], [pl.x + pl.w, pl.y + pl.h], [pl.x, pl.y + pl.h]]
    .map(([x, y]) => pl.rp(x, y));
  let o = `<polygon class="selbox" points="${corners.map((c) => c.map((v) => v.toFixed(4)).join(',')).join(' ')}"/>`;
  // PUNCH/FOLD own the pointer: the MOVE/TURN/SIZE handles step aside so a
  // click on the part is always a punch and a drag is always a score line.
  if (verb !== 'select') return o;
  for (const hp of handlePoints(pl)) {
    const [hx, hy] = pl.rp(hp.p[0], hp.p[1]);
    o += `<rect class="handle" data-handle="${hp.id}" x="${hx - hs}" y="${hy - hs}" ` +
         `width="${hs * 2}" height="${hs * 2}" rx="${hs * 0.35}"/>`;
  }
  // single TURN knob, above the selection
  const [ax, ay] = pl.rp(pl.x + pl.w / 2, pl.y);
  const a = pl.rot * Math.PI / 180;
  const knob = [ax + Math.sin(a) * 30 * px, ay - Math.cos(a) * 30 * px];
  o += `<line class="turnstem" x1="${ax}" y1="${ay}" x2="${knob[0]}" y2="${knob[1]}"/>`;
  o += `<circle class="turnknob" data-handle="turn" cx="${knob[0]}" cy="${knob[1]}" r="${7 * px}"/>`;
  return o;
}

function render() {
  if (!drag) updateMatBox();
  svg.setAttribute('viewBox', `${matBox.minX} ${matBox.minY} ${matBox.w} ${matBox.h}`);
  svg.setAttribute('width', (matBox.w * PPI * zoom).toFixed(1));
  svg.setAttribute('height', (matBox.h * PPI * zoom).toFixed(1));
  // ghost (the checkpoint) UNDER today's parts, crimson tint over them
  svg.innerHTML = gridSvg() + ghostSvg() + (design.parts || []).map(partSvg).join('')
    + cmpTintSvg() + overlaySvg() + toolOverlaySvg();
  svg.classList.toggle('tool', verb !== 'select');
  $('#zoomPct').textContent = Math.round(zoom * 100) + '%';
  renderTray();
  renderSelection();
  renderHardware();
}

function renderTray() {
  $('#trayRows').innerHTML = (design.parts || []).map((p) => {
    const pl = placement(p);
    return `<div class="trow${p.id === selId ? ' sel' : ''}" data-part="${esc(p.id)}" ` +
      `title="${esc(p.id)} — ${pl.w.toFixed(2)} × ${pl.h.toFixed(2)} in">` +
      `<span class="sw"></span><span class="n">${esc(p.name || p.id)}</span>` +
      `<span class="c">&times;${p.count || 1}</span></div>`;
  }).join('');
}

function renderSelection() {
  const part = selPart();
  const minus = $('#copyMinus'), plus = $('#copyPlus');
  if (!part) {
    $('#selName').textContent = 'nothing selected';
    $('#selDims').textContent = 'click a part on the mat';
    $('#copyN').textContent = '—';
    $('#copyNote').textContent = '';
    minus.disabled = plus.disabled = true;
    return;
  }
  const pl = placement(part);
  $('#selName').textContent = part.name || part.id;
  $('#selDims').textContent =
    `${pl.w.toFixed(2)} × ${pl.h.toFixed(2)} in · at ${pl.x.toFixed(2)}, ${pl.y.toFixed(2)} in` +
    (pl.rot ? ` · turned ${Math.round(pl.rot)}°` : '');
  $('#copyN').textContent = String(part.count || 1);
  const floor = minCount(part);
  minus.disabled = (part.count || 1) <= floor;
  plus.disabled = (part.count || 1) >= 12;
  $('#copyNote').textContent = (part.count || 1) <= floor && floor > 1
    ? `the 3D assembly uses ${floor} copies of this part`
    : '';
}

// The validator rejects a count lower than the copies the assembly names.
function minCount(part) {
  let mx = 0;
  for (const inst of design.assembly?.instances || []) {
    if (inst.part === part.id) mx = Math.max(mx, (inst.copy ?? 0) + 1);
  }
  return Math.max(1, mx);
}

/* ================================================================
   Inspector: read-only pretty design.json + flash on what changed
   ================================================================ */
function jsonLines(v, path, prefix, depth, tail, out) {
  const pad = '  '.repeat(depth);
  if (Array.isArray(v)) {
    if (!v.length) { out.push({ path, html: pad + prefix + '[]' + tail }); return; }
    out.push({ path, html: pad + prefix + '[' });
    v.forEach((it, i) => jsonLines(it, `${path}[${i}]`, '', depth + 1, i < v.length - 1 ? ',' : '', out));
    out.push({ path, html: pad + ']' + tail });
  } else if (v && typeof v === 'object') {
    const ks = Object.keys(v);
    if (!ks.length) { out.push({ path, html: pad + prefix + '{}' + tail }); return; }
    out.push({ path, html: pad + prefix + '{' });
    ks.forEach((k, i) => jsonLines(v[k], path ? `${path}.${k}` : k,
      `<span class="k">"${esc(k)}"</span>: `, depth + 1, i < ks.length - 1 ? ',' : '', out));
    out.push({ path, html: pad + '}' + tail });
  } else {
    const cls = typeof v === 'number' ? 'n' : typeof v === 'string' ? 'v' : 'n';
    out.push({ path, html: `${pad}${prefix}<span class="${cls}">${esc(JSON.stringify(v))}</span>${tail}` });
  }
}

function renderInspector(changed) {
  const lines = [];
  jsonLines(design, '', '', 0, '', lines);
  $('#json').innerHTML = lines
    .map((l) => `<div class="ln" data-path="${esc(l.path)}">${l.html}</div>`).join('');
  flash(changed);
}

// scroll a line into the middle of the inspector (offsetTop is unreliable here —
// the lines' offsetParent is not the scroller, so measure through the boxes)
function scrollLineIntoView(el, frac = 0.5) {
  const box = $('#json');
  box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top
    - box.clientHeight * frac;
}

// scroll to + flash-highlight the property that just changed
function flash(changed) {
  if (!changed || !changed.length) return;
  const box = $('#json');
  let first = null;
  for (const path of changed) {
    for (const el of box.querySelectorAll(`.ln[data-path="${CSS.escape(path)}"]`)) {
      el.classList.remove('flash');
      void el.offsetWidth;             // restart the CSS animation
      el.classList.add('flash');
      if (!first) first = el;
    }
  }
  if (first) scrollLineIntoView(first);
}

function scrollInspectorTo(path) {
  const el = $('#json').querySelector(`.ln[data-path="${CSS.escape(path)}"]`);
  if (el) scrollLineIntoView(el, 0.12);
}

/* ================================================================
   Edits: undo/redo + sync
   ================================================================ */
function pushUndo() {
  undoStack.push(clone(design));
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('#undo').disabled = !undoStack.length;
  $('#redo').disabled = !redoStack.length;
}

function undo() {
  if (!undoStack.length) return;
  closePop();
  redoStack.push(clone(design));
  design = undoStack.pop();
  // The readout still shows whatever the undone gesture measured ("FIX fixed —
  // Ø 0.26″"). That number is no longer true of the document, and a readout
  // that lies about the geometry is worse than an empty one.
  liveReadout('UNDO');
  logOp('undo', null);
  afterEdit(null, 'undone');
  updateHistoryButtons();
}

function redo() {
  if (!redoStack.length) return;
  closePop();
  undoStack.push(clone(design));
  design = redoStack.pop();
  liveReadout('REDO');
  logOp('redo', null);
  afterEdit(null, 'redone');
  updateHistoryButtons();
}

// One place every committed edit funnels through: repaint, flash the inspector,
// push the working document to the viewer + the draft endpoint.
function afterEdit(changed, note) {
  render();
  renderInspector(changed);
  if (note) setStatus(note);
  scheduleSync();
}

let syncTimer = null;
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { postToViewer(); putDraft(); }, 300);
}

// One doc at a time (DESIGN.md vetoes dual-document ghosts in 3D): while
// reviewing, the BEFORE/AFTER toggle picks which document the viewer holds.
function postToViewer(doc) {
  const frame = $('#viewer');
  if (!frame.contentWindow) return;
  if (!viewerReady) { viewerPending = true; return; }
  const d = doc || (review ? (baSide === 'before' ? review.base : design) : design);
  frame.contentWindow.postMessage({ type: 'cuttingmat:design', design: d }, '*');
}

let putting = false, putAgain = false, lastPutBody = null;
async function putDraft() {
  if (mock) return true;                  // local-only draft until §3 lands
  // Reviewing: `design` is Claude's MERGED proposal, not the kid's draft. It
  // must never reach the draft endpoint — Keep it all is the only door.
  if (review) return false;
  if (putting) { putAgain = true; return false; }
  // The server already holds exactly this document — don't burn a rev on a
  // no-op PUT (a chat turn flushes before sending, mutations or not).
  const snapshot = JSON.stringify(design);
  if (snapshot === lastPutBody) return true;
  putting = true;
  try {
    // `?soft=1`: a document the Toy Doctor is still complaining about is a
    // normal state of this tool, not a network failure, so the server reports
    // it in the body (200 { ok: false, errors, findings }) instead of a 400 the
    // browser would log as a console error. The draft on the server is left
    // exactly where the 400 would have left it — at the last valid revision.
    const res = await fetch(`/api/designs/${encodeURIComponent(slug)}/draft?soft=1`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ design, rev }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 || body.stale) {
      // someone else moved the draft on — reload it and keep going
      await loadDraft();
      setStatus('reloaded the draft', 'warn');
      return false;
    }
    if (!res.ok || body.ok === false) {
      // A rejected draft is not a crash — the Toy Doctor strip carries the
      // sentence (and, when the linter can compute one, the one-tap fix).
      const errs = body.errors || [body.error || ('HTTP ' + res.status)];
      takeFindings(body, errs, []);
      setStatus(errs.length + ' problem' + (errs.length > 1 ? 's' : '') + ' — see the Toy Doctor', 'err');
      if (!findings.some((f) => f.level === 'error')) toast('The Toy Doctor says: ' + errs[0], true);
      return false;
    }
    rev = body.rev ?? rev;
    lastPutBody = snapshot;
    takeFindings(body, [], body.warnings || []);
    setStatus((body.warnings || []).length ? body.warnings[0] : 'saved to draft',
      (body.warnings || []).length ? 'warn' : '');
    return true;
  } catch (err) {
    setStatus('offline?', 'err');
    return false;
  } finally {
    putting = false;
    if (putAgain) { putAgain = false; putDraft(); }
  }
}

// putDraft() answers `false` for two very different things: the document was
// rejected, and "another PUT is in flight, try me later". A checkpoint (or a
// print) must not be dropped for the second one — so wait the busy line out and
// ask again, and only give up on a real rejection.
async function flushDraft() {
  for (let i = 0; i < 40; i++) {
    if (await putDraft()) return true;
    if (!putting) return false;             // a genuine rejection, not a busy line
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

let statusTimer = null;
function setStatus(text, cls = '') {
  const el = $('#status');
  el.textContent = text;
  el.title = text;                     // the full sentence, when it is elided
  el.className = cls;
  clearTimeout(statusTimer);
  if (text && !cls) statusTimer = setTimeout(() => { el.textContent = ''; }, 2500);
}

let toastTimer = null;
function toast(text, isErr = false, ms = 5200) {
  const el = $('#toast');
  el.textContent = text;
  el.className = isErr ? 'err' : '';
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
}

/* ================================================================
   Gestures: MOVE / TURN / SIZE
   ================================================================ */
function matPoint(ev) {
  const r = svg.getBoundingClientRect();
  return [
    matBox.minX + (ev.clientX - r.left) / r.width * matBox.w,
    matBox.minY + (ev.clientY - r.top) / r.height * matBox.h,
  ];
}

function select(id, fromTray) {
  if (id !== selId) { endCurlLive(); closePop(); }
  selId = id;
  render();
  if (id) {
    const idx = design.parts.findIndex((p) => p.id === id);
    if (idx >= 0) scrollInspectorTo(`parts[${idx}]`);
    if (fromTray) setStatus('selected ' + (partById(id).name || id));
  }
}

svg.addEventListener('pointerdown', (ev) => {
  if (locked) { setStatus('editing is locked while you compare — Exit first', 'warn'); return; }
  if (verb !== 'select' && toolPointerDown(ev)) return;
  const handle = ev.target.closest('[data-handle]');
  const partEl = ev.target.closest('[data-part]');
  if (!handle && !partEl) { select(null); return; }
  ev.preventDefault();
  svg.setPointerCapture(ev.pointerId);

  if (!handle) {
    const id = partEl.getAttribute('data-part');
    if (id !== selId) select(id);
    const part = partById(id);
    const pl = placement(part);
    drag = {
      kind: 'move', id, start: matPoint(ev), moved: false,
      base: { x: pl.x, y: pl.y }, snapshot: clone(design),
    };
    return;
  }

  const part = selPart();
  if (!part) return;
  const pl = placement(part);
  const p0 = matPoint(ev);
  if (handle.getAttribute('data-handle') === 'turn') {
    drag = {
      kind: 'turn', id: part.id, moved: false, snapshot: clone(design),
      cx: pl.cx, cy: pl.cy, rot0: pl.rot,
      ang0: Math.atan2(p0[1] - pl.cy, p0[0] - pl.cx) * 180 / Math.PI,
    };
    return;
  }
  const hid = handle.getAttribute('data-handle');
  const hp = handlePoints(pl).find((h) => h.id === hid);
  drag = {
    kind: 'size', id: part.id, moved: false, snapshot: clone(design),
    hp, pl, part0: clone(part),
    M0: pl.rp(hp.a[0], hp.a[1]),      // the anchor, pinned in mat space
    rot: pl.rot,
  };
});

svg.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  if (drag.tool) { toolPointerMove(ev); return; }
  const p = matPoint(ev);
  if (drag.kind === 'move') {
    const part = partById(drag.id);
    const free = ev.altKey;
    // Snap to the ¼" grid PER AXIS, and only once the pointer has actually
    // travelled on that axis (half a step). Auto-pack seeds layouts off-grid
    // (0.35), so snapping both axes on every move quietly dragged a part
    // sideways during a purely horizontal drag — motion the kid never asked
    // for. An untouched axis now keeps its exact value; alt = free, no grid.
    const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
    if (free || Math.abs(dx) >= SNAP / 2) drag.axisX = true;
    if (free || Math.abs(dy) >= SNAP / 2) drag.axisY = true;
    const nx = drag.axisX ? Math.max(0, snap(drag.base.x + dx, !free)) : drag.base.x;
    const ny = drag.axisY ? Math.max(0, snap(drag.base.y + dy, !free)) : drag.base.y;
    const pl0 = layoutOf(part);
    if (!drag.moved && Math.abs(nx - pl0.x) < 1e-9 && Math.abs(ny - pl0.y) < 1e-9) return;
    drag.moved = true;
    part.layout = { x: +nx.toFixed(4), y: +ny.toFixed(4), rotDeg: pl0.rot };
    liveReadout(`MOVE  ${nx.toFixed(2)} , ${ny.toFixed(2)} in`);
    render();
  } else if (drag.kind === 'turn') {
    const part = partById(drag.id);
    const ang = Math.atan2(p[1] - drag.cy, p[0] - drag.cx) * 180 / Math.PI;
    let rot = drag.rot0 + (ang - drag.ang0);
    if (!ev.shiftKey) rot = Math.round(rot / 15) * 15;
    rot = ((rot % 360) + 360) % 360;
    const l = layoutOf(part);
    drag.moved = true;
    part.layout = { x: l.x, y: l.y, rotDeg: +rot.toFixed(2) };
    liveReadout(`TURN  ${Math.round(rot)}°`);
    render();
  } else if (drag.kind === 'size') {
    applySize(p, !ev.altKey);
  }
});

// SIZE — corner handles scale uniformly about the opposite corner, edge handles
// scale one axis about the opposite edge. The same affine goes to path, holes,
// slits and backing; layout is corrected so the anchor stays put on the mat.
function applySize(p, doSnap) {
  const { hp, pl, part0, M0, rot } = drag;
  const a = -rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  // pointer → pre-rotation placed space (exact: displayed(p) = M0 + R(rot)(p − A))
  const dx = p[0] - M0[0], dy = p[1] - M0[1];
  const q = [hp.a[0] + dx * c - dy * s, hp.a[1] + dx * s + dy * c];

  const A = hp.a, H = hp.p;
  let sx = 1, sy = 1;
  if (hp.axes === 'xy') {
    const ux = H[0] - A[0], uy = H[1] - A[1];
    let k = ((q[0] - A[0]) * ux + (q[1] - A[1]) * uy) / (ux * ux + uy * uy);
    if (doSnap) k = Math.max(SNAP, snap(pl.w * k)) / pl.w;
    sx = sy = k;
  } else if (hp.axes === 'x') {
    let nx = q[0];
    if (doSnap) nx = snap(nx);
    sx = (nx - A[0]) / (H[0] - A[0]);
  } else {
    let ny = q[1];
    if (doSnap) ny = snap(ny);
    sy = (ny - A[1]) / (H[1] - A[1]);
  }
  sx = Math.max(sx, MIN_SIZE / pl.w);
  sy = Math.max(sy, MIN_SIZE / pl.h);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;

  // local anchor: the pre-rotation anchor expressed in the part's own coords
  const bb = pl.bb;
  const aL = [bb.minX + (A[0] - pl.x), bb.minY + (A[1] - pl.y)];
  const f = (x, y) => [aL[0] + (x - aL[0]) * sx, aL[1] + (y - aL[1]) * sy];

  const part = partById(drag.id);
  part.path = mapPath(part0.path, f);
  if (part0.holes) part.holes = part0.holes.map((h) => withD(h, mapPath(dOf(h), f)));
  if (part0.slits) part.slits = part0.slits.map((s2) => withD(s2, mapPath(dOf(s2), f)));
  if (part0.backing) part.backing = mapPath(part0.backing, f);

  // layout: scale the placed box about the anchor, then pin the anchor in place
  const nx0 = A[0] + (pl.x - A[0]) * sx, ny0 = A[1] + (pl.y - A[1]) * sy;
  const nw = pl.w * sx, nh = pl.h * sy;
  const ncx = nx0 + nw / 2, ncy = ny0 + nh / 2;
  const ra = rot * Math.PI / 180, rc = Math.cos(ra), rs = Math.sin(ra);
  const anchorNow = [
    ncx + (A[0] - ncx) * rc - (A[1] - ncy) * rs,
    ncy + (A[0] - ncx) * rs + (A[1] - ncy) * rc,
  ];
  part.layout = {
    x: +(nx0 + M0[0] - anchorNow[0]).toFixed(4),
    y: +(ny0 + M0[1] - anchorNow[1]).toFixed(4),
    rotDeg: rot,
  };
  drag.moved = true;
  drag.changedPath = true;
  liveReadout(`SIZE  ${nw.toFixed(2)} × ${nh.toFixed(2)} in`);
  render();
}

function liveReadout(text) {
  $('#readout').textContent = text;
  for (const [id, verb] of [['#vMove', 'MOVE'], ['#vTurn', 'TURN'], ['#vSize', 'SIZE']]) {
    $(id).classList.toggle('on', text.startsWith(verb));
  }
}

function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.tool) { endToolDrag(d); return; }
  if (!d.moved) { render(); return; }
  undoStack.push(d.snapshot);
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
  const idx = design.parts.findIndex((p) => p.id === d.id);
  let changed;
  if (d.kind === 'size') {
    changed = [`parts[${idx}].path`, `parts[${idx}].layout.x`, `parts[${idx}].layout.y`];
  } else if (d.kind === 'turn') {
    changed = [`parts[${idx}].layout.rotDeg`];
  } else {
    // MOVE flashes only the axis that actually moved (a horizontal drag no
    // longer claims — or causes — a change in y)
    const was = ((d.snapshot.parts || [])[idx] || {}).layout || {};
    const now = (design.parts[idx] || {}).layout || {};
    changed = [];
    if (was.x !== now.x) changed.push(`parts[${idx}].layout.x`);
    if (was.y !== now.y) changed.push(`parts[${idx}].layout.y`);
    if (!changed.length) changed = [`parts[${idx}].layout.x`, `parts[${idx}].layout.y`];
  }
  logOp(d.kind, d.id);
  afterEdit(changed);
}

svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);

/* ---- tray selection (syncs both ways) ---- */
$('#trayRows').addEventListener('click', (ev) => {
  const row = ev.target.closest('[data-part]');
  if (row) select(row.getAttribute('data-part'), true);
});

/* ---- COPIES stepper ---- */
function bumpCount(delta) {
  const part = selPart();
  if (!part) return;
  const floor = minCount(part);
  const next = clamp((part.count || 1) + delta, floor, 12);
  if (next === (part.count || 1)) return;
  pushUndo();
  part.count = next;
  logOp('copies', part.id);
  const idx = design.parts.indexOf(part);
  afterEdit([`parts[${idx}].count`]);
  liveReadout(`COPIES  ×${next}`);
}
$('#copyPlus').addEventListener('click', () => bumpCount(1));
$('#copyMinus').addEventListener('click', () => bumpCount(-1));

/* ---- zoom ---- */
function setZoom(z, keepCentre = true) {
  const scroller = $('#matScroll');
  const cxFrac = (scroller.scrollLeft + scroller.clientWidth / 2) / Math.max(1, svg.clientWidth);
  const cyFrac = (scroller.scrollTop + scroller.clientHeight / 2) / Math.max(1, svg.clientHeight);
  zoom = clamp(z, 0.15, 4);
  render();
  if (keepCentre) {
    scroller.scrollLeft = cxFrac * svg.clientWidth - scroller.clientWidth / 2;
    scroller.scrollTop = cyFrac * svg.clientHeight - scroller.clientHeight / 2;
  }
}
$('#zoomIn').addEventListener('click', () => setZoom(zoom * 1.25));
$('#zoomOut').addEventListener('click', () => setZoom(zoom / 1.25));
$('#zoomFit').addEventListener('click', () => fitView());

// open on the whole design plus a 2" margin
function fitView() {
  const scroller = $('#matScroll');
  const c = contentBounds();
  const w = (c.maxX - c.minX) + 4, h = (c.maxY - c.minY) + 4;
  zoom = clamp(Math.min((scroller.clientWidth - 36) / (w * PPI), (scroller.clientHeight - 36) / (h * PPI)), 0.15, 4);
  render();
  const midX = ((c.minX + c.maxX) / 2 - matBox.minX) / matBox.w * svg.clientWidth;
  const midY = ((c.minY + c.maxY) / 2 - matBox.minY) / matBox.h * svg.clientHeight;
  scroller.scrollLeft = midX - scroller.clientWidth / 2;
  scroller.scrollTop = midY - scroller.clientHeight / 2;
}

$('#matScroll').addEventListener('wheel', (ev) => {
  if (!ev.ctrlKey && !ev.metaKey) return;
  ev.preventDefault();
  setZoom(zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });

/* ---- keyboard: undo / redo / deselect ---- */
addEventListener('keydown', (ev) => {
  const z = ev.key.toLowerCase() === 'z';
  if (locked && (z || ev.key.toLowerCase() === 'y') && (ev.metaKey || ev.ctrlKey)) {
    ev.preventDefault();
    setStatus(review ? 'finish reviewing Claude’s idea first — Keep it all or No thanks'
                     : 'editing is locked while you compare — Exit first', 'warn');
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && z) {
    ev.preventDefault();
    ev.shiftKey ? redo() : undo();
  } else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'y') {
    ev.preventDefault(); redo();
  } else if (ev.key === 'Escape') {
    if (popEl) closePop();
    else if (cmp) exitCompare();
    else if (curlLive) endCurlLive();
    else if (verb !== 'select') setVerb('select');
    else select(null);
  }
});
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);

/* ================================================================
   PRINT / SAVE
   ================================================================ */
$('#print').addEventListener('click', async () => {
  const btn = $('#print');
  btn.disabled = true;
  const old = btn.innerHTML;
  btn.textContent = 'rendering…';
  try {
    clearTimeout(syncTimer);
    if (mock) { toast('The draft render endpoint is not up yet (mock draft mode).', true); return; }
    if (!(await flushDraft())) return;
    const res = await fetch(`/api/designs/${encodeURIComponent(slug)}/draft/render`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast('Could not print: ' + ((body.errors || [])[0] || body.error || res.status), true);
      return;
    }
    const files = body.files || [];
    const letter = files.find((f) => /letter/i.test(f)) || files.find((f) => /template/i.test(f)) || files[0];
    if (!letter) { toast('The renderer produced no files.', true); return; }
    window.open(letter, '_blank');
    toast('Cut sheet rendered — check the new tab.');
    await writeCheckpoint(' · printed');    // no-op when nothing changed since the last dot
  } catch (err) {
    toast('Could not print: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
});

$('#save').addEventListener('click', async () => {
  if (!confirm('Save this to the gallery? It updates the design in your gallery — the printed sheets and the 3D preview change for everyone.')) return;
  const btn = $('#save');
  btn.disabled = true;
  try {
    clearTimeout(syncTimer);
    if (mock) { toast('The draft save endpoint is not up yet (mock draft mode).', true); return; }
    if (!(await flushDraft())) return;
    const res = await fetch(`/api/designs/${encodeURIComponent(slug)}/draft/save`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast('Could not save: ' + ((body.errors || [])[0] || body.error || res.status), true);
      return;
    }
    toast('Saved to the gallery and re-printed the bundle.');
    setStatus('saved');
    await writeCheckpoint(' · saved');      // no-op when nothing changed since the last dot
  } catch (err) {
    toast('Could not save: ' + err.message, true);
  } finally {
    btn.disabled = false;
  }
});

/* ================================================================
   Goal card
   ================================================================ */
function maybeGoal() {
  const forced = new URLSearchParams(location.search).get('goal') === '1';
  const key = 'cuttingmat.goal.' + slug;
  let seen = false;
  try { seen = localStorage.getItem(key) === '1'; } catch { /* private mode */ }
  if (!forced && (seen || slug !== 'pirate-sword')) return;
  $('#goal').classList.remove('hidden');
  $('#goalGo').addEventListener('click', () => {
    $('#goal').classList.add('hidden');
    try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
  });
}

/* ================================================================
   Boot
   ================================================================ */
async function loadDraft() {
  const res = await fetch(`/api/designs/${encodeURIComponent(slug)}/draft`);
  if (res.ok) {
    const body = await res.json();
    design = body.design;
    rev = body.rev ?? 0;
    mock = false;
  } else {
    // The draft endpoints (contract §3) are not up yet: work from the saved
    // design with locally computed auto-pack layouts, and keep edits in-page.
    const d = await (await fetch(`/api/designs/${encodeURIComponent(slug)}`)).json();
    design = d;
    rev = 0;
    mock = true;
  }
  if ((design.parts || []).some((p) => !p.layout)) autoPackLayouts(design.parts || []);
  // Chips and fixes anchor on hole/slit ids. Builder A backfills these on draft
  // init (M2 §1); until that lands (and harmlessly after), do it here too —
  // assigning only where an id is missing makes the two agree exactly.
  ensureEntryIds(design);
  lastPutBody = JSON.stringify(design);  // what we hold IS what the server holds
}

addEventListener('message', (ev) => {
  if (ev.data && ev.data.type === 'cuttingmat:viewer-ready') {
    viewerReady = true;
    if (viewerPending) { viewerPending = false; postToViewer(); }
  }
});

async function boot() {
  await loadDraft();
  document.title = (design.title || slug) + ' — The Cutting Mat';
  $('#title').textContent = design.title || slug;
  $('#viewer').src = `/viewer/${encodeURIComponent(slug)}?draft=1&t=1`;
  updateHistoryButtons();
  await loadShelf();
  loadTranscript();                  // the chat rail survives a reload (sessionStorage)
  renderChat();
  let chatWasOpen = true;
  try { chatWasOpen = sessionStorage.getItem(CHAT_OPEN_KEY()) !== '0'; } catch { /* private mode */ }
  $('#app').classList.toggle('chatclosed', !chatWasOpen);   // before the fit, so it fits the real width
  $('#chatToggle').innerHTML = chatWasOpen ? '&#8594;' : '&#8592;';
  render();
  renderInspector(null);
  renderDoctor();
  fitView();
  if (mock) setStatus('mock draft', 'warn');
  maybeGoal();
  addEventListener('resize', () => render());
  cpBase = clone(design);            // quantities in a summary measure from here
  await loadCheckpoints();           // the strip reflects GET /checkpoints on load
  putDraft();                        // first lint pass → Toy Doctor chips
}

/* ================================================================
   M2 — shared geometry helpers for PUNCH / FOLD / SHELF / TOY DOCTOR
   ================================================================ */
const KAPPA = 0.5522847498307936;
const f4 = (v) => String(Math.round(v * 1e4) / 1e4);
const ROUND_KINDS = new Set(['dowel', 'skewer', 'straw']);
const LOOSE_GAP = 0.06;   // "LOOSE so it spins" — inside the linter's +0.04..+0.12 band
const SNUG_GAP = 0.01;    // "SNUG so it grips"  — inside the linter's −0.01..+0.03 band
const SLIT_OVERHANG = 0.04;   // score lines run a hair past the outline (schema slack is 0.05)

// A circle as four cubics — the schema forbids arcs, and this is exactly how
// the existing designs draw their holes.
function circlePath(cx, cy, r) {
  const k = KAPPA * r;
  return `M ${f4(cx + r)} ${f4(cy)}` +
    ` C ${f4(cx + r)} ${f4(cy + k)} ${f4(cx + k)} ${f4(cy + r)} ${f4(cx)} ${f4(cy + r)}` +
    ` C ${f4(cx - k)} ${f4(cy + r)} ${f4(cx - r)} ${f4(cy + k)} ${f4(cx - r)} ${f4(cy)}` +
    ` C ${f4(cx - r)} ${f4(cy - k)} ${f4(cx - k)} ${f4(cy - r)} ${f4(cx)} ${f4(cy - r)}` +
    ` C ${f4(cx + k)} ${f4(cy - r)} ${f4(cx + r)} ${f4(cy - k)} ${f4(cx + r)} ${f4(cy)} Z`;
}

// A closed polygon with rounded corners (radius per-corner or one number).
function roundedPoly(pts, radius) {
  const n = pts.length, seg = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const r0 = Array.isArray(radius) ? radius[i] : radius;
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const rr = Math.max(0, Math.min(r0 || 0, la / 2, lb / 2));
    const ua = la ? [(a[0] - p[0]) / la, (a[1] - p[1]) / la] : [0, 0];
    const ub = lb ? [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb] : [0, 0];
    seg.push({ p, rr, in: [p[0] + ua[0] * rr, p[1] + ua[1] * rr], out: [p[0] + ub[0] * rr, p[1] + ub[1] * rr] });
  }
  const P = (q) => `${f4(q[0])} ${f4(q[1])}`;
  let d = `M ${P(seg[0].out)}`;
  for (let i = 1; i <= n; i++) {
    const s = seg[i % n];
    d += ` L ${P(s.in)}`;
    if (s.rr > 1e-6) {
      const k = KAPPA;
      const c1 = [s.in[0] + (s.p[0] - s.in[0]) * k, s.in[1] + (s.p[1] - s.in[1]) * k];
      const c2 = [s.out[0] + (s.p[0] - s.out[0]) * k, s.out[1] + (s.p[1] - s.out[1]) * k];
      d += ` C ${P(c1)} ${P(c2)} ${P(s.out)}`;
    }
  }
  return d + ' Z';
}

// mat space ⟷ the part's own coordinates (the inverse of contract §1's place()).
function matToLocal(part, p) {
  const pl = placement(part);
  const a = -pl.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = p[0] - pl.cx, dy = p[1] - pl.cy;
  return [pl.cx + dx * c - dy * s - pl.tx, pl.cy + dx * s + dy * c - pl.ty];
}
function localToMat(part, p) {
  const pl = placement(part);
  return pl.rp(p[0] + pl.tx, p[1] + pl.ty);
}
function matToClient(m) {
  const r = svg.getBoundingClientRect();
  return [r.left + (m[0] - matBox.minX) / matBox.w * r.width,
          r.top + (m[1] - matBox.minY) / matBox.h * r.height];
}

// Adding a slit that overhangs (or a hole near an edge) changes the part's
// bbox — and layout is expressed against that bbox — so re-solve layout to keep
// every existing point exactly where it was on the mat. `prev` is placement()
// captured BEFORE the mutation.
function preserveWorld(part, prev) {
  const bb = partBBox(part);
  if (!bb) return;
  const a = prev.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const R = (v) => [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
  const dOld = R([-prev.bb.minX - prev.w / 2, -prev.bb.minY - prev.h / 2]);
  const dNew = R([-bb.minX - bb.width / 2, -bb.minY - bb.height / 2]);
  part.layout = {
    x: +(dOld[0] + prev.cx - dNew[0] - bb.width / 2).toFixed(4),
    y: +(dOld[1] + prev.cy - dNew[1] - bb.height / 2).toFixed(4),
    rotDeg: prev.rot,
  };
}

const entryIdOf = (entry) => (entry && typeof entry === 'object' ? entry.id : undefined);

function nextEntryId(part, prefix) {
  const key = prefix === 'h' ? 'holes' : 'slits';
  const used = new Set((part[key] || []).map(entryIdOf).filter(Boolean));
  for (let i = 1; i < 999; i++) if (!used.has(prefix + i)) return prefix + i;
  return prefix + Date.now();
}

// Builder A backfills ids on draft init; this makes the same assignment when a
// document arrives without them (identical scheme, so the two never disagree).
function ensureEntryIds(doc) {
  for (const part of doc.parts || []) {
    for (const key of ['holes', 'slits']) {
      const list = part[key];
      if (!Array.isArray(list)) continue;
      const prefix = key === 'holes' ? 'h' : 's';
      const used = new Set(list.map(entryIdOf).filter(Boolean));
      list.forEach((entry, i) => {
        if (entryIdOf(entry)) return;
        let id = prefix + (i + 1), n = i + 1;
        while (used.has(id)) id = prefix + (++n);
        used.add(id);
        list[i] = { id, d: dOf(entry) };
      });
    }
  }
}

const holeIndexById = (part, id) => (part.holes || []).findIndex((h) => entryIdOf(h) === id);

function circleOfEntry(part, entry) {
  const bb = bboxOfPath(dOf(entry));
  if (!bb) return null;
  return { cx: (bb.minX + bb.maxX) / 2, cy: (bb.minY + bb.maxY) / 2, dia: (bb.width + bb.height) / 2 };
}

// Scale one hole uniformly about its own centre to a target diameter.
// `base` supplies the geometry to scale FROM (the pre-drag clone during a live
// ring drag, so repeated frames never compound).
function setHoleDiameter(part, idx, dia, base) {
  const src = ((base || part).holes || [])[idx];
  const d = dOf(src);
  const bb = bboxOfPath(d);
  if (!bb) return;
  const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
  const cur = (bb.width + bb.height) / 2;
  if (!(cur > 1e-6)) return;
  const k = dia / cur;
  const prev = placement(part);
  part.holes[idx] = withD(part.holes[idx], mapPath(d, (x, y) => [cx + (x - cx) * k, cy + (y - cy) * k]));
  preserveWorld(part, prev);
}

function setHoleCentre(part, idx, centre, base) {
  const src = ((base || part).holes || [])[idx];
  const c0 = circleOfEntry(part, src);
  if (!c0 || !Number.isFinite(centre[0]) || !Number.isFinite(centre[1])) return;
  const dx = centre[0] - c0.cx, dy = centre[1] - c0.cy;
  const prev = placement(part);
  part.holes[idx] = withD(part.holes[idx], mapPath(dOf(src), (x, y) => [x + dx, y + dy]));
  preserveWorld(part, prev);
}

function pointInPath(d, p) {
  const pts = samplePath(d);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) &&
        p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Clip an infinite line (point + direction, part-local) to the part outline and
// give it a small overhang, the way a score line is drawn on the sheets.
function trimToOutline(part, P, dir, overhang = SLIT_OVERHANG) {
  const pts = samplePath(part.path);
  if (pts.length < 3) return null;
  const nx = -dir[1], ny = dir[0];
  const side = (q) => (q[0] - P[0]) * nx + (q[1] - P[1]) * ny;
  const ts = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const sa = side(a), sb = side(b);
    if (sa === sb) continue;
    if ((sa < 0) === (sb < 0)) continue;
    const u = sa / (sa - sb);
    const q = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    ts.push((q[0] - P[0]) * dir[0] + (q[1] - P[1]) * dir[1]);
  }
  if (ts.length < 2) return null;
  const t0 = Math.min(...ts) - overhang, t1 = Math.max(...ts) + overhang;
  if (t1 - t0 < 0.2) return null;
  return [[P[0] + dir[0] * t0, P[1] + dir[1] * t0], [P[0] + dir[0] * t1, P[1] + dir[1] * t1]];
}

const norm180 = (deg) => ((deg % 360) + 540) % 360 - 180;
function snapAngle(deg) {
  const k = Math.round(deg / 90) * 90;
  return Math.abs(norm180(deg - k)) <= 10 ? k : deg;
}

// FOLD: one score line through the drag. CURL: `count` parallel lines fanned
// evenly across the swipe, each perpendicular to it. Both trim to the outline.
function foldLines(part, p0, p1, count) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  if (Math.hypot(dx, dy) < 1e-6) return [];
  const raw = Math.atan2(dy, dx) * 180 / Math.PI + (count > 1 ? 90 : 0);
  const a = snapAngle(norm180(raw)) * Math.PI / 180;
  const ldir = [Math.cos(a), Math.sin(a)];
  const sdir = [-ldir[1], ldir[0]];
  const out = [];
  const add = (P) => {
    const seg = trimMatLine(part, P, ldir);
    if (seg) out.push(seg);
  };
  if (count > 1) {
    const span = (p1[0] - p0[0]) * sdir[0] + (p1[1] - p0[1]) * sdir[1];
    for (let i = 0; i < count; i++) {
      const t = span * (i / (count - 1));
      add([p0[0] + sdir[0] * t, p0[1] + sdir[1] * t]);
    }
  } else {
    add([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]);
  }
  return out;
}

function trimMatLine(part, matP, matDir) {
  const pl = placement(part);
  const a = -pl.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const dir = [matDir[0] * c - matDir[1] * s, matDir[0] * s + matDir[1] * c];
  const seg = trimToOutline(part, matToLocal(part, matP), dir);
  if (!seg) return null;
  const m0 = localToMat(part, seg[0]), m1 = localToMat(part, seg[1]);
  return {
    local: `M ${f4(seg[0][0])} ${f4(seg[0][1])} L ${f4(seg[1][0])} ${f4(seg[1][1])}`,
    mat: `M ${f4(m0[0])} ${f4(m0[1])} L ${f4(m1[0])} ${f4(m1[1])}`,
  };
}

/* ================================================================
   Tool overlay: PUNCH drag-rings, live previews, chip flash
   ================================================================ */
let activeHole = null;

function toolOverlaySvg() {
  let o = '';
  if (ghostPath) o += `<path class="dropghost" d="${esc(ghostPath)}"/>`;
  for (const l of ghostLines) o += `<path class="ghostline" d="${esc(l)}"/>`;
  if (flashGeo) o += `<path class="flashgeo" d="${esc(flashGeo)}"/>`;
  const part = selPart();
  if (verb === 'punch' && part) {
    const px = 1 / (PPI * zoom);
    for (const h of part.holes || []) {
      const c = circleOfEntry(part, h);
      if (!c) continue;
      const id = entryIdOf(h) || '';
      const m = localToMat(part, [c.cx, c.cy]);
      const r = Math.max(c.dia / 2 + 5 * px, 10 * px);
      const act = id === activeHole ? ' act' : '';
      o += `<circle class="ringhit" data-ring="${esc(id)}" cx="${f4(m[0])}" cy="${f4(m[1])}" r="${f4(r)}"/>` +
           `<circle class="ring${act}" data-ring="${esc(id)}" cx="${f4(m[0])}" cy="${f4(m[1])}" r="${f4(r)}"/>` +
           `<circle class="hdot${act}" data-hdot="${esc(id)}" cx="${f4(m[0])}" cy="${f4(m[1])}" r="${f4(4.5 * px)}"/>`;
    }
  }
  return o;
}

function commitEdit(snapshot, changed, note) {
  undoStack.push(snapshot);
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
  afterEdit(changed, note);
}

/* ================================================================
   Verb switching
   ================================================================ */
function setVerb(v) {
  verb = verb === v ? 'select' : v;
  if (verb !== 'fold') { curlOn = false; endCurlLive(); }
  if (verb !== 'punch') { activeHole = null; closePop(); }
  updateVerbUI();
  render();
}

function updateVerbUI() {
  $('#vPunch').classList.toggle('on', verb === 'punch');
  $('#vFold').classList.toggle('on', verb === 'fold');
  $('#vCurl').classList.toggle('on', curlOn);
  $('#curlStep').classList.toggle('hidden', !curlOn);
  $('#curlN').textContent = String(curlCount);
  for (const id of ['#vMove', '#vTurn', '#vSize']) $(id).classList.remove('on');
  if (verb === 'punch') {
    $('#readout').textContent = 'PUNCH — click the part for a hole · drag the blue ring to resize · drag the dot onto a hardware chip';
  } else if (verb === 'fold' && curlOn) {
    $('#readout').textContent = `CURL ×${curlCount} — swipe across the curl; the score lines fan out square to your swipe`;
  } else if (verb === 'fold') {
    $('#readout').textContent = 'FOLD — drag a score line across the part · snaps square within 10°';
  } else {
    $('#readout').textContent = 'the grid is real inches — 1″ squares, heavy every 3″';
  }
}

$('#vPunch').addEventListener('click', () => setVerb('punch'));
$('#vFold').addEventListener('click', () => setVerb('fold'));
$('#vCurl').addEventListener('click', () => {
  if (verb !== 'fold') { verb = 'fold'; curlOn = true; activeHole = null; closePop(); }
  else curlOn = !curlOn;
  if (!curlOn) endCurlLive();
  updateVerbUI();
  render();
});
$('#curlPlus').addEventListener('click', () => setCurlCount(curlCount + 1));
$('#curlMinus').addEventListener('click', () => setCurlCount(curlCount - 1));

/* ================================================================
   PUNCH
   ================================================================ */
const STANDARD_HW = [
  { key: 'dowel', kind: 'dowel', diameterIn: 0.25, lengthIn: 12, short: '¼″ dowel',
    label: '1/4-inch wooden dowel, 12 inches long', source: 'craft store, hardware store, or the garage' },
  { key: 'skewer', kind: 'skewer', diameterIn: 0.125, lengthIn: 12, short: '⅛″ skewer',
    label: '1/8-inch bamboo skewer, 12 inches long', source: 'the kitchen drawer or a grocery store' },
  { key: 'straw', kind: 'straw', diameterIn: 0.28, lengthIn: 8, short: 'straw 0.28″',
    label: 'plastic drinking straw, 8 inches long', source: 'the kitchen drawer' },
  { key: 'string', kind: 'string', lengthIn: 36, short: 'string',
    label: 'cotton string, 3 feet long', source: 'the junk drawer or a craft store' },
  { key: 'brad', kind: 'brad', lengthIn: 0.75, short: 'brad',
    label: 'brass paper fastener (brad), 3/4 inch', source: 'the desk drawer or an office shop' },
  { key: 'rubber-band', kind: 'rubber-band', lengthIn: 3.5, short: 'rubber band',
    label: 'rubber band, 3-1/2 inches around', source: 'the junk drawer' },
  { key: 'paper-clip', kind: 'paper-clip', lengthIn: 2, short: 'large paper clip',
    label: 'large paper clip', source: 'the desk drawer' },
];
const NOMINAL_THICK = { string: 0.05, 'rubber-band': 0.07, 'paper-clip': 0.04, brad: 0.12 };
// chip rows carry `dia`; raw hardware entries carry `diameterIn`
const thickOf = (h) => (h.dia || h.diameterIn || NOMINAL_THICK[h.kind] || 0.08);

// Round hardware the design already carries; when it has none, the standard
// kinds stand in (contract §3).
function fitCandidates() {
  const own = (design.hardware || [])
    .filter((h) => ROUND_KINDS.has(h.kind) && h.diameterIn > 0)
    .map((h) => ({ key: 'own:' + h.id, name: h.label || h.id, dia: h.diameterIn }));
  if (own.length) return own;
  return STANDARD_HW.filter((h) => ROUND_KINDS.has(h.kind))
    .map((h) => ({ key: 'std:' + h.key, name: h.short, dia: h.diameterIn }));
}

const defaultPunchDia = () => {
  const c = fitCandidates()[0];
  return c ? +(c.dia + LOOSE_GAP).toFixed(2) : 0.25;
};

function punchAt(part, matP) {
  const local = matToLocal(part, matP);
  const dia = defaultPunchDia(), r = dia / 2;
  if (!pointInPath(part.path, local)) {
    toast('Punch inside the part — that spot is off the cardboard.', true);
    return;
  }
  const bb = bboxOfPath(part.path);
  if (local[0] - r < bb.minX || local[0] + r > bb.maxX ||
      local[1] - r < bb.minY || local[1] + r > bb.maxY) {
    toast('That is right on the edge — punch a bit further in.', true);
    return;
  }
  const snapshot = clone(design);
  const prev = placement(part);
  const id = nextEntryId(part, 'h');
  part.holes = (part.holes || []).concat([{ id, d: circlePath(local[0], local[1], r) }]);
  preserveWorld(part, prev);
  activeHole = id;
  const idx = design.parts.indexOf(part);
  logOp('punch', part.id, { holeId: id, dia });
  commitEdit(snapshot, [`parts[${idx}].holes[${part.holes.length - 1}]`], `punched ${id}`);
  liveReadout(`PUNCH  Ø ${dia.toFixed(2)} in`);
  openFitChooser(part, id);
}

function openFitChooser(part, holeId, note) {
  const idx = holeIndexById(part, holeId);
  if (idx < 0) return;
  const c = circleOfEntry(part, part.holes[idx]);
  const cands = fitCandidates();
  let html = '<h4>HOW SHOULD IT FIT?</h4>' +
    `<div class="sub">${note ? esc(note) + '<br>' : ''}This hole is Ø ${c.dia.toFixed(2)}″ right now. ` +
    'Pick a fit, or drag the blue ring.</div>';
  for (const cand of cands) {
    const loose = +(cand.dia + LOOSE_GAP).toFixed(2), snug = +(cand.dia + SNUG_GAP).toFixed(2);
    html += `<div class="hwname">${esc(cand.name)} — Ø ${cand.dia.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}″</div>` +
      '<div class="fits">' +
      `<button class="fitchip" data-fit="${f4(loose)}" data-fitname="LOOSE"><b>LOOSE so it spins</b>` +
      `<span class="dia">Ø ${loose.toFixed(2)}″</span></button>` +
      `<button class="fitchip" data-fit="${f4(snug)}" data-fitname="SNUG"><b>SNUG so it grips</b>` +
      `<span class="dia">Ø ${snug.toFixed(2)}″</span></button></div>`;
  }
  const el = openPop(html, () => matToClient(localToMat(part, [c.cx, c.cy])));
  el.addEventListener('click', (ev) => {
    const chip = ev.target.closest('[data-fit]');
    if (!chip) return;
    const dia = Number(chip.getAttribute('data-fit'));
    const name = chip.getAttribute('data-fitname');
    const i2 = holeIndexById(part, holeId);
    if (i2 < 0) return closePop();
    const snapshot = clone(design);
    setHoleDiameter(part, i2, dia);
    logOp('fit', part.id, { holeId, dia });
    const pi = design.parts.indexOf(part);
    commitEdit(snapshot, [`parts[${pi}].holes[${i2}].d`], `${name} — Ø ${dia.toFixed(2)} in`);
    liveReadout(`PUNCH  ${name}  Ø ${dia.toFixed(2)} in`);
    closePop();
  });
}

/* ================================================================
   Popovers
   ================================================================ */
let popEl = null, popAnchor = null;

function closePop() {
  if (popEl) popEl.remove();
  popEl = null; popAnchor = null;
}

function openPop(html, anchor) {
  closePop();
  popEl = document.createElement('div');
  popEl.className = 'pop';
  popEl.innerHTML = html + '<button class="close" data-pop-close title="close">&times;</button>';
  document.body.appendChild(popEl);
  popAnchor = anchor;
  positionPop();
  popEl.addEventListener('click', (ev) => { if (ev.target.closest('[data-pop-close]')) closePop(); });
  return popEl;
}

function positionPop() {
  if (!popEl || !popAnchor) return;
  const [ax, ay] = popAnchor();
  const w = popEl.offsetWidth, h = popEl.offsetHeight;
  let y = ay + 18;
  if (y + h > innerHeight - 8) y = ay - h - 18;
  popEl.style.left = clamp(ax - w / 2, 8, innerWidth - w - 8) + 'px';
  popEl.style.top = clamp(y, 8, innerHeight - h - 8) + 'px';
}
addEventListener('scroll', positionPop, true);

/* ================================================================
   Tool gestures
   ================================================================ */
function toolPointerDown(ev) {
  const part = selPart();
  const grab = ev.target.closest('[data-ring],[data-hdot]');
  if (verb === 'punch' && part && grab) {
    ev.preventDefault();
    svg.setPointerCapture(ev.pointerId);
    const isRing = grab.hasAttribute('data-ring');
    const hid = grab.getAttribute(isRing ? 'data-ring' : 'data-hdot');
    const idx = holeIndexById(part, hid);
    if (idx < 0) return true;
    closePop();
    activeHole = hid;
    drag = {
      tool: isRing ? 'ring' : 'holemove', id: part.id, hid, idx, moved: false,
      snapshot: clone(design), part0: clone(part), start: matPoint(ev),
    };
    render();
    return true;
  }
  const partEl = ev.target.closest('[data-part]');
  if (!partEl) { select(null); return true; }
  const id = partEl.getAttribute('data-part');
  if (verb === 'punch') {
    ev.preventDefault();
    if (id !== selId) select(id);
    punchAt(partById(id), matPoint(ev));
    return true;
  }
  if (verb === 'fold') {
    ev.preventDefault();
    svg.setPointerCapture(ev.pointerId);
    if (id !== selId) select(id);
    endCurlLive();
    const p = matPoint(ev);
    drag = { tool: 'fold', id, p0: p, p1: p, moved: false, snapshot: clone(design) };
    return true;
  }
  return false;
}

function toolPointerMove(ev) {
  const part = partById(drag.id);
  if (!part) return;
  const p = matPoint(ev);
  if (drag.tool === 'ring') {
    const c = circleOfEntry(part, drag.part0.holes[drag.idx]);
    const m = localToMat(part, [c.cx, c.cy]);
    const dia = clamp(Math.round(2 * Math.hypot(p[0] - m[0], p[1] - m[1]) * 100) / 100, 0.06, 4);
    setHoleDiameter(part, drag.idx, dia, drag.part0);
    drag.moved = true; drag.dia = dia;
    liveReadout(`PUNCH  Ø ${dia.toFixed(2)} in`);
    render();
  } else if (drag.tool === 'holemove') {
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const chipEl = under && under.closest ? under.closest('[data-hw]') : null;
    const key = chipEl ? chipEl.getAttribute('data-hw') : null;
    if (key !== hotChipKey) hotChipKey = key;
    if (key) {
      // parked over a hardware chip: the hole stays put, the FIT is the offer
      const home = circleOfEntry(part, drag.part0.holes[drag.idx]);
      setHoleCentre(part, drag.idx, [home.cx, home.cy], drag.part0);
      liveReadout(`PUNCH  drop to re-fit on ${chipEl.getAttribute('data-hwname')}`);
      render();
      return;
    }
    const free = ev.altKey;
    const target = matToLocal(part, [snap(p[0], !free), snap(p[1], !free)]);
    const c0 = circleOfEntry(part, drag.part0.holes[drag.idx]);
    const bb = bboxOfPath(part.path), r = c0.dia / 2;
    if (pointInPath(part.path, target) &&
        target[0] - r >= bb.minX && target[0] + r <= bb.maxX &&
        target[1] - r >= bb.minY && target[1] + r <= bb.maxY) {
      setHoleCentre(part, drag.idx, target, drag.part0);
      drag.moved = true;
    }
    liveReadout(`PUNCH  moving ${drag.hid}`);
    render();
  } else if (drag.tool === 'fold') {
    drag.p1 = p;
    drag.moved = Math.hypot(p[0] - drag.p0[0], p[1] - drag.p0[1]) > 0.12;
    const lines = foldLines(part, drag.p0, drag.p1, curlOn ? curlCount : 1);
    ghostLines = lines.map((l) => l.mat);
    const deg = Math.round(norm180(snapAngle(norm180(
      Math.atan2(drag.p1[1] - drag.p0[1], drag.p1[0] - drag.p0[0]) * 180 / Math.PI))));
    liveReadout(curlOn ? `CURL  ×${curlCount}  (${lines.length} lines fit)` : `FOLD  ${deg}°`);
    render();
  }
}

function endToolDrag(d) {
  ghostLines = [];
  const part = partById(d.id);
  if (!part) { render(); return; }
  const pi = design.parts.indexOf(part);
  if (d.tool === 'ring') {
    if (!d.moved) { render(); return; }
    logOp('fit', part.id, { holeId: d.hid, dia: d.dia });
    commitEdit(d.snapshot, [`parts[${pi}].holes[${d.idx}].d`], `Ø ${d.dia.toFixed(2)} in`);
    openFitChooser(part, d.hid, 'Resized by hand.');
  } else if (d.tool === 'holemove') {
    const chip = hotChipKey;
    hotChipKey = null;
    if (chip) { resnapToHardware(d, part, chip); return; }
    if (!d.moved) { render(); return; }
    logOp('holemove', part.id, { holeId: d.hid });
    commitEdit(d.snapshot, [`parts[${pi}].holes[${d.idx}].d`], `moved ${d.hid}`);
  } else if (d.tool === 'fold') {
    if (!d.moved) { render(); return; }
    commitFold(d, part, pi);
  }
}

// A hole dropped on a hardware chip takes that hardware's fit — nearest band
// edge — and the chooser reopens so the other one is one tap away.
function resnapToHardware(d, part, chipKey) {
  const hw = chipHardware(chipKey);
  if (!hw || !(hw.dia > 0)) { render(); return; }
  const c = circleOfEntry(part, part.holes[d.idx]);
  const loose = +(hw.dia + LOOSE_GAP).toFixed(2), snug = +(hw.dia + SNUG_GAP).toFixed(2);
  const target = Math.abs(c.dia - loose) <= Math.abs(c.dia - snug) ? loose : snug;
  const name = target === loose ? 'LOOSE' : 'SNUG';
  setHoleDiameter(part, d.idx, target);
  logOp('fit', part.id, { holeId: d.hid, dia: target });
  const pi = design.parts.indexOf(part);
  commitEdit(d.snapshot, [`parts[${pi}].holes[${d.idx}].d`], `${name} on ${hw.name} — Ø ${target.toFixed(2)} in`);
  liveReadout(`PUNCH  ${name} on ${hw.name}  Ø ${target.toFixed(2)} in`);
  openFitChooser(part, d.hid, `Snapped ${name} to the ${hw.name}.`);
}

function commitFold(d, part, pi) {
  const count = curlOn ? curlCount : 1;
  const lines = foldLines(part, d.p0, d.p1, count);
  if (!lines.length) {
    toast('That line misses the part — drag right across it.', true);
    render();
    return;
  }
  const prev = placement(part);
  const ids = [];
  part.slits = part.slits || [];
  for (const l of lines) {
    const id = nextEntryId(part, 's');
    ids.push(id);
    part.slits.push({ id, d: l.local });
  }
  preserveWorld(part, prev);
  logOp('fold', part.id, { n: lines.length });
  commitEdit(d.snapshot, [`parts[${pi}].slits`], count > 1 ? `curled ×${lines.length}` : `scored ${ids[0]}`);
  liveReadout(count > 1 ? `CURL  ×${lines.length}` : `FOLD  ${ids[0]}`);
  if (count > 1) {
    curlLive = { partId: part.id, ids, p0: d.p0, p1: d.p1 };
    updateVerbUI();
  }
}

// The CURL stepper keeps editing the fan it just made, until the selection moves on.
function setCurlCount(n) {
  n = clamp(Math.round(n), 2, 24);
  if (n === curlCount && curlLive) return;
  curlCount = n;
  $('#curlN').textContent = String(n);
  if (!curlLive) { updateVerbUI(); return; }
  const part = partById(curlLive.partId);
  if (!part) { curlLive = null; return; }
  const snapshot = clone(design);
  const prev = placement(part);
  part.slits = (part.slits || []).filter((s) => !curlLive.ids.includes(entryIdOf(s)));
  const lines = foldLines(part, curlLive.p0, curlLive.p1, n);
  const ids = [];
  for (const l of lines) {
    const id = nextEntryId(part, 's');
    ids.push(id);
    part.slits.push({ id, d: l.local });
  }
  preserveWorld(part, prev);
  curlLive.ids = ids;
  logOp('fold', part.id, { n: lines.length, curl: true });
  const pi = design.parts.indexOf(part);
  commitEdit(snapshot, [`parts[${pi}].slits`], `curl ×${lines.length}`);
  liveReadout(`CURL  ×${lines.length}`);
  updateVerbUI();
}

function endCurlLive() { curlLive = null; }

/* ================================================================
   Shape Shelf
   ================================================================ */
let starters = null, shelfOK = false;

const STARTERS_FALLBACK = [
  { id: 'panel', name: 'Panel', emoji: '▭', params: [
    { key: 'width', label: 'width', min: 1, max: 20, step: 0.25, default: 6, unit: 'in' },
    { key: 'height', label: 'height', min: 1, max: 20, step: 0.25, default: 4, unit: 'in' },
    { key: 'radius', label: 'corner round', min: 0, max: 1, step: 0.125, default: 0, unit: 'in' }] },
  { id: 'wheel', name: 'Wheel', emoji: '⚪', params: [
    { key: 'diameter', label: 'across', min: 1, max: 8, step: 0.25, default: 4.75, unit: 'in' },
    { key: 'hubHole', label: 'hub hole', min: 0, max: 1, step: 0.01, default: 0.26, unit: 'in' }] },
  { id: 'strip', name: 'Strip', emoji: '≣', params: [
    { key: 'length', label: 'length', min: 2, max: 24, step: 0.25, default: 7.5, unit: 'in' },
    { key: 'width', label: 'width', min: 0.5, max: 4, step: 0.1, default: 2.2, unit: 'in' },
    { key: 'slits', label: 'score lines', min: 0, max: 24, step: 1, default: 10, unit: '' }] },
  { id: 'blade', name: 'Blade', emoji: '🗡', params: [
    { key: 'length', label: 'length', min: 6, max: 30, step: 0.5, default: 16, unit: 'in' },
    { key: 'width', label: 'width', min: 1, max: 4, step: 0.25, default: 2, unit: 'in' }] },
  { id: 'tab', name: 'Glue Tab', emoji: '▱', params: [
    { key: 'width', label: 'width', min: 0.5, max: 3, step: 0.25, default: 1, unit: 'in' },
    { key: 'depth', label: 'depth', min: 0.5, max: 2, step: 0.25, default: 1, unit: 'in' }] },
];

async function loadShelf() {
  try {
    const res = await fetch('/api/shelf');
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length) { starters = list; shelfOK = true; }
    }
  } catch { /* endpoint not up yet */ }
  if (!starters) starters = STARTERS_FALLBACK;
  renderShelf();
}

function renderShelf() {
  $('#shelfRows').innerHTML = (starters || []).map((s) =>
    `<div class="schip" data-starter="${esc(s.id)}" title="drag ${esc(s.name)} onto the mat">` +
    `<span class="gl">${esc(s.emoji || '▭')}</span><span>${esc(s.name)}</span></div>`).join('');
}

const paramDefaults = (st) => Object.fromEntries((st.params || []).map((p) => [p.key, p.default]));

// The server owns starter geometry (contract §2). This local twin is the
// stand-in when /api/shelf/make is unreachable, and reads param keys loosely so
// it still works against the server's own key names.
function localMake(starterId, params) {
  const g = (...keys) => {
    for (const k of keys) if (Number.isFinite(params[k])) return params[k];
    return undefined;
  };
  if (starterId === 'panel') {
    const w = g('width', 'w') ?? 6, h = g('height', 'h') ?? 4, r = g('radius', 'r', 'cornerRadius') ?? 0;
    return { name: `Panel ${w}×${h}`, count: 1, corrugation: 'vertical', holes: [], slits: [],
      path: roundedPoly([[0, 0], [w, 0], [w, h], [0, h]], r) };
  }
  if (starterId === 'wheel') {
    const d = g('diameter', 'dia', 'd') ?? 4.75, hub = g('hubHole', 'hub', 'hole') ?? 0.26;
    const r = d / 2;
    return { name: `Wheel Ø ${d}`, count: 1, corrugation: 'horizontal', slits: [],
      path: circlePath(r, r, r), holes: hub > 0 ? [circlePath(r, r, hub / 2)] : [] };
  }
  if (starterId === 'strip') {
    const L = g('length', 'len', 'l') ?? 7.5, w = g('width', 'w') ?? 2.2;
    const n = Math.round(g('slits', 'count', 'n') ?? 10);
    const slits = [];
    for (let i = 1; i <= n; i++) {
      const x = L * i / (n + 1);
      slits.push(`M ${f4(x)} 0 L ${f4(x)} ${f4(w)}`);
    }
    return { name: `Strip ${L}×${w}`, count: 1, corrugation: 'vertical', holes: [], slits,
      path: roundedPoly([[0, 0], [L, 0], [L, w], [0, w]], 0) };
  }
  if (starterId === 'blade') {
    const L = g('length', 'len', 'l') ?? 16, w = g('width', 'w') ?? 2;
    const path = `M 0 ${f4(L)}` +
      ` C ${f4(0.05 * w)} ${f4(0.58 * L)} ${f4(0.12 * w)} ${f4(0.22 * L)} ${f4(0.30 * w)} ${f4(0.055 * L)}` +
      ` C ${f4(0.38 * w)} ${f4(0.012 * L)} ${f4(0.44 * w)} 0 ${f4(0.5 * w)} 0` +
      ` C ${f4(0.56 * w)} 0 ${f4(0.62 * w)} ${f4(0.012 * L)} ${f4(0.70 * w)} ${f4(0.055 * L)}` +
      ` C ${f4(0.88 * w)} ${f4(0.22 * L)} ${f4(0.95 * w)} ${f4(0.58 * L)} ${f4(w)} ${f4(L)} Z`;
    return { name: `Blade ${L}″`, count: 1, corrugation: 'vertical', holes: [], slits: [], path };
  }
  const w = g('width', 'w') ?? 1, dep = g('depth', 'd', 'depthIn') ?? 1;
  const i = w * 0.18, r = Math.min(0.15, dep * 0.3, i);
  return { name: 'Glue Tab', count: 1, corrugation: 'vertical', holes: [], slits: [],
    path: roundedPoly([[0, 0], [w, 0], [w - i, dep], [i, dep]], [0, 0, r, r]) };
}

async function makeStarterPart(starterId, params) {
  if (shelfOK) {
    try {
      const res = await fetch('/api/shelf/make', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ starter: starterId, params }),
      });
      if (res.ok) {
        const body = await res.json();
        if (body && body.part && typeof body.part.path === 'string') return body.part;
      }
    } catch { /* fall through to the local twin */ }
  }
  return localMake(starterId, params);
}

let ghostHalfH = 0;
function ghostFor(made, centre) {
  const bb = partBBox(made);
  if (!bb) return null;
  ghostHalfH = bb.height / 2;
  const dx = centre[0] - (bb.minX + bb.width / 2), dy = centre[1] - (bb.minY + bb.height / 2);
  const f = (x, y) => [x + dx, y + dy];
  return [made.path, ...holePaths(made)].map((d) => mapPath(d, f)).join(' ');
}

let shelfDrag = null;

$('#shelfRows').addEventListener('pointerdown', (ev) => {
  const chip = ev.target.closest('[data-starter]');
  if (!chip || locked) return;
  ev.preventDefault();
  const st = (starters || []).find((s) => s.id === chip.getAttribute('data-starter'));
  if (!st) return;
  closePop();
  chip.setPointerCapture(ev.pointerId);
  chip.classList.add('dragging');
  const params = paramDefaults(st);
  shelfDrag = { st, params, made: localMake(st.id, params), at: null };
  makeStarterPart(st.id, params).then((p) => { if (shelfDrag && shelfDrag.st === st) shelfDrag.made = p; });
  const dg = $('#dragGhost');
  dg.textContent = st.name;
  dg.style.display = 'block';

  const move = (e) => {
    dg.style.left = (e.clientX + 14) + 'px';
    dg.style.top = (e.clientY + 14) + 'px';
    const r = svg.getBoundingClientRect();
    const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    shelfDrag.at = over ? [snap(matPoint(e)[0]), snap(matPoint(e)[1])] : null;
    ghostPath = shelfDrag.at ? ghostFor(shelfDrag.made, shelfDrag.at) : null;
    render();
  };
  const up = (e) => {
    chip.removeEventListener('pointermove', move);
    chip.removeEventListener('pointerup', up);
    chip.removeEventListener('pointercancel', up);
    chip.classList.remove('dragging');
    dg.style.display = 'none';
    const at = shelfDrag && shelfDrag.at;
    if (at) openDialPop(st, shelfDrag.params, at);
    else { ghostPath = null; shelfDrag = null; render(); }
  };
  chip.addEventListener('pointermove', move);
  chip.addEventListener('pointerup', up);
  chip.addEventListener('pointercancel', up);
});

// Dials live at creation time only (DESIGN §2.1): they compile straight to a
// plain path and the dial state is thrown away.
function openDialPop(st, params, at) {
  let html = `<h4>${esc((st.name || '').toUpperCase())}</h4>` +
    '<div class="sub">Turn the dials — the dashed ghost is what lands on the mat.</div>';
  for (const p of st.params || []) {
    html += `<div class="dial" data-key="${esc(p.key)}"><div class="dl"><span>${esc(p.label || p.key)}</span>` +
      `<b data-val="${esc(p.key)}">${params[p.key]}${p.unit ? ' ' + esc(p.unit) : ''}</b></div>` +
      `<input type="range" data-dial="${esc(p.key)}" min="${p.min}" max="${p.max}" ` +
      `step="${p.step}" value="${params[p.key]}"></div>`;
  }
  html += '<div class="row"><button data-add>Add to the mat</button>' +
    '<button class="ghost" data-cancel>Cancel</button></div>';
  // anchored under the ghost's bottom edge, so the shape it describes stays visible
  const el = openPop(html, () => matToClient([at[0], at[1] + ghostHalfH]));
  let token = 0;
  const repaint = async () => {
    const mine = ++token;
    const made = await makeStarterPart(st.id, params);
    if (mine !== token) return;
    if (shelfDrag) shelfDrag.made = made;
    ghostPath = ghostFor(made, at);
    render();
  };
  el.addEventListener('input', (ev) => {
    const inp = ev.target.closest('[data-dial]');
    if (!inp) return;
    const key = inp.getAttribute('data-dial');
    params[key] = Number(inp.value);
    const spec = (st.params || []).find((p) => p.key === key) || {};
    el.querySelector(`[data-val="${CSS.escape(key)}"]`).textContent =
      params[key] + (spec.unit ? ' ' + spec.unit : '');
    ghostPath = ghostFor(localMake(st.id, params), at);   // instant
    render();
    positionPop();
    repaint();                                            // then the server's own
  });
  el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-cancel]')) {
      ghostPath = null; shelfDrag = null; closePop(); render(); return;
    }
    if (ev.target.closest('[data-add]')) {
      closePop();
      insertStarter(st, params, at);
    }
  });
  repaint();
}

const slugifyId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';

function uniqueId(base) {
  const used = new Set((design.parts || []).map((p) => p.id));
  if (!used.has(base)) return base;
  for (let i = 2; i < 500; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

async function insertStarter(st, params, at) {
  const made = await makeStarterPart(st.id, params);
  const snapshot = clone(design);
  const part = {
    id: uniqueId(slugifyId(st.id)),
    name: made.name || st.name,
    count: Number.isInteger(made.count) ? made.count : 1,
    path: made.path,
    holes: (made.holes || []).map((h, i) => ({ id: 'h' + (i + 1), d: dOf(h) })),
    slits: (made.slits || []).map((s, i) => ({ id: 's' + (i + 1), d: dOf(s) })),
    corrugation: made.corrugation || 'vertical',
  };
  const names = new Set((design.parts || []).map((p) => p.name));
  if (names.has(part.name)) {
    let n = 2;
    while (names.has(`${part.name} ${n}`)) n++;
    part.name = `${part.name} ${n}`;
  }
  const bb = partBBox(part) || { width: 1, height: 1 };
  part.layout = {
    x: +Math.max(0, snap(at[0] - bb.width / 2)).toFixed(4),
    y: +Math.max(0, snap(at[1] - bb.height / 2)).toFixed(4),
    rotDeg: 0,
  };
  design.parts.push(part);
  ghostPath = null;
  shelfDrag = null;
  selId = part.id;
  logOp('add-part', part.id, { starter: st.name });
  commitEdit(snapshot, [`parts[${design.parts.length - 1}]`], `added ${part.name}`);
  toast(`${part.name} is on the mat — drag it, size it, print it.`);
}

/* ================================================================
   Hardware tray — chips drawn to TRUE SCALE at the mat's zoom
   ================================================================ */
function hardwareChips() {
  const own = (design.hardware || []).map((h) => ({
    key: 'own:' + h.id, name: h.label || h.id, short: h.id, kind: h.kind,
    dia: h.diameterIn, len: h.lengthIn, own: true,
  }));
  const haveKind = new Set(own.map((o) => o.kind));
  const std = STANDARD_HW.filter((s) => !haveKind.has(s.kind)).map((s) => ({
    key: 'std:' + s.key, name: s.short, short: s.short, kind: s.kind,
    dia: s.diameterIn, len: s.lengthIn, own: false, std: s,
  }));
  return own.concat(std);
}

const chipHardware = (key) => hardwareChips().find((c) => c.key === key);

function renderHardware() {
  const W = 196;
  $('#hwRows').innerHTML = hardwareChips().map((c) => {
    const thick = Math.max(1.5, thickOf(c) * PPI * zoom);
    const H = Math.max(16, thick + 8);
    const cy = H / 2, r = thick / 2;
    const barX = c.dia ? thick + 5 : 4;
    const barW = Math.max(10, Math.min(W - barX - 4, (c.len || 3) * PPI * zoom));
    const wood = c.kind === 'straw' ? '#E8E3DA' : c.kind === 'string' ? '#D8CDBB'
      : c.kind === 'rubber-band' ? '#C9A0B4' : c.kind === 'brad' || c.kind === 'paper-clip' ? '#C8CCD1' : '#D9C29A';
    let art = `<svg class="art" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    if (c.dia) art += `<circle cx="${(4 + r).toFixed(1)}" cy="${cy}" r="${r.toFixed(2)}" fill="${wood}" stroke="#9E8261"/>`;
    art += `<rect x="${barX}" y="${(cy - thick / 2).toFixed(2)}" width="${barW.toFixed(1)}" ` +
      `height="${thick.toFixed(2)}" rx="${Math.min(thick / 2, 3).toFixed(2)}" fill="${wood}" stroke="#9E8261"/></svg>`;
    return `<div class="hwchip${c.own ? ' mine' : ''}${hotChipKey === c.key ? ' hot' : ''}" ` +
      `data-hw="${esc(c.key)}" data-hwname="${esc(c.short)}" ` +
      `title="${esc(c.name)}${c.dia ? ` — Ø ${c.dia}″` : ''} · drawn true scale">` +
      `<div class="lab"><b>${esc(c.short)}</b><span>${c.dia ? 'Ø ' + c.dia + '″' : (c.own ? 'in design' : 'drag in')}</span></div>` +
      art + '</div>';
  }).join('');
}

// Dragging a standard chip onto the design adds the hardware[] entry.
$('#hwRows').addEventListener('pointerdown', (ev) => {
  const chip = ev.target.closest('[data-hw]');
  if (!chip || locked) return;
  const c = chipHardware(chip.getAttribute('data-hw'));
  if (!c || c.own) return;                      // already in the design
  ev.preventDefault();
  chip.setPointerCapture(ev.pointerId);
  const dg = $('#dragGhost');
  dg.textContent = c.short;
  dg.style.display = 'block';
  let moved = false;
  const move = (e) => {
    moved = true;
    dg.style.left = (e.clientX + 14) + 'px';
    dg.style.top = (e.clientY + 14) + 'px';
  };
  const up = (e) => {
    chip.removeEventListener('pointermove', move);
    chip.removeEventListener('pointerup', up);
    chip.removeEventListener('pointercancel', up);
    dg.style.display = 'none';
    if (!moved) return;
    const r = svg.getBoundingClientRect();
    const onMat = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    const inTray = !!(document.elementFromPoint(e.clientX, e.clientY) || {}).closest?.('#tray');
    if (onMat || inTray) addHardware(c.std);
  };
  chip.addEventListener('pointermove', move);
  chip.addEventListener('pointerup', up);
  chip.addEventListener('pointercancel', up);
});

function addHardware(std) {
  if (!std) return;
  const snapshot = clone(design);
  design.hardware = design.hardware || [];
  const used = new Set(design.hardware.map((h) => h.id));
  let id = std.kind;
  for (let i = 2; used.has(id); i++) id = `${std.kind}-${i}`;
  const entry = { id, kind: std.kind, count: 1, label: std.label, source: std.source };
  if (std.diameterIn) entry.diameterIn = std.diameterIn;
  if (std.lengthIn) entry.lengthIn = std.lengthIn;
  design.hardware.push(entry);
  logOp('hardware', null, { name: std.short });
  commitEdit(snapshot, [`hardware[${design.hardware.length - 1}]`], `added ${std.short}`);
  toast(`${std.label} — added to WHAT YOU NEED.`);
}

/* ================================================================
   Toy Doctor strip
   ================================================================ */
function normalizeFinding(f) {
  if (!f || typeof f !== 'object' || typeof f.message !== 'string') return null;
  return {
    level: f.level === 'error' ? 'error' : 'warn',
    code: f.code || 'other',
    message: f.message,
    anchor: f.anchor || {},
    fix: f.fix && f.fix.patch ? f.fix : null,
  };
}

// Stand-in for structured findings: the linter's sentences already name the
// part, the hole and (for fits) the target diameter, so they parse cleanly.
function deriveFindings(errors, warnings) {
  const one = (message, level) => {
    const f = { level, code: 'other', message, anchor: {}, fix: null };
    const hole = message.match(/hole (?:"([^"]+)"|\[(\d+)\]|(\d+)) of "([^"]+)"/);
    if (hole) {
      f.anchor.part = hole[4];
      f.anchor.holeId = hole[1] || null;
      f.anchor.holeIdx = hole[2] != null ? +hole[2] : (hole[3] != null ? +hole[3] : null);
    } else {
      const p = message.match(/^parts\[\d+\] \(([^)]+)\)/) || message.match(/part "([^"]+)"/);
      if (p) f.anchor.part = p[1];
    }
    if (/BEARING FIT/.test(message)) f.code = 'bearing-fit';
    else if (/HUB FIT/.test(message)) f.code = 'hub-fit';
    else if (/BEARING LENGTH/.test(message)) f.code = 'bearing-length';
    else if (/positional reference/.test(message)) f.code = 'positional-ref';
    else if (/overlap/.test(message)) f.code = 'overlap';
    else if (/durability|laminate/.test(message)) f.code = 'durability';
    else if (/bend score/.test(message)) f.code = 'bend-scores';
    const rz = message.match(/Resize the hole to Ø ([\d.]+)"/);
    if (rz && f.anchor.part) {
      f.fix = { label: `Resize to Ø ${rz[1]}″`,
        patch: { op: 'set-hole-diameter', part: f.anchor.part, holeId: f.anchor.holeId,
                 holeIdx: f.anchor.holeIdx, diameterIn: +rz[1] } };
    }
    return f;
  };
  return errors.map((m) => one(m, 'error')).concat(warnings.map((m) => one(m, 'warn')));
}

function takeFindings(body, errors, warnings) {
  const server = Array.isArray(body && body.findings)
    ? body.findings.map(normalizeFinding).filter(Boolean) : null;
  const list = server && server.length ? server : deriveFindings(errors, warnings);
  doctorReady = true;
  const seen = new Set();
  findings = [];
  for (const f of list) {
    const k = f.level + '|' + f.message;
    if (seen.has(k)) continue;
    seen.add(k);
    findings.push(f);
  }
  // errors first, and inside that the mechanism rules before the declarative
  // fitChecks — when both describe one hole, the axle rule is the one to obey.
  const rank = (f) => (f.level === 'error' ? 0 : 10) +
    ({ 'bearing-fit': 0, 'hub-fit': 0, 'bearing-length': 1, 'axle-budget': 1 }[f.code] ?? 2);
  findings.sort((a, b) => rank(a) - rank(b));
  renderDoctor();
}

const partLabel = (id) => {
  const p = partById(id);
  return p ? (p.name || p.id) : id;
};

let doctorReady = false;

function renderDoctor() {
  const el = $('#docChips');
  if (!findings.length) {
    const msg = doctorReady ? 'Every toy check passes — nothing to fix.'
      : mock ? 'The Toy Doctor needs the draft endpoint — it is not up yet.'
      : 'Checking the toy…';
    el.innerHTML = `<span class="dchip none"><span class="dot"></span><span class="msg">${esc(msg)}</span></span>`;
    return;
  }
  el.innerHTML = findings.map((f, i) => {
    const cls = f.level === 'error' ? 'err' : 'warn';
    const who = f.anchor && f.anchor.part
      ? partLabel(f.anchor.part) + (f.anchor.holeId ? ' · ' + f.anchor.holeId : '') : '';
    return `<button class="dchip ${cls}" data-fi="${i}" title="${esc(f.message)}">` +
      '<span class="dot"></span><span class="msg">' +
      (who ? `<span class="who">${esc(who)}</span> — ` : '') + esc(f.message) + '</span>' +
      // no deterministic fix → the other door: hand the shop rule to Claude
      (f.fix ? `<span class="fix" data-fix="${i}">${esc(f.fix.label || 'FIX')}</span>`
             : `<span class="ask" data-ask="${i}" title="Put this in the chat box for Claude">ASK CLAUDE</span>`) +
      '</button>';
  }).join('');
}

$('#docChips').addEventListener('click', (ev) => {
  const fixEl = ev.target.closest('[data-fix]');
  if (fixEl) { ev.stopPropagation(); applyFinding(findings[+fixEl.getAttribute('data-fix')]); return; }
  const askEl = ev.target.closest('[data-ask]');
  if (askEl) { ev.stopPropagation(); askClaudeAbout(findings[+askEl.getAttribute('data-ask')]); return; }
  const chip = ev.target.closest('[data-fi]');
  if (chip) zoomToFinding(findings[+chip.getAttribute('data-fi')]);
});

function anchorIndex(part, anchor, key) {
  const list = part[key] || [];
  if (key === 'holes' && anchor.holeId) {
    const i = list.findIndex((h) => entryIdOf(h) === anchor.holeId);
    if (i >= 0) return i;
  }
  if (key === 'slits' && anchor.slitId) {
    const i = list.findIndex((s) => entryIdOf(s) === anchor.slitId);
    if (i >= 0) return i;
  }
  if (key === 'holes' && Number.isInteger(anchor.holeIdx) && list[anchor.holeIdx]) return anchor.holeIdx;
  return -1;
}

function zoomToFinding(f) {
  if (!f || !f.anchor || !f.anchor.part) return;
  const part = partById(f.anchor.part);
  if (!part) return;
  closePop();
  const hi = anchorIndex(part, f.anchor, 'holes');
  const si = anchorIndex(part, f.anchor, 'slits');
  const d = hi >= 0 ? dOf(part.holes[hi]) : si >= 0 ? dOf(part.slits[si]) : part.path;
  select(part.id);
  if (!zoomToMatPath(mapPath(d, (x, y) => localToMat(part, [x, y])))) return;
  setStatus(f.message, f.level === 'error' ? 'err' : 'warn');
}

// Pan+zoom the mat onto one piece of geometry (already in mat space) and flash
// it. Shared by the Toy Doctor chips (M2) and the compare labels (M3 §4).
function zoomToMatPath(md) {
  const bb = pathBBox(md);
  if (!bb) return false;
  const scroller = $('#matScroll');
  const want = Math.max(bb.width, bb.height, 0.2) + 2;
  zoom = clamp(Math.min(scroller.clientWidth - 40, scroller.clientHeight - 40) / (want * PPI), 0.15, 4);
  flashGeo = md;
  render();
  scroller.scrollLeft = ((bb.minX + bb.maxX) / 2 - matBox.minX) / matBox.w * svg.clientWidth - scroller.clientWidth / 2;
  scroller.scrollTop = ((bb.minY + bb.maxY) / 2 - matBox.minY) / matBox.h * svg.clientHeight - scroller.clientHeight / 2;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashGeo = null; render(); }, 2400);
  return true;
}

// One tap, deterministic, visible: the patch runs locally, snapshots undo and
// PUTs — the same door every other edit goes through.
function applyFinding(f) {
  if (!f || !f.fix || !f.fix.patch) return;
  // Compare and Review are read-only views; a fix here would edit the ghost or
  // the proposal instead of the kid's design.
  if (locked) { setStatus(review ? 'finish reviewing Claude’s idea first'
                                 : 'editing is locked while you compare — Exit first', 'warn'); return; }
  closePop();
  const p = f.fix.patch;
  const snapshot = clone(design);
  let changed = null, note = '';
  if (p.op === 'set-hole-diameter') {
    const part = partById(p.part);
    if (!part) return;
    const idx = anchorIndex(part, { holeId: p.holeId, holeIdx: p.holeIdx }, 'holes');
    if (idx < 0) { toast('That hole is gone — nothing to fix.', true); return; }
    setHoleDiameter(part, idx, p.diameterIn);
    const pi = design.parts.indexOf(part);
    changed = [`parts[${pi}].holes[${idx}].d`];
    note = `fixed — Ø ${p.diameterIn}″`;
    select(part.id);
    flashGeo = mapPath(dOf(part.holes[idx]), (x, y) => localToMat(part, [x, y]));
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashGeo = null; render(); }, 2400);
  } else if (p.op === 'set-hardware-length') {
    const hw = (design.hardware || []).find((h) => h.id === p.hardware);
    if (!hw) return;
    hw.lengthIn = p.lengthIn;
    // the label IS the shopping-list line the guide prints — a fix that leaves
    // it saying "7.5 inches long" would send the kid to the shop for the wrong stick
    if (typeof hw.label === 'string') {
      hw.label = hw.label.replace(/(\d+(?:[./]\d+)?)(\s*)(inch|inches|in\.?)(\s+long)/i,
        (m, _n, sp, unit, tail) => `${p.lengthIn}${sp}${unit}${tail}`);
    }
    changed = [`hardware[${design.hardware.indexOf(hw)}].lengthIn`];
    note = `fixed — ${p.lengthIn}″ long`;
  } else {
    toast('That fix is not one the Mat can apply yet.', true);
    return;
  }
  logOp('fix', p.part || null, { code: f.code });
  commitEdit(snapshot, changed, note);
  liveReadout(`FIX  ${note}`);
}

/* ================================================================
   M3 — HISTORY: checkpoints, the dot strip, restore, ghost-diff
   ----------------------------------------------------------------
   The strip reflects GET /checkpoints; a dot is a full immutable snapshot the
   server owns. Nothing here ever rewinds the log: restore APPENDS, compare only
   reads. Checkpoints are written on a pause after real mutations, on SAVE, on
   PRINT and on pagehide (beacon) — never twice for zero intervening edits.
   ================================================================ */
const CP_URL = () => `/api/designs/${encodeURIComponent(slug)}/checkpoints`;

// 45s of quiet is the shipping trigger; ?fastcp=1 (or ?fastcp=<ms>) shortens it
// so an acceptance run does not have to sit through three quarters of a minute.
const CP_FAST = new URLSearchParams(location.search).get('fastcp');
const CP_DEBOUNCE = CP_FAST ? Math.max(200, Number(CP_FAST) > 1 ? Number(CP_FAST) : 1500) : 45000;

let checkpoints = [];        // [{ id, author, summary, ts, base }] — chronological
let histMode = 'boot';       // 'live' (Builder A is up) | 'mock' (local stand-in)
let opLog = [];              // mutations since the last checkpoint
let cpBase = null;           // the document AS OF that checkpoint — quantities measure against it
let cpTimer = null, cpBusy = false, histProbe = null;
let cmp = null;              // compare mode: { id, summary, ts, changes, old, ghostParts, ... }
let locked = false;          // editing lock while comparing
const mockCps = [];          // stand-in store until the checkpoint endpoints answer

/* ---------------- relative + absolute time ---------------- */
function relTime(ts) {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 5400) return 'an hour ago';
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  if (s < 172800) return 'yesterday';
  return `${Math.round(s / 86400)} days ago`;
}
const absTime = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(+d) ? '' : d.toLocaleString(undefined,
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const authorName = (a) => (a === 'claude' ? 'Claude' : 'you');

/* ---------------- the strip ---------------- */
function renderHistory() {
  const el = $('#histDots');
  const dots = checkpoints.map((c, i) => {
    const cls = (c.author === 'claude' ? 'claude' : 'you') + (cmp && cmp.id === c.id ? ' base' : '');
    return (i ? '<span class="cprail"></span>' : '') +
      `<button class="cpdot ${cls}" data-cp="${esc(c.id)}" ` +
      `title="${esc(c.summary)} · ${esc(relTime(c.ts))}" ` +
      `aria-label="${esc(authorName(c.author))}: ${esc(c.summary)}"></button>`;
  }).join('');
  el.innerHTML = dots + (checkpoints.length ? '<span class="cprail"></span>' : '') +
    '<span class="cpdot now" data-cp="now" title="now — the draft you are editing"></span>';
  $('#histNote').textContent = histMode === 'mock'
    ? 'local history — the checkpoint endpoint is not up yet'
    : checkpoints.length ? '' : 'edit something — a dot lands here when you pause';
  el.scrollLeft = el.scrollWidth;              // newest always visible
}

// Hover tooltip: `summary · relative time` (a real element, so it also shows in
// a screenshot — a native title never does).
$('#histDots').addEventListener('pointerover', (ev) => {
  const dot = ev.target.closest('[data-cp]');
  const tip = $('#cpTip');
  if (!dot || popEl) { tip.style.display = 'none'; return; }
  const id = dot.getAttribute('data-cp');
  const c = checkpoints.find((k) => k.id === id);
  tip.textContent = c ? `${c.summary} · ${relTime(c.ts)}` : 'now — the draft you are editing';
  tip.style.display = 'block';
  const r = dot.getBoundingClientRect();
  tip.style.left = clamp(r.left + r.width / 2 - tip.offsetWidth / 2, 8, innerWidth - tip.offsetWidth - 8) + 'px';
  tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + 'px';
});
$('#histDots').addEventListener('pointerout', (ev) => {
  if (!ev.relatedTarget || !ev.relatedTarget.closest || !ev.relatedTarget.closest('#histDots')) {
    $('#cpTip').style.display = 'none';
  }
});

$('#histDots').addEventListener('click', (ev) => {
  const dot = ev.target.closest('[data-cp]');
  if (!dot) return;
  const c = checkpoints.find((k) => k.id === dot.getAttribute('data-cp'));
  if (!c) return;
  if (review) { setStatus('finish reviewing Claude’s idea first', 'warn'); return; }
  // Clicking another dot while comparing re-bases the comparison onto it.
  if (cmp && c.id !== cmp.id) { startCompare(c); return; }
  openCpPop(c, dot);
});

function openCpPop(c, dot) {
  $('#cpTip').style.display = 'none';        // the popover says it all — no hover tip on top
  const colour = c.author === 'claude' ? 'var(--crimson)' : 'var(--kraft-dark)';
  const html = '<h4>CHECKPOINT</h4>' +
    `<div style="font-size:13.5px;font-weight:700;line-height:1.35">${esc(c.summary)}</div>` +
    `<div class="who"><i style="background:${colour}"></i>${esc(authorName(c.author))}</div>` +
    `<div class="meta">${esc(absTime(c.ts))} · ${esc(relTime(c.ts))}</div>` +
    '<div class="row"><button data-restore>Restore</button>' +
    '<button class="ghost" data-compare>Compare</button></div>';
  // sits ABOVE the strip: a popover that covered the dots would hide the very
  // thing you clicked (and the neighbour you might click next)
  const el = openPop(html, () => {
    const r = dot.getBoundingClientRect();
    return [r.left + r.width / 2, r.top - (popEl ? popEl.offsetHeight : 150) - 26];
  });
  el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-restore]')) restoreCheckpoint(c);
    else if (ev.target.closest('[data-compare]')) startCompare(c);
  });
}

/* ---------------- loading + endpoint discovery ---------------- */
async function loadCheckpoints() {
  if (histMode === 'mock') {
    checkpoints = mockCps.map(({ design: _d, ...meta }) => meta);
    renderHistory();
    return;
  }
  try {
    const res = await fetch(CP_URL());
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      checkpoints = Array.isArray(body.checkpoints) ? body.checkpoints : [];
      histMode = 'live';
      renderHistory();
      return;
    }
  } catch { /* endpoint not up yet */ }
  goMock();
}

// Builder A's endpoints may land mid-session; keep knocking and switch over.
function goMock() {
  if (histMode !== 'mock') {
    histMode = 'mock';
    if (!histProbe) histProbe = setInterval(probeLive, 15000);
  }
  checkpoints = mockCps.map(({ design: _d, ...meta }) => meta);
  renderHistory();
}

async function probeLive() {
  try {
    const res = await fetch(CP_URL());
    if (!res.ok) return;
    clearInterval(histProbe); histProbe = null;
    histMode = 'live';
    mockCps.length = 0;
    await loadCheckpoints();
    setStatus('history is live');
  } catch { /* still down */ }
}

/* ---------------- the op log → kid-language summaries ---------------- */
const OP_RANK = { 'add-part': 0, punch: 1, fold: 2, size: 3, fit: 4, holemove: 5,
                  turn: 6, move: 7, copies: 8, hardware: 9, fix: 10, undo: 11, redo: 11 };

function logOp(kind, partId, extra) {
  if (locked) return;                       // compare mode cannot mutate anything
  opLog.push({ kind, partId: partId || null, ...(extra || {}) });
  if (!cpBase) cpBase = clone(design);
  clearTimeout(cpTimer);
  cpTimer = setTimeout(() => { writeCheckpoint(); }, CP_DEBOUNCE);
}

const fmtIn = (v) => String(Math.round(v * 100) / 100);
const baseOf = (id) => (cpBase && (cpBase.parts || []).find((p) => p.id === id)) || null;
const nameOf = (p, fallback) => (p ? (p.name || p.id) : fallback || 'a part');
const diaOfHole = (part, holeId) => {
  const h = (part && part.holes || []).find((e) => entryIdOf(e) === holeId) || (part && (part.holes || [])[(part.holes || []).length - 1]);
  const c = part && h ? circleOfEntry(part, h) : null;
  return c ? c.dia : null;
};

// One group of same-kind ops on one part → one sentence a kid would say.
function phraseOp(g) {
  const now = g.partId ? partById(g.partId) : null;
  const was = g.partId ? baseOf(g.partId) : null;
  const nm = nameOf(now || was, g.name);
  switch (g.kind) {
    case 'add-part':
      return `Added a ${g.last.starter || nm} from the Shelf`;
    case 'punch': {
      const added = ((now && now.holes) || []).length - ((was && was.holes) || []).length;
      if (added > 1) return `Punched ${added} new holes in ${nm}`;
      const dia = diaOfHole(now, g.last.holeId);
      return dia ? `Punched Ø ${dia.toFixed(2)}" hole in ${nm}` : `Punched a hole in ${nm}`;
    }
    case 'fit': {
      const dia = g.last.dia || diaOfHole(now, g.last.holeId);
      return dia ? `Resized a hole in ${nm} to Ø ${Number(dia).toFixed(2)}"` : `Resized a hole in ${nm}`;
    }
    case 'fold': {
      const added = ((now && now.slits) || []).length - ((was && was.slits) || []).length;
      if (added === 1) return `New score line on ${nm}`;
      if (added > 1) return `${added} new score lines on ${nm}`;
      return `Score lines on ${nm} are now ${((now && now.slits) || []).length}`;
    }
    case 'size': {
      const a = was && partBBox(was), b = now && partBBox(now);
      if (!a || !b) return `Resized ${nm}`;
      const dw = b.width - a.width, dh = b.height - a.height;
      if (Math.abs(dh) >= Math.abs(dw) && Math.abs(dh) > 0.05) {
        return dh > 0 ? `Stretched ${nm} ${fmtIn(dh)}" longer` : `Trimmed ${nm} ${fmtIn(-dh)}" shorter`;
      }
      if (Math.abs(dw) > 0.05) {
        return dw > 0 ? `Widened ${nm} by ${fmtIn(dw)}"` : `Slimmed ${nm} by ${fmtIn(-dw)}"`;
      }
      return `Resized ${nm} to ${fmtIn(b.width)}×${fmtIn(b.height)}"`;
    }
    case 'turn': {
      const d = norm180(layoutOf(now || {}).rot - (was ? layoutOf(was).rot : 0));
      return `Turned ${nm} ${Math.abs(Math.round(d))}°`;
    }
    case 'move': {
      if (!now || !was) return `Moved ${nm}`;
      const a = layoutOf(was), b = layoutOf(now);
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02) return `Nudged ${nm}`;
      return Math.abs(dx) >= Math.abs(dy)
        ? `Moved ${nm} ${fmtIn(Math.abs(dx))}" ${dx > 0 ? 'right' : 'left'}`
        : `Moved ${nm} ${fmtIn(Math.abs(dy))}" ${dy > 0 ? 'down' : 'up'}`;
    }
    case 'copies':
      return `Made ${(now && now.count) || 1} copies of ${nm}`;
    case 'hardware':
      return `Added a ${g.last.name || 'part'} to what you need`;
    case 'fix':
      return now ? `Toy Doctor fixed ${nm}` : 'Took the Toy Doctor’s fix';
    case 'holemove':
      return `Moved a hole on ${nm}`;
    case 'undo': return 'Stepped back a change';
    case 'redo': return 'Put a change back';
    default: return `Changed ${nm}`;
  }
}

// Most significant first, the rest counted: "Punched Ø 0.26" hole in Lid Wrap +2 more".
function summarizePending() {
  if (!opLog.length) return null;
  const groups = [], byKey = new Map();
  for (const op of opLog) {
    const key = op.kind + '|' + (op.partId || '');
    let g = byKey.get(key);
    if (!g) { g = { kind: op.kind, partId: op.partId, n: 0, last: op }; byKey.set(key, g); groups.push(g); }
    g.n++; g.last = op;
  }
  groups.sort((a, b) => (OP_RANK[a.kind] ?? 20) - (OP_RANK[b.kind] ?? 20));
  let head = phraseOp(groups[0]) || 'Tinkered with the design';
  const more = groups.length - 1;
  const tail = more > 0 ? ` +${more} more` : '';
  if (head.length + tail.length > 62) head = head.slice(0, 59 - tail.length).trimEnd() + '…';
  return head + tail;
}

/* ---------------- writing a checkpoint ---------------- */
async function writeCheckpoint(suffix = '') {
  clearTimeout(cpTimer);
  if (!opLog.length || cpBusy || locked) return null;   // never two for zero mutations
  const summary = (summarizePending() || 'Tinkered with the design') + suffix;
  if (mock) return null;                                 // no draft endpoints at all
  if (findings.some((f) => f.level === 'error')) {
    setStatus('checkpoint held — the Toy Doctor found a problem', 'warn');
    return null;                                         // never persist a broken snapshot
  }
  cpBusy = true;
  try {
    if (histMode !== 'live') {
      mockCps.push({
        id: 'cp-' + (mockCps.length + 1), author: 'you', summary,
        ts: new Date().toISOString(), base: mockCps.length ? 'cp-' + mockCps.length : null,
        design: clone(design),
      });
    } else {
      if (!(await flushDraft())) {                       // checkpoint what the server validated
        setStatus('checkpoint held — the draft did not go through', 'warn');
        return null;
      }
      const res = await fetch(CP_URL(), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ author: 'you', summary, design }),
      });
      if (!res.ok) {
        setStatus('could not write a checkpoint', 'warn');
        return null;
      }
      await res.json().catch(() => ({}));
    }
    opLog = [];
    cpBase = clone(design);
    await loadCheckpoints();
    setStatus('checkpoint · ' + summary);
    return summary;
  } catch {
    setStatus('could not write a checkpoint', 'warn');
    return null;
  } finally {
    cpBusy = false;
  }
}

// Closing the tab is a pause like any other — best-effort, no response to read.
addEventListener('pagehide', () => {
  if (!opLog.length || mock || histMode !== 'live') return;
  try {
    const body = JSON.stringify({ author: 'you', summary: summarizePending(), design });
    navigator.sendBeacon(CP_URL(), new Blob([body], { type: 'application/json' }));
    opLog = [];
  } catch { /* best effort */ }
});

/* ---------------- restore (append-only: the strip only grows) ---------------- */
async function restoreCheckpoint(c) {
  closePop();
  if (cmp) exitCompare();
  if (histMode !== 'live') {
    const rec = mockCps.find((k) => k.id === c.id);
    if (!rec) return;
    applyRestored(clone(rec.design), null, null, true);
    mockCps.push({
      id: 'cp-' + (mockCps.length + 1), author: 'you', summary: `restored "${c.summary}"`,
      ts: new Date().toISOString(), base: c.id, design: clone(rec.design),
    });
    await loadCheckpoints();
    toast(`Back to “${c.summary}”. Cmd-Z steps back across it if you change your mind.`);
    return;
  }
  setStatus('restoring…');
  try {
    const res = await fetch(`/api/designs/${encodeURIComponent(slug)}/draft/restore`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkpoint: c.id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.design) {
      toast('Could not restore: ' + ((body.errors || [])[0] || body.error || res.status), true);
      return;
    }
    applyRestored(body.design, body.rev, body, false);
    await loadCheckpoints();
    toast(`Back to “${c.summary}”. Cmd-Z steps back across it if you change your mind.`);
  } catch (err) {
    toast('Could not restore: ' + err.message, true);
  }
}

// The restore rides the ONE undo stack: the pre-restore document goes on it, so
// Cmd-Z steps back across the restore exactly like any other edit.
function applyRestored(nextDesign, nextRev, body, push) {
  undoStack.push(clone(design));
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  design = nextDesign;
  ensureEntryIds(design);
  if (Number.isFinite(nextRev)) rev = nextRev;
  if (selId && !partById(selId)) selId = null;
  clearTimeout(cpTimer);
  opLog = [];
  cpBase = clone(design);
  updateHistoryButtons();
  render();
  renderInspector(null);
  postToViewer();
  if (body && Array.isArray(body.findings)) takeFindings(body, [], []);
  $('#readout').textContent = 'RESTORED — the mat is back at that checkpoint';
  setStatus('restored');
  if (push) scheduleSync();                 // mock restore still owes the server a PUT
}

/* ---------------- compare: ghost diff vs the current draft ---------------- */
async function startCompare(c) {
  closePop();
  setStatus('reading the diff…');
  let changes = null, old = null;
  if (histMode === 'live') {
    // `b=draft` reads the SERVER's draft, so the debounced PUT has to land first
    // or the diff would describe a document one gesture out of date.
    clearTimeout(syncTimer);
    await flushDraft();
    try {
      const [dRes, rRes] = await Promise.all([
        fetch(`${CP_URL()}/diff?a=${encodeURIComponent(c.id)}&b=draft`),
        fetch(`${CP_URL()}/${encodeURIComponent(c.id)}`),
      ]);
      if (rRes.ok) old = (await rRes.json().catch(() => ({}))).design || null;
      if (dRes.ok) {
        const body = await dRes.json().catch(() => ({}));
        if (Array.isArray(body.changes)) changes = body.changes;
      }
    } catch { /* fall through to the local differ */ }
  } else {
    const rec = mockCps.find((k) => k.id === c.id);
    old = rec ? clone(rec.design) : null;
  }
  if (!old) { toast('That checkpoint’s snapshot is not available yet.', true); return; }
  if (!changes) changes = localDiff(old, design);   // stand-in until the differ answers

  cmp = { id: c.id, summary: c.summary, ts: c.ts, author: c.author, changes, old,
          ...diffSets(changes, old) };
  setLocked(true);
  renderCompare();
  render();
  renderHistory();
  setStatus(`comparing ${c.id}`);
}

// Which geometry ghosts (the BEFORE document's) and which gets the crimson tint
// (today's / the proposal's). Shared by M3 compare and M4 Review.
function diffSets(changes, old) {
  const ghostParts = new Set(), tintParts = new Set(), tintGeo = new Set(), goneGeo = new Set();
  for (const rec of changes || []) {
    const pid = rec && rec.ref && rec.ref.part;
    if (!pid) continue;
    const gid = rec.ref.holeId || rec.ref.slitId;
    if (((old && old.parts) || []).some((p) => p.id === pid)) ghostParts.add(pid);
    if (rec.kind === 'removed') {
      if (gid) goneGeo.add(pid + '|' + gid);          // a filled-in hole must still be visible
    } else if (partById(pid)) {
      tintParts.add(pid);
      if (gid) tintGeo.add(pid + '|' + gid);
    }
  }
  return { ghostParts, tintParts, tintGeo, goneGeo };
}

function exitCompare() {
  if (cmp && cmp.review) return;          // Review has its own two doors
  cmp = null;
  setLocked(false);
  flashGeo = null;
  renderCompare();
  render();
  renderHistory();
  setStatus('back to editing');
}
$('#cmpExit').addEventListener('click', exitCompare);

function renderCompare() {
  // In Review the chip list lives in the chat rail (DESIGN.md §3: "the chat rail
  // becomes the change-chip list") so the 3D pane stays visible for BEFORE/AFTER.
  $('#cmpPanel').classList.toggle('hidden', !cmp || !!cmp.review);
  $('#cmpBar').classList.toggle('hidden', !cmp);
  $('#cmpExit').classList.toggle('hidden', !!(cmp && cmp.review));
  if (!cmp) return;
  if (cmp.review) {
    $('#cmpBar').firstElementChild.innerHTML =
      'Reviewing Claude\'s idea: <b id="cmpWhat">“' + esc(cmp.summary) + '”</b>';
    $('#cmpBar').querySelectorAll('.key')[0].lastChild.textContent = ' yours now';
    $('#cmpBar').querySelectorAll('.key')[1].lastChild.textContent = ' Claude\'s change';
    return;
  }
  $('#cmpBar').firstElementChild.innerHTML =
    'Comparing <b id="cmpWhat">…</b> &rarr; <b>now</b>';
  $('#cmpBar').querySelectorAll('.key')[0].lastChild.textContent = ' then';
  $('#cmpBar').querySelectorAll('.key')[1].lastChild.textContent = ' now';
  $('#cmpWhat').textContent = `“${cmp.summary}”`;
  $('#cmpSub').textContent = cmp.changes.length
    ? `${cmp.changes.length} change${cmp.changes.length > 1 ? 's' : ''} since ${relTime(cmp.ts)} — tap one to zoom to it`
    : 'Nothing has changed since this checkpoint.';
  $('#cmpList').innerHTML = cmp.changes.length
    ? cmp.changes.map((rec, i) =>
        `<button class="clab ${esc(rec.kind || 'changed')}" data-ci="${i}">` +
        '<span class="kd"></span>' +
        `<span class="lb">${esc(rec.label || fallbackLabel(rec))}</span>` +
        '<span class="zoom">ZOOM</span></button>').join('')
    : '<div id="cmpEmpty">Nothing changed since this checkpoint — the mat looks exactly like that dot.</div>';
}

// The differ owns labels; this only covers a record that arrives without one.
function fallbackLabel(rec) {
  const nm = rec && rec.ref && rec.ref.part ? partLabel(rec.ref.part) : 'the design';
  return `${nm}: ${rec.kind || 'changed'} ${rec.scope || ''}`.trim();
}

$('#cmpList').addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-ci]');
  if (!el || !cmp) return;
  zoomToChange(cmp.changes[+el.getAttribute('data-ci')]);
});

// Clicking a label zooms to that geometry — today's if it still exists, the
// ghost's if the change removed it.
function zoomToChange(rec) {
  if (!rec || !rec.ref) return;
  const pid = rec.ref.part;
  let part = pid ? partById(pid) : null;
  if (rec.kind === 'removed' || !part) {
    part = (cmp.old.parts || []).find((p) => p.id === pid) || null;
  }
  if (!part) { setStatus(rec.label || '', ''); return; }
  const geoId = rec.ref.holeId || rec.ref.slitId;
  let d = part.path;
  if (geoId) {
    const hit = [...(part.holes || []), ...(part.slits || [])].find((e) => entryIdOf(e) === geoId);
    if (hit) d = dOf(hit);
  }
  zoomToMatPath(mapPath(d, (x, y) => localToMat(part, [x, y])));
  setStatus(rec.label || fallbackLabel(rec));
}

/* ---------------- the ghost + crimson tint layers ---------------- */
function partTransform(part) {
  const pl = placement(part);
  return `rotate(${+pl.rot.toFixed(3)} ${+pl.cx.toFixed(4)} ${+pl.cy.toFixed(4)}) ` +
         `translate(${+pl.tx.toFixed(4)} ${+pl.ty.toFixed(4)})`;
}

// Dashed gray, drawn UNDER today's parts: the checkpoint's own geometry at its
// own layout (so a moved part reads as "it used to sit here").
function ghostSvg() {
  if (!cmp || !cmp.old) return '';
  let o = '';
  for (const p of cmp.old.parts || []) {
    if (!cmp.ghostParts.has(p.id)) continue;
    o += `<g class="ghostpart" transform="${partTransform(p)}">` +
      `<path class="g-out" d="${esc([p.path, ...holePaths(p)].join(' '))}"/>`;
    for (const s of slitPaths(p)) o += `<path class="g-slit" d="${esc(s)}"/>`;
    o += '</g>';
  }
  return o;
}

// Crimson on today's added/changed geometry, over the kraft — plus the gray
// dashed ghosts of geometry that is GONE. A filled-in hole lives under today's
// opaque cardboard, so that one ghost rides on top or it cannot be seen at all.
function cmpTintSvg() {
  if (!cmp) return '';
  let o = '';
  if (cmp.goneGeo.size) {
    for (const p of cmp.old.parts || []) {
      const gone = [...(p.holes || []), ...(p.slits || [])]
        .filter((e) => cmp.goneGeo.has(p.id + '|' + entryIdOf(e)));
      if (!gone.length) continue;
      o += `<g class="ghostgone" transform="${partTransform(p)}">` +
        gone.map((e) => `<path class="g-hole" d="${esc(dOf(e))}"/>`).join('') + '</g>';
    }
  }
  for (const p of design.parts || []) {
    const whole = cmp.tintParts.has(p.id);
    const geo = [...(p.holes || []), ...(p.slits || [])]
      .filter((e) => cmp.tintGeo.has(p.id + '|' + entryIdOf(e)));
    if (!whole && !geo.length) continue;
    o += `<g transform="${partTransform(p)}">`;
    if (whole) o += `<path class="cmp-tint" d="${esc([p.path, ...holePaths(p)].join(' '))}"/>`;
    for (const e of geo) o += `<path class="cmp-geo" d="${esc(dOf(e))}"/>`;
    o += '</g>';
  }
  // Review only: repeat the BEFORE outline on TOP, unfilled. A proposal that
  // only ever grows a part would otherwise hide its own ghost under the new
  // cardboard, and "what would this actually change" is the whole point.
  if (cmp.review) {
    for (const p of cmp.old.parts || []) {
      if (!cmp.ghostParts.has(p.id)) continue;
      o += `<g transform="${partTransform(p)}"><path class="g-top" ` +
           `d="${esc([p.path, ...holePaths(p)].join(' '))}"/></g>`;
    }
  }
  return o;
}

/* ---------------- the editing lock ---------------- */
const LOCKABLE = ['#vPunch', '#vFold', '#vCurl', '#curlPlus', '#curlMinus',
                  '#copyPlus', '#copyMinus', '#undo', '#redo', '#print', '#save'];

function setLocked(on) {
  locked = on;
  if (on) {
    verb = 'select';
    curlOn = false;
    endCurlLive();
    closePop();
    updateVerbUI();
  }
  $('#lockPill').classList.toggle('hidden', !on);
  svg.classList.toggle('locked', on);
  for (const id of LOCKABLE) $(id).disabled = on;
  if (on) $('#readout').textContent = review
    ? 'REVIEWING CLAUDE’S IDEA — Keep it all or No thanks to get back to editing'
    : 'COMPARING — editing is locked until you Exit';
  else { updateHistoryButtons(); renderSelection(); updateVerbUI(); }
}

/* ---------------- a local differ (stand-in / fallback only) ---------------- */
// Same DiffRecord shape as server/src/differ.mjs so the UI is identical either
// way; the server's labels win whenever the endpoint answers.
function localDiff(a, b) {
  const out = [];
  const rec = (kind, scope, ref, prop, before, after, label) =>
    out.push({ kind, scope, ref: { part: null, holeId: null, slitId: null, id: null, ...ref },
               prop: prop || null, before: before ?? null, after: after ?? null, label });
  const A = new Map(((a && a.parts) || []).map((p) => [p.id, p]));
  const B = new Map(((b && b.parts) || []).map((p) => [p.id, p]));
  const entries = (p, key) => new Map(((p && p[key]) || [])
    .map((e, i) => [entryIdOf(e) || `#${i}`, e]));
  const diaOf = (p, e) => { const c = circleOfEntry(p, e); return c ? c.dia : null; };

  for (const [id, pa] of A) {
    const pb = B.get(id);
    const nm = pa.name || id;
    if (!pb) { rec('removed', 'part', { part: id }, null, null, null, `Removed ${nm}`); continue; }
    const la = layoutOf(pa), lb = layoutOf(pb);
    const dx = lb.x - la.x, dy = lb.y - la.y, drot = norm180(lb.rot - la.rot);
    if (Math.abs(dx) > 0.01) {
      rec('changed', 'layout', { part: id }, 'layout.x', +la.x.toFixed(4), +lb.x.toFixed(4),
        `${nm}: moved ${fmtIn(Math.abs(dx))}" ${dx > 0 ? 'right' : 'left'}`);
    }
    if (Math.abs(dy) > 0.01) {
      rec('changed', 'layout', { part: id }, 'layout.y', +la.y.toFixed(4), +lb.y.toFixed(4),
        `${nm}: moved ${fmtIn(Math.abs(dy))}" ${dy > 0 ? 'down' : 'up'}`);
    }
    if (Math.abs(drot) > 0.01) {
      rec('changed', 'layout', { part: id }, 'layout.rotDeg', la.rot, lb.rot,
        `${nm}: turned ${Math.abs(Math.round(drot))}°`);
    }
    if (pa.path !== pb.path) {
      const ba = bboxOfPath(pa.path), bb2 = bboxOfPath(pb.path);
      let label = `${nm}: reshaped`;
      if (ba && bb2) {
        const dw = bb2.width - ba.width, dh = bb2.height - ba.height;
        if (Math.abs(dh) > 0.05 && Math.abs(dh) >= Math.abs(dw)) {
          label = dh > 0 ? `${nm}: ${fmtIn(dh)}" longer (now ${fmtIn(bb2.height)}")`
                         : `${nm}: ${fmtIn(-dh)}" shorter (now ${fmtIn(bb2.height)}")`;
        } else if (Math.abs(dw) > 0.05) {
          label = dw > 0 ? `${nm}: ${fmtIn(dw)}" wider (now ${fmtIn(bb2.width)}")`
                         : `${nm}: ${fmtIn(-dw)}" narrower (now ${fmtIn(bb2.width)}")`;
        }
      }
      rec('changed', 'path', { part: id }, 'path', pa.path, pb.path, label);
    }
    const ha = entries(pa, 'holes'), hb = entries(pb, 'holes');
    for (const [hid, e] of ha) {
      if (!hb.has(hid)) { rec('removed', 'hole', { part: id, holeId: hid }, null, null, null, `${nm}: a hole is gone`); continue; }
      const d0 = diaOf(pa, e), d1 = diaOf(pb, hb.get(hid));
      if (d0 != null && d1 != null && Math.abs(d1 - d0) > 0.005) {
        rec('changed', 'hole', { part: id, holeId: hid }, 'd', +d0.toFixed(3), +d1.toFixed(3),
          `${nm}: hole ${d1 > d0 ? 'grown' : 'shrunk'} to Ø ${d1.toFixed(2)}"`);
      } else if (dOf(e) !== dOf(hb.get(hid))) {
        rec('changed', 'hole', { part: id, holeId: hid }, 'd', null, null, `${nm}: a hole moved`);
      }
    }
    for (const [hid, e] of hb) {
      if (ha.has(hid)) continue;
      const d1 = diaOf(pb, e);
      rec('added', 'hole', { part: id, holeId: hid }, null, null, null,
        d1 ? `${nm}: new Ø ${d1.toFixed(2)}" hole` : `${nm}: new hole`);
    }
    const sa = entries(pa, 'slits'), sb = entries(pb, 'slits');
    const newSlits = [...sb.keys()].filter((k) => !sa.has(k));
    const goneSlits = [...sa.keys()].filter((k) => !sb.has(k));
    if (newSlits.length) {
      rec('added', 'slit', { part: id, slitId: newSlits[0] }, null, null, null,
        newSlits.length === 1 ? `${nm}: 1 new score line` : `${nm}: ${newSlits.length} new score lines`);
    }
    if (goneSlits.length) {
      rec('removed', 'slit', { part: id, slitId: goneSlits[0] }, null, null, null,
        goneSlits.length === 1 ? `${nm}: a score line is gone` : `${nm}: ${goneSlits.length} score lines gone`);
    }
    if ((pa.count || 1) !== (pb.count || 1)) {
      rec('changed', 'count', { part: id }, 'count', pa.count || 1, pb.count || 1,
        `${nm}: now ${pb.count || 1} copies`);
    }
  }
  for (const [id, pb] of B) {
    if (A.has(id)) continue;
    rec('added', 'part', { part: id }, null, null, null, `New part: ${pb.name || id}`);
  }
  const hwA = new Map(((a && a.hardware) || []).map((h) => [h.id, h]));
  const hwB = new Map(((b && b.hardware) || []).map((h) => [h.id, h]));
  for (const [id, h] of hwB) {
    if (!hwA.has(id)) rec('added', 'hardware', { id }, null, null, null, `New in what you need: ${h.label || id}`);
    else if ((hwA.get(id).lengthIn || 0) !== (h.lengthIn || 0)) {
      rec('changed', 'hardware', { id }, 'lengthIn', hwA.get(id).lengthIn, h.lengthIn,
        `${h.label || id}: now ${fmtIn(h.lengthIn || 0)}" long`);
    }
  }
  for (const [id, h] of hwA) if (!hwB.has(id)) rec('removed', 'hardware', { id }, null, null, null, `Gone from what you need: ${h.label || id}`);
  return out;
}

/* ================================================================
   M4 — CHAT PROPOSALS: ask → think → propose → merge → Review → commit
   ----------------------------------------------------------------
   The rail is a normal chat until a turn comes back with a document. Editing is
   NEVER locked while Claude thinks — the kid's gestures keep PUTting and the
   three-way merge is what reconciles them; the lock only goes on in Review,
   where `design` temporarily holds the MERGED proposal and the kid's own draft
   is the dashed-gray ghost underneath (the M3 machinery, inverted). Nothing
   reaches disk until [Keep it all].
   ================================================================ */
const PROP_URL = () => `/api/designs/${encodeURIComponent(slug)}/propose`;
const CHAT_KEY = () => 'cuttingmat.chat.' + slug;
const CHAT_OPEN_KEY = () => 'cuttingmat.chatopen.' + slug;
// ?mock=1 on the Mat forwards to the proposal endpoint's scripted-edit path
// (M4 §3) — the whole pipeline in milliseconds, no CLI.
const MOCK_Q = new URLSearchParams(location.search).get('mock') === '1' ? '?mock=1' : '';
const POLL_MS = 2000;

let chatTurns = [];        // the persisted transcript
let job = null;            // { id, t0, status, progress, reply, summary, local }
let pollTimer = null, heartTimer = null;
let review = null;         // { jobId, base, merged, changes, conflicts, findings, baseMoved, choices }
let baSide = 'after';      // which document the 3D pane is holding
let chatMode = 'boot';     // 'live' once /propose answers | 'local' stand-in
let localJob = null;

/* ---------------- the rail ---------------- */
function openChat(on) {
  $('#app').classList.toggle('chatclosed', !on);
  $('#chatToggle').innerHTML = on ? '&#8594;' : '&#8592;';
  try { sessionStorage.setItem(CHAT_OPEN_KEY(), on ? '1' : '0'); } catch { /* private mode */ }
  if (on) $('#chat').classList.remove('unread');
  render();                                  // the mat's width just changed
}
$('#chatToggle').addEventListener('click', () => openChat(false));
$('#chatTab').addEventListener('click', () => openChat(true));

function loadTranscript() {
  try { chatTurns = JSON.parse(sessionStorage.getItem(CHAT_KEY()) || '[]'); } catch { chatTurns = []; }
  if (!Array.isArray(chatTurns)) chatTurns = [];
}
function saveTranscript() {
  chatTurns = chatTurns.slice(-60);
  try { sessionStorage.setItem(CHAT_KEY(), JSON.stringify(chatTurns)); } catch { /* private mode */ }
}
function addTurn(t) {
  chatTurns.push({ ts: new Date().toISOString(), ...t });
  saveTranscript();
  renderChat();
  if ($('#app').classList.contains('chatclosed') && t.role !== 'you') $('#chat').classList.add('unread');
}

// The elapsed time is ours (the rail's own clock, so it ticks between polls);
// a server progress line that already carries "(12s)" gets it trimmed off.
const heartbeatText = () => {
  const secs = job ? Math.max(0, Math.round((Date.now() - job.t0) / 1000)) : 0;
  const p = String((job && job.progress) || '').replace(/[\s.]*\(\d+s\)\s*$/, '').replace(/\.{3}$/, '').trim();
  return `${p || 'thinking about the geometry'}… ${secs}s`;
};

function renderChat() {
  const log = $('#chatLog');
  let html = '';
  if (!chatTurns.length) {
    html += '<div class="bub note">Ask for a change — “make the blade 2 inches longer” — or just ask a ' +
            'question. Keep editing while Claude thinks; nothing you do gets lost.</div>';
  }
  for (const t of chatTurns) {
    if (t.role === 'you') { html += `<div class="bub you">${esc(t.text)}</div>`; continue; }
    if (t.role === 'note') { html += `<div class="bub note">${esc(t.text)}</div>`; continue; }
    if (t.role === 'proposal') {
      const live = !!(job && job.id === t.jobId && job.status === 'ready' && !review);
      const mine = !!(review && review.jobId === t.jobId);
      html += `<div class="card${live ? '' : ' stale'}"><div class="h">CLAUDE’S IDEA</div>` +
        `<div>${esc(t.text)}</div><div class="sum">“${esc(t.summary || 'a change')}”</div>` +
        (live ? '<button data-review>Review it</button>'
              : `<div class="bub note" style="padding:0;max-width:none">${
                  mine ? 'you are reviewing this one' : 'this idea is no longer on the table'}</div>`) +
        '</div>';
      continue;
    }
    html += `<div class="bub claude">${esc(t.text)}</div>`;
  }
  if (job && job.status === 'thinking') {
    html += '<div class="bub think"><span class="dots"><i></i><i></i><i></i></span>' +
            `<span id="heartTxt">${esc(heartbeatText())}</span></div>`;
  }
  log.innerHTML = html;
  log.scrollTop = log.scrollHeight;
}

$('#chatLog').addEventListener('click', (ev) => {
  if (ev.target.closest('[data-review]')) startReview((job && job.id) || null);
});

function setChatStatus(text) { $('#chatStatus').textContent = text || ''; }

function setThinking(on) {
  $('#chat').classList.toggle('busy', on);
  clearInterval(heartTimer); heartTimer = null;
  if (!on) return;
  heartTimer = setInterval(() => {
    const el = $('#heartTxt');
    if (el) el.textContent = heartbeatText();
    setChatStatus(heartbeatText());
  }, 1000);
}

/* ---------------- asking ---------------- */
$('#chatForm').addEventListener('submit', (ev) => { ev.preventDefault(); sendChat($('#chatInput').value); });
$('#chatInput').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); sendChat($('#chatInput').value); }
});

async function sendChat(text) {
  const msg = String(text || '').trim();
  if (!msg || review) return;
  if (job && job.status === 'thinking') { toast('Claude is still thinking about the last one.'); return; }
  addTurn({ role: 'you', text: msg });
  $('#chatInput').value = '';
  // The proposal's base is the draft AS THE SERVER HAS IT, so the kid's last
  // gesture has to land before we ask — otherwise the merge would call the
  // kid's own edit a conflict.
  clearTimeout(syncTimer);
  await flushDraft();
  const chat = chatTurns.filter((t) => t.role === 'you' || t.role === 'claude' || t.role === 'proposal')
    .slice(-10).map((t) => ({ role: t.role === 'you' ? 'you' : 'claude', text: t.text }));

  let started = null;
  if (chatMode !== 'local') {
    try {
      const res = await fetch(PROP_URL() + MOCK_Q, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: msg, chat, selection: selId }),
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.jobId) { chatMode = 'live'; started = { id: body.jobId, local: false }; }
      } else if (res.status === 404) {
        goChatLocal();
      } else {
        addTurn({ role: 'note', text: 'Claude could not start that one (' + res.status + ').' });
        return;
      }
    } catch { goChatLocal(); }
  }
  if (!started) started = startLocalJob(msg);
  job = { id: started.id, t0: Date.now(), status: 'thinking', progress: 'thinking about the geometry',
          local: !!started.local };
  setThinking(true);
  renderChat();
  if (!job.local) pollJob();
}

// Builder A's endpoints may not be up yet: a local stand-in keeps the whole
// rail exercisable. It is never preferred over the server.
function goChatLocal() {
  if (chatMode === 'local') return;
  chatMode = 'local';
  addTurn({ role: 'note', text: 'the proposal endpoint is not up yet — using a local stand-in' });
}

function pollJob() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (!job || job.local || job.status !== 'thinking') return;
    try {
      const res = await fetch(`${PROP_URL()}/${encodeURIComponent(job.id)}`);
      if (!res.ok) {
        if (res.status === 404) { failJob('that idea got lost on the way back.'); return; }
        pollJob(); return;
      }
      const b = await res.json().catch(() => ({}));
      if (!job) return;
      if (b.progress) job.progress = b.progress;
      if (b.status === 'thinking') { pollJob(); return; }
      landJob(b);
    } catch {
      pollJob();                               // a blip is not an answer
    }
  }, POLL_MS);
}

function failJob(msg) {
  setThinking(false);
  job = null;
  addTurn({ role: 'claude', text: 'I couldn’t make that work — ' + msg });
  setChatStatus('');
}

function landJob(b) {
  setThinking(false);
  if (!job) return;
  if (b.status === 'error') { failJob(b.error || 'the shop rules got in the way.'); return; }
  if (b.status === 'chat' || !b.summary) {
    job = null;
    addTurn({ role: 'claude', text: b.reply || 'Hmm — nothing to change there.' });
    setChatStatus('');
    return;
  }
  job.status = 'ready';
  job.reply = b.reply || '';
  job.summary = b.summary;
  addTurn({ role: 'proposal', text: b.reply || 'Here’s an idea.', summary: b.summary, jobId: job.id });
  setChatStatus('an idea is waiting — Review it');
  toast('Claude has an idea: “' + b.summary + '” — Review it in the chat rail.');
}

/* ---------------- Review mode ---------------- */
async function callMerge(jobId, choices) {
  if (chatMode === 'local' || (job && job.local)) return localMergeResult(choices);
  try {
    const res = await fetch(`${PROP_URL()}/${encodeURIComponent(jobId)}/merge`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choices: choices || {} }),
    });
    if (!res.ok) return null;
    const b = await res.json().catch(() => ({}));
    if (!b.merged) return null;
    return { merged: b.merged, changes: b.changes || [], conflicts: b.conflicts || [],
             findings: Array.isArray(b.findings) ? b.findings.map(normalizeFinding).filter(Boolean) : null,
             baseMoved: !!b.baseMoved };
  } catch { return null; }
}

async function startReview(jobId) {
  if (review || !job || job.status !== 'ready' || (jobId && jobId !== job.id)) return;
  setStatus('working out what changed…');
  clearTimeout(syncTimer);
  await flushDraft();                       // merge against what the server has
  const base = clone(design);
  const m = await callMerge(job.id, {});
  if (!m) { toast('Could not work out how that fits with your design.', true); setStatus(''); return; }
  review = { jobId: job.id, base, choices: {}, summary: job.summary, ...m };
  applyReviewDoc();
  openChat(true);
  toast('Your version is the dashed gray ghost — Claude’s change is crimson.');
}

// `design` becomes the merged proposal; the kid's draft rides underneath as the
// M3 ghost layer. Called again after every conflict tap.
function applyReviewDoc() {
  design = clone(review.merged);
  ensureEntryIds(design);
  if (selId && !partById(selId)) selId = null;
  cmp = { id: 'proposal', review: true, summary: review.summary || 'a change',
          ts: new Date().toISOString(), author: 'claude', changes: review.changes, old: review.base,
          ...diffSets(review.changes, review.base) };
  setLocked(true);
  $('#baBar').classList.remove('hidden');
  renderCompare();
  renderReview();
  render();
  renderInspector(null);
  renderChat();
  setBaSide(baSide);                  // labels the toggle and feeds the viewer
  setStatus('reviewing Claude’s idea');
}

function renderReview() {
  $('#review').classList.toggle('hidden', !review);
  $('#chatForm').querySelectorAll('textarea, button').forEach((el) => { el.disabled = !!review; });
  if (!review) return;
  $('#revSum').textContent = '“' + (review.summary || 'a change') + '”';
  const errs = (review.findings || []).filter((f) => f.level === 'error');
  const warns = (review.findings || []).filter((f) => f.level !== 'error');
  const lint = $('#revLint');
  if (review.errors && review.errors.length) {
    lint.className = 'bad';
    lint.textContent = 'That won’t build: ' + review.errors.join(' · ');
  } else if (errs.length) {
    lint.className = 'bad';
    lint.textContent = errs.map((f) => f.message).join(' · ');
  } else if (review.findings === null) {
    lint.className = 'ok';
    lint.textContent = 'the Toy Doctor checks this for real when you keep it';
  } else {
    lint.className = 'ok';
    lint.textContent = 'still passes every toy check' +
      (warns.length ? ` — ${warns.length} thing${warns.length > 1 ? 's' : ''} to keep an eye on` : '');
  }
  $('#revMoved').classList.toggle('hidden', !review.baseMoved);

  const confs = review.conflicts || [];
  let html = '';
  if (confs.length) {
    html += `<div class="subh">${confs.length} THING${confs.length > 1 ? 'S' : ''} YOU BOTH CHANGED` +
            ' — TAP THE ONE YOU WANT</div>';
    // One gesture can collide on several properties of the same part (a SIZE
    // moves the outline AND every score line on it). Group them under the part
    // so the rail reads as "the blade", not four identical questions.
    const groups = [];
    const byPart = new Map();
    for (const c of confs) {
      const pid = (c.theirs && c.theirs.ref && c.theirs.ref.part) || (c.key || '').split('|')[1] || '';
      let g = byPart.get(pid);
      if (!g) { g = { pid, list: [] }; byPart.set(pid, g); groups.push(g); }
      g.list.push(c);
    }
    html += groups.map((g) => {
      const picks = g.list.map((c) => {
        const side = review.choices[c.key] === 'claude' ? 'claude' : 'you';
        const yours = (c.yours && c.yours.label) || 'keep it the way you have it';
        const theirs = (c.theirs && c.theirs.label) || 'Claude’s version';
        return `<div class="conf" data-ck="${esc(c.key)}"><div class="picks">` +
          `<button class="pick${side === 'you' ? ' on' : ''}" data-ck="${esc(c.key)}" data-side="you">` +
          `<span class="w">You:</span><span>${esc(yours)}</span>` +
          `${side === 'you' ? '<span class="tick">✓</span>' : ''}</button>` +
          `<button class="pick${side === 'claude' ? ' on' : ''}" data-ck="${esc(c.key)}" data-side="claude">` +
          `<span class="w">Claude:</span><span>${esc(theirs)}</span>` +
          `${side === 'claude' ? '<span class="tick">✓</span>' : ''}</button>` +
          '</div></div>';
      }).join('');
      if (g.list.length < 2) return picks;
      const keys = esc(g.list.map((c) => c.key).join(''));
      return `<div class="cgroup"><div class="ghead"><b>${esc(partLabel(g.pid) || 'the design')}</b>` +
        `<span>${g.list.length} things</span>` +
        `<button class="allbtn" data-all="you" data-keys="${keys}">all mine</button>` +
        `<button class="allbtn" data-all="claude" data-keys="${keys}">all Claude’s</button></div>` +
        picks + '</div>';
    }).join('');
  }
  const changes = review.changes || [];
  html += `<div class="subh">${changes.length ? 'WHAT CLAUDE CHANGED' : 'NOTHING WOULD CHANGE'}</div>`;
  html += changes.length
    ? changes.map((rec, i) =>
        `<button class="clab ${esc(rec.kind || 'changed')}" data-ri="${i}">` +
        '<span class="kd"></span>' +
        `<span class="lb">${esc(rec.label || fallbackLabel(rec))}</span>` +
        '<span class="zoom">ZOOM</span></button>').join('')
    : '<div id="cmpEmpty">Your design already looks like Claude’s idea.</div>';
  $('#revList').innerHTML = html;
}

async function repick(pairs) {
  if (!review) return;
  const before = { ...review.choices };
  let moved = false;
  for (const [key, side] of pairs) {
    const was = review.choices[key] || 'you';
    if (was !== side) moved = true;
    review.choices[key] = side;
  }
  if (!moved) { renderReview(); return; }
  delete review.errors;                 // a fresh merge, a fresh verdict
  setStatus('re-checking the merge…');
  const m = await callMerge(review.jobId, review.choices);
  // a failed re-merge must not leave the chips claiming a pick the document
  // does not have
  if (!m) { review.choices = before; renderReview(); toast('Could not re-merge that pick.', true); return; }
  Object.assign(review, m);
  applyReviewDoc();                     // the ghosts re-render on the new merge
}

$('#revList').addEventListener('click', async (ev) => {
  const all = ev.target.closest('.allbtn');
  if (all) {
    const side = all.getAttribute('data-all');
    await repick(all.getAttribute('data-keys').split('').filter(Boolean).map((k) => [k, side]));
    return;
  }
  const pick = ev.target.closest('.pick');
  if (pick) {
    await repick([[pick.getAttribute('data-ck'), pick.getAttribute('data-side')]]);
    return;
  }
  const lab = ev.target.closest('[data-ri]');
  if (lab && review) zoomToChange(review.changes[+lab.getAttribute('data-ri')]);
});

/* ---- the 3D BEFORE/AFTER toggle (one document at a time) ---- */
function setBaSide(side) {
  baSide = side;
  $('#baBefore').classList.toggle('on', side === 'before');
  $('#baAfter').classList.toggle('on', side === 'after');
  $('#baWhich').textContent = side === 'before' ? 'your design right now' : 'with Claude’s change';
  postToViewer();
}
$('#baBefore').addEventListener('click', () => setBaSide('before'));
$('#baAfter').addEventListener('click', () => setBaSide('after'));

/* ---- the two doors ---- */
function exitReview(note) {
  if (!review) return;
  const base = review.base;
  review = null;
  cmp = null;
  baSide = 'after';
  $('#review').classList.add('hidden');
  $('#baBar').classList.add('hidden');
  renderReview();
  design = base;
  if (selId && !partById(selId)) selId = null;
  setLocked(false);
  flashGeo = null;
  renderCompare();
  render();
  renderInspector(null);
  renderHistory();
  renderChat();
  postToViewer();
  setChatStatus('');
  if (note) setStatus(note);
}

$('#revKeep').addEventListener('click', async () => {
  if (!review) return;
  const btn = $('#revKeep');
  btn.disabled = true;
  const summary = review.summary || 'Claude’s change';
  const pre = clone(review.base);            // undo steps back ACROSS the accept
  try {
    const body = await acceptProposal();
    if (!body) { toast('Could not keep that one.', true); return; }
    if (body.ok === false) {
      review.errors = body.errors || ['the shop rules got in the way'];
      renderReview();
      toast('That change breaks a toy check — pick your version, or say No thanks.', true);
      return;
    }
    job = null;
    exitReview('kept Claude’s change');
    undoStack.push(pre);
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
    updateHistoryButtons();
    design = body.design;
    ensureEntryIds(design);
    if (Number.isFinite(body.rev)) rev = body.rev;
    if (selId && !partById(selId)) selId = null;
    opLog = [];                               // the server just wrote the checkpoint
    cpBase = clone(design);
    clearTimeout(cpTimer);
    render();
    renderInspector(null);
    postToViewer();
    if (body.findings) takeFindings(body, [], []);
    if (body.local) scheduleSync();           // the stand-in owes the draft a PUT
    await loadCheckpoints();                  // the crimson dot lands here
    addTurn({ role: 'note', text: 'Added! ✓ ' + summary });
    $('#readout').textContent = 'KEPT — Cmd-Z steps back across it if you change your mind';
    toast('Added! ✓ ' + summary + ' — Cmd-Z steps back across it.');
  } finally {
    btn.disabled = false;
  }
});

async function acceptProposal() {
  if (chatMode === 'local' || (job && job.local)) return localAccept();
  try {
    const res = await fetch(`${PROP_URL()}/${encodeURIComponent(review.jobId)}/accept`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choices: review.choices || {} }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok && body.ok !== false) return null;
    return body;
  } catch { return null; }
}

$('#revNo').addEventListener('click', async () => {
  if (!review) return;
  const jobId = review.jobId;
  const local = chatMode === 'local' || (job && job.local);
  job = null;
  exitReview('tossed it — your design is exactly where you left it');
  addTurn({ role: 'note', text: 'okay, tossed it.' });
  if (local) return;
  try {
    await fetch(`${PROP_URL()}/${encodeURIComponent(jobId)}/reject`, { method: 'POST' });
  } catch { /* the job ages out on its own */ }
});

/* ---- ASK CLAUDE: a Toy Doctor chip with no deterministic fix ---- */
function askClaudeAbout(f) {
  if (!f) return;
  if (review) { setStatus('finish reviewing Claude’s idea first', 'warn'); return; }
  openChat(true);
  const inp = $('#chatInput');
  inp.value = `Toy Doctor says: ${f.message} — can you fix it?`;
  inp.focus();
  try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch { /* ignore */ }
  setChatStatus('ready when you are — hit Send');
  setStatus('put the Toy Doctor’s note in the chat box');
}

/* ================================================================
   The local stand-in: a scripted proposal + a property-level merge.
   Only ever used when the propose endpoints do not answer — the server's
   answers win the moment they exist.
   ================================================================ */
function localScriptedEdit(base, selection) {
  const doc = clone(base);
  const part = (selection && (doc.parts || []).find((p) => p.id === selection)) || (doc.parts || [])[0];
  if (!part) return null;
  const bb = partBBox(part);
  if (!bb || bb.height <= 0) return null;
  const k = (bb.height + 2) / bb.height;
  const f = (x, y) => [x, bb.minY + (y - bb.minY) * k];
  part.path = mapPath(part.path, f);
  part.holes = (part.holes || []).map((e) => withD(e, mapPath(dOf(e), f)));
  part.slits = (part.slits || []).map((e) => withD(e, mapPath(dOf(e), f)));
  if (part.backing) part.backing = mapPath(part.backing, f);
  return { design: doc, summary: `Stretched ${part.name || part.id} 2" taller`,
           reply: 'I stretched it two inches — the grip stays where your hand goes, so only the ' +
                  'top grew. Have a look at the ghost underneath.' };
}

function startLocalJob(message) {
  const id = 'local-' + Date.now().toString(36);
  const base = clone(design);
  const prose = /\?\s*$/.test(message) || /^(what|why|how|which|should|is |are |can you tell)/i.test(message);
  localJob = { id, base, at: Date.now(), prose };
  const steps = ['reading your design', 'thinking about the geometry', 'checking the shop rules'];
  let i = 0;
  const tick = setInterval(() => {
    if (!job || job.id !== id) { clearInterval(tick); return; }
    job.progress = steps[Math.min(i++, steps.length - 1)];
  }, 1200);
  setTimeout(() => {
    clearInterval(tick);
    if (!job || job.id !== id) return;
    if (prose) {
      landJob({ status: 'chat', reply: 'Cardboard is strongest across the flutes — if you laminate a ' +
        'second layer with the flutes turned 90° the blade stops folding in a duel.' });
      return;
    }
    const made = localScriptedEdit(localJob.base, selId);
    if (!made) { landJob({ status: 'error', error: 'nothing to stretch.' }); return; }
    localJob.proposal = made.design;
    landJob({ status: 'ready', reply: made.reply, summary: made.summary });
  }, 4200);
  return { id, local: true };
}

const mergeKey = (r) => [r.scope, (r.ref && (r.ref.part || r.ref.id)) || '',
  (r.ref && (r.ref.holeId || r.ref.slitId)) || '', r.prop || r.kind].join('|');

function localMergeResult(choices) {
  if (!localJob || !localJob.proposal) return null;
  const base = localJob.base, ours = review ? review.base : clone(design), theirs = localJob.proposal;
  const mine = new Map(localDiff(base, ours).map((r) => [mergeKey(r), r]));
  const his = localDiff(base, theirs);
  const merged = clone(ours);
  const changes = [], conflicts = [];
  for (const r of his) {
    const key = mergeKey(r);
    const yours = mine.get(key);
    const clash = yours && JSON.stringify(yours.after) !== JSON.stringify(r.after);
    changes.push({ ...r, from: 'claude' });
    if (clash) {
      conflicts.push({ key, yours, theirs: r });
      if ((choices || {})[key] !== 'claude') continue;      // conflicts default to OURS
    }
    applyRecord(merged, r, theirs);
  }
  return { merged, changes, conflicts, findings: null,
           baseMoved: JSON.stringify(base) !== JSON.stringify(ours) };
}

// Apply ONE DiffRecord onto a document (stand-in merge only).
function applyRecord(doc, rec, src) {
  const pid = rec.ref && rec.ref.part;
  const part = pid ? (doc.parts || []).find((p) => p.id === pid) : null;
  const from = pid ? ((src.parts || []).find((p) => p.id === pid)) : null;
  if (rec.scope === 'part' && rec.kind === 'added' && from) {
    if (!part) doc.parts.push(clone(from));
    return;
  }
  if (rec.scope === 'part' && rec.kind === 'removed') {
    doc.parts = (doc.parts || []).filter((p) => p.id !== pid);
    return;
  }
  if (!part || !from) return;
  if (rec.scope === 'layout' && rec.prop) {
    const k = rec.prop.split('.')[1];
    const l = layoutOf(part);
    part.layout = { x: l.x, y: l.y, rotDeg: l.rot, ...(part.layout || {}) };
    part.layout[k] = rec.after;
    return;
  }
  if (rec.scope === 'path') { part.path = rec.after; return; }
  if (rec.scope === 'count') { part.count = rec.after; return; }
  const key = rec.scope === 'hole' ? 'holes' : rec.scope === 'slit' ? 'slits' : null;
  if (!key) return;
  const gid = rec.ref.holeId || rec.ref.slitId;
  const srcList = from[key] || [], mineList = part[key] || (part[key] = []);
  if (rec.kind === 'removed') {
    part[key] = mineList.filter((e) => entryIdOf(e) !== gid);
    return;
  }
  const srcEntry = srcList.find((e) => entryIdOf(e) === gid) ||
    (rec.kind === 'added' ? srcList.filter((e) => !mineList.some((m) => entryIdOf(m) === entryIdOf(e))) : []);
  const list = Array.isArray(srcEntry) ? srcEntry : [srcEntry];
  for (const e of list) {
    if (!e) continue;
    const i = mineList.findIndex((m) => entryIdOf(m) === entryIdOf(e));
    if (i >= 0) mineList[i] = clone(e);
    else mineList.push(clone(e));
  }
}

async function localAccept() {
  const merged = clone(design);              // what Review is showing
  const summary = review.summary || 'Claude’s change';
  let checkpointId = null;
  if (histMode === 'live' && !mock) {
    try {
      const res = await fetch(CP_URL(), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ author: 'claude', summary, design: merged }),
      });
      if (res.ok) checkpointId = (await res.json().catch(() => ({}))).id || null;
    } catch { /* the strip just will not gain a dot */ }
  }
  return { ok: true, design: merged, rev, findings: null, checkpointId, local: true };
}

/* ================================================================
   Boot
   ================================================================ */
// A read-only seam so acceptance runs can measure the working document (which
// is not always the server's draft — a rejected PUT leaves the bad state here,
// which is exactly the state a red Toy Doctor chip describes).
window.__mat = {
  doc: () => design, findings: () => findings, verb: () => verb, rev: () => rev,
  // M3 seam: the strip's data, the pending op log and its summary, the compare
  // state, and a manual checkpoint trigger (what the 45s pause would fire).
  checkpoints: () => checkpoints, histMode: () => histMode, cpDebounce: () => CP_DEBOUNCE,
  pending: () => opLog.slice(), summary: () => summarizePending(), locked: () => locked,
  compare: () => (cmp ? { id: cmp.id, summary: cmp.summary, changes: cmp.changes } : null),
  checkpointNow: (suffix) => writeCheckpoint(suffix || ''),
  // `stage` puts findings on the strip without a server round-trip. The six
  // shipped designs cannot reach an axle-budget fix through any M2 gesture
  // (nothing on the Mat edits hardware length), so this is how that chip's
  // set-hardware-length patch gets exercised end to end by a real FIX tap.
  stage: (list) => { findings = list; doctorReady = true; renderDoctor(); },
  // M4 seam: the chat transcript, the live job, and the review state (with the
  // merged document, so a run can measure the proposal without accepting it).
  chat: () => chatTurns.slice(), job: () => (job ? { ...job } : null), chatMode: () => chatMode,
  review: () => (review ? { jobId: review.jobId, summary: review.summary, changes: review.changes,
                            conflicts: review.conflicts, choices: { ...review.choices },
                            baseMoved: !!review.baseMoved, base: review.base, merged: design } : null),
  ba: () => baSide,
  ask: (text) => sendChat(text),
};

updateVerbUI();
boot().catch((err) => {
  console.error(err);
  toast('Could not open the mat: ' + err.message, true);
});
