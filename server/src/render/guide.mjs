// Assembly guide renderer — Letter portrait, following the R&P guide anatomy:
// cover → what you need → paper size → printer setup → page overlap →
// tracing → cutting/gluing tips → Step pages → license back cover.
// Photos in the originals are replaced by vector diagrams drawn from the
// same part geometry (see FORMAT-SPEC.md "What OUR system does differently").

import { PDFDocument } from 'pdf-lib';
import { pathBBox, unionBBox, holePaths, slitPaths } from './geometry.mjs';
import {
  IN, PAGE, COLORS, loadFonts, topY,
  drawText, drawParagraph, drawRect, drawLine, drawPath,
  drawNumberBadge, drawButtonBar, drawSectionHeader, drawCorrugationArrow,
} from './pdfkit.mjs';

const PW = PAGE.letter.w, PH = PAGE.letter.h;
const MARGIN = 0.55;

function newPage(doc) {
  return doc.addPage([PW * IN, PH * IN]);
}

// ---- figure drawing --------------------------------------------------
// A figure can carry:
//   refPart          — single part id (template-style outline)
//   parts            — [{refPart, dx, dy, style}] real part geometry placed in a
//                      shared figure space. style: outline | filled | filledDark
//                      | ghost (dashed gray = "this is where the part lands")
//   paths            — raw path entries [{d, dx, dy, stroke, fill, width, dash}]
//   arrows           — [{from:[x,y], to:[x,y], label}] crimson alignment/glue arrows
//   labels           — [{at:[x,y], text, size, align}] in-figure callout text
// Everything shares one coordinate space (inches, y-down) and is scaled to fit.

const STROKE_MAP = {
  gray: () => COLORS.backing,
  kraftEdge: () => COLORS.kraftEdge,
  crimson: () => COLORS.crimson,
};
const FILL_MAP = {
  kraft: () => COLORS.kraft,
  kraftDark: () => COLORS.kraftDark,
  white: () => COLORS.white,
};

function styledPartPaths(design, partId, style = 'outline') {
  const part = (design.parts || []).find(p => p.id === partId);
  if (!part) return [];
  const paths = [];
  if (style === 'ghost') {
    paths.push({ d: part.path, stroke: 'gray', width: 1.5, dash: true });
  } else if (style === 'filled' || style === 'filledDark') {
    paths.push({ d: part.path, stroke: 'kraftEdge', width: 2.2, fill: style === 'filled' ? 'kraft' : 'kraftDark' });
    for (const h of holePaths(part)) paths.push({ d: h, stroke: 'kraftEdge', width: 2 });
    for (const s of slitPaths(part)) paths.push({ d: s, stroke: 'kraftEdge', width: 1.1, dash: true });
  } else {
    paths.push({ d: part.path, stroke: 'black', width: 2.6 });
    for (const h of holePaths(part)) paths.push({ d: h, stroke: 'black', width: 2 });
    for (const s of slitPaths(part)) paths.push({ d: s, stroke: 'black', width: 1.1, dash: true });
    if (part.backing) paths.push({ d: part.backing, stroke: 'gray', width: 1.4, dash: true });
  }
  return paths;
}

function resolveFigurePaths(design, fig) {
  const out = [];
  if (fig.refPart) out.push(...styledPartPaths(design, fig.refPart));
  for (const p of fig.parts || []) {
    out.push(...styledPartPaths(design, p.refPart, p.style).map(pp => ({ ...pp, dx: p.dx || 0, dy: p.dy || 0 })));
  }
  for (const p of fig.paths || []) out.push({ ...p });
  return out;
}

