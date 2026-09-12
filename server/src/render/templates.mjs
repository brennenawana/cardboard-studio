// Template (cut-sheet) renderer.
// Reproduces the Reuse & Play conventions documented in reference/FORMAT-SPEC.md:
//  - global 1" light grid + 3" heavy grid, drawn edge-to-edge on every page
//  - pages tile a global inch-space with 1" overlap; grid stays continuous
//  - giant light-gray page numeral behind artwork
//  - bold black outlines, dashed gray backing copies, thin dashed slits
//  - part labels ("Name - N pcs") and corrugation-direction arrows
// Beyond R&P we add (fixes from blind critique):
//  - shelf packing: parts sit side-by-side across the page width before the
//    layout grows downward, so no sheet prints as blank grid
//  - seam avoidance: a shelf that would straddle a page seam (and fits on one
//    page) is pushed below the overlap strip instead of printing split
//  - a KEY box (cut vs score legend, piece counts, lamination note, 1-inch
//    scale check, tape map of the sheets) placed in provably empty grid
//  - a small sheet footer ("SHEET n OF m … sheet k joins below") per page
//  - crimson circle-cross registration marks printed at identical global
//    coordinates inside each overlap strip, so matching marks align sheets

import { PDFDocument, degrees } from 'pdf-lib';
import { partBBox, pathBBox, samplePath, flatPart, placeByLayout, hasFullLayout } from './geometry.mjs';
import {
  IN, PAGE, COLORS, loadFonts, drawPath, drawLine, drawText, drawParagraph,
  drawRect, drawCorrugationArrow, topY,
} from './pdfkit.mjs';

const OVERLAP = 1.0;      // inches of overlap between adjacent pages
const LAYOUT_PAD = 0.6;   // inches between parts in global space
const EDGE_PAD = 0.35;    // inches from page/layout edge to part geometry

// Compute a global layout in shared inch-space using shelf packing: parts are
// sorted tallest-first and placed left-to-right across the usable page width;
// a new shelf (row) starts only when the current one is full. Shelves that
// would straddle a horizontal page seam — but fit on a single page — are
// pushed past the overlap strip so no part prints needlessly split.
export function layoutParts(parts, paper = 'letter') {
  if (hasFullLayout(parts)) return manualLayout(parts);
  const { w: pw, h: ph } = PAGE[paper];
  const usableRight = pw - EDGE_PAD;
  const stepH = ph - OVERLAP;

  const items = parts
    .map(part => ({ part: flatPart(part), bb: partBBox(part) }))
    .filter(it => it.bb);
  items.sort((a, b) => b.bb.height - a.bb.height);

  // If a shelf [y, y+h] crosses the bottom of the page-row containing y and
  // could fit wholly on one page, start it below the next seam's overlap.
  const avoidSeam = (y, h) => {
    if (h > ph - OVERLAP - 2 * EDGE_PAD) return y; // can't fit one page anyway
    const row = Math.max(0, Math.floor(y / stepH));
    const rowBottom = row * stepH + ph;
    if (y + h > rowBottom) return (row + 1) * stepH + OVERLAP + 0.15;
    return y;
  };

  const placed = [];
  let shelfY = EDGE_PAD;
  let shelfH = 0;
  let cursorX = EDGE_PAD;
  for (const { part, bb } of items) {
    if (placed.length && cursorX + bb.width > usableRight) {
      shelfY += shelfH + LAYOUT_PAD;
      cursorX = EDGE_PAD;
      shelfH = 0;
    }
    if (cursorX === EDGE_PAD) {
      shelfY = avoidSeam(shelfY, bb.height);
      shelfH = bb.height;
    } else {
      shelfH = Math.max(shelfH, bb.height);
    }
    placed.push({ part, bb, offsetX: cursorX - bb.minX, offsetY: shelfY - bb.minY });
    cursorX += bb.width + LAYOUT_PAD;
  }

  const width = Math.max(...placed.map(p => p.bb.width + p.offsetX + p.bb.minX)) + EDGE_PAD;
  const height = shelfY + shelfH + EDGE_PAD;
  return { placed, width, height };
}

// Manual (Cutting Mat) layout: every part carries `layout` {x, y, rotDeg}, so
// the sheets print exactly what the Mat shows. The layout is baked into real
// coordinates (path data transformed numerically — see geometry.placeByLayout),
// which means every downstream stage — labels, key box, registration marks,
// overview page, page tiling — keeps working with zero special-casing: from
// here down a placed part is just geometry already sitting in global space.
//
// The sheet is tiled from (0,0) outward, so anything the Mat pushed ABOVE or
// LEFT of the origin — dragging a blade tip upward is the most natural gesture
// there is — used to fall outside every page and silently vanish from the
// print. The whole arrangement therefore slides back inside the sheet's edge
// pad as ONE rigid body (relative positions, the thing the Mat actually shows,
// are preserved exactly), giving manual layouts the same EDGE_PAD guarantee
// the auto-packer gives: no cut line ever lands in a home printer's
// unprintable margin. Content already clear of the pad never moves — the shift
// is 0 for every layout the Mat opens with, and for anything dragged away from
// the origin.
function manualLayout(parts) {
  const placed = [];
  for (const part of parts) {
    const moved = placeByLayout(part);
    if (!moved) continue;
    const bb = partBBox(moved);
    if (!bb) continue;
    placed.push({ part: moved, bb, offsetX: 0, offsetY: 0 });
  }
  if (!placed.length) return { placed, width: PAGE.letter.w, height: PAGE.letter.h };
  const minX = Math.min(...placed.map(p => p.bb.minX));
  const minY = Math.min(...placed.map(p => p.bb.minY));
  const shiftX = Math.max(0, EDGE_PAD - minX);
  const shiftY = Math.max(0, EDGE_PAD - minY);
  if (shiftX || shiftY) for (const p of placed) { p.offsetX = shiftX; p.offsetY = shiftY; }
  const width = Math.max(...placed.map(p => p.bb.maxX)) + shiftX + EDGE_PAD;
  const height = Math.max(...placed.map(p => p.bb.maxY)) + shiftY + EDGE_PAD;
  return { placed, width, height };
}

