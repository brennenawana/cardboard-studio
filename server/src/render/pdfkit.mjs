// Shared PDF drawing primitives built on pdf-lib.
// All dimensions in inches unless suffixed Pt. 1in = 72pt.
// pdf-lib page origin is bottom-left y-up; drawSvgPath treats (x,y) as a
// top-left anchor with path y-down — matching our inch/y-down design space.

import { rgb, StandardFonts } from 'pdf-lib';

export const IN = 72;

export const PAGE = {
  letter: { w: 8.5, h: 11 },
  a4: { w: 595.32 / 72, h: 841.92 / 72 },
};

// Palette (matched to Reuse & Play sheets)
export const COLORS = {
  outline: rgb(0.13, 0.12, 0.12),        // near-black part outline
  gridLight: rgb(0.78, 0.78, 0.78),      // 1" grid
  gridHeavy: rgb(0.58, 0.58, 0.58),      // 3" grid
  pageNum: rgb(0.72, 0.72, 0.72),        // giant page numeral
  backing: rgb(0.55, 0.55, 0.55),        // dashed second-copy outline
  arrow: rgb(0.35, 0.35, 0.35),          // corrugation arrow
  label: rgb(0.1, 0.1, 0.1),
  crimson: rgb(0.66, 0.13, 0.29),        // R&P accent (buttons/banners)
  warnRed: rgb(0.87, 0.12, 0.15),
  panelGray: rgb(0.93, 0.93, 0.93),
  textDark: rgb(0.23, 0.19, 0.17),
  textBody: rgb(0.15, 0.15, 0.15),
  textMut: rgb(0.45, 0.45, 0.45),
  white: rgb(1, 1, 1),
  kraft: rgb(0.79, 0.67, 0.52),          // cardboard fill for illustrations
  kraftDark: rgb(0.62, 0.51, 0.38),
  kraftEdge: rgb(0.45, 0.36, 0.26),
};