function drawFigure(page, design, fig, box, fonts, { pad = 0.15 } = {}) {
  const paths = resolveFigurePaths(design, fig);
  const bbs = paths.map(p => {
    const b = pathBBox(p.d);
    if (!b) return null;
    const dx = p.dx || 0, dy = p.dy || 0;
    return { minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy };
  }).filter(Boolean);
  for (const a of fig.arrows || []) {
    for (const [x, y] of [a.from, a.to]) bbs.push({ minX: x, minY: y, maxX: x, maxY: y });
  }
  for (const l of fig.labels || []) {
    bbs.push({ minX: l.at[0], minY: l.at[1], maxX: l.at[0], maxY: l.at[1] });
  }
  const bb = unionBBox(bbs);
  if (!bb) return;
  const bw = bb.maxX - bb.minX, bh = bb.maxY - bb.minY;
  const availW = box.w - 2 * pad, availH = box.h - 2 * pad;
  const scale = Math.min(availW / Math.max(bw, 0.01), availH / Math.max(bh, 0.01), 1.6);
  const ox = box.x + (box.w - bw * scale) / 2 - bb.minX * scale;
  const oy = box.y + (box.h - bh * scale) / 2 - bb.minY * scale;
  const X = x => ox + x * scale, Y = y => oy + y * scale;

  for (const p of paths) {
    drawPath(page, p.d, {
      offsetX: ox + (p.dx || 0) * scale, offsetY: oy + (p.dy || 0) * scale, scale,
      stroke: p.stroke === 'none' ? undefined : (STROKE_MAP[p.stroke]?.() ?? COLORS.outline),
      strokeWidth: p.width ?? 2.2,
      dash: p.dash ? [4, 3] : undefined,
      fill: FILL_MAP[p.fill]?.(),
    });
  }
  // crimson alignment / glue arrows
  for (const a of fig.arrows || []) {
    const [x1, y1] = a.from, [x2, y2] = a.to;
    drawLine(page, X(x1), Y(y1), X(x2), Y(y2), { color: COLORS.crimson, width: 2 });
    const ang = Math.atan2(Y(y2) - Y(y1), X(x2) - X(x1));
    const ah = 0.1;
    for (const da of [Math.PI * 5 / 6, -Math.PI * 5 / 6]) {
      drawLine(page, X(x2), Y(y2), X(x2) + ah * Math.cos(ang + da), Y(y2) + ah * Math.sin(ang + da), { color: COLORS.crimson, width: 2 });
    }
    if (a.label) {
      drawText(page, a.label, {
        x: X(x1), y: Y(y1) - 0.07, font: fonts.bold, size: 8.5,
        color: COLORS.crimson, align: a.labelAlign || 'center',
      });
    }
  }
  // in-figure callout labels
  for (const l of fig.labels || []) {
    drawText(page, l.text, {
      x: X(l.at[0]), y: Y(l.at[1]), font: fonts.bold, size: l.size || 9,
      color: l.color === 'crimson' ? COLORS.crimson : COLORS.textDark, align: l.align || 'center',
    });
  }
  return { scale, ox, oy, bb };
}

// ------------------------------------------------------------------ cover
function coverPage(doc, design, fonts) {
  const page = newPage(doc);
  // hero illustration
  const heroPaths = (design.hero?.paths || []).map(p => ({ ...p }));
  if (heroPaths.length) {
    drawFigure(page, design, { paths: heroPaths }, { x: 1.4, y: 0.9, w: PW - 2.8, h: 6.3 }, fonts, { pad: 0.1 });
  }
  // title block
  const title = (design.title || 'CARDBOARD PROJECT').toUpperCase();
  // shrink-to-fit: long titles (e.g. "CARDBOARD MONSTER TRUCK") must not overflow the page
  let titleSize = 44;
  while (titleSize > 22 && fonts.reg.widthOfTextAtSize(title, titleSize) > (PW - 1.2) * 72) titleSize -= 1;
  drawText(page, title, { x: PW / 2, y: 8.15, font: fonts.reg, size: titleSize, color: COLORS.textDark, align: 'center' });
  drawText(page, 'step by step guide', { x: PW / 2, y: 8.62, font: fonts.reg, size: 18, color: COLORS.textBody, align: 'center' });
  drawButtonBar(page, { x: 1.1, y: 9.05, w: PW - 2.2, text: 'MEASURE TWICE  •  CUT ONCE  •  HAVE FUN', fonts, size: 13 });
  drawText(page, 'Cardboard Studio — our family workshop', { x: PW / 2, y: 10.05, font: fonts.reg, size: 14, color: COLORS.textMut, align: 'center' });
}

