// Cardboard Studio — 3D assembly viewer.
// Fetches /api/designs/:slug, extrudes each part's cut path into kraft cardboard,
// and animates the flat cut sheet folding + flying into the finished toy
// (see reference/ASSEMBLY-SPEC.md).
import * as THREE from 'three';
import { OrbitControls } from '/vendor/three/OrbitControls.js';

const DEG = Math.PI / 180;
const $ = (s) => document.querySelector(s);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

/* ================================================================
   SVG path sampling — ported from server/src/render/geometry.mjs.
   Design space: inches, y-down. Commands M L H V C S Q T Z only.
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

function samplePath(d, curveSteps = 24) {
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
        case 'H': {
          let x = n();
          if (rel) x += cx;
          cx = x; push(cx, cy);
          break;
        }
        case 'V': {
          let y = n();
          if (rel) y += cy;
          cy = y; push(cx, cy);
          break;
        }
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
        case 'Z': {
          cx = sx; cy = sy; push(cx, cy);
          i = Infinity;
          break;
        }
        default:
          i = Infinity;
      }
      prevCmd = C;
      if (C === 'Z') break;
    }
  }
  return pts;
}

function uvBBox(d) {
  const pts = samplePath(d);
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (const [u, v] of pts) {
    if (u < minU) minU = u;
    if (v < minV) minV = v;
    if (u > maxU) maxU = u;
    if (v > maxV) maxV = v;
  }
  return { minU, minV, maxU, maxV };
}

/* ================================================================
   2D polygon helpers. Everything below works in the part-local
   plane: x = u, y = -v (spec: part local 3D X=u, Y=-v, Z=out).
   ================================================================ */
function dedupe(pts, eps = 5e-4) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push([p[0], p[1]]);
  }
  while (out.length > 1 &&
         Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) {
    out.pop();
  }
  return out;
}