function pageGrid(page, originX, originY) {
  // Draw global-inch grid across full page. originX/Y = global inches at page top-left.
  const wIn = page.getWidth() / IN;
  const hIn = page.getHeight() / IN;
  // vertical lines at global integer inches
  const firstV = Math.ceil(originX);
  for (let gx = firstV; gx <= originX + wIn; gx++) {
    const x = (gx - originX);
    const heavy = gx % 3 === 0;
    drawLine(page, x, 0, x, hIn, {
      color: heavy ? COLORS.gridHeavy : COLORS.gridLight,
      width: heavy ? 1.6 : 0.6,
    });
  }
  const firstH = Math.ceil(originY);
  for (let gy = firstH; gy <= originY + hIn; gy++) {
    const y = (gy - originY);
    const heavy = gy % 3 === 0;
    drawLine(page, 0, y, wIn, y, {
      color: heavy ? COLORS.gridHeavy : COLORS.gridLight,
      width: heavy ? 1.6 : 0.6,
    });
  }
}

function giantPageNumber(page, num, fonts) {
  const size = 200;
  const label = String(num);
  const w = fonts.reg.widthOfTextAtSize(label, size);
  const cx = page.getWidth() * 0.32;
  const cy = page.getHeight() * 0.5;
  page.drawText(label, {
    x: cx - w / 2, y: cy - size * 0.36,
    size, font: fonts.reg, color: COLORS.pageNum, opacity: 0.55,
  });
}

const LABEL_SIZE = 15;

// Draw a part label reading bottom-to-top (for tall narrow parts whose
// interior cannot fit a horizontal label without crossing cut lines).
function drawRotatedLabel(page, text, cxIn, cyIn, font) {
  const w = font.widthOfTextAtSize(text, LABEL_SIZE);
  page.drawText(text, {
    x: cxIn * IN + LABEL_SIZE * 0.36,
    y: topY(page, cyIn) - w / 2,
    size: LABEL_SIZE, font, color: COLORS.label,
    rotate: degrees(90),
  });
}

// Measured footprint (global inches) of a planned label. Horizontal labels
// anchor at (x = text center, y = baseline); rotated ones at their midpoint.
function labelRect(plan) {
  if (plan.rotate === 90) {
    return {
      x0: plan.x - 0.17, x1: plan.x + 0.12,
      y0: plan.y - plan.textW / 2 - 0.06, y1: plan.y + plan.textW / 2 + 0.06,
    };
  }
  return {
    x0: plan.x - plan.textW / 2 - 0.06, x1: plan.x + plan.textW / 2 + 0.06,
    y0: plan.y - 0.24, y1: plan.y + 0.10,
  };
}