// --------------------------------------------------------- what you need
function materialsPage(doc, design, fonts) {
  const page = newPage(doc);
  drawSectionHeader(page, 'What you need', fonts);
  let y = 1.3;

  drawText(page, 'MATERIALS', { x: MARGIN, y, font: fonts.bold, size: 13, color: COLORS.crimson });
  y += 0.35;
  for (const mLine of design.materials || ['Corrugated cardboard (a few large boxes)']) {
    drawText(page, '•', { x: MARGIN + 0.05, y, font: fonts.bold, size: 11 });
    y = drawParagraph(page, mLine, { x: MARGIN + 0.28, y, font: fonts.reg, size: 11.5, maxWidthIn: PW - 2 * MARGIN - 0.3 });
    y += 0.06;
  }
  if (design.hardware?.length) {
    y += 0.3;
    drawText(page, 'HARDWARE', { x: MARGIN, y, font: fonts.bold, size: 13, color: COLORS.crimson });
    y += 0.35;
    for (const h of design.hardware) {
      const line = `${h.label || h.id} ×${h.count || 1}${h.source ? ` — ${h.source}` : ''}`;
      drawText(page, '•', { x: MARGIN + 0.05, y, font: fonts.bold, size: 11 });
      y = drawParagraph(page, line, { x: MARGIN + 0.28, y, font: fonts.reg, size: 11.5, maxWidthIn: PW - 2 * MARGIN - 0.3 });
      y += 0.06;
    }
  }
  y += 0.3;
  drawText(page, 'TOOLS', { x: MARGIN, y, font: fonts.bold, size: 13, color: COLORS.crimson });
  y += 0.35;
  for (const tLine of design.tools || ['Scissors or craft knife (grown-up help!)', 'Hot glue gun or white glue', 'Pencil and ruler', 'Printer + tape for the template']) {
    drawText(page, '•', { x: MARGIN + 0.05, y, font: fonts.bold, size: 11 });
    y = drawParagraph(page, tLine, { x: MARGIN + 0.28, y, font: fonts.reg, size: 11.5, maxWidthIn: PW - 2 * MARGIN - 0.3 });
    y += 0.06;
  }

  // info panel: finished size / difficulty / time
  y += 0.35;
  const panelY = y;
  drawRect(page, { x: MARGIN, y: panelY, w: PW - 2 * MARGIN, h: 1.15, color: COLORS.panelGray });
  const cols = [
    ['FINISHED SIZE', design.finishedSize ? `${design.finishedSize.widthIn}" x ${design.finishedSize.heightIn}"` : '—'],
    ['DIFFICULTY', `${design.difficulty || 2} of 3`],
    ['BUILD TIME', design.buildTime || '1–2 hours'],
    ['AGES', design.ageRange || '5+ with a grown-up'],
  ];
  const colW = (PW - 2 * MARGIN) / cols.length;
  cols.forEach(([head, val], i) => {
    const cx = MARGIN + colW * i + colW / 2;
    drawText(page, head, { x: cx, y: panelY + 0.42, font: fonts.bold, size: 9.5, color: COLORS.textMut, align: 'center' });
    // shrink to fit the column, then wrap if still too wide
    let size = 12.5;
    while (size > 8 && fonts.bold.widthOfTextAtSize(val, size) > (colW - 0.25) * IN) size -= 0.5;
    if (fonts.bold.widthOfTextAtSize(val, size) <= (colW - 0.25) * IN) {
      drawText(page, val, { x: cx, y: panelY + 0.78, font: fonts.bold, size, color: COLORS.textDark, align: 'center' });
    } else {
      drawParagraph(page, val, { x: MARGIN + colW * i + 0.12, y: panelY + 0.7, font: fonts.bold, size: 9, maxWidthIn: colW - 0.24, color: COLORS.textDark });
    }
  });

  // safety note
  y = panelY + 1.55;
  drawRect(page, { x: MARGIN, y, w: PW - 2 * MARGIN, h: 0.62, color: COLORS.white, borderColor: COLORS.crimson, borderWidth: 1.2 });
  drawText(page, 'SAFETY:', { x: MARGIN + 0.18, y: y + 0.38, font: fonts.bold, size: 11, color: COLORS.crimson });
  drawText(page, 'Craft knives and hot glue are for grown-ups. Kids trace, fold, tape and decorate!', {
    x: MARGIN + 0.95, y: y + 0.38, font: fonts.reg, size: 11, color: COLORS.textBody,
  });
}

// ------------------------------------------------------------ paper size
function paperSizePage(doc, design, fonts) {
  const page = newPage(doc);
  drawSectionHeader(page, 'Paper size', fonts);
  const panelW = (PW - 2 * MARGIN - 0.3) / 2;
  const panels = [
    { x: MARGIN, title: 'INTERNATIONAL', sub: '(EUROPEAN)', name: 'A4', dims: '210 x 297 mm\n8-1/4 x 11-3/4 in', note: 'Template part has more height', tag: 'NARROW\nLONGER', pw: 0.72, ph: 1.02 },
    { x: MARGIN + panelW + 0.3, title: 'NORTH AMERICA', sub: '', name: 'Letter size', dims: '8.5 x 11 in\n216 x 279 mm', note: 'Template part has more width', tag: 'WIDER\nSHORTER', pw: 0.78, ph: 1.0 },
  ];
  for (const p of panels) {
    drawRect(page, { x: p.x, y: 1.15, w: panelW, h: 8.6, color: COLORS.panelGray });
    const cx = p.x + panelW / 2;
    drawText(page, p.title, { x: cx, y: 1.7, font: fonts.bold, size: 15, align: 'center', color: COLORS.textDark });
    if (p.sub) drawText(page, p.sub, { x: cx, y: 2.0, font: fonts.bold, size: 13, align: 'center', color: COLORS.textDark });
    const name = p.name;
    drawText(page, name, { x: cx, y: 2.5, font: fonts.bold, size: 16, align: 'center', color: COLORS.textDark });
    drawLine(page, cx - fonts.bold.widthOfTextAtSize(name, 16) / IN / 2, 2.56, cx + fonts.bold.widthOfTextAtSize(name, 16) / IN / 2, 2.56, { width: 1.2, color: COLORS.textDark });
    // paper mock
    const mw = 1.9 * p.pw, mh = 1.9 * p.ph * 1.35;
    drawRect(page, { x: cx - mw / 2, y: 3.0, w: mw, h: mh, color: COLORS.white, borderColor: COLORS.gridHeavy, borderWidth: 0.7 });
    const tagLines = p.tag.split('\n');
    tagLines.forEach((t, i) => drawText(page, t, { x: cx, y: 3.0 + mh / 2 + i * 0.24 - 0.08, font: fonts.bold, size: 10, align: 'center', color: COLORS.textMut }));
    let dy = 3.0 + mh + 0.4;
    for (const line of p.dims.split('\n')) {
      drawText(page, line, { x: cx, y: dy, font: fonts.bold, size: 12, align: 'center', color: COLORS.textDark });
      dy += 0.28;
    }
    // gridded template mock
    const gy = dy + 0.25, gw = mw, gh = 1.7;
    drawRect(page, { x: cx - gw / 2, y: gy, w: gw, h: gh, color: COLORS.white, borderColor: COLORS.gridHeavy, borderWidth: 0.7 });
    for (let i = 1; i < 6; i++) {
      drawLine(page, cx - gw / 2 + (gw / 6) * i, gy, cx - gw / 2 + (gw / 6) * i, gy + gh, { color: COLORS.gridLight, width: 0.5 });
      if (i < 5) drawLine(page, cx - gw / 2, gy + (gh / 5) * i, cx + gw / 2, gy + (gh / 5) * i, { color: COLORS.gridLight, width: 0.5 });
    }
    drawText(page, '1', { x: cx, y: gy + gh / 2 + 0.2, font: fonts.reg, size: 40, align: 'center', color: COLORS.pageNum });
    drawText(page, p.note, { x: cx, y: 9.5, font: fonts.bold, size: 11.5, align: 'center', color: COLORS.textDark });
  }
}