function centroidOf(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

// Sutherland–Hodgman clip of a closed polygon against half-plane nx*x + ny*y <= d.
function clipHalfPlane(pts, nx, ny, d) {
  const out = [];
  const N = pts.length;
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    const da = a[0] * nx + a[1] * ny - d;
    const db = b[0] * nx + b[1] * ny - d;
    const ain = da <= 0, bin = db <= 0;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function polyCentroid(pts) {
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const c = p[0] * q[1] - q[0] * p[1];
    a += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-9) return centroidOf(pts);
  return [x / (3 * a), y / (3 * a)];
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) &&
        pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// A straight slit polyline → its crease line: canonical normal (nx,ny) with
// nx>=0 (ties resolve +y), offset, and the slit's own interval [tA,tB] along
// the line direction (ny,-nx). Curved slits return null (decorative grooves).
function slitLine(slitPts) {
  if (!slitPts || slitPts.length < 2) return null;
  const p0 = slitPts[0], p1 = slitPts[slitPts.length - 1];
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  if (len < 0.05) return null;
  const dx = (p1[0] - p0[0]) / len, dy = (p1[1] - p0[1]) / len;
  for (const p of slitPts) {
    if (Math.abs((p[0] - p0[0]) * -dy + (p[1] - p0[1]) * dx) > 0.02) return null;
  }
  let nx = -dy, ny = dx;
  if (nx < -1e-6 || (Math.abs(nx) <= 1e-6 && ny < 0)) { nx = -nx; ny = -ny; }
  const off = p0[0] * nx + p0[1] * ny;
  const t0 = p0[0] * ny - p0[1] * nx, t1 = p1[0] * ny - p1[1] * nx;
  return { nx, ny, off, tA: Math.min(t0, t1), tB: Math.max(t0, t1) };
}

// Split a simple polygon by the line n·p = off into its connected pieces on
// each side (Sutherland–Hodgman alone merges disjoint pieces through zero-width
// bridges — fatal for box nets, where one cut line separates a flap AND two
// corner tabs). Chains of boundary strictly on one side are re-joined through
// the sorted on-line crossing pairs. Falls back to S–H if pairing fails.
function polySplit(poly, nx, ny, off) {
  const N = poly.length;
  const d = poly.map((p) => {
    let v = p[0] * nx + p[1] * ny - off;
    if (Math.abs(v) < 1e-7) v = 1e-7;
    return v;
  });
  if (d.every((v) => v > 0)) return { neg: [], pos: [poly] };
  if (d.every((v) => v < 0)) return { neg: [poly], pos: [] };
  const dirx = ny, diry = -nx;
  let s0 = 0;
  for (let i = 0; i < N; i++) {
    if ((d[i] > 0) !== (d[(i + 1) % N] > 0)) { s0 = (i + 1) % N; break; }
  }
  const chains = [], crossings = [];
  let cur = null;
  for (let k = 0; k < N; k++) {
    const i = (s0 + k) % N, j = (s0 + k + 1) % N;
    if (!cur) cur = { side: d[i] > 0 ? 1 : -1, pts: [], start: null, end: null };
    cur.pts.push(poly[i]);
    if ((d[i] > 0) !== (d[j] > 0)) {
      const f = d[i] / (d[i] - d[j]);
      const x = poly[i][0] + (poly[j][0] - poly[i][0]) * f;
      const y = poly[i][1] + (poly[j][1] - poly[i][1]) * f;
      const c = { idx: crossings.length, t: x * dirx + y * diry, x, y };
      crossings.push(c);
      cur.end = c;
      chains.push(cur);
      cur = null;
    }
  }
  for (let k = 0; k < chains.length; k++) {
    chains[k].start = crossings[(k + chains.length - 1) % chains.length];
  }
  const partner = new Map();
  const byT = [...crossings].sort((a, b) => a.t - b.t);
  for (let i = 0; i + 1 < byT.length; i += 2) {
    partner.set(byT[i].idx, byT[i + 1]);
    partner.set(byT[i + 1].idx, byT[i]);
  }
  const startMap = new Map();
  for (const c of chains) startMap.set(c.side + ':' + c.start.idx, c);
  const out = { neg: [], pos: [] };
  const used = new Set();
  let failed = false;
  for (const first of chains) {
    if (used.has(first)) continue;
    const piece = [];
    let ch = first, closed = false;
    for (let guard = 0; guard <= chains.length && !closed; guard++) {
      used.add(ch);
      piece.push([ch.start.x, ch.start.y], ...ch.pts, [ch.end.x, ch.end.y]);
      const back = partner.get(ch.end.idx);
      const nxt = back && startMap.get(ch.side + ':' + back.idx);
      if (!nxt || (nxt !== first && used.has(nxt))) break;
      if (nxt === first) closed = true;
      else ch = nxt;
    }
    if (!closed) { failed = true; break; }
    const pts = dedupe(piece);
    if (pts.length >= 3) (first.side < 0 ? out.neg : out.pos).push(pts);
  }
  if (failed) {
    const neg = dedupe(clipHalfPlane(poly, nx, ny, off));
    const pos = dedupe(clipHalfPlane(poly, -nx, -ny, -off));
    return { neg: neg.length >= 3 ? [neg] : [], pos: pos.length >= 3 ? [pos] : [] };
  }
  return out;
}

const GAP = 0.006; // hair-line gap at each crease: reads as a score + kills coplanar walls

// Build a part's fold data as a hinge TREE (spec: "Fold semantics"): cut the
// outline by every crease line named in the instance's folds (both axes — a
// box cross-net folds perpendicular ways), pick a root region, BFS outward.
// Each region hinges at the line it shares with its parent by that slit's
// angle; a parallel-slit fan (guard curl, crown band) degenerates to the old
// chain. Mirroring flips x (mirror through the part plane = flip-x + 180° Y).
// holes[]/slits[] entries are a bare path string (legacy) or {id, d} (stable
// editor ids) — pathD reads either shape.
const pathD = (x) => (typeof x === 'string' ? x : (x && typeof x.d === 'string' ? x.d : ''));

function buildFoldTree(part, folds, mirrored) {
  const toXY = mirrored ? (p) => [-p[0], -p[1]] : (p) => [p[0], -p[1]];
  const outline = dedupe(samplePath(part.path).map(toXY));
  const holes = (part.holes || []).map((h) => dedupe(samplePath(pathD(h)).map(toXY)));

  // Which slits hinge, and by how much: the slits the instance's folds name
  // (every straight slit, under {slit:"all"}). Others stay decorative grooves.
  let allAngle = null;
  const byIdx = new Map();
  for (const f of folds || []) {
    if (f.slit === 'all') allAngle = f.angleDeg * DEG;
    else if (Number.isInteger(f.slit)) byIdx.set(f.slit, f.angleDeg * DEG);
  }
  const hingeSlits = [], grooves = [];
  (part.slits || []).forEach((s, idx) => {
    const pts = samplePath(pathD(s)).map(toXY);
    const angle = byIdx.has(idx) ? byIdx.get(idx) : allAngle;
    const line = angle === null ? null : slitLine(pts);
    if (line) hingeSlits.push({ ...line, angle });
    else grooves.push(pts);
  });

  // Collinear slits share one cut line (a box net reuses a line for the wall
  // crease AND the corner-tab creases); slice the outline by every line, with
  // the crease gap baked into the two offset cuts.
  const lines = [];
  for (const hs of hingeSlits) {
    let L = lines.find((l) =>
      Math.abs(l.nx * hs.ny - l.ny * hs.nx) < 1e-3 &&
      l.nx * hs.nx + l.ny * hs.ny > 0 &&
      Math.abs(l.off - hs.off) < 0.008);
    if (!L) lines.push(L = { nx: hs.nx, ny: hs.ny, off: hs.off, slits: [] });
    L.slits.push(hs);
  }
  let polys = [outline];
  for (const L of lines) {
    const next = [];
    for (const poly of polys) {
      next.push(...polySplit(poly, L.nx, L.ny, L.off - GAP).neg);
      next.push(...polySplit(poly, L.nx, L.ny, L.off + GAP).pos);
    }
    polys = next.filter((p) => p.length >= 3 && Math.abs(polyArea(p)) > 1e-3);
  }
  const regions = polys.map((poly) => ({
    poly, area: Math.abs(polyArea(poly)), centroid: polyCentroid(poly),
    parent: -1, pivot: [0, 0], axis: [1, 0], target: 0, holes: [], grooves: [],
  }));

  // Region adjacency: shared boundary interval (>0.04") across a cut line.
  // The hinge angle comes from the slit segment covering that interval most.
  const edges = [];
  for (const L of lines) {
    const dirx = L.ny, diry = -L.nx;
    const info = regions.map((r) => {
      const segs = [];
      for (let i = 0; i < r.poly.length; i++) {
        const a = r.poly[i], b = r.poly[(i + 1) % r.poly.length];
        if (Math.abs(a[0] * L.nx + a[1] * L.ny - L.off) <= GAP + 0.002 &&
            Math.abs(b[0] * L.nx + b[1] * L.ny - L.off) <= GAP + 0.002) {
          const ta = a[0] * dirx + a[1] * diry, tb = b[0] * dirx + b[1] * diry;
          if (Math.abs(ta - tb) > 1e-4) segs.push([Math.min(ta, tb), Math.max(ta, tb)]);
        }
      }
      return { side: (r.centroid[0] * L.nx + r.centroid[1] * L.ny - L.off) > 0 ? 1 : -1, segs };
    });
    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        if (info[i].side === info[j].side || !info[i].segs.length || !info[j].segs.length) continue;
        let lo = 0, hi = -1;
        for (const s1 of info[i].segs) {
          for (const s2 of info[j].segs) {
            const l = Math.max(s1[0], s2[0]), h = Math.min(s1[1], s2[1]);
            if (h - l > hi - lo) { lo = l; hi = h; }
          }
        }
        if (hi - lo < 0.04) continue;
        let angle = 0, best = 0;
        for (const hs of L.slits) {
          const ov = Math.min(hi, hs.tB) - Math.max(lo, hs.tA);
          if (ov > best) { best = ov; angle = hs.angle; }
        }
        edges.push({ a: i, b: j, line: L, mid: (lo + hi) / 2, angle });
      }
    }
  }

  // Root region. Parallel fans keep the legacy chain convention (first region
  // along the canonical normal) so existing curls read identically; true
  // 2-axis nets root at the LARGEST region — more robust than centroid
  // containment, because a cross-net's outline centroid can land outside every
  // region, while the largest region is the box base and always exists.
  let root = 0;
  if (regions.length > 1 && lines.length) {
    const parallel = lines.every((L) => Math.abs(L.nx * lines[0].ny - L.ny * lines[0].nx) < 1e-3);
    if (parallel) {
      let best = Infinity;
      regions.forEach((r, i) => {
        const v = r.centroid[0] * lines[0].nx + r.centroid[1] * lines[0].ny;
        if (v < best) { best = v; root = i; }
      });
    } else {
      let best = -1;
      regions.forEach((r, i) => { if (r.area > best) { best = r.area; root = i; } });
    }
  }

  // BFS out from the root; positive angle folds a child toward +Z (front face
  // becomes the inside of the fold), whichever side of its line it hangs on:
  // axis a satisfies a × n = +Z for n pointing parent→child → a = (ny, -nx).
  const order = [root];
  const seen = new Set([root]);
  for (let qi = 0; qi < order.length; qi++) {
    for (const e of edges) {
      const other = e.a === order[qi] ? e.b : e.b === order[qi] ? e.a : -1;
      if (other < 0 || seen.has(other)) continue;
      seen.add(other);
      const L = e.line, r = regions[other];
      const side = (r.centroid[0] * L.nx + r.centroid[1] * L.ny - L.off) > 0 ? 1 : -1;
      r.parent = order[qi];
      r.pivot = [L.nx * L.off + L.ny * e.mid, L.ny * L.off - L.nx * e.mid];
      r.axis = [L.ny * side, -L.nx * side];
      r.target = e.angle;
      order.push(other);
    }
  }
  regions.forEach((r, i) => { if (!seen.has(i)) { r.parent = root; order.push(i); } });

  // Holes and decorative slits ride with the region containing their centroid.
  const regionAt = (pt) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < regions.length; i++) {
      if (pointInPoly(pt, regions[i].poly)) return i;
      const dx = regions[i].centroid[0] - pt[0], dy = regions[i].centroid[1] - pt[1];
      if (dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; bi = i; }
    }
    return bi;
  };
  for (const h of holes) if (h.length >= 3) regions[regionAt(centroidOf(h))].holes.push(h);
  for (const g of grooves) if (g.length >= 2) regions[regionAt(centroidOf(g))].grooves.push(g);
  return { regions, order };
}