// Plan every part label's final position in GLOBAL inch-space before drawing:
//  - start from labelAt (or the auto spot near the top of the part's bbox)
//  - never clip: shift the label the least distance that puts its whole rect
//    at least EDGE_PAD (0.35") inside SOME sheet's edges — it then prints
//    complete on that sheet (pages where it would clip skip it entirely)
//  - never cross ANOTHER part's cut lines: if it would, try just below, then
//    just above, the label's own part
//  - never overlap another label: stack the later one vertically below
function planLabels(placed, fonts, { cols, rows, stepW, stepH, pw, ph }) {
  const perPartSegs = placed.map(({ part, offsetX, offsetY }) => {
    const paths = [part.path, ...(part.holes || []), ...(part.slits || [])];
    if (part.backing) paths.push(part.backing);
    const segs = [];
    for (const d of paths) {
      const pts = samplePath(d);
      for (let i = 1; i < pts.length; i++) {
        segs.push([pts[i - 1][0] + offsetX, pts[i - 1][1] + offsetY, pts[i][0] + offsetX, pts[i][1] + offsetY]);
      }
    }
    return segs;
  });

  const clampToSheet = (plan) => {
    const r = labelRect(plan);
    const left = plan.x - r.x0, right = r.x1 - plan.x;
    const up = plan.y - r.y0, down = r.y1 - plan.y;
    let best = null;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = Math.min(Math.max(plan.x, col * stepW + EDGE_PAD + left), col * stepW + pw - EDGE_PAD - right);
        const y = Math.min(Math.max(plan.y, row * stepH + EDGE_PAD + up), row * stepH + ph - EDGE_PAD - down);
        const d = Math.abs(x - plan.x) + Math.abs(y - plan.y);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    plan.x = best.x;
    plan.y = best.y;
  };

  const rectsTouch = (r, q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0;
  const hitsForeignPart = (plan) => {
    const r = labelRect(plan);
    return perPartSegs.some((segs, j) => j !== plan.i && segs.some(s => segHitsRect(s, r.x0, r.y0, r.x1, r.y1)));
  };
  const hitsPlannedLabel = (plan, others) =>
    others.some(o => rectsTouch(labelRect(plan), labelRect(o)));

  const plans = placed.map(({ part, bb, offsetX, offsetY }, i) => {
    const text = `${part.name} - ${part.count ?? 1} pcs`;
    const base = part.labelAt || { x: (bb.minX + bb.maxX) / 2, y: bb.minY + 0.45 };
    return {
      i, text,
      rotate: part.labelAt?.rotate === 90 ? 90 : undefined,
      textW: fonts.reg.widthOfTextAtSize(text, LABEL_SIZE) / IN,
      x: base.x + offsetX, y: base.y + offsetY,
      bb, offsetX, offsetY,
    };
  });

  const done = [];
  for (const plan of plans) {
    clampToSheet(plan);
    if (hitsForeignPart(plan) || hitsPlannedLabel(plan, done)) {
      const cx = (plan.bb.minX + plan.bb.maxX) / 2 + plan.offsetX;
      const candidates = plan.rotate === 90 ? [] : [
        { x: cx, y: plan.bb.maxY + plan.offsetY + 0.32 }, // just below the part
        { x: cx, y: plan.bb.minY + plan.offsetY - 0.16 }, // just above the part
      ];
      for (const c of candidates) {
        const trial = { ...plan, x: c.x, y: c.y };
        clampToSheet(trial);
        if (!hitsForeignPart(trial) && !hitsPlannedLabel(trial, done)) {
          plan.x = trial.x;
          plan.y = trial.y;
          break;
        }
      }
    }
    done.push(plan);
  }
  // final de-overlap: any labels still colliding get stacked vertically
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let a = 0; a < done.length; a++) {
      for (let b = a + 1; b < done.length; b++) {
        const ra = labelRect(done[a]), rb = labelRect(done[b]);
        if (rectsTouch(ra, rb)) {
          done[b].y += (ra.y1 - rb.y0) + 0.08;
          clampToSheet(done[b]);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return plans;
}

// ---------------------------------------------------------------------------
// Small-hole diameter labels: any hole ≤ 0.75" across gets a tiny
// 'Ø 0.31" — punch or drill' note beside its crosshair. Planned in global
// inch-space with the same collision rules as part labels: never cross a cut
// line, never touch another label. Identical holes on a part share one note.

const SMALL_HOLE_IN = 0.75;
const HOLE_LABEL_SIZE = 7.5;

function holeLabelRect(p) {
  return {
    x0: p.x - p.textW / 2 - 0.04, x1: p.x + p.textW / 2 + 0.04,
    y0: p.y - 0.12, y1: p.y + 0.04,
  };
}

function planHoleLabels(placed, segs, partLabelPlans, fonts) {
  const plans = [];
  const taken = partLabelPlans.map(labelRect);
  const rectsTouch = (r, q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0;
  for (const { part, offsetX, offsetY } of placed) {
    const seen = new Set();
    for (const hole of part.holes || []) {
      const hb = pathBBox(hole);
      if (!hb || hb.width > SMALL_HOLE_IN || hb.height > SMALL_HOLE_IN) continue;
      const dia = ((hb.width + hb.height) / 2).toFixed(2);
      if (seen.has(dia)) continue; // duplicates keep the crosshair, share the note
      seen.add(dia);
      const text = `Ø ${dia}" — punch or drill`;
      const textW = fonts.reg.widthOfTextAtSize(text, HOLE_LABEL_SIZE) / IN;
      const cx = (hb.minX + hb.maxX) / 2 + offsetX;
      const cy = (hb.minY + hb.maxY) / 2 + offsetY;
      const r = Math.max(hb.width, hb.height) / 2;
      const candidates = [
        { x: cx, y: cy + r + 0.26 },                    // below the hole
        { x: cx, y: cy - r - 0.16 },                    // above
        { x: cx + r + 0.14 + textW / 2, y: cy + 0.04 }, // right
        { x: cx - r - 0.14 - textW / 2, y: cy + 0.04 }, // left
      ];
      let plan = null;
      for (const c of candidates) {
        const trial = { ...c, text, textW };
        const tr = holeLabelRect(trial);
        if (segs.some(s => segHitsRect(s, tr.x0, tr.y0, tr.x1, tr.y1))) continue;
        if (taken.some(q => rectsTouch(tr, q))) continue;
        plan = trial;
        break;
      }
      if (!plan) plan = { ...candidates[0], text, textW }; // least-bad fallback
      taken.push(holeLabelRect(plan));
      plans.push(plan);
    }
  }
  return plans;
}

function drawLabelPlan(page, plan, originX, originY, fonts) {
  if (plan.rotate === 90) {
    drawRotatedLabel(page, plan.text, plan.x - originX, plan.y - originY, fonts.reg);
  } else {
    drawText(page, plan.text, {
      x: plan.x - originX, y: plan.y - originY,
      font: fonts.reg, size: LABEL_SIZE, color: COLORS.label, align: 'center',
    });
  }
}

function drawPlacedPart(page, placed, originX, originY, fonts) {
  const { part, bb, offsetX, offsetY } = placed;
  const ox = offsetX - originX;
  const oy = offsetY - originY;

  // backing (second larger copy) — dashed gray, drawn first
  if (part.backing) {
    drawPath(page, part.backing, { offsetX: ox, offsetY: oy, stroke: COLORS.backing, strokeWidth: 1.6, dash: [5, 4] });
  }
  // main outline
  drawPath(page, part.path, { offsetX: ox, offsetY: oy, stroke: COLORS.outline, strokeWidth: 3 });
  // interior cutouts; small holes (≤ 0.75" — hardware seats) get a crosshair
  // center mark so a punch or drill lands exactly on center
  for (const hole of part.holes || []) {
    drawPath(page, hole, { offsetX: ox, offsetY: oy, stroke: COLORS.outline, strokeWidth: 2.4 });
    const hb = pathBBox(hole);
    if (hb && hb.width <= SMALL_HOLE_IN && hb.height <= SMALL_HOLE_IN) {
      const cx = (hb.minX + hb.maxX) / 2 + ox, cy = (hb.minY + hb.maxY) / 2 + oy;
      const r = Math.max(hb.width, hb.height) / 2 + 0.09;
      drawLine(page, cx - r, cy, cx + r, cy, { color: COLORS.outline, width: 0.9 });
      drawLine(page, cx, cy - r, cx, cy + r, { color: COLORS.outline, width: 0.9 });
    }
  }
  // slits / fold lines — thin dashed
  for (const slit of part.slits || []) {
    drawPath(page, slit, { offsetX: ox, offsetY: oy, stroke: COLORS.outline, strokeWidth: 1.2, dash: [4, 3] });
  }

  // (part labels are planned globally and drawn per-page — see planLabels)

  // corrugation arrow
  if (part.corrugation) {
    const ap = part.arrowAt || { x: (bb.minX + bb.maxX) / 2, y: bb.minY + 1.0 };
    // placeByLayout leaves the exact angle in corrugationDeg for turned parts
    const dir = Number.isFinite(part.corrugationDeg) ? part.corrugationDeg : part.corrugation;
    drawCorrugationArrow(page, ap.x + ox, ap.y + oy, dir);
  }
  // inline note (small annotation text like R&P's "Dash lines is for second, larger copy")
  if (part.note && part.noteAt) {
    drawText(page, part.note, { x: part.noteAt.x + ox, y: part.noteAt.y + oy, font: fonts.reg, size: 9, color: COLORS.textMut });
  }
}

// ---------------------------------------------------------------------------
// Occupancy: global-space rectangles covered by parts (incl. label/arrow),
// used to place the key box, footers and registration marks in empty grid.

function occupiedRects(placed, labelPlans) {
  const partRects = [];  // coarse part bounding boxes
  const annoRects = [];  // labels + corrugation arrows
  for (const { part, bb, offsetX, offsetY } of placed) {
    const pad = 0.25;
    partRects.push({
      x0: bb.minX + offsetX - pad, y0: bb.minY + offsetY - pad,
      x1: bb.maxX + offsetX + pad, y1: bb.maxY + offsetY + pad,
    });
    // corrugation arrow (explicit arrowAt or the auto spot drawPlacedPart uses)
    const ap = part.corrugation
      ? (part.arrowAt || { x: (bb.minX + bb.maxX) / 2, y: bb.minY + 1.0 })
      : null;
    if (ap) {
      annoRects.push({ x0: ap.x + offsetX - 0.55, y0: ap.y + offsetY - 0.55, x1: ap.x + offsetX + 0.55, y1: ap.y + offsetY + 0.55 });
    }
  }
  for (const plan of labelPlans) {
    const r = labelRect(plan);
    annoRects.push({ x0: r.x0 - 0.06, y0: r.y0 - 0.06, x1: r.x1 + 0.06, y1: r.y1 + 0.06 });
  }
  return { partRects, annoRects };
}

const hits = (rects, x0, y0, x1, y1) =>
  rects.some(r => x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0);

// Exact drawn geometry as global-space polyline segments — lets footers and
// registration marks sit close to a part's true outline instead of being
// pushed away by its (much larger) bounding box.
function geometrySegments(placed) {
  const segs = [];
  for (const { part, offsetX, offsetY } of placed) {
    const paths = [part.path, ...(part.holes || []), ...(part.slits || [])];
    if (part.backing) paths.push(part.backing);
    for (const d of paths) {
      const pts = samplePath(d);
      for (let i = 1; i < pts.length; i++) {
        segs.push([pts[i - 1][0] + offsetX, pts[i - 1][1] + offsetY, pts[i][0] + offsetX, pts[i][1] + offsetY]);
      }
    }
  }
  return segs;
}

function segsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const o = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  return o(ax, ay, bx, by, cx, cy) !== o(ax, ay, bx, by, dx, dy)
    && o(cx, cy, dx, dy, ax, ay) !== o(cx, cy, dx, dy, bx, by);
}

function segHitsRect([sx1, sy1, sx2, sy2], x0, y0, x1, y1) {
  if (Math.max(sx1, sx2) < x0 || Math.min(sx1, sx2) > x1) return false;
  if (Math.max(sy1, sy2) < y0 || Math.min(sy1, sy2) > y1) return false;
  const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  if (inside(sx1, sy1) || inside(sx2, sy2)) return true;
  return segsCross(sx1, sy1, sx2, sy2, x0, y0, x1, y0)
    || segsCross(sx1, sy1, sx2, sy2, x1, y0, x1, y1)
    || segsCross(sx1, sy1, sx2, sy2, x1, y1, x0, y1)
    || segsCross(sx1, sy1, sx2, sy2, x0, y1, x0, y0);
}

// Sampled part outlines as closed polygons (global space) — detects when a
// candidate rect sits wholly INSIDE a part, where no outline segment crosses.
function partPolygons(placed) {
  return placed.map(({ part, offsetX, offsetY }) =>
    samplePath(part.path).map(([x, y]) => [x + offsetX, y + offsetY]));
}

function pointInPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// blocked(x0,y0,x1,y1): true when the rect touches part geometry (exact),
// sits inside a part interior, or overlaps a reserved annotation rect
// (labels, arrows, key box, reg marks, footers).
function makeBlocker(segs, rects, polys) {
  return (x0, y0, x1, y1) =>
    hits(rects, x0, y0, x1, y1)
    || segs.some(s => segHitsRect(s, x0, y0, x1, y1))
    || polys.some(p => pointInPoly(p, (x0 + x1) / 2, (y0 + y1) / 2));
}

// ---------------------------------------------------------------------------
// KEY box: legend (cut/score/backing/arrow/registration), piece counts with
// lamination note, 1-inch scale check, and a tape map of the sheet tiling.

// Count the lines drawParagraph will produce (same wrap algorithm).
function wrapLineCount(text, font, size, maxWidthIn) {
  const words = String(text).split(/\s+/);
  const maxW = maxWidthIn * IN;
  let line = '';
  let n = 0;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (font.widthOfTextAtSize(test, size) > maxW && line) { n++; line = word; }
    else line = test;
  }
  return n + (line ? 1 : 0);
}

function keySpec(parts, { cols, rows }, fonts) {
  const w = 3.8;
  const pad = 0.18;
  const hasBacking = parts.some(p => p.backing);
  const multiSheet = cols * rows > 1;
  const keyRows = 3 + (hasBacking ? 1 : 0) + (multiSheet ? 1 : 0);
  const partLines = parts.length;
  // lamination note only when some part is a laminated stack (laminate: true)
  const laminated = parts.filter(p => p.laminate);
  const lamText = laminated.length
    ? `Glue duplicate pieces back-to-back — ${laminated.map(p => p.name).join(', ')} — the layers make it stiff and strong (see guide).`
    : null;
  const lamH = lamText ? 0.06 + wrapLineCount(lamText, fonts.obl, 9, w - 2 * pad) * 0.169 + 0.04 : 0;
  const tapeText = 'Line up the crosshair marks and the grid — squares must stay exactly 1 inch — then tape.';
  const mapH = multiSheet
    ? 0.1 + 0.2 + wrapLineCount(tapeText, fonts.reg, 8.5, w - 2 * pad) * 0.16 + 0.08 + rows * 0.3 + 0.16
    : 0;
  const h = pad * 2 + 0.34            // title
    + keyRows * 0.27
    + 0.34                            // scale-check line
    + 0.3                             // pieces header
    + partLines * 0.24
    + lamH                            // lamination note (only if laminated parts)
    + mapH;

  const draw = (page, x, y) => {
    drawRect(page, { x, y, w, h, color: COLORS.white, borderColor: COLORS.textBody, borderWidth: 1.2 });
    let yy = y + pad + 0.16;
    const tx = x + pad;
    drawText(page, 'TEMPLATE KEY', { x: tx, y: yy, font: fonts.bold, size: 12, color: COLORS.textBody });
    yy += 0.34;

    const sampleX0 = tx, sampleX1 = tx + 0.52, textX = tx + 0.64;
    const keyRow = (drawSample, text) => {
      drawSample(yy - 0.05);
      drawText(page, text, { x: textX, y: yy, font: fonts.reg, size: 9.5, color: COLORS.textBody });
      yy += 0.27;
    };
    keyRow(sy => drawLine(page, sampleX0, sy, sampleX1, sy, { color: COLORS.outline, width: 3 }),
      'CUT — solid bold line, cut all the way through');
    keyRow(sy => drawLine(page, sampleX0, sy, sampleX1, sy, { color: COLORS.outline, width: 1.2, dash: [4, 3] }),
      'SCORE — thin dashed line, cut halfway to fold');
    if (hasBacking) {
      keyRow(sy => drawLine(page, sampleX0, sy, sampleX1, sy, { color: COLORS.backing, width: 1.6, dash: [5, 4] }),
        'Gray dashes — second, larger backing copy');
    }
    keyRow(sy => drawCorrugationArrow(page, (sampleX0 + sampleX1) / 2, sy, 'horizontal', 0.45),
      'Arrow — corrugation (flute) direction');
    if (multiSheet) {
      keyRow(sy => drawRegMark(page, (sampleX0 + sampleX1) / 2, sy, 0.09),
        'Circle-cross — stack these marks to align sheets');
    }

    drawText(page, 'CHECK SCALE: 1 grid square = 1 inch (print at 100%)', {
      x: tx, y: yy, font: fonts.bold, size: 9.5, color: COLORS.crimson,
    });
    yy += 0.34;

    drawText(page, 'PIECES TO CUT:', { x: tx, y: yy, font: fonts.bold, size: 9.5, color: COLORS.textBody });
    yy += 0.24;
    for (const p of parts) {
      drawText(page, `•  ${p.name} — ${p.count ?? 1} pcs`, { x: tx + 0.1, y: yy, font: fonts.reg, size: 9.5, color: COLORS.textBody });
      yy += 0.24;
    }
    if (lamText) {
      yy += 0.06;
      yy = drawParagraph(page, lamText, {
        x: tx, y: yy, font: fonts.obl, size: 9, color: COLORS.textMut, maxWidthIn: w - 2 * pad,
      });
    }

    if (multiSheet) {
      yy += 0.1;
      drawText(page, `TAPE MAP — ${cols * rows} sheets share 1-inch strips:`, {
        x: tx, y: yy, font: fonts.bold, size: 9.5, color: COLORS.textBody,
      });
      yy += 0.2;
      yy = drawParagraph(page, tapeText, {
        x: tx, y: yy, font: fonts.reg, size: 8.5, color: COLORS.textBody, maxWidthIn: w - 2 * pad,
      });
      yy += 0.04;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = tx + c * 0.32, cy = yy + r * 0.3;
          drawRect(page, { x: cx, y: cy, w: 0.3, h: 0.28, color: COLORS.panelGray, borderColor: COLORS.gridHeavy, borderWidth: 0.8 });
          const n = String(r * cols + c + 1);
          const nw = fonts.bold.widthOfTextAtSize(n, 8);
          page.drawText(n, { x: (cx + 0.15) * IN - nw / 2, y: topY(page, cy + 0.2), size: 8, font: fonts.bold, color: COLORS.textBody });
        }
      }
    }
  };

  return { w, h, draw };
}