// --------------------------------------------------------- printer setup
function printerSetupPage(doc, design, fonts) {
  const page = newPage(doc);
  drawSectionHeader(page, 'NOTE', fonts, { suffix: '- printer set up' });

  // red warning banner
  const by = 1.3, bh = 1.15;
  drawRect(page, { x: MARGIN, y: by, w: PW - 2 * MARGIN, h: bh, color: COLORS.warnRed });
  // warning triangles
  for (const tx of [MARGIN + 0.75, PW - MARGIN - 0.75]) {
    drawPath(page, 'M 0 0.5 L 0.29 0 L 0.58 0.5 Z', { offsetX: tx - 0.29, offsetY: by + 0.33, stroke: COLORS.white, strokeWidth: 2.4 });
    drawText(page, '!', { x: tx, y: by + 0.72, font: fonts.bold, size: 17, color: COLORS.white, align: 'center' });
  }
  drawText(page, 'Be sure your printer', { x: PW / 2, y: by + 0.38, font: fonts.reg, size: 15, color: COLORS.white, align: 'center' });
  drawText(page, 'is set to print in 100%', { x: PW / 2, y: by + 0.64, font: fonts.reg, size: 15, color: COLORS.white, align: 'center' });
  drawText(page, 'A C T U A L   S I Z E', { x: PW / 2, y: by + 0.95, font: fonts.bold, size: 17, color: COLORS.white, align: 'center' });

  // simplified print-dialog mock
  const dx = MARGIN, dy = 2.9, dw = PW - 2 * MARGIN, dh = 4.6;
  drawRect(page, { x: dx, y: dy, w: dw, h: dh, color: COLORS.white, borderColor: COLORS.gridHeavy, borderWidth: 1 });
  drawRect(page, { x: dx, y: dy, w: dw, h: 0.34, color: COLORS.panelGray });
  drawText(page, 'Print', { x: dx + 0.15, y: dy + 0.24, font: fonts.reg, size: 10.5 });
  drawText(page, 'Page Sizing & Handling', { x: dx + 0.3, y: dy + 0.85, font: fonts.bold, size: 10.5 });
  const opts = [
    ['Fit', false], ['Actual size', true], ['Shrink oversized pages', false], ['Custom Scale: 100%', false],
  ];
  let oy = dy + 1.25;
  for (const [label, checked] of opts) {
    page.drawCircle({ x: (dx + 0.45) * IN, y: topY(page, oy - 0.03), size: 0.055 * IN, borderColor: COLORS.textBody, borderWidth: 1 });
    if (checked) page.drawCircle({ x: (dx + 0.45) * IN, y: topY(page, oy - 0.03), size: 0.028 * IN, color: COLORS.textBody });
    drawText(page, label, { x: dx + 0.62, y: oy, font: checked ? fonts.bold : fonts.reg, size: 10.5 });
    if (checked) {
      // red check mark
      drawPath(page, 'M 0 0.06 L 0.06 0.14 L 0.2 -0.06', { offsetX: dx + 0.62 + fonts.bold.widthOfTextAtSize(label, 10.5) / IN + 0.12, offsetY: oy - 0.06, stroke: COLORS.warnRed, strokeWidth: 2.4 });
    }
    oy += 0.36;
  }
  // page preview inside dialog
  const pvx = dx + dw - 2.5, pvy = dy + 0.85, pvw = 2.0, pvh = 2.6;
  drawRect(page, { x: pvx, y: pvy, w: pvw, h: pvh, color: COLORS.white, borderColor: COLORS.textBody, borderWidth: 1 });
  for (let i = 1; i < 8; i++) {
    drawLine(page, pvx + (pvw / 8) * i, pvy, pvx + (pvw / 8) * i, pvy + pvh, { color: COLORS.gridLight, width: 0.4 });
    if (i < 10) drawLine(page, pvx, pvy + (pvh / 10) * i, pvx + pvw, pvy + (pvh / 10) * i, { color: COLORS.gridLight, width: 0.4 });
  }
  drawText(page, '1', { x: pvx + pvw / 2, y: pvy + pvh / 2 + 0.25, font: fonts.reg, size: 46, color: COLORS.pageNum, align: 'center' });
  drawText(page, 'Page 1 of ' + (design.templatePages || 'N'), { x: pvx + pvw / 2, y: pvy + pvh + 0.28, font: fonts.reg, size: 9, color: COLORS.textMut, align: 'center' });

  drawParagraph(page, 'By default settings the printer shrinks the image to fit its printing area and your template will come out smaller. Each printer has its own paper margin and will not print right to the edge — that is OK: every page includes extra overlap so no detail is lost.', {
    x: MARGIN, y: dy + dh + 0.45, font: fonts.reg, size: 11.5, maxWidthIn: PW - 2 * MARGIN,
  });
}