export async function loadFonts(doc) {
  return {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    obl: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
}

// y given from TOP of page in inches; converts to pdf-lib's bottom-up points.
export function topY(page, yIn) {
  return page.getHeight() - yIn * IN;
}

export function drawText(page, text, { x, y, font, size = 11, color = COLORS.textBody, align = 'left', maxWidthIn }) {
  let xPt = x * IN;
  const w = font.widthOfTextAtSize(text, size);
  if (align === 'center') xPt -= w / 2;
  if (align === 'right') xPt -= w;
  page.drawText(text, { x: xPt, y: topY(page, y), size, font, color, maxWidth: maxWidthIn ? maxWidthIn * IN : undefined });
}

// Word-wraps text into lines fitting maxWidthIn. Returns y after the block (in).
export function drawParagraph(page, text, { x, y, font, size = 10.5, color = COLORS.textBody, maxWidthIn, lineGap = 1.35 }) {
  const words = String(text).split(/\s+/);
  const maxW = maxWidthIn * IN;
  let line = '';
  let yy = y;
  const lineH = (size * lineGap) / IN;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (font.widthOfTextAtSize(test, size) > maxW && line) {
      page.drawText(line, { x: x * IN, y: topY(page, yy), size, font, color });
      yy += lineH;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    page.drawText(line, { x: x * IN, y: topY(page, yy), size, font, color });
    yy += lineH;
  }
  return yy;
}

export function drawRect(page, { x, y, w, h, color, borderColor, borderWidth = 0, opacity = 1 }) {
  page.drawRectangle({
    x: x * IN, y: topY(page, y + h), width: w * IN, height: h * IN,
    color, borderColor, borderWidth, opacity,
  });
}

export function drawLine(page, x1, y1, x2, y2, { color = COLORS.outline, width = 1, dash } = {}) {
  page.drawLine({
    start: { x: x1 * IN, y: topY(page, y1) },
    end: { x: x2 * IN, y: topY(page, y2) },
    color, thickness: width,
    dashArray: dash,
  });
}

// Draw an svg path (inches, y-down) anchored at global-space offset.
// offsetX/offsetY = inches from page top-left where path-space (0,0) lands.
// NOTE: pdf-lib applies `scale` via the CTM, which also scales stroke width
// and dash pattern — so we pre-divide those to keep them in visual points.
export function drawPath(page, d, { offsetX = 0, offsetY = 0, scale = 1, stroke = COLORS.outline, strokeWidth = 3, dash, fill } = {}) {
  const s = IN * scale;
  page.drawSvgPath(d, {
    x: offsetX * IN,
    y: topY(page, offsetY),
    scale: s,
    borderColor: stroke,
    borderWidth: strokeWidth / s,
    borderDashArray: dash ? dash.map(v => v / s) : undefined,
    color: fill,
    borderLineCap: 1,
  });
}

// Corrugation direction arrow (like R&P: dot tail + arrowhead), centered at (cx,cy) inches.
// `direction` is the legacy "vertical"/"horizontal" string OR an angle in degrees
// (clockwise from +x in this y-down inch space) — a part turned on the Cutting Mat
// carries its flute arrow around with it, so the arrow must draw at any angle.
// The two legacy strings map to the exact geometry this drew before: "vertical" =
// -90° (arrow up the sheet), "horizontal" = 0° (arrow to the right).
export function drawCorrugationArrow(page, cx, cy, direction = 'vertical', lenIn = 0.75) {
  const deg = (typeof direction === 'number' && Number.isFinite(direction))
    ? direction
    : (direction === 'horizontal' ? 0 : -90);
  const a = deg * Math.PI / 180;
  const r = (v) => Math.round(v * 1e6) / 1e6;
  const ux = r(Math.cos(a)), uy = r(Math.sin(a));   // along the flutes, arrow-ward
  const nx = -uy, ny = ux;                          // unit normal
  const half = lenIn / 2;
  const c = COLORS.arrow;
  const dot = 0.045;
  const tx = cx - half * ux, ty = cy - half * uy;   // tail (dot)
  const hx = cx + half * ux, hy = cy + half * uy;   // head (arrowhead)
  drawLine(page, tx, ty, hx, hy, { color: c, width: 2.5 });
  page.drawCircle({ x: tx * IN, y: topY(page, ty), size: dot * IN, color: c });
  const barb = (s) => `${r(-0.12 * ux + s * 0.07 * nx)} ${r(-0.12 * uy + s * 0.07 * ny)}`;
  drawPath(page, `M ${barb(-1)} L 0 0 L ${barb(1)}`, {
    offsetX: hx, offsetY: hy, stroke: c, strokeWidth: 2.5,
  });
}

// Numbered circle callout like R&P's ① ② ③
export function drawNumberBadge(page, x, y, num, fonts, { r = 0.09, size = 11 } = {}) {
  page.drawCircle({ x: x * IN, y: topY(page, y), size: r * IN, borderColor: COLORS.textBody, borderWidth: 1.3 });
  const label = String(num);
  const w = fonts.bold.widthOfTextAtSize(label, size);
  page.drawText(label, { x: x * IN - w / 2, y: topY(page, y) - size * 0.36, size, font: fonts.bold, color: COLORS.textBody });
}

// R&P-style crimson link/button bar
export function drawButtonBar(page, { x, y, w, h = 0.42, text, fonts, size = 14 }) {
  drawRect(page, { x, y, w, h, color: COLORS.crimson });
  // play triangle
  const cy = y + h / 2;
  drawPath(page, 'M 0 -0.06 L 0.1 0 L 0 0.06 Z', { offsetX: x + 0.28, offsetY: cy, stroke: COLORS.white, strokeWidth: 1, fill: COLORS.white });
  const tw = fonts.bold.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: (x + w / 2) * IN - tw / 2 + 6, y: topY(page, cy) - size * 0.36,
    size, font: fonts.bold, color: COLORS.white,
  });
}

// Section header: small logo square + underlined bold title (R&P convention)
export function drawSectionHeader(page, title, fonts, { x = 0.55, y = 0.62, suffix = '' } = {}) {
  // logo mark: small square with circle cutout feel
  drawRect(page, { x, y: y - 0.18, w: 0.26, h: 0.26, color: COLORS.panelGray, borderColor: COLORS.gridHeavy, borderWidth: 0.8 });
  page.drawCircle({ x: (x + 0.13) * IN, y: topY(page, y - 0.05), size: 0.07 * IN, borderColor: COLORS.gridHeavy, borderWidth: 1 });
  const size = 17;
  const tx = x + 0.4;
  page.drawText(title, { x: tx * IN, y: topY(page, y), size, font: fonts.bold, color: COLORS.textBody });
  const w = fonts.bold.widthOfTextAtSize(title, size);
  if (suffix) {
    page.drawText(' ' + suffix, { x: tx * IN + w, y: topY(page, y), size: 13, font: fonts.reg, color: COLORS.textBody });
  }
  drawLine(page, tx, y + 0.06, tx + w / IN, y + 0.06, { color: COLORS.textBody, width: 1.2 });
}
