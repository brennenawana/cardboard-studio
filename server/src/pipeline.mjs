// Pipeline: design JSON -> printable bundle (template PDFs + guide PDF).

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTemplatePdf, layoutParts } from './render/templates.mjs';
import { renderGuidePdf } from './render/guide.mjs';
import { PAGE } from './render/pdfkit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DESIGNS_DIR = path.resolve(here, '../../designs');

export function designDir(slug) {
  return path.join(DESIGNS_DIR, slug);
}

export function listDesigns() {
  if (!existsSync(DESIGNS_DIR)) return [];
  return readdirSync(DESIGNS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(path.join(DESIGNS_DIR, d.name, 'design.json')))
    .map(d => {
      const design = JSON.parse(readFileSync(path.join(DESIGNS_DIR, d.name, 'design.json'), 'utf8'));
      const files = readdirSync(path.join(DESIGNS_DIR, d.name)).filter(f => f.endsWith('.pdf'));
      return { slug: d.name, title: design.title, tagline: design.tagline, category: design.category, difficulty: design.difficulty, files };
    });
}

export function loadDesign(slug) {
  return JSON.parse(readFileSync(path.join(designDir(slug), 'design.json'), 'utf8'));
}

export function saveDesign(design) {
  const dir = designDir(design.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'design.json'), JSON.stringify(design, null, 2));
  return dir;
}

// Compute template page-grid so the guide's page map matches the sheets.
function templateGrid(design, paper) {
  const { width, height } = layoutParts(design.parts);
  const { w: pw, h: ph } = PAGE[paper];
  const overlap = 1.0;
  return {
    cols: Math.max(1, Math.ceil((width - overlap) / (pw - overlap))),
    rows: Math.max(1, Math.ceil((height - overlap) / (ph - overlap))),
  };
}

export async function renderBundle(design) {
  const dir = saveDesign(design);
  const grid = templateGrid(design, 'letter');
  design.templateGrid = grid;
  design.templatePages = grid.cols * grid.rows;

  const nameBase = design.slug.replace(/-/g, '_');
  const letter = await renderTemplatePdf(design.parts, { paper: 'letter' });
  writeFileSync(path.join(dir, `${nameBase}_template_Lettersize.pdf`), letter);
  const a4 = await renderTemplatePdf(design.parts, { paper: 'a4' });
  writeFileSync(path.join(dir, `${nameBase}_template_A4.pdf`), a4);
  const guide = await renderGuidePdf(design);
  writeFileSync(path.join(dir, `${nameBase}_guide.pdf`), guide);

  saveDesign(design); // persist computed grid
  return {
    dir,
    files: [`${nameBase}_template_Lettersize.pdf`, `${nameBase}_template_A4.pdf`, `${nameBase}_guide.pdf`],
  };
}