// ------------------------------------------------------- pages overlap
function overlapPage(doc, design, fonts) {
  const page = newPage(doc);
  drawSectionHeader(page, 'Pages overlap and positioning', fonts);

  // diagram: two overlapping page mocks with grid + registration circles
  const gx = MARGIN + 0.2, gy = 1.35, gw = 3.4, gh = 2.6;
  for (const [px, py] of [[gx, gy], [gx + 1.15, gy + 0.75]]) {
    drawRect(page, { x: px, y: py, w: gw * 0.72, h: gh * 0.72, color: COLORS.white, borderColor: COLORS.gridHeavy, borderWidth: 0.8 });
    for (let i = 1; i < 5; i++) {
      drawLine(page, px + (gw * 0.72 / 5) * i, py, px + (gw * 0.72 / 5) * i, py + gh * 0.72, { color: COLORS.gridLight, width: 0.5 });
      drawLine(page, px, py + (gh * 0.72 / 5) * i, px + gw * 0.72, py + (gh * 0.72 / 5) * i, { color: COLORS.gridLight, width: 0.5 });
    }
  }
  // red registration circles on the overlap zone
  for (const [cx, cy] of [[gx + 1.35, gy + 0.95], [gx + 2.15, gy + 0.95], [gx + 1.35, gy + 1.75], [gx + 2.15, gy + 1.75]]) {
    page.drawCircle({ x: cx * IN, y: topY(page, cy), size: 0.075 * IN, borderColor: COLORS.warnRed, borderWidth: 1.6 });
    drawLine(page, cx - 0.12, cy, cx + 0.12, cy, { color: COLORS.warnRed, width: 0.8 });
    drawLine(page, cx, cy - 0.12, cx, cy + 0.12, { color: COLORS.warnRed, width: 0.8 });
  }

  // numbered explanations
  const tx = MARGIN + 4.4;
  let ty = 1.6;
  const items = [
    ['Overlap', 'All pages include an extra margin for overlap, so no details of the template are lost. The exact overlap depends on your printer.'],
    ['1 inch grid (2.54 cm) / 3 inch grid (7.62 cm)', 'The grid helps you align the pages perfectly in place. Light lines are 1 inch apart; heavy lines are 3 inches apart.'],
    ['3x3 inch square', 'Overlap the pages until the visible squares measure exactly 1 inch and the heavy lines form 3x3 inch squares — your pattern will automatically align. Tape the pages together.'],
  ];
  items.forEach(([head, body], i) => {
    drawNumberBadge(page, tx, ty - 0.04, i + 1, fonts);
    drawText(page, head, { x: tx + 0.22, y: ty, font: fonts.bold, size: 11.5 });
    ty = drawParagraph(page, body, { x: tx + 0.22, y: ty + 0.26, font: fonts.reg, size: 10.5, maxWidthIn: PW - tx - MARGIN - 0.2 });
    ty += 0.28;
  });

  // page-map: how the printed pages arrange
  const mapY = 5.4;
  drawText(page, 'Your template pages arrange like this:', { x: MARGIN, y: mapY, font: fonts.bold, size: 12 });
  const cols = design.templateGrid?.cols || 1, rows = design.templateGrid?.rows || 2;
  // size cells to fit above the button bar
  const availH = 9.6 - (mapY + 0.4);
  const cellH = Math.min(1.5, availH / rows - 0.12);
  const cellW = cellH * (8.5 / 11);
  const mx = PW / 2 - (cols * cellW + (cols - 1) * 0.12) / 2, my = mapY + 0.4;
  let n = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = mx + c * (cellW + 0.12), y = my + r * (cellH + 0.12);
      drawRect(page, { x, y, w: cellW, h: cellH, color: COLORS.white, borderColor: COLORS.gridHeavy, borderWidth: 0.8 });
      const numSize = Math.min(30, cellH * 22);
      drawText(page, String(n++), { x: x + cellW / 2, y: y + cellH / 2 + numSize / 2 / IN * 0.7, font: fonts.reg, size: numSize, color: COLORS.pageNum, align: 'center' });
    }
  }
  drawButtonBar(page, { x: MARGIN, y: 9.85, w: PW - 2 * MARGIN, text: 'LINE UP THE GRID — THEN TAPE THE PAGES', fonts, size: 13 });
}