/* ================================================================
   Viewer
   ================================================================ */
const COLORS = {
  bg: 0xFAF6EF, face: 0xC9AB84, side: 0x9E8261, edge: 0x5c4a36,
  groove: 0x6b5740, pulse: 0xA8214A,
  wood: 0xD9C29A, woodEnd: 0xBCA47C,
};
const FLAT_QUAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

function showMsg(text) {
  const el = $('#msg');
  el.style.display = 'flex';
  el.textContent = text;
}

/* ---- draft mode (Cutting Mat M1 contract §4) --------------------------
   /viewer/:slug?draft=1 reads the in-memory working draft instead of the
   saved design, and rebuilds the scene whenever the Mat posts
   {type:'cuttingmat:design', design} — preserving the camera and the
   FLAT⟷BUILT slider. Renderer/scene/camera/controls live in a persistent
   "stage" so a rebuild never allocates a second WebGL context.          */
let stage = null;
let live = null; // the build currently on screen: { partsGroup, abort }

function getStage() {
  if (stage) return stage;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('#scene').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.bg);

  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.52;

  scene.add(new THREE.HemisphereLight(0xfff8ec, 0xd6c7ab, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  scene.add(key);
  scene.add(key.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.ShadowMaterial({ opacity: 0.24 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  stage = { renderer, scene, camera, controls, key };
  return stage;
}

// Camera + slider state, captured before a rebuild so the kid never loses
// their viewpoint mid-edit.
function snapshot() {
  if (!stage || !live) return null;
  const { camera, controls } = stage;
  return {
    pos: camera.position.clone(),
    quat: camera.quaternion.clone(),
    target: controls.target.clone(),
    t: clamp(Number($('#slider').value) / 1000, 0, 1),
  };
}

function teardown() {
  if (!live) return;
  live.abort.abort();
  stage.renderer.setAnimationLoop(null);
  stage.scene.remove(live.partsGroup);
  live.partsGroup.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x && x.dispose());
    else if (m) m.dispose();
  });
  $('#partRows').innerHTML = '';
  $('#ticks').innerHTML = '';
  live = null;
}

async function main() {
  const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop());
  const draftMode = new URLSearchParams(location.search).get('draft') === '1';
  let res = draftMode
    ? await fetch('/api/designs/' + encodeURIComponent(slug) + '/draft')
    : null;
  // before the draft endpoint exists (or for a slug with no draft) fall back to
  // the saved design — the Mat still drives this frame by postMessage
  const fromDraft = !!(res && res.ok);
  if (!fromDraft) res = await fetch('/api/designs/' + encodeURIComponent(slug));
  if (!res.ok) throw new Error('design "' + slug + '" not found');
  const body = await res.json();
  const design = fromDraft ? body.design : body;

  // Dev-only mechanics mock (?mock=1 on monster-truck): injects a fake dowel
  // hardware entry + revolute mechanisms so the MECHANICS-SPEC viewer features
  // can be exercised before a real mechanized design exists. Client-side only.
  if (new URLSearchParams(location.search).get('mock') === '1' &&
      slug === 'monster-truck' && !(design.mechanisms || []).length) {
    design.hardware = [{
      id: 'mock-dowel', kind: 'dowel', diameterIn: 0.25, lengthIn: 7, count: 2,
      label: 'mock 1/4-inch dowel',
    }];
    design.mechanisms = [
      { type: 'revolute', id: 'mock-front', axle: 'mock-dowel',
        spins: ['fr-disc-0', 'fr-disc-1', 'fr-disc-2', 'fr-face',
                'fl-disc-0', 'fl-disc-1', 'fl-disc-2', 'fl-face'] },
      { type: 'revolute', id: 'mock-rear', axle: 'mock-dowel',
        spins: ['rr-disc-0', 'rr-disc-1', 'rr-disc-2', 'rr-face',
                'rl-disc-0', 'rl-disc-1', 'rl-disc-2', 'rl-face'] },
    ];
    design.assembly.instances.push(
      { id: 'mock-axle-front', hardware: 'mock-dowel', copy: 0, order: 3,
        pos: [3.44, 5.7, 0], rot: [0, 90, 0] },
      { id: 'mock-axle-rear', hardware: 'mock-dowel', copy: 1, order: 3,
        pos: [9.64, 5.7, 0], rot: [0, 90, 0] },
    );
  }

  build(design);

  if (draftMode) {
    // The Mat posts its working document ~300ms after every edit.
    addEventListener('message', (ev) => {
      const d = ev.data;
      if (!d || d.type !== 'cuttingmat:design' || !d.design) return;
      try {
        build(d.design, snapshot());
      } catch (err) {
        console.error(err);
        showMsg('Could not rebuild the preview: ' + err.message);
      }
    });
    if (window.parent !== window) parent.postMessage({ type: 'cuttingmat:viewer-ready' }, '*');
  }
}

