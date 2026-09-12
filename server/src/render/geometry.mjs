// Geometry helpers: SVG path parsing (bbox, sampling) for design parts.
// Design coordinate space: inches, y-down, origin at part's top-left region.
// AI-generated paths must use M/L/H/V/C/S/Q/T/Z (no arcs) — enforced by schema.

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi;

export function parsePath(d) {
  // Tokenize into command segments
  const segs = [];
  const re = /([MLHVCSQTZAmlhvcsqtza])([^MLHVCSQTZAmlhvcsqtza]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const cmd = m[1];
    const nums = (m[2].match(NUM) || []).map(Number);
    segs.push({ cmd, nums });
  }
  return segs;
}

// Sample a path into polyline points (for bbox + previews). Returns [[x,y],...]
export function samplePath(d, curveSteps = 16) {
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
          // subsequent pairs are implicit L
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
          i = Infinity; // Z consumes no numbers; exit inner loop
          break;
        }
        default:
          // Unsupported command (e.g. A) — skip its numbers
          i = Infinity;
      }
      prevCmd = C;
      if (C === 'Z') break;
    }
  }
  return pts;
}

export function pathBBox(d) {
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

export function unionBBox(boxes) {
  const bs = boxes.filter(Boolean);
  if (!bs.length) return null;
  return bs.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    get width() { return this.maxX - this.minX; },
    get height() { return this.maxY - this.minY; },
  }));
}

// --------------------------------------------------------------- entry shape
// holes[] / slits[] entries are EITHER a bare path string (legacy) or an
// object { id, d } (editor-assigned stable ids — see docs/cad-studio/DESIGN.md
// §2.1). Every consumer goes through these helpers, so both shapes work.

export const pathD = (entry) =>
  typeof entry === 'string' ? entry
    : (entry && typeof entry === 'object' && typeof entry.d === 'string') ? entry.d
      : null;

export const entryId = (entry) =>
  (entry && typeof entry === 'object' && typeof entry.id === 'string') ? entry.id : null;

const listPaths = (list) => (list || []).map(pathD).filter((d) => typeof d === 'string');
export const holePaths = (part) => listPaths(part.holes);
export const slitPaths = (part) => listPaths(part.slits);

// Same part with holes/slits flattened to plain path strings — what the
// renderers want (they never need ids).
export const flatPart = (part) => ({ ...part, holes: holePaths(part), slits: slitPaths(part) });

// All paths belonging to a part (outline + holes + slits + backing)
export function partBBox(part) {
  const paths = [part.path, ...holePaths(part), ...slitPaths(part)];
  if (part.backing) paths.push(part.backing);
  return unionBBox(paths.map(pathBBox));
}

// ----------------------------------------------------------------- transform
// Affine transform of path data, done NUMERICALLY: parse, map every point,
// re-serialize as absolute commands. (pdf-lib's rotate would rotate the whole
// canvas, not the path, and would not survive bbox math or the overview page.)
// m = [a, b, c, d, e, f]:  x' = a*x + c*y + e,  y' = b*x + d*y + f
// Relative commands become absolute and H/V become L; C/S/Q/T keep their
// command letter (an affine map commutes with the control-point reflection
// that S and T imply, so the smoothness is preserved exactly).

const fmt = (n) => {
  const r = Math.abs(n) < 1e-9 ? 0 : Math.round(n * 1e6) / 1e6;
  return String(r);
};