// ---------------------------------------------------------------- tracing
function tracingPage(doc, design, fonts) {
  const page = newPage(doc);
  drawSectionHeader(page, 'Tracing', fonts);
  let y = 1.35;
  drawText(page, 'Method 1.', { x: MARGIN, y, font: fonts.bold, size: 12.5 });
  y += 0.3;
  const m1 = [
    'Cut Out the Template: carefully cut out the shapes from the printed template using scissors.',
    'Secure the Template: place the template pieces on the cardboard and secure with tape or small weights so nothing slips.',
    'Trace the Outline: use a pencil or pen to trace around the edges of the template onto the cardboard.',
    'Check Your Lines: double-check every piece is traced before removing the template.',
  ];
  m1.forEach((t, i) => {
    y = drawParagraph(page, `${i + 1}. ${t}`, { x: MARGIN, y, font: fonts.reg, size: 11, maxWidthIn: PW - 2 * MARGIN });
    y += 0.08;
  });

  y += 0.4;
  drawText(page, 'Method 2.', { x: MARGIN, y, font: fonts.bold, size: 12.5 });
  y += 0.35;
  // three vector vignettes: taped template / tracing wheel / embossed board
  const cellW = (PW - 2 * MARGIN - 0.6) / 3;
  const cy = y;
  const vign = [
    { cap: 'Tape it', sub: 'and trace it' },
    { cap: 'Tracing tool', sub: 'a pen with pressure, or a tracing wheel' },
    { cap: 'Ready to cut out', sub: '' },
  ];
  vign.forEach((v, i) => {
    const x = MARGIN + i * (cellW + 0.3);
    drawRect(page, { x, y: cy, w: cellW, h: 1.9, color: COLORS.kraft });
    if (i === 0) {
      // paper with grid on cardboard
      drawRect(page, { x: x + 0.25, y: cy + 0.25, w: cellW - 0.5, h: 1.3, color: COLORS.white });
      for (let g = 1; g < 5; g++) {
        drawLine(page, x + 0.25 + ((cellW - 0.5) / 5) * g, cy + 0.25, x + 0.25 + ((cellW - 0.5) / 5) * g, cy + 1.55, { color: COLORS.gridLight, width: 0.5 });
      }
      drawPath(page, 'M 0 0 C 0.3 -0.25 0.7 -0.2 0.9 0.15', { offsetX: x + 0.4, offsetY: cy + 1.0, stroke: COLORS.outline, strokeWidth: 2.5 });
    } else if (i === 1) {
      // tracing wheel
      page.drawCircle({ x: (x + cellW / 2) * IN, y: topY(page, cy + 0.75), size: 0.32 * IN, borderColor: COLORS.kraftEdge, borderWidth: 2.5 });
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        drawLine(page, x + cellW / 2 + Math.cos(ang) * 0.32, cy + 0.75 + Math.sin(ang) * 0.32, x + cellW / 2 + Math.cos(ang) * 0.4, cy + 0.75 + Math.sin(ang) * 0.4, { color: COLORS.kraftEdge, width: 1.5 });
      }
      drawLine(page, x + cellW / 2 + 0.28, cy + 0.55, x + cellW - 0.2, cy + 0.25, { color: COLORS.kraftEdge, width: 3 });
      drawPath(page, `M 0 0 C 0.35 0.12 0.7 0.1 1.0 -0.05`, { offsetX: x + 0.15, offsetY: cy + 1.5, stroke: COLORS.kraftDark, strokeWidth: 2 });
    } else {
      // embossed outline on cardboard
      drawPath(page, 'M 0 0.5 C 0.1 0.1 0.5 0 0.6 0.3 C 0.7 0 1.0 0.15 0.95 0.5 C 0.9 0.85 0.2 0.9 0 0.5 Z', {
        offsetX: x + 0.35, offsetY: cy + 0.55, stroke: COLORS.kraftDark, strokeWidth: 2, scale: (cellW - 0.7),
      });
    }
    drawNumberBadge(page, x + 0.14, cy + 2.15, i + 1, fonts);
    drawText(page, v.cap, { x: x + 0.32, y: cy + 2.2, font: fonts.bold, size: 11 });
    if (v.sub) drawParagraph(page, v.sub, { x: x + 0.32, y: cy + 2.44, font: fonts.reg, size: 9.5, maxWidthIn: cellW - 0.3 });
  });

  // cardboard direction tip
  const ty = cy + 3.3;
  drawSectionHeader(page, 'NOTE', fonts, { x: MARGIN, y: ty, suffix: '- mind cardboard structure direction' });
  let yy = ty + 0.4;
  yy = drawParagraph(page, 'The arrow on each template part shows the direction of the corrugated cardboard flutes. Keep the arrow parallel to the little waves inside your cardboard — parts stay strong and bend where they should.', {
    x: MARGIN, y: yy, font: fonts.reg, size: 11, maxWidthIn: PW - 2 * MARGIN - 1.6,
  });
  drawCorrugationArrow(page, PW - MARGIN - 0.7, ty + 0.55, 'vertical');
  yy += 0.15;
  yy = drawParagraph(page, 'Tip: the best way to bend cardboard smoothly is to cut slits halfway through on one side. Crease the slits with your fingernail to bend the other way and keep the front smooth.', {
    x: MARGIN, y: yy, font: fonts.reg, size: 11, maxWidthIn: PW - 2 * MARGIN,
  });
}