// Find a page + position where the key box sits on empty grid, fully inside
// one sheet, without hiding that sheet's giant numeral.
// Returns { pageIndex, x, y } in global inches, or null.
function placeKey(spec, rects, { cols, rows, stepW, stepH, pw, ph }) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ox = c * stepW, oy = r * stepH;
      const pageNo = r * cols + c + 1;
      const numHalfW = 0.85 * String(pageNo).length + 0.15;
      const numeral = {
        x0: ox + 0.32 * pw - numHalfW, x1: ox + 0.32 * pw + numHalfW,
        y0: oy + 0.5 * ph - 1.5, y1: oy + 0.5 * ph + 1.5,
      };
      for (let y = oy + 0.45; y + spec.h <= oy + ph - 0.45; y += 0.5) {
        for (let x = ox + 0.45; x + spec.w <= ox + pw - 0.45; x += 0.5) {
          if (!hits([...rects, numeral], x - 0.15, y - 0.15, x + spec.w + 0.15, y + spec.h + 0.15)) {
            return { pageIndex: pageNo - 1, x, y };
          }
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Registration marks: crimson circle + cross drawn at identical GLOBAL
// coordinates inside each overlap strip — the same mark prints on both
// adjacent sheets, so stacking the marks aligns the pages exactly.

function drawRegMark(page, cxIn, cyIn, r = 0.13) {
  const c = COLORS.crimson;
  page.drawCircle({ x: cxIn * IN, y: topY(page, cyIn), size: r * IN, borderColor: c, borderWidth: 1 });
  drawLine(page, cxIn - r * 1.6, cyIn, cxIn + r * 1.6, cyIn, { color: c, width: 1 });
  drawLine(page, cxIn, cyIn - r * 1.6, cxIn, cyIn + r * 1.6, { color: c, width: 1 });
}

// Pick registration-mark positions (global inches) for every sheet seam.
// `blocked` tests against exact part geometry, so marks tuck into any clear
// grid between parts instead of being pushed out by bounding boxes.
function regMarkPositions(blocked, { cols, rows, stepW, stepH, pw, ph }) {
  const marks = [];
  const clear = (x, y) => !blocked(x - 0.35, y - 0.35, x + 0.35, y + 0.35);
  const pickAlong = (fixed, lo, hi, vertical) => {
    const found = [];
    for (let t = lo + 0.55; t <= hi - 0.55 && found.length < 2; t += 0.25) {
      const x = vertical ? fixed : t;
      const y = vertical ? t : fixed;
      if (!clear(x, y)) continue;
      if (found.length && Math.abs(t - found[0].t) < 2.5) continue;
      found.push({ t, x, y });
    }
    if (!found.length) { // fallback: thirds, regardless of parts underneath
      for (const f of [1 / 3, 2 / 3]) {
        const t = lo + (hi - lo) * f;
        found.push(vertical ? { t, x: fixed, y: t } : { t, x: t, y: fixed });
      }
    }
    return found.map(({ x, y }) => ({ x, y }));
  };
  // horizontal seams (between row r and r+1): strip centered at rowBottom-0.5
  for (let r = 0; r + 1 < rows; r++) {
    const seamY = r * stepH + ph - OVERLAP / 2;
    for (let c = 0; c < cols; c++) {
      marks.push(...pickAlong(seamY, c * stepW, c * stepW + pw, false));
    }
  }
  // vertical seams (between col c and c+1)
  for (let c = 0; c + 1 < cols; c++) {
    const seamX = c * stepW + pw - OVERLAP / 2;
    for (let r = 0; r < rows; r++) {
      marks.push(...pickAlong(seamX, r * stepH, r * stepH + ph, true));
    }
  }
  return marks;
}

// ---------------------------------------------------------------------------
// Sheet footer: compact two-line block
//   SHEET n OF m  ·  1 sq = 1 inch
//   sheet k joins below · sheet j joins right
// placed in whichever page corner is free of drawn geometry.

// Plan the footer for one page: pick a free corner (checked against exact
// geometry) and return everything needed to draw it later. Planned footers
// are reserved in annoRects BEFORE registration marks are chosen, so a mark
// never claims a page corner the footer wants.
function planFooter(blocked, fonts, { pageNum, total, r, c, cols, rows, originX, originY, pw, ph }) {
  const line1b = `SHEET ${pageNum} OF ${total}`;
  const line1r = '  ·  1 sq = 1 inch';
  const joins = [];
  if (r + 1 < rows) joins.push(`sheet ${(r + 1) * cols + c + 1} joins below`);
  if (c + 1 < cols) joins.push(`sheet ${r * cols + c + 2} joins right`);
  const line2 = joins.join('  ·  ');
  const w1 = (fonts.bold.widthOfTextAtSize(line1b, 9) + fonts.reg.widthOfTextAtSize(line1r, 8)) / IN;
  const w2 = line2 ? fonts.reg.widthOfTextAtSize(line2, 8) / IN : 0;
  const wIn = Math.max(w1, w2);
  const hIn = line2 ? 0.42 : 0.22;

  const corners = [
    { x: 0.3, yTop: ph - 0.14 - hIn },            // bottom-left
    { x: pw - 0.3 - wIn, yTop: ph - 0.14 - hIn }, // bottom-right
    { x: 0.3, yTop: 0.12 },                       // top-left
    { x: pw - 0.3 - wIn, yTop: 0.12 },            // top-right
  ];
  let spot = corners.find(k =>
    !blocked(originX + k.x - 0.1, originY + k.yTop - 0.1, originX + k.x + wIn + 0.1, originY + k.yTop + hIn + 0.1));
  const knockout = !spot;
  if (!spot) spot = corners[0];
  return {
    spot, knockout, wIn, hIn, line1b, line1r, line2,
    rect: { x0: originX + spot.x - 0.1, y0: originY + spot.yTop - 0.1, x1: originX + spot.x + wIn + 0.1, y1: originY + spot.yTop + hIn + 0.1 },
  };
}

function drawSheetFooter(page, plan, fonts) {
  const { spot, knockout, wIn, hIn, line1b, line1r, line2 } = plan;
  if (knockout) {
    drawRect(page, { x: spot.x - 0.06, y: spot.yTop - 0.04, w: wIn + 0.12, h: hIn + 0.08, color: COLORS.white, opacity: 0.85 });
  }
  const y1 = spot.yTop + 0.16;
  drawText(page, line1b, { x: spot.x, y: y1, font: fonts.bold, size: 9, color: COLORS.textDark });
  drawText(page, line1r, { x: spot.x + fonts.bold.widthOfTextAtSize(line1b, 9) / IN, y: y1, font: fonts.reg, size: 8, color: COLORS.textMut });
  if (line2) {
    drawText(page, line2, { x: spot.x, y: y1 + 0.21, font: fonts.reg, size: 8, color: COLORS.textMut });
  }
}

// ---------------------------------------------------------------------------

// Render tiled template sheets for a list of parts onto a new PDFDocument.
// paper: 'letter' | 'a4'
// ---------------------------------------------------------------------------
// LAYOUT OVERVIEW page: the whole template drawn small, as if every sheet were
// already taped into one large piece — sheet tiles overlaid with their numbers,
// shared overlap strips shaded, overall size labeled. First page of the PDF;
// nothing on it is cut.

function overviewPage(doc, placed, geom, fonts) {
  const { cols, rows, stepW, stepH, pw, ph } = geom;
  const page = doc.addPage([pw * IN, ph * IN]);

  // header
  drawText(page, 'LAYOUT OVERVIEW', { x: 0.55, y: 0.72, font: fonts.bold, size: 19, color: COLORS.textDark });
  drawLine(page, 0.55, 0.8, 0.55 + fonts.bold.widthOfTextAtSize('LAYOUT OVERVIEW', 19) / IN, 0.8, { color: COLORS.textDark, width: 1.2 });
  drawText(page, 'All the sheets taped together — as if the template were one big piece of cardboard.', {
    x: 0.55, y: 1.06, font: fonts.reg, size: 11, color: COLORS.textMut,
  });

  // figure box
  const tiledW = (cols - 1) * stepW + pw;
  const tiledH = (rows - 1) * stepH + ph;
  const figX0 = 0.7, figY0 = 1.5, figX1 = pw - 0.7, figY1 = ph - 2.0;
  const scale = Math.min((figX1 - figX0) / tiledW, (figY1 - figY0) / tiledH);
  const fx = figX0 + ((figX1 - figX0) - tiledW * scale) / 2;
  const fy = figY0 + ((figY1 - figY0) - tiledH * scale) / 2;
  const gx = (x) => fx + x * scale;   // global inches -> page inches
  const gy = (y) => fy + y * scale;

  // sheet tiles: white cards, then shaded shared strips, then borders
  drawRect(page, { x: gx(0), y: gy(0), w: tiledW * scale, h: tiledH * scale, color: COLORS.white });
  for (let c = 0; c < cols - 1; c++) {
    drawRect(page, { x: gx((c + 1) * stepW), y: gy(0), w: OVERLAP * scale, h: tiledH * scale, color: COLORS.panelGray });
  }
  for (let r = 0; r < rows - 1; r++) {
    drawRect(page, { x: gx(0), y: gy((r + 1) * stepH), w: tiledW * scale, h: OVERLAP * scale, color: COLORS.panelGray });
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = gx(c * stepW), y = gy(r * stepH);
      drawRect(page, { x, y, w: pw * scale, h: ph * scale, borderColor: COLORS.gridHeavy, borderWidth: 0.9 });
    }
  }

  // part geometry, small but real
  for (const p of placed) {
    const ox = gx(p.offsetX), oy = gy(p.offsetY);
    if (p.part.backing) drawPath(page, p.part.backing, { offsetX: ox, offsetY: oy, scale, stroke: COLORS.backing, strokeWidth: 0.8, dash: [2.5, 2] });
    drawPath(page, p.part.path, { offsetX: ox, offsetY: oy, scale, stroke: COLORS.outline, strokeWidth: 1.4 });
    for (const hole of p.part.holes || []) drawPath(page, hole, { offsetX: ox, offsetY: oy, scale, stroke: COLORS.outline, strokeWidth: 1 });
    for (const slit of p.part.slits || []) drawPath(page, slit, { offsetX: ox, offsetY: oy, scale, stroke: COLORS.outline, strokeWidth: 0.6, dash: [2, 1.6] });
  }

  // sheet numbers on top, centered on each tile
  let n = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const label = String(n++);
      const size = Math.max(16, Math.min(48, 190 * scale));
      const cx = gx(c * stepW + pw / 2), cy = gy(r * stepH + ph / 2);
      const w = fonts.reg.widthOfTextAtSize(label, size);
      page.drawText(label, {
        x: cx * IN - w / 2, y: topY(page, cy) - size * 0.36,
        size, font: fonts.reg, color: COLORS.pageNum, opacity: 0.75,
      });
    }
  }

  // dimensions: width below, height at right
  const dimY = gy(tiledH) + 0.28;
  drawLine(page, gx(0), dimY, gx(tiledW), dimY, { color: COLORS.textMut, width: 0.8 });
  drawLine(page, gx(0), dimY - 0.07, gx(0), dimY + 0.07, { color: COLORS.textMut, width: 0.8 });
  drawLine(page, gx(tiledW), dimY - 0.07, gx(tiledW), dimY + 0.07, { color: COLORS.textMut, width: 0.8 });
  // label sits just above its line so it can't collide with the legend below
  drawText(page, `${tiledW.toFixed(1)}"`, { x: gx(tiledW / 2), y: dimY - 0.08, font: fonts.bold, size: 10, color: COLORS.textMut, align: 'center' });
  const dimX = gx(tiledW) + 0.28;
  drawLine(page, dimX, gy(0), dimX, gy(tiledH), { color: COLORS.textMut, width: 0.8 });
  drawLine(page, dimX - 0.07, gy(0), dimX + 0.07, gy(0), { color: COLORS.textMut, width: 0.8 });
  drawLine(page, dimX - 0.07, gy(tiledH), dimX + 0.07, gy(tiledH), { color: COLORS.textMut, width: 0.8 });
  page.drawText(`${tiledH.toFixed(1)}"`, {
    x: (dimX + 0.12) * IN, y: topY(page, gy(tiledH / 2)), size: 10, font: fonts.bold, color: COLORS.textMut, rotate: degrees(90),
  });

  // legend line + crimson notice
  const total = cols * rows;
  drawText(page, `${total} sheet${total > 1 ? 's' : ''} · gray strips are shared overlap · squares on the sheets = 1 inch`, {
    x: pw / 2, y: ph - 1.55, font: fonts.reg, size: 10.5, color: COLORS.textBody, align: 'center',
  });
  drawRect(page, { x: 0.55, y: ph - 1.25, w: pw - 1.1, h: 0.5, color: COLORS.crimson });
  drawText(page, 'NOTHING TO CUT ON THIS PAGE — print every sheet at 100%, tape them following this map.', {
    x: pw / 2, y: ph - 0.94, font: fonts.bold, size: 10.5, color: COLORS.white, align: 'center',
  });
}