export function transformPath(d, m) {
  const [a, b, c, dd, e, f] = m;
  const P = (x, y) => `${fmt(a * x + c * y + e)} ${fmt(b * x + dd * y + f)}`;
  const out = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;

  for (const { cmd, nums } of parsePath(d)) {
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    let i = 0;
    const n = () => nums[i++];
    if (C === 'Z') { out.push('Z'); cx = sx; cy = sy; continue; }
    let first = true;
    while (i < nums.length) {
      switch (C) {
        case 'M': {
          let x = n(), y = n();
          if (rel) { x += cx; y += cy; }
          out.push(first ? `M ${P(x, y)}` : `L ${P(x, y)}`); // implicit L after M
          if (first) { sx = x; sy = y; }
          cx = x; cy = y;
          break;
        }
        case 'L': case 'T': {
          let x = n(), y = n();
          if (rel) { x += cx; y += cy; }
          out.push(`${C} ${P(x, y)}`);
          cx = x; cy = y;
          break;
        }
        case 'H': {
          let x = n();
          if (rel) x += cx;
          out.push(`L ${P(x, cy)}`);
          cx = x;
          break;
        }
        case 'V': {
          let y = n();
          if (rel) y += cy;
          out.push(`L ${P(cx, y)}`);
          cy = y;
          break;
        }
        case 'C': {
          let x1 = n(), y1 = n(), x2 = n(), y2 = n(), x = n(), y = n();
          if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
          out.push(`C ${P(x1, y1)} ${P(x2, y2)} ${P(x, y)}`);
          cx = x; cy = y;
          break;
        }
        case 'S': case 'Q': {
          let x1 = n(), y1 = n(), x = n(), y = n();
          if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; }
          out.push(`${C} ${P(x1, y1)} ${P(x, y)}`);
          cx = x; cy = y;
          break;
        }
        default:
          i = nums.length; // unsupported (A) — drop, schema rejects it anyway
      }
      first = false;
    }
  }
  return out.join(' ');
}

// Transform an {x, y} annotation anchor (labelAt / arrowAt / noteAt).
export const transformPoint = (p, [a, b, c, d, e, f]) =>
  ({ ...p, x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f });

// Matrix for a part's `layout`: translate so the part's PRE-ROTATION bbox
// min-corner lands at (x, y), then rotate clockwise (y-down space) about the
// translated bbox center. One shared mental model with the Mat:
//   place(u,v) = R(rotDeg, center) · (u - bb.minX + x, v - bb.minY + y)
export function layoutMatrix(layout, bb) {
  const x = layout.x, y = layout.y;
  const th = (layout.rotDeg || 0) * Math.PI / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const tx = x - bb.minX, ty = y - bb.minY;
  const cx = x + bb.width / 2, cy = y + bb.height / 2;
  return [
    cos, sin, -sin, cos,
    cx + (tx - cx) * cos - (ty - cy) * sin,
    cy + (tx - cx) * sin + (ty - cy) * cos,
  ];
}

// A part with its `layout` baked into real coordinates (holes/slits flattened
// to strings on the way through). Returns null when the part can't be measured.
export function placeByLayout(part) {
  const bb = partBBox(part);
  if (!bb) return null;
  const m = layoutMatrix(part.layout, bb);
  const out = flatPart(part);
  out.path = transformPath(part.path, m);
  out.holes = out.holes.map((d) => transformPath(d, m));
  out.slits = out.slits.map((d) => transformPath(d, m));
  if (part.backing) out.backing = transformPath(part.backing, m);
  for (const key of ['labelAt', 'arrowAt', 'noteAt']) {
    if (part[key] && Number.isFinite(part[key].x) && Number.isFinite(part[key].y)) {
      out[key] = transformPoint(part[key], m);
    }
  }
  // The flute arrow rides along: a part turned 90° must tell the builder to run
  // the corrugation along its NEW long axis, or the sheet contradicts the part
  // printed on it. `corrugation` can only say "vertical"/"horizontal", so the
  // exact angle travels in `corrugationDeg` (what templates.mjs draws) and the
  // string is re-pointed at the nearer axis for anything that still reads it.
  if (part.corrugation) {
    const deg = corrugationBaseDeg(part.corrugation) + (part.layout.rotDeg || 0);
    out.corrugationDeg = deg;
    const q = ((deg % 180) + 180) % 180;              // 0..180, axis-only
    out.corrugation = (q < 45 || q >= 135) ? 'horizontal' : 'vertical';
  }
  return out;
}

// Angle (deg, clockwise from +x in y-down space) the legacy direction strings
// mean — the same convention pdfkit.drawCorrugationArrow draws.
export const corrugationBaseDeg = (dir) => (dir === 'horizontal' ? 0 : -90);

// True when EVERY part carries a usable layout — the renderer then skips shelf
// packing entirely (no mixed mode: one part without a layout means auto-pack).
export const hasFullLayout = (parts) =>
  Array.isArray(parts) && parts.length > 0 && parts.every(
    (p) => p && p.layout && Number.isFinite(p.layout.x) && Number.isFinite(p.layout.y)
      && (p.layout.rotDeg === undefined || Number.isFinite(p.layout.rotDeg)));