// ------------------------------------------------------ cut & glue tips
function tipsPage(doc, design, fonts) {
  const page = newPage(doc);
  drawSectionHeader(page, 'NOTE', fonts, { suffix: '- tips and tricks' });

  // HOW TO CUT
  drawRect(page, { x: MARGIN + 1.1, y: 1.15, w: PW - 2 * MARGIN - 1.1, h: 0.75, color: COLORS.panelGray });
  // scissors icon
  drawPath(page, 'M 0 0 L 0.5 0.5 M 0 0.5 L 0.5 0 M 0.02 0.02 m 0 0', { offsetX: MARGIN + 0.25, offsetY: 1.3, stroke: COLORS.crimson, strokeWidth: 3 });
  drawText(page, 'HOW TO CUT CARDBOARD', { x: MARGIN + 1.35, y: 1.62, font: fonts.bold, size: 16, color: COLORS.textDark });
  let y = 2.25;
  const cutTips = [
    ['PERFECT STRAIGHT CUT', 'Use a sharp blade and a metal ruler. Cut in 2–3 light passes instead of one hard press.'],
    ['CUT A PAPER BLEED', 'Measure your cardboard thickness, cut half through, then peel off the corrugated layer leaving one paper face. Glue sticks much better on the bleed.'],
    ['CUT A PERFECT CIRCLE', 'Mark the radius on a cardboard scrap, poke a pin through one end and a pencil through the other — instant compass. Cut just outside the line, then trim.'],
  ];
  for (const [head, body] of cutTips) {
    drawText(page, head, { x: MARGIN, y, font: fonts.bold, size: 11.5, color: COLORS.textDark });
    y = drawParagraph(page, body, { x: MARGIN, y: y + 0.26, font: fonts.reg, size: 10.5, maxWidthIn: PW - 2 * MARGIN });
    y += 0.22;
  }

  // HOW TO GLUE
  y += 0.15;
  drawRect(page, { x: MARGIN + 1.1, y, w: PW - 2 * MARGIN - 1.1, h: 0.75, color: COLORS.panelGray });
  // zigzag glue icon
  drawPath(page, 'M 0 0 L 0.12 0.18 L 0 0.36 L 0.12 0.54 L 0 0.72', { offsetX: MARGIN + 0.35, offsetY: y + 0.02, stroke: COLORS.crimson, strokeWidth: 2.6 });
  drawText(page, 'HOW TO GLUE CARDBOARD', { x: MARGIN + 1.35, y: y + 0.47, font: fonts.bold, size: 16, color: COLORS.textDark });
  y += 1.1;
  const glueTips = [
    ['QUICK CONNECTION — HOT GLUE', 'Fix the panels with tape first, open the joint like a book, run hot glue in the groove, close and tape again. Quick and sturdy for small parts.'],
    ['BIG PANELS — WHITE GLUE', 'Add a little water to white glue and mix. Spread on the bottom part, lay the top parts like a mosaic so they overlap seams, press under books and let dry completely.'],
    ['SEAMLESS OVERLAP', 'Make a paper bleed on the edges, apply white glue on the bottom part and the bleed, connect the matching parts, press and let dry.'],
  ];
  for (const [head, body] of glueTips) {
    drawText(page, head, { x: MARGIN, y, font: fonts.bold, size: 11.5, color: COLORS.textDark });
    y = drawParagraph(page, body, { x: MARGIN, y: y + 0.26, font: fonts.reg, size: 10.5, maxWidthIn: PW - 2 * MARGIN });
    y += 0.22;
  }
}