// Build (or rebuild) the scene from a design document. `restore` (a snapshot()
// from the previous build) pins the camera and the FLAT⟷BUILT slider.
function build(design, restore) {
  teardown();
  const { renderer, scene, camera, controls, key } = getStage();
  const abort = new AbortController();
  const signal = abort.signal;
  const slug = design.slug || '';

  document.title = (design.title || slug) + ' — 3D Preview';
  $('#title').textContent = design.title || slug;
  $('#subtitle').textContent = '3D assembly preview — drag to orbit, scroll to zoom';
  $('#msg').style.display = 'none';

  if (!design.assembly || !Array.isArray(design.assembly.instances) || !design.assembly.instances.length) {
    showMsg('This design has no 3D assembly data yet. Re-generate it to add the fold-up preview.');
    return;
  }
  const TH = typeof design.assembly.thicknessIn === 'number' ? design.assembly.thicknessIn : 0.15;
  const DEPTH = TH - 0.004; // slightly thin so stacked layers never share a face
  const partsById = new Map((design.parts || []).map((p) => [p.id, p]));
  const hardwareById = new Map((design.hardware || []).map((h) => [h.id, h]));

  // --- shared materials (face/side cloned per instance for the highlight pulse) ---
  const mats = {
    face: new THREE.MeshStandardMaterial({
      color: COLORS.face, roughness: 0.92, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }),
    side: new THREE.MeshStandardMaterial({
      color: COLORS.side, roughness: 0.96, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }),
    edge: new THREE.LineBasicMaterial({ color: COLORS.edge, transparent: true, opacity: 0.5 }),
    groove: new THREE.LineBasicMaterial({ color: COLORS.groove, transparent: true, opacity: 0.65 }),
    // hardware (dowels/skewers/straws): smooth wood barrel + darker flat ends
    wood: new THREE.MeshStandardMaterial({ color: COLORS.wood, roughness: 0.72, metalness: 0 }),
    woodEnd: new THREE.MeshStandardMaterial({ color: COLORS.woodEnd, roughness: 0.85, metalness: 0 }),
  };

  // --- build every instance ---
  const partsGroup = new THREE.Group();
  scene.add(partsGroup);
  const records = [];

  for (const inst of design.assembly.instances) {
    // hardware instance (MECHANICS-SPEC): a wooden cylinder, axis = local X
    // before rot, animated through the build like any cardboard part
    if (inst.hardware) {
      const hw = hardwareById.get(inst.hardware);
      if (!hw) continue;
      const rad = Math.max((hw.diameterIn || 0.25) / 2, 0.02);
      const len = Math.max(hw.lengthIn || 1, 0.1);
      const woodMat = mats.wood.clone();
      const endMat = mats.woodEnd.clone();
      const geo = new THREE.CylinderGeometry(rad, rad, len, 24);
      geo.rotateZ(-Math.PI / 2); // CylinderGeometry axis Y → local X
      const mesh = new THREE.Mesh(geo, [woodMat, endMat, endMat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const container = new THREE.Group();
      container.add(mesh);
      partsGroup.add(container);
      const hrot = inst.rot || [0, 0, 0];
      records.push({
        inst, isHardware: true,
        part: { name: hw.id, count: hw.count ?? 1 },
        container, hinges: [], faceMat: woodMat, sideMat: endMat,
        uvBox: { minU: -len / 2, maxU: len / 2, minV: -rad, maxV: rad },
        flatLift: rad,
        flatPos: new THREE.Vector3(),
        finalPos: new THREE.Vector3(...(inst.pos || [0, 0, 0])),
        finalQuat: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(hrot[0] * DEG, hrot[1] * DEG, hrot[2] * DEG, 'XYZ')),
        window: [0, 1],
      });
      continue;
    }
    const part = partsById.get(inst.part);
    if (!part) continue;
    const data = buildFoldTree(part, inst.folds, !!inst.mirror);

    const faceMat = mats.face.clone();
    const sideMat = mats.side.clone();
    const container = new THREE.Group();
    const inner = new THREE.Group();
    if (inst.mirror) inner.rotation.y = Math.PI;
    container.add(inner);

    // hinge-tree groups: the root region sits in the part's base frame; every
    // other region's group pivots at the crease it shares with its parent
    const hingeCtl = [];
    const nodes = new Array(data.regions.length);
    for (const ri of data.order) {
      const r = data.regions[ri];
      let g = inner, px = 0, py = 0;
      if (r.parent >= 0) {
        const pn = nodes[r.parent];
        g = new THREE.Group();
        px = r.pivot[0]; py = r.pivot[1];
        g.position.set(px - pn.px, py - pn.py, 0);
        pn.g.add(g);
        if (r.target) {
          hingeCtl.push({
            group: g,
            axis: new THREE.Vector3(r.axis[0], r.axis[1], 0).normalize(),
            target: r.target,
          });
        }
      }
      nodes[ri] = { g, px, py };
      if (r.poly.length < 3) continue;
      const shape = new THREE.Shape(r.poly.map((p) => new THREE.Vector2(p[0], p[1])));
      for (const hole of r.holes) {
        shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p[0], p[1]))));
      }
      const geo = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: false });
      const mesh = new THREE.Mesh(geo, [faceMat, sideMat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(-px, -py, 0);
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), mats.edge));
      // decorative (non-hinging) slits: dark score lines on the front face
      for (const gpts of r.grooves) {
        const lg = new THREE.BufferGeometry().setFromPoints(
          gpts.map((p) => new THREE.Vector3(p[0], p[1], DEPTH + 0.002)));
        mesh.add(new THREE.Line(lg, mats.groove));
      }
      g.add(mesh);
    }

    partsGroup.add(container);
    const rot = inst.rot || [0, 0, 0];
    records.push({
      inst, part,
      container, hinges: hingeCtl, faceMat, sideMat,
      uvBox: uvBBox(part.path),
      flatLift: inst.mirror ? DEPTH : 0,
      flatPos: new THREE.Vector3(),
      finalPos: new THREE.Vector3(...(inst.pos || [0, 0, 0])),
      finalQuat: new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ')),
      window: [0, 1],
    });
  }

  // --- animation windows: order values are TIME SLOTS (~30% overlap between
  // consecutive slots). An order whose next present order skips values keeps
  // animating through the gap — a long fold (box net) can take several slots.
  // Consecutive orders 0..n-1 reduce exactly to the old equal-window layout.
  const orders = [...new Set(records.map((r) => r.inst.order ?? 0))].sort((a, b) => a - b);
  const maxO = orders[orders.length - 1];
  const slotW = 1 / (0.7 * maxO + 1);
  const orderInfo = orders.map((o, i) => ({
    order: o,
    start: 0.7 * slotW * o,
    end: Math.min(1, 0.7 * slotW * ((i + 1 < orders.length ? orders[i + 1] : maxO + 1) - 1) + slotW),
    step: records.find((r) => (r.inst.order ?? 0) === o && Number.isInteger(r.inst.step))?.inst.step,
  }));
  for (const r of records) {
    const oi = orderInfo[orders.indexOf(r.inst.order ?? 0)];
    r.window = [oi.start, oi.end];
  }

  /* ---- mechanisms (MECHANICS-SPEC): revolute spins about the axle's axis ----
     Each instance named in a mechanism's `spins` is bound to its nearest axle
     hardware instance (shortest distance from the wheel's final position to
     the axle's world axis line). During the build it gets a settle quarter-turn
     that lands exactly on the final pose; in ROLL mode it adds distance ÷ its
     own wheel radius, sign chosen so ground contact never slides. */
  const UP = new THREE.Vector3(0, 1, 0);
  const recById = new Map(records.map((r) => [r.inst.id, r]));
  const spinRecs = [];
  for (const mech of design.mechanisms || []) {
    if (mech.type !== 'revolute') continue;
    const axles = records
      .filter((r) => r.isHardware && r.inst.hardware === mech.axle)
      .map((a) => ({
        p: a.finalPos,
        dir: new THREE.Vector3(1, 0, 0).applyQuaternion(a.finalQuat).normalize(),
      }));
    if (!axles.length) continue;
    for (const sid of mech.spins || []) {
      const r = recById.get(sid);
      if (!r || r.spin) continue;
      let best = axles[0], bd = Infinity;
      for (const a of axles) {
        const v = new THREE.Vector3().subVectors(r.finalPos, a.p);
        const d = v.addScaledVector(a.dir, -v.dot(a.dir)).length();
        if (d < bd) { bd = d; best = a; }
      }
      const du = r.uvBox.maxU - r.uvBox.minU, dv = r.uvBox.maxV - r.uvBox.minV;
      r.spin = { p: best.p, dir: best.dir, radius: Math.max(du, dv) / 2 || 1, rollSign: 1 };
      spinRecs.push(r);
    }
  }
  // roll direction: perpendicular (on the ground) to the first axle's axis;
  // no-slip sign per wheel: v·D = r·ω·(axis × up) ⇒ θ = d/r · sign((axis×up)·D)
  const rollDir = new THREE.Vector3(1, 0, 0);
  if (spinRecs.length) {
    const c = new THREE.Vector3().crossVectors(spinRecs[0].spin.dir, UP);
    if (c.lengthSq() > 1e-6) rollDir.copy(c).normalize();
    for (const r of spinRecs) {
      const ci = new THREE.Vector3().crossVectors(r.spin.dir, UP);
      r.spin.rollSign = (ci.dot(rollDir) < 0 ? -1 : 1);
    }
  }
  let rollDist = 0; // inches travelled along rollDir (0 unless ROLL is on)
  const _sq = new THREE.Quaternion(), _sp = new THREE.Vector3(), _sq2 = new THREE.Quaternion();

  let hot = null; // parts-list hover target (declared before applyT uses it)
  function applyT(t) {
    for (const r of records) {
      const s = smoothstep((t - r.window[0]) / (r.window[1] - r.window[0]));
      if (r.spin && (s < 1 || rollDist !== 0)) {
        // rigid rotation of the final pose about the axle's world axis:
        // settle quarter-turn (-90°→0 across the window) + rolling angle
        const theta = (s - 1) * (Math.PI / 2) +
          (rollDist / r.spin.radius) * r.spin.rollSign;
        _sq.setFromAxisAngle(r.spin.dir, theta);
        _sp.copy(r.finalPos).sub(r.spin.p).applyQuaternion(_sq).add(r.spin.p);
        _sq2.multiplyQuaternions(_sq, r.finalQuat);
        r.container.position.lerpVectors(r.flatPos, _sp, s);
        r.container.quaternion.slerpQuaternions(FLAT_QUAT, _sq2, s);
      } else {
        r.container.position.lerpVectors(r.flatPos, r.finalPos, s);
        r.container.quaternion.slerpQuaternions(FLAT_QUAT, r.finalQuat, s);
      }
      for (const h of r.hinges) h.group.quaternion.setFromAxisAngle(h.axis, h.target * s);
      // subtle crimson glow on whatever is currently moving through its window
      r.active = s > 0.002 && s < 0.998;
      if (r !== hot) {
        r.faceMat.emissiveIntensity = r.active ? 0.18 : 0;
        r.sideMat.emissiveIntensity = r.active ? 0.09 : 0;
      }
    }
    $('#caption').textContent = captionFor(t);
  }

  function captionFor(t) {
    if (t <= 0.001) return 'Flat-cut parts, front face up — slide toward BUILT';
    let cur = null;
    for (const oi of orderInfo) if (t >= oi.start + 1e-6) cur = oi;
    if (!cur || !Number.isInteger(cur.step) || !design.steps?.[cur.step]) return '';
    return 'Step ' + (cur.step + 1) + ' · ' + design.steps[cur.step].title + (t >= 0.999 ? ' — built!' : '');
  }

  // --- measure the assembled toy, then lay the flat parts out beside it ---
  applyT(1);
  partsGroup.updateMatrixWorld(true);
  const builtBox = new THREE.Box3().setFromObject(partsGroup);

  (function layoutFlat() {
    const gap = 0.9;
    const cols = [[], []];
    records.forEach((r, i) => cols[i % 2].push(r));
    const midZ = (builtBox.min.z + builtBox.max.z) / 2;
    cols.forEach((col, ci) => {
      const total = col.reduce((s, r) => s + (r.uvBox.maxV - r.uvBox.minV), 0) + gap * (col.length - 1);
      let z = midZ - total / 2;
      for (const r of col) {
        const w = r.uvBox.maxU - r.uvBox.minU;
        const cellX = ci === 0 ? builtBox.min.x - 1.4 - w : builtBox.max.x + 1.4;
        // flat pose maps local (x,y,z) → world (x, z, -y): px offsets u, pz offsets v
        r.flatPos.set(
          cellX - r.uvBox.minU,
          (r.flatLift || 0) + 0.02,
          z - r.uvBox.minV
        );
        z += (r.uvBox.maxV - r.uvBox.minV) + gap;
      }
    });
  })();

  applyT(0);
  partsGroup.updateMatrixWorld(true);
  const flatBox = new THREE.Box3().setFromObject(partsGroup);
  const unionBox = builtBox.clone().union(flatBox);

  // key light + shadow frustum sized to the whole scene
  const uc = unionBox.getCenter(new THREE.Vector3());
  const us = unionBox.getSize(new THREE.Vector3());
  const uRad = 0.5 * Math.hypot(us.x, us.y, us.z);
  // wheel-zoom clamps: the model can never be lost to the near plane or infinity
  controls.minDistance = Math.max(uRad * 0.18, 0.8);
  controls.maxDistance = uRad * 7;
  key.position.set(uc.x + uRad * 0.85, uc.y + uRad * 1.15, uc.z + uRad * 0.6);
  key.target.position.copy(uc);
  key.target.updateMatrixWorld();
  const sc = key.shadow.camera;
  sc.left = -uRad * 1.2; sc.right = uRad * 1.2;
  sc.top = uRad * 1.2; sc.bottom = -uRad * 1.2;
  sc.near = 0.5; sc.far = uRad * 5;
  sc.updateProjectionMatrix();

  function fitCamera(box, pad = 1.02) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.5 * Math.hypot(size.x, size.y, size.z), 2) * pad;
    const vfov = camera.fov * DEG;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const dist = radius / Math.sin(Math.min(vfov, hfov) / 2);
    // optional ?cam=x,y,z view direction (debug / sharing a viewpoint)
    const q = (new URLSearchParams(location.search).get('cam') || '').split(',').map(Number);
    const dir = q.length === 3 && q.every(Number.isFinite) && q.some((v) => v !== 0)
      ? new THREE.Vector3(...q) : new THREE.Vector3(0.62, 0.5, 0.92);
    camera.position.copy(center).addScaledVector(dir.normalize(), dist);
    camera.near = Math.max(dist / 100, 0.05);
    camera.far = dist * 30;
    camera.updateProjectionMatrix();
    controls.target.copy(center).setY(Math.max(center.y * 0.6, 0.5));
    controls.update();
  }

  // --- UI: slider, play, roll, reset, parts list, ?t= param ---
  const slider = $('#slider');
  const playBtn = $('#play');
  const rollBtn = $('#roll');
  let t = 1, playing = false, lastTick = 0;
  let rolling = false, rollPhase = 0;
  const qT = parseFloat(new URLSearchParams(location.search).get('t'));
  if (Number.isFinite(qT)) t = clamp(qT, 0, 1);
  if (restore) t = restore.t;
  slider.value = String(Math.round(t * 1000));

  const setPlaying = (p) => {
    playing = p;
    playBtn.innerHTML = p ? '&#10074;&#10074; Pause' : '&#9654;&#xFE0E; Play';
  };

  // ROLL: only offered when a mechanism actually resolved to spinnable wheels.
  // The finished toy (t forced to 1) shuttles back and forth along rollDir over
  // a ~6s loop while each wheel turns by distance ÷ its own radius (kinematic).
  const ROLL_SECS = 6;
  const bSize = builtBox.getSize(new THREE.Vector3());
  const rollAmp = Math.max(
    0.55 * Math.abs(bSize.x * rollDir.x + bSize.z * rollDir.z), 2.5);
  const setRolling = (on) => {
    if (!spinRecs.length) return;
    rolling = on;
    rollBtn.classList.toggle('on', on);
    rollBtn.innerHTML = on ? '&#9632;&#xFE0E; Stop' : '&#8635;&#xFE0E; Roll';
    if (on) {
      setPlaying(false);
      rollPhase = 0;
      t = 1;
      slider.value = '1000';
    } else {
      rollDist = 0;
      partsGroup.position.set(0, 0, 0);
    }
    applyT(t);
  };
  rollBtn.style.display = spinRecs.length ? '' : 'none';
  if (spinRecs.length) {
    rollBtn.addEventListener('click', () => setRolling(!rolling), { signal });
  }

  slider.addEventListener('input', () => {
    setPlaying(false);
    if (rolling) setRolling(false);
    t = slider.value / 1000;
    applyT(t);
  }, { signal });
  playBtn.addEventListener('click', () => {
    if (rolling) setRolling(false);
    if (!playing && t >= 0.999) { t = 0; applyT(t); slider.value = '0'; }
    setPlaying(!playing);
    lastTick = performance.now();
  }, { signal });
  $('#reset').addEventListener('click', () => fitCamera(builtBox), { signal });

  // discrete step ticks on the BUILD slider: one per distinct order, each
  // clickable to jump to that step's completed pose (its window end)
  const ticksEl = $('#ticks');
  orderInfo.forEach((oi, i) => {
    const end = clamp(oi.end, 0, 1);
    const tick = document.createElement('button');
    tick.type = 'button';
    tick.className = 'tick';
    tick.style.left = (end * 100) + '%';
    tick.title = Number.isInteger(oi.step) && design.steps?.[oi.step]
      ? 'Jump to: ' + design.steps[oi.step].title
      : 'Jump to build step ' + (i + 1);
    tick.addEventListener('click', () => {
      setPlaying(false);
      if (rolling) setRolling(false);
      t = end;
      slider.value = String(Math.round(t * 1000));
      applyT(t);
    });
    ticksEl.appendChild(tick);
  });

  // parts list with press/hover highlight (the 2D↔3D link)
  const rowsEl = $('#partRows');
  for (const r of records) {
    const row = document.createElement('div');
    row.className = 'prow';
    const label = r.part.name + (r.part.count > 1 ? ' · copy ' + ((r.inst.copy ?? 0) + 1) : '');
    row.innerHTML = '<span class="sw"></span><span>' + label + '</span>';
    const on = () => { hot = r; row.classList.add('hot'); };
    const off = () => {
      if (hot === r) hot = null;
      row.classList.remove('hot');
      r.faceMat.emissiveIntensity = r.active ? 0.18 : 0;
      r.sideMat.emissiveIntensity = r.active ? 0.09 : 0;
    };
    row.addEventListener('mouseenter', on);
    row.addEventListener('mouseleave', off);
    row.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
    row.addEventListener('touchend', off);
    r.faceMat.emissive = new THREE.Color(COLORS.pulse);
    r.sideMat.emissive = new THREE.Color(COLORS.pulse);
    r.faceMat.emissiveIntensity = 0;
    r.sideMat.emissiveIntensity = 0;
    rowsEl.appendChild(row);
  }

  slider.value = String(Math.round(t * 1000));
  applyT(t);
  if (restore) {
    // same viewpoint as before the edit — only the geometry changed
    camera.position.copy(restore.pos);
    camera.quaternion.copy(restore.quat);
    controls.target.copy(restore.target);
    const dist = camera.position.distanceTo(controls.target);
    camera.near = Math.max(dist / 100, 0.05);
    camera.far = dist * 30;
    camera.updateProjectionMatrix();
    controls.update();
  } else {
    fitCamera(t > 0.6 ? builtBox : unionBox);
  }
  live = { partsGroup, abort };

  // --- render loop: geometry is built once; only matrices animate ---
  const PLAY_SECS = 8;
  renderer.setAnimationLoop((now) => {
    if (playing) {
      t = Math.min(1, t + (now - lastTick) / (PLAY_SECS * 1000));
      slider.value = String(Math.round(t * 1000));
      applyT(t);
      if (t >= 1) setPlaying(false);
    } else if (rolling) {
      rollPhase += (now - lastTick) / 1000;
      rollDist = rollAmp * Math.sin(rollPhase * 2 * Math.PI / ROLL_SECS);
      partsGroup.position.set(rollDir.x * rollDist, 0, rollDir.z * rollDist);
      applyT(1);
    }
    lastTick = now;
    if (hot) {
      // unmistakably crimson: strong emissive pulse while the row is held
      const k = 0.85 + 0.25 * Math.sin(now * 0.009);
      hot.faceMat.emissiveIntensity = k;
      hot.sideMat.emissiveIntensity = k * 0.6;
    }
    controls.update();
    renderer.render(scene, camera);
  });
}

main().catch((err) => {
  console.error(err);
  showMsg('Could not load the 3D preview: ' + err.message);
});