export async function renderTemplatePdf(parts, { paper = 'letter' } = {}) {
  const doc = await PDFDocument.create();
  const fonts = await loadFonts(doc);
  const { placed, width, height } = layoutParts(parts, paper);
  const { w: pw, h: ph } = PAGE[paper];

  const stepW = pw - OVERLAP;
  const stepH = ph - OVERLAP;
  const cols = Math.max(1, Math.ceil((width - OVERLAP) / stepW));
  const rows = Math.max(1, Math.ceil((height - OVERLAP) / stepH));
  const geom = { cols, rows, stepW, stepH, pw, ph };

  const labelPlans = planLabels(placed, fonts, geom);
  const { partRects, annoRects } = occupiedRects(placed, labelPlans);
  const segs = geometrySegments(placed);
  const holeLabelPlans = planHoleLabels(placed, segs, labelPlans, fonts);
  annoRects.push(...holeLabelPlans.map(holeLabelRect));
  const polys = partPolygons(placed);
  const key = keySpec(parts, geom, fonts);
  const keyAt = placeKey(key, [...partRects, ...annoRects], geom);
  if (keyAt) {
    annoRects.push({ x0: keyAt.x - 0.15, y0: keyAt.y - 0.15, x1: keyAt.x + key.w + 0.15, y1: keyAt.y + key.h + 0.15 });
  }
  const blocked = makeBlocker(segs, annoRects, polys);
  const total = cols * rows;

  // Plan every page's footer first and reserve its corner, THEN choose
  // registration-mark spots so marks never crowd a footer.
  const footers = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const plan = planFooter(blocked, fonts, {
        pageNum: r * cols + c + 1, total, r, c, cols, rows,
        originX: c * stepW, originY: r * stepH, pw, ph,
      });
      footers.push(plan);
      annoRects.push(plan.rect);
    }
  }
  const marks = regMarkPositions(blocked, geom);

  overviewPage(doc, placed, geom, fonts);

  let pageNum = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const originX = c * stepW;
      const originY = r * stepH;
      const page = doc.addPage([pw * IN, ph * IN]);
      pageGrid(page, originX, originY);
      giantPageNumber(page, pageNum, fonts);
      for (const p of placed) {
        // skip parts entirely outside this page window
        const gx0 = p.bb.minX + p.offsetX, gx1 = p.bb.maxX + p.offsetX;
        const gy0 = p.bb.minY + p.offsetY, gy1 = p.bb.maxY + p.offsetY;
        if (gx1 < originX || gx0 > originX + pw) continue;
        if (gy1 < originY || gy0 > originY + ph) continue;
        drawPlacedPart(page, p, originX, originY, fonts);
      }
      // labels: only where the whole label fits on this page (planLabels
      // guarantees each label fits complete on at least one sheet)
      for (const plan of labelPlans) {
        const lr = labelRect(plan);
        if (lr.x0 < originX + 0.05 || lr.x1 > originX + pw - 0.05) continue;
        if (lr.y0 < originY + 0.05 || lr.y1 > originY + ph - 0.05) continue;
        drawLabelPlan(page, plan, originX, originY, fonts);
      }
      // small-hole diameter notes (same fits-complete-on-page rule)
      for (const plan of holeLabelPlans) {
        const hr = holeLabelRect(plan);
        if (hr.x0 < originX + 0.05 || hr.x1 > originX + pw - 0.05) continue;
        if (hr.y0 < originY + 0.05 || hr.y1 > originY + ph - 0.05) continue;
        drawText(page, plan.text, {
          x: plan.x - originX, y: plan.y - originY,
          font: fonts.reg, size: HOLE_LABEL_SIZE, color: COLORS.label, align: 'center',
        });
      }
      // registration marks in overlap strips (global coords -> both sheets)
      for (const m of marks) {
        if (m.x > originX + 0.2 && m.x < originX + pw - 0.2 && m.y > originY + 0.2 && m.y < originY + ph - 0.2) {
          drawRegMark(page, m.x - originX, m.y - originY);
        }
      }
      if (keyAt && keyAt.pageIndex === pageNum - 1) {
        key.draw(page, keyAt.x - originX, keyAt.y - originY);
      }
      drawSheetFooter(page, footers[pageNum - 1], fonts);
      pageNum++;
    }
  }
  // Fallback: key box never found empty grid — give it its own final sheet.
  // Not a template sheet (no numeral, nothing to cut), so say so.
  if (!keyAt) {
    const page = doc.addPage([pw * IN, ph * IN]);
    pageGrid(page, 0, rows * stepH);
    const kx = Math.max(0.45, pw - 0.45 - key.w);
    key.draw(page, kx, 1.2);
    drawText(page, 'KEY SHEET — read me first, nothing to cut here', {
      x: 0.3, y: ph - 0.18, font: fonts.bold, size: 9, color: COLORS.textDark,
    });
  }
  return doc.save();
}