// ------------------------------------------------------------ step pages
function stepPages(doc, design, fonts) {
  (design.steps || []).forEach((step, idx) => {
    const page = newPage(doc);
    drawSectionHeader(page, `Step ${idx + 1}.`, fonts, { suffix: step.title });

    const figures = step.figures || [];
    const startY = 1.3;
    const colCount = Math.min(figures.length, 2) || 1;
    const cellW = (PW - 2 * MARGIN - (colCount - 1) * 0.3) / colCount;
    const cellH = figures.length > 2 ? 2.55 : 4.0;
    const rowGap = figures.length > 2 ? 0.8 : 0.85;
    let maxRowY = startY;

    figures.forEach((fig, i) => {
      const col = i % colCount, row = Math.floor(i / colCount);
      const x = MARGIN + col * (cellW + 0.3);
      const y = startY + row * (cellH + rowGap);
      if (fig.refPart || fig.parts || fig.paths) {
        drawFigure(page, design, fig, { x, y, w: cellW, h: cellH }, fonts);
      }
      if (fig.caption) {
        drawNumberBadge(page, x + 0.12, y + cellH + 0.22, i + 1, fonts, { r: 0.08, size: 10 });
        drawParagraph(page, fig.caption, { x: x + 0.3, y: y + cellH + 0.27, font: fonts.reg, size: 10, maxWidthIn: cellW - 0.35 });
      }
      maxRowY = Math.max(maxRowY, y + cellH + rowGap);
    });

    // numbered instructions below/beside figures
    let y = Math.min(maxRowY + 0.25, 8.4);
    (step.instructions || []).forEach((inst, i) => {
      const numbered = `${i + 1}. `;
      const w = fonts.bold.widthOfTextAtSize(numbered, 11);
      drawText(page, numbered, { x: MARGIN, y, font: fonts.bold, size: 11 });
      y = drawParagraph(page, inst, { x: MARGIN + w / IN + 0.02, y, font: fonts.reg, size: 11, maxWidthIn: PW - 2 * MARGIN - w / IN - 0.1 });
      y += 0.1;
    });

    if (step.check) {
      y += 0.08;
      const label = 'CHECK: ';
      const lw = fonts.bold.widthOfTextAtSize(label, 10.5);
      drawText(page, label, { x: MARGIN, y: y + 0.15, font: fonts.bold, size: 10.5, color: COLORS.crimson });
      y = drawParagraph(page, step.check, { x: MARGIN + lw / IN + 0.02, y: y + 0.15, font: fonts.reg, size: 10.5, maxWidthIn: PW - 2 * MARGIN - lw / IN - 0.1 });
    }

    if (step.tip) {
      y += 0.1;
      drawRect(page, { x: MARGIN, y: y - 0.05, w: PW - 2 * MARGIN, h: 0.02, color: COLORS.panelGray });
      drawParagraph(page, `TIP: ${step.tip}`, { x: MARGIN, y: y + 0.15, font: fonts.obl, size: 10.5, maxWidthIn: PW - 2 * MARGIN, color: COLORS.textMut });
    }
  });
}

// --------------------------------------------------------------- license
function licensePage(doc, design, fonts) {
  const page = newPage(doc);
  // logo mark
  const lx = PW / 2, ly = 2.3;
  drawRect(page, { x: lx - 0.45, y: ly - 0.45, w: 0.4, h: 0.9, color: COLORS.crimson });
  drawRect(page, { x: lx - 0.0, y: ly - 0.45, w: 0.45, h: 0.42, color: COLORS.kraft });
  drawRect(page, { x: lx - 0.0, y: ly + 0.03, w: 0.45, h: 0.42, color: COLORS.kraftDark });
  page.drawCircle({ x: lx * IN, y: topY(page, ly), size: 0.22 * IN, color: COLORS.white });
  page.drawCircle({ x: lx * IN, y: topY(page, ly), size: 0.15 * IN, color: COLORS.panelGray });
  drawText(page, 'CARDBOARD STUDIO', { x: lx, y: ly + 0.85, font: fonts.bold, size: 13, color: COLORS.textDark, align: 'center' });

  drawText(page, 'MADE AT HOME, FOR HOME.', { x: lx, y: 4.4, font: fonts.bold, size: 13, color: COLORS.crimson, align: 'center' });
  drawParagraph(page, 'This template was designed in our family workshop. Print it, build it, smash it, rebuild it better. Share it with friends — and send us a photo of what you made!', {
    x: 1.6, y: 4.8, font: fonts.reg, size: 11.5, maxWidthIn: PW - 3.2, color: COLORS.textBody,
  });

  drawText(page, 'BUILT WITH', { x: lx, y: 6.6, font: fonts.bold, size: 11, color: COLORS.textDark, align: 'center' });
  drawText(page, 'Cardboard Studio', { x: lx, y: 7.0, font: fonts.reg, size: 16, color: COLORS.textDark, align: 'center' });
  drawText(page, `Design: ${design.title || 'Untitled'}  •  ${new Date(design.createdAt || Date.now()).getFullYear()}`, {
    x: lx, y: 7.45, font: fonts.reg, size: 10.5, color: COLORS.textMut, align: 'center',
  });
}

export async function renderGuidePdf(design) {
  const doc = await PDFDocument.create();
  const fonts = await loadFonts(doc);
  coverPage(doc, design, fonts);
  materialsPage(doc, design, fonts);
  paperSizePage(doc, design, fonts);
  printerSetupPage(doc, design, fonts);
  overlapPage(doc, design, fonts);
  tracingPage(doc, design, fonts);
  tipsPage(doc, design, fonts);
  stepPages(doc, design, fonts);
  licensePage(doc, design, fonts);
  return doc.save();
}
