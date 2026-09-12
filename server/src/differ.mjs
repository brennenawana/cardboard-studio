// The structural differ — M3 contract §3, and M4's Review engine.
//
//   diffDesigns(a, b) -> DiffRecord[]
//
// Two design.json documents in, a flat list of "what physically changed"
// records out. It is IDENTITY-keyed, never index-keyed where ids exist: parts
// by `id`, holes/slits by entry `id` (index only as the legacy bare-string
// fallback), hardware / mechanisms / assembly instances by `id`, steps by
// index, fitChecks by their measurement signature, everything else by field.
//
// DiffRecord (a public API — the Mat's history strip, the ghost-diff overlay
// and M4's proposal chips all read these fields, and M5's partial accept will
// key off `ref`):
//
//   { kind:  "added" | "removed" | "changed",
//     scope: "part" | "hole" | "slit" | "layout" | "path" | "count" |
//            "hardware" | "mechanism" | "assembly" | "step" | "fitCheck" | "meta",
//     ref:   { part, holeId, slitId, id },   // whatever the record is anchored to
//     prop:  "layout.x" | "d" | null,        // set for scalar/geometry changes,
//                                            //   null for adds and removes
//     before, after,                         // JSON values; paths as path strings
//     label: "Sword Body: moved 2.9\" right" }
//
// Two documented extras on `ref`, both additive and safely ignorable:
//   - `ref.ids`   — present on a GROUPED slit record (see below).
//   - `ref.index` — the array position for the two things that have no id
//                   (steps, fitChecks), so the UI can address them.
//
// Rules that make the output a product surface rather than a data dump:
//   - Labels are kid language and name the part, then say what physically
//     changed, quantified when it is cheap ("moved 2.9\" right", "turned 90°
//     right", "hole grown to Ø 0.31\"", "8 new score lines"). A label NEVER
//     contains a JSON path.
//   - Unchanged objects produce nothing at all.
//   - A moved part yields layout records, not a path record: paths are
//     compared exactly, layout separately.
//   - Adding one hole to a part is ONE added-hole record, not a changed-part
//     blob. Score lines are the one thing that arrives in flocks (the CURL
//     fan), so N>1 added/removed slits on the same part group into a single
//     record carrying `ref.ids` and an array of path strings — "8 new score
//     lines" is the honest chip, eight identical chips is not.
//   - Sub-visible float noise is not a change: inch fields need to move at
//     least 0.005" and angles 0.05° before anything is emitted.

import { pathBBox, pathD, entryId } from './render/geometry.mjs';

// --------------------------------------------------------------- primitives

const IN_EPS = 0.005;   // half a hundredth of an inch — under this, nothing moved
const DEG_EPS = 0.05;

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const nearly = (x, y, eps) => isNum(x) && isNum(y) && Math.abs(x - y) < eps;

// Stable structural equality (key order in a JSON file is not meaningful).
function stable(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
const same = (x, y) => stable(x) === stable(y);

// 2.90 -> `2.9"`, 3.0 -> `3"`, 0.255 -> `0.26"`
const inch = (n) => `${String(Math.round(n * 100) / 100)}"`;
const dia = (n) => `Ø ${n.toFixed(2)}"`;
const deg = (n) => `${String(Math.round(n * 10) / 10)}°`;

const xWord = (d) => (d > 0 ? 'right' : 'left');
const yWord = (d) => (d > 0 ? 'down' : 'up');   // design space is y-down

// "sword-body" / "swordBody" -> "Sword Body"
function humanize(id) {
  if (typeof id !== 'string' || !id) return 'something';
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const clip = (s, n = 64) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/[\s,;:]+\S*$/, '') + '…';
};

const quote = (s) => `"${clip(s, 40)}"`;

// A list keyed by identity, collisions disambiguated so nothing is ever lost.
function keyed(list, keyOf) {
  const map = new Map();
  (Array.isArray(list) ? list : []).forEach((item, index) => {
    let key = keyOf(item, index);
    if (map.has(key)) { let n = 2; while (map.has(`${key}~${n}`)) n++; key = `${key}~${n}`; }
    map.set(key, { item, index });
  });
  return map;
}

// --------------------------------------------------------------- the record

function record(kind, scope, ref, prop, before, after, label) {
  return {
    kind,
    scope,
    ref: { part: null, holeId: null, slitId: null, id: null, ...ref },
    prop: prop === undefined ? null : prop,
    before: before === undefined ? null : before,
    after: after === undefined ? null : after,
    label,
  };
}

// ------------------------------------------------------------ measurements

// Holes are round in this product (PUNCH makes circles), so a hole's identity
// as a kid sees it is "where it is and how big across".
function circle(d) {
  const bb = pathBBox(d);
  if (!bb) return null;
  const round = Math.abs(bb.width - bb.height) <= Math.max(0.02, 0.08 * Math.max(bb.width, bb.height));
  return {
    bb,
    cx: (bb.minX + bb.maxX) / 2,
    cy: (bb.minY + bb.maxY) / 2,
    d: (bb.width + bb.height) / 2,
    round,
  };
}

// A score line is a straight segment: its length is its bbox diagonal.
function segment(d) {
  const bb = pathBBox(d);
  if (!bb) return null;
  return { bb, cx: (bb.minX + bb.maxX) / 2, cy: (bb.minY + bb.maxY) / 2, len: Math.hypot(bb.width, bb.height) };
}

// "moved 2.9" right", "moved 0.5" right and 1" down", or '' when it sat still.
function movedPhrase(dx, dy) {
  const bits = [];
  if (Math.abs(dx) >= IN_EPS) bits.push(`${inch(Math.abs(dx))} ${xWord(dx)}`);
  if (Math.abs(dy) >= IN_EPS) bits.push(`${inch(Math.abs(dy))} ${yWord(dy)}`);
  return bits.join(' and ');
}

// "2" taller", "0.5" wider and 1" shorter"
function sizePhrase(dw, dh) {
  const bits = [];
  if (Math.abs(dw) >= IN_EPS) bits.push(`${inch(Math.abs(dw))} ${dw > 0 ? 'wider' : 'narrower'}`);
  if (Math.abs(dh) >= IN_EPS) bits.push(`${inch(Math.abs(dh))} ${dh > 0 ? 'taller' : 'shorter'}`);
  return bits.join(' and ');
}

const sizeOf = (bb) => `${inch(bb.width)} × ${inch(bb.height)}`;

// =============================================================== parts

const partLabel = (part, id) => (part && typeof part.name === 'string' && part.name.trim()) ? part.name.trim() : humanize(id);

function diffPart(idA, a, b, out) {
  const name = partLabel(b, idA);
  const ref = { part: idA };
  const say = (s) => `${name}: ${s}`;

  // --- copies -------------------------------------------------------------
  const ca = isNum(a.count) ? a.count : 1;
  const cb = isNum(b.count) ? b.count : 1;
  if (ca !== cb) {
    out.push(record('changed', 'count', ref, 'count', a.count ?? 1, b.count ?? 1,
      say(cb === 1 ? `just 1 copy now (was ${ca})` : `${cb} copies now (was ${ca})`)));
  }

  // --- layout (MOVE / TURN) ----------------------------------------------
  // Moving a part is a layout write, never a path write, so a move must not
  // read as "reshaped" — the two live in different records on purpose.
  const la = a.layout, lb = b.layout;
  if (la && lb && typeof la === 'object' && typeof lb === 'object') {
    if (isNum(la.x) && isNum(lb.x) && !nearly(la.x, lb.x, IN_EPS)) {
      const d = lb.x - la.x;
      out.push(record('changed', 'layout', ref, 'layout.x', la.x, lb.x, say(`moved ${inch(Math.abs(d))} ${xWord(d)}`)));
    }
    if (isNum(la.y) && isNum(lb.y) && !nearly(la.y, lb.y, IN_EPS)) {
      const d = lb.y - la.y;
      out.push(record('changed', 'layout', ref, 'layout.y', la.y, lb.y, say(`moved ${inch(Math.abs(d))} ${yWord(d)}`)));
    }
    const ra = isNum(la.rotDeg) ? la.rotDeg : 0, rb = isNum(lb.rotDeg) ? lb.rotDeg : 0;
    if (!nearly(ra, rb, DEG_EPS)) {
      const d = rb - ra;
      out.push(record('changed', 'layout', ref, 'layout.rotDeg', la.rotDeg ?? 0, lb.rotDeg ?? 0,
        say(`turned ${deg(Math.abs(d))} ${d > 0 ? 'right' : 'left'}`)));
    }
  } else if (!same(la, lb)) {
    out.push(record('changed', 'layout', ref, 'layout', la ?? null, lb ?? null,
      say(lb ? 'got its own spot on the mat' : 'went back to auto-placement')));
  }

  // --- outline (SIZE / reshape) ------------------------------------------
  if (typeof a.path === 'string' && typeof b.path === 'string' && a.path !== b.path) {
    const ba = pathBBox(a.path), bbx = pathBBox(b.path);
    let text = 'reshaped its outline';
    if (ba && bbx) {
      const grew = sizePhrase(bbx.width - ba.width, bbx.height - ba.height);
      text = grew ? `resized to ${sizeOf(bbx)} — ${grew}` : `same size (${sizeOf(bbx)}) but a new shape`;
    }
    out.push(record('changed', 'path', ref, 'path', a.path, b.path, say(text)));
  }

  // --- holes (PUNCH) ------------------------------------------------------
  diffEntries('hole', a, b, idA, name, out);
  // --- score lines (FOLD / CURL) -----------------------------------------
  diffEntries('slit', a, b, idA, name, out);

  // --- backing + the plain part fields -----------------------------------
  if (!same(a.backing ?? null, b.backing ?? null)) {
    const kind = !a.backing ? 'added' : !b.backing ? 'removed' : 'changed';
    out.push(record(kind === 'changed' ? 'changed' : kind, 'path', ref, 'backing', a.backing ?? null, b.backing ?? null,
      say(kind === 'added' ? 'got a bigger backing piece behind it'
        : kind === 'removed' ? 'lost its backing piece'
          : 'its backing piece changed shape')));
  }
  if (typeof a.name === 'string' && typeof b.name === 'string' && a.name !== b.name) {
    out.push(record('changed', 'part', ref, 'name', a.name, b.name, `${a.name} is now called ${quote(b.name)}`));
  }
  if ((a.corrugation ?? null) !== (b.corrugation ?? null)) {
    out.push(record('changed', 'part', ref, 'corrugation', a.corrugation ?? null, b.corrugation ?? null,
      say(`the cardboard ridges run ${b.corrugation || 'the other way'} now`)));
  }
  if (!!a.laminate !== !!b.laminate) {
    out.push(record('changed', 'part', ref, 'laminate', !!a.laminate, !!b.laminate,
      say(b.laminate ? 'gets glued in a stack now' : 'is a single layer now')));
  }
  // labelAt / arrowAt / noteAt are print annotations that ride along with SIZE
  // and MOVE; reporting them would double every geometry chip, so they are
  // deliberately silent.
}

// holes[] and slits[] share a shape ({id, d} or a legacy bare string) and
// differ only in how a kid talks about them.
function diffEntries(scope, a, b, partId, name, out) {
  const key = scope === 'hole' ? 'holes' : 'slits';
  const idKey = scope === 'hole' ? 'holeId' : 'slitId';
  const say = (s) => `${name}: ${s}`;
  // Identity first: entries are matched by `id`. Legacy bare strings have no
  // identity and fall back to their position (DESIGN.md §2.1 — the exact
  // fragility ids exist to end). The fallback is decided per LIST, not per
  // entry: an old checkpoint whose slits are bare strings compared against a
  // draft whose ids were backfilled must read as "nothing changed", not as
  // "every score line removed and re-added".
  const allIds = (l) => !Array.isArray(l) || l.length === 0 || l.every((e) => entryId(e));
  const useIds = allIds(a[key]) && allIds(b[key]);
  const kf = useIds ? (e, i) => entryId(e) || `#${i}` : (e, i) => `#${i}`;
  const A = keyed(a[key], kf), B = keyed(b[key], kf);

  const added = [], removed = [];
  for (const [k, { item }] of B) if (!A.has(k)) added.push([k, item]);
  for (const [k, { item }] of A) if (!B.has(k)) removed.push([k, item]);

  const changed = [];
  for (const [k, { item }] of B) {
    if (!A.has(k)) continue;
    const before = pathD(A.get(k).item), after = pathD(item);
    if (typeof before === 'string' && typeof after === 'string' && before !== after) changed.push([k, before, after, item]);
  }

  if (scope === 'hole') {
    for (const [k, item] of added) {
      const c = circle(pathD(item));
      out.push(record('added', 'hole', { part: partId, holeId: entryId(item) || null }, null, null, pathD(item),
        say(c && c.round ? `punched a new ${dia(c.d)} hole` : 'cut a new hole in it')));
    }
    for (const [k, item] of removed) {
      const c = circle(pathD(item));
      out.push(record('removed', 'hole', { part: partId, holeId: entryId(item) || null }, null, pathD(item), null,
        say(c && c.round ? `filled in a ${dia(c.d)} hole` : 'lost one of its cut-outs')));
    }
    for (const [k, before, after, item] of changed) {
      const ca = circle(before), cb = circle(after);
      let text = 'reshaped a hole';
      if (ca && cb) {
        const bits = [];
        if (!nearly(ca.d, cb.d, IN_EPS)) bits.push(`hole ${cb.d > ca.d ? 'grown' : 'shrunk'} to ${dia(cb.d)} (was ${dia(ca.d)})`);
        const moved = movedPhrase(cb.cx - ca.cx, cb.cy - ca.cy);
        if (moved) bits.push(bits.length ? `moved ${moved}` : `moved a hole ${moved}`);
        if (bits.length) text = bits.join(' and ');
      }
      out.push(record('changed', 'hole', { part: partId, holeId: entryId(item) || null }, 'd', before, after, say(text)));
    }
    return;
  }

  // Score lines arrive in flocks (the CURL fan), so N>1 groups into one chip.
  if (added.length) {
    const ds = added.map(([, e]) => pathD(e));
    const ids = added.map(([, e]) => entryId(e) || null);
    out.push(added.length === 1
      ? record('added', 'slit', { part: partId, slitId: ids[0] }, null, null, ds[0], say('a new score line to fold on'))
      : record('added', 'slit', { part: partId, slitId: null, ids }, null, null, ds, say(`${added.length} new score lines`)));
  }
  if (removed.length) {
    const ds = removed.map(([, e]) => pathD(e));
    const ids = removed.map(([, e]) => entryId(e) || null);
    out.push(removed.length === 1
      ? record('removed', 'slit', { part: partId, slitId: ids[0] }, null, ds[0], null, say('took away a score line'))
      : record('removed', 'slit', { part: partId, slitId: null, ids }, null, ds, null, say(`took away ${removed.length} score lines`)));
  }
  for (const [k, before, after, item] of changed) {
    const sa = segment(before), sb = segment(after);
    let text = 'changed a score line';
    if (sa && sb) {
      const bits = [];
      if (!nearly(sa.len, sb.len, IN_EPS)) bits.push(`a score line is ${inch(Math.abs(sb.len - sa.len))} ${sb.len > sa.len ? 'longer' : 'shorter'}`);
      const moved = movedPhrase(sb.cx - sa.cx, sb.cy - sa.cy);
      if (moved) bits.push(bits.length ? `moved ${moved}` : `moved a score line ${moved}`);
      if (bits.length) text = bits.join(' and ');
    }
    out.push(record('changed', 'slit', { part: partId, slitId: entryId(item) || null }, 'd', before, after, say(text)));
  }
}

function diffParts(a, b, out) {
  const A = keyed(a.parts, (p, i) => (p && typeof p.id === 'string' ? p.id : `#${i}`));
  const B = keyed(b.parts, (p, i) => (p && typeof p.id === 'string' ? p.id : `#${i}`));

  for (const [id, { item }] of B) {
    if (A.has(id)) {
      diffPart(id, A.get(id).item, item, out);
    } else {
      const bb = pathBBox(item.path);
      const n = partLabel(item, id);
      out.push(record('added', 'part', { part: id }, null, null, item,
        bb ? `New part: ${n} (${sizeOf(bb)})` : `New part: ${n}`));
    }
  }
  for (const [id, { item }] of A) {
    if (B.has(id)) continue;
    out.push(record('removed', 'part', { part: id }, null, item, null, `Took away the part: ${partLabel(item, id)}`));
  }
}

// =============================================================== hardware

const hwName = (h, id) => humanize(id || (h && h.kind) || 'hardware');

function diffHardware(a, b, out) {
  const kf = (h, i) => (h && typeof h.id === 'string' ? h.id : `#${i}`);
  const A = keyed(a.hardware, kf), B = keyed(b.hardware, kf);

  for (const [id, { item }] of B) {
    const name = hwName(item, item.id || id);
    if (!A.has(id)) {
      const bits = [];
      if (isNum(item.diameterIn)) bits.push(`${dia(item.diameterIn)}`);
      if (isNum(item.lengthIn)) bits.push(`${inch(item.lengthIn)} long`);
      out.push(record('added', 'hardware', { id: item.id || id }, null, null, item,
        `Added hardware: ${name}${item.kind ? ` — a ${item.kind}` : ''}${bits.length ? ` (${bits.join(', ')})` : ''}`));
      continue;
    }
    const before = A.get(id).item;
    const say = (s) => `${name}: ${s}`;
    if (isNum(before.lengthIn) && isNum(item.lengthIn) && !nearly(before.lengthIn, item.lengthIn, IN_EPS)) {
      const d = item.lengthIn - before.lengthIn;
      out.push(record('changed', 'hardware', { id: item.id || id }, 'lengthIn', before.lengthIn, item.lengthIn,
        say(`cut ${inch(Math.abs(d))} ${d > 0 ? 'longer' : 'shorter'} — now ${inch(item.lengthIn)} long`)));
    }
    if (isNum(before.diameterIn) && isNum(item.diameterIn) && !nearly(before.diameterIn, item.diameterIn, IN_EPS)) {
      out.push(record('changed', 'hardware', { id: item.id || id }, 'diameterIn', before.diameterIn, item.diameterIn,
        say(`${item.diameterIn > before.diameterIn ? 'thicker' : 'thinner'} now — ${dia(item.diameterIn)} (was ${dia(before.diameterIn)})`)));
    }
    const nb = isNum(before.count) ? before.count : 1, nn = isNum(item.count) ? item.count : 1;
    if (nb !== nn) {
      out.push(record('changed', 'hardware', { id: item.id || id }, 'count', before.count ?? 1, item.count ?? 1,
        say(`you need ${nn} now (was ${nb})`)));
    }
    if ((before.kind ?? null) !== (item.kind ?? null)) {
      out.push(record('changed', 'hardware', { id: item.id || id }, 'kind', before.kind ?? null, item.kind ?? null,
        say(`it's a ${item.kind} now (was a ${before.kind})`)));
    }
    for (const prop of ['label', 'source']) {
      if ((before[prop] ?? null) !== (item[prop] ?? null)) {
        out.push(record('changed', 'hardware', { id: item.id || id }, prop, before[prop] ?? null, item[prop] ?? null,
          say(prop === 'label' ? `now described as ${quote(item[prop])}` : `now comes from ${quote(item[prop])}`)));
      }
    }
  }
  for (const [id, { item }] of A) {
    if (B.has(id)) continue;
    out.push(record('removed', 'hardware', { id: item.id || id }, null, item, null, `Removed hardware: ${hwName(item, item.id || id)}`));
  }
}

// =============================================================== mechanisms

function diffMechanisms(a, b, out) {
  const kf = (m, i) => (m && typeof m.id === 'string' ? m.id : `#${i}`);
  const A = keyed(a.mechanisms, kf), B = keyed(b.mechanisms, kf);

  for (const [id, { item }] of B) {
    const name = humanize(item.id || id);
    if (!A.has(id)) {
      out.push(record('added', 'mechanism', { id: item.id || id }, null, null, item, `New spinning part: ${name}`));
      continue;
    }
    const before = A.get(id).item;
    const say = (s) => `${name}: ${s}`;
    if ((before.axle ?? null) !== (item.axle ?? null)) {
      out.push(record('changed', 'mechanism', { id: item.id || id }, 'axle', before.axle ?? null, item.axle ?? null,
        say(`turns on the ${humanize(item.axle)} now (was the ${humanize(before.axle)})`)));
    }
    if ((before.type ?? null) !== (item.type ?? null)) {
      out.push(record('changed', 'mechanism', { id: item.id || id }, 'type', before.type ?? null, item.type ?? null,
        say(`works a different way now (${item.type})`)));
    }
    for (const prop of ['bearings', 'hubs']) {
      if (same(before[prop] ?? [], item[prop] ?? [])) continue;
      out.push(record('changed', 'mechanism', { id: item.id || id }, prop, before[prop] ?? null, item[prop] ?? null,
        say(prop === 'bearings' ? 'goes through different holes now' : 'grips different holes now')));
    }
    if (!same(before.spins ?? [], item.spins ?? [])) {
      const nb = (before.spins || []).length, nn = (item.spins || []).length;
      out.push(record('changed', 'mechanism', { id: item.id || id }, 'spins', before.spins ?? null, item.spins ?? null,
        say(nb === nn ? 'different pieces spin with it now' : `${nn} pieces spin with it now (was ${nb})`)));
    }
  }
  for (const [id, { item }] of A) {
    if (B.has(id)) continue;
    out.push(record('removed', 'mechanism', { id: item.id || id }, null, item, null, `Removed the spinning part: ${humanize(item.id || id)}`));
  }
}

// =============================================================== assembly

function instName(inst, id, partsById) {
  const part = partsById.get(inst && inst.part);
  const pn = part ? partLabel(part, inst.part) : humanize(inst && inst.part);
  return pn && pn !== 'Something' ? pn : humanize(id);
}

function diffAssembly(a, b, out) {
  const A = a.assembly || {}, B = b.assembly || {};
  const partsById = new Map((b.parts || []).map((p) => [p && p.id, p]));

  if (isNum(A.thicknessIn) && isNum(B.thicknessIn) && !nearly(A.thicknessIn, B.thicknessIn, IN_EPS)) {
    out.push(record('changed', 'meta', {}, 'assembly.thicknessIn', A.thicknessIn, B.thicknessIn,
      `The cardboard is ${inch(B.thicknessIn)} thick now (was ${inch(A.thicknessIn)})`));
  }

  const kf = (n, i) => (n && typeof n.id === 'string' ? n.id : `#${i}`);
  const IA = keyed(A.instances, kf), IB = keyed(B.instances, kf);

  for (const [id, { item }] of IB) {
    const name = instName(item, item.id || id, partsById);
    const ref = { id: item.id || id, part: item.part || null };
    if (!IA.has(id)) {
      out.push(record('added', 'assembly', ref, null, null, item, `Added ${name} to the fold-up build`));
      continue;
    }
    const before = IA.get(id).item;
    const say = (s) => `${name}: ${s}`;
    if ((before.part ?? null) !== (item.part ?? null)) {
      out.push(record('changed', 'assembly', ref, 'part', before.part ?? null, item.part ?? null,
        say(`is a different piece now (${humanize(item.part)})`)));
    }
    if (!same(before.pos ?? null, item.pos ?? null)) {
      const p = before.pos || [], q = item.pos || [];
      const d = Math.hypot((q[0] || 0) - (p[0] || 0), (q[1] || 0) - (p[1] || 0), (q[2] || 0) - (p[2] || 0));
      out.push(record('changed', 'assembly', ref, 'pos', before.pos ?? null, item.pos ?? null,
        say(d >= IN_EPS ? `sits ${inch(d)} over in the fold-up build` : 'sits in a new spot in the fold-up build')));
    }
    if (!same(before.rot ?? null, item.rot ?? null)) {
      out.push(record('changed', 'assembly', ref, 'rot', before.rot ?? null, item.rot ?? null, say('is turned a new way in the fold-up build')));
    }
    if (!!before.mirror !== !!item.mirror) {
      out.push(record('changed', 'assembly', ref, 'mirror', !!before.mirror, !!item.mirror, say(item.mirror ? 'is flipped over now' : 'is not flipped anymore')));
    }
    if (!same(before.folds ?? null, item.folds ?? null)) {
      const fa = (before.folds || []).map((f) => f && f.angleDeg).filter(isNum);
      const fb = (item.folds || []).map((f) => f && f.angleDeg).filter(isNum);
      let text = 'folds differently now';
      if (fa.length === 1 && fb.length === 1 && !nearly(fa[0], fb[0], DEG_EPS)) text = `folded to ${deg(fb[0])} (was ${deg(fa[0])})`;
      else if (!fa.length && fb.length) text = `folds on its score lines now (${deg(fb[0])})`;
      else if (fa.length && !fb.length) text = 'stays flat now';
      out.push(record('changed', 'assembly', ref, 'folds', before.folds ?? null, item.folds ?? null, say(text)));
    }
    if ((before.step ?? null) !== (item.step ?? null)) {
      out.push(record('changed', 'assembly', ref, 'step', before.step ?? null, item.step ?? null,
        say(`goes on in step ${item.step} now (was step ${before.step})`)));
    }
    if ((before.order ?? null) !== (item.order ?? null)) {
      out.push(record('changed', 'assembly', ref, 'order', before.order ?? null, item.order ?? null,
        say(`gets glued on ${(item.order ?? 0) < (before.order ?? 0) ? 'earlier' : 'later'} than before`)));
    }
    if ((before.copy ?? null) !== (item.copy ?? null)) {
      out.push(record('changed', 'assembly', ref, 'copy', before.copy ?? null, item.copy ?? null, say('uses a different copy of the part')));
    }
  }
  for (const [id, { item }] of IA) {
    if (IB.has(id)) continue;
    out.push(record('removed', 'assembly', { id: item.id || id, part: item.part || null }, null, item, null,
      `Took ${instName(item, item.id || id, new Map((a.parts || []).map((p) => [p && p.id, p])))} out of the fold-up build`));
  }
}

// =============================================================== steps

function diffSteps(a, b, out) {
  const A = Array.isArray(a.steps) ? a.steps : [];
  const B = Array.isArray(b.steps) ? b.steps : [];
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const before = A[i], after = B[i];
    const ref = { id: `step-${i + 1}`, index: i };
    if (before === undefined) {
      out.push(record('added', 'step', ref, null, null, after, `New step ${i + 1}: ${quote(after && after.title)}`));
      continue;
    }
    if (after === undefined) {
      out.push(record('removed', 'step', ref, null, before, null, `Removed step ${i + 1}: ${quote(before.title)}`));
      continue;
    }
    if ((before.title ?? null) !== (after.title ?? null)) {
      out.push(record('changed', 'step', ref, 'title', before.title ?? null, after.title ?? null,
        `Step ${i + 1} is now called ${quote(after.title)}`));
    }
    if (!same(before.instructions ?? [], after.instructions ?? [])) {
      const nb = (before.instructions || []).length, na = (after.instructions || []).length;
      out.push(record('changed', 'step', ref, 'instructions', before.instructions ?? null, after.instructions ?? null,
        nb === na ? `Step ${i + 1}: the words changed` : `Step ${i + 1}: ${na} things to do now (was ${nb})`));
    }
    if (!same(before.figures ?? [], after.figures ?? [])) {
      out.push(record('changed', 'step', ref, 'figures', before.figures ?? null, after.figures ?? null,
        `Step ${i + 1}: different pictures`));
    }
    for (const prop of Object.keys({ ...before, ...after })) {
      if (['title', 'instructions', 'figures'].includes(prop)) continue;
      if (same(before[prop] ?? null, after[prop] ?? null)) continue;
      out.push(record('changed', 'step', ref, prop, before[prop] ?? null, after[prop] ?? null,
        `Step ${i + 1}: ${humanize(prop).toLowerCase()} changed`));
    }
  }
}

// =============================================================== fitChecks

// fitChecks carry no id, so identity is the measurement they make: same two
// sides and the same operator = the same check, wherever it sits in the array.
function fitKey(fc, i) {
  if (!fc || typeof fc !== 'object') return `#${i}`;
  const side = (s) => {
    if (s == null) return '?';
    if (typeof s === 'number') return String(s);
    if (typeof s !== 'object') return String(s);
    if (isNum(s.valueIn)) return `${s.valueIn}`;
    return `${s.part || '?'}.${s.measure || '?'}${s.d ? `#${s.d}` : ''}${s.hole !== undefined ? `@${s.hole}` : ''}`;
  };
  return `${side(fc.a)}|${fc.op || '?'}|${side(fc.b)}`;
}

function diffFitChecks(a, b, out) {
  const A = keyed(a.fitChecks, fitKey), B = keyed(b.fitChecks, fitKey);
  for (const [k, { item, index }] of B) {
    const ref = { id: null, index, part: (item.a && item.a.part) || null };
    if (!A.has(k)) {
      out.push(record('added', 'fitCheck', ref, null, null, item, `New fit check: ${clip(item.reason || 'these two pieces must fit')}`));
      continue;
    }
    const before = A.get(k).item;
    for (const prop of ['minIn', 'maxIn', 'reason']) {
      if (same(before[prop] ?? null, item[prop] ?? null)) continue;
      const text = prop === 'reason'
        ? `Fit check now says: ${clip(item.reason)}`
        : `Fit check: ${prop === 'minIn' ? 'smallest' : 'biggest'} allowed is ${isNum(item[prop]) ? inch(item[prop]) : 'anything'} now (was ${isNum(before[prop]) ? inch(before[prop]) : 'anything'}) — ${clip(item.reason || '', 40)}`;
      out.push(record('changed', 'fitCheck', ref, prop, before[prop] ?? null, item[prop] ?? null, text));
    }
  }
  for (const [k, { item, index }] of A) {
    if (B.has(k)) continue;
    out.push(record('removed', 'fitCheck', { id: null, index, part: (item.a && item.a.part) || null }, null, item, null,
      `Dropped a fit check: ${clip(item.reason || 'these two pieces must fit')}`));
  }
}

// =============================================================== meta

const HANDLED = new Set(['parts', 'hardware', 'mechanisms', 'assembly', 'steps', 'fitChecks']);

// finishedSize is an object — spell it as inches, never String(object).
const dims = (v) => (v && typeof v === 'object')
  ? [v.widthIn, v.heightIn, v.depthIn].filter((n) => n != null).map((n) => `${n}"`).join(' × ')
  : String(v);

const META_LABEL = {
  title: (x, y) => `Called ${quote(y)} now (was ${quote(x)})`,
  tagline: (x, y) => `New tagline: ${quote(y)}`,
  slug: (x, y) => `Its folder name is ${quote(y)} now (was ${quote(x)})`,
  category: (x, y) => `Filed under ${quote(y)} now (was ${quote(x)})`,
  difficulty: (x, y) => `Difficulty is ${quote(y)} now (was ${quote(x)})`,
  ageRange: (x, y) => `For ages ${clip(y, 20)} now (was ${clip(x, 20)})`,
  buildTime: (x, y) => `Takes ${clip(y, 20)} now (was ${clip(x, 20)})`,
  finishedSize: (x, y) => `Finished size is ${dims(y)} now (was ${dims(x)})`,
  templatePages: (x, y) => `Prints on ${y} pages now (was ${x})`,
  hero: () => 'The cover picture changed',
  materials: (x, y) => `Materials list: ${(y || []).length} things now (was ${(x || []).length})`,
  tools: (x, y) => `Tools list: ${(y || []).length} things now (was ${(x || []).length})`,
  templateGrid: (x, y) => `The pages tile ${y && y.cols}×${y && y.rows} now (was ${x && x.cols}×${x && x.rows})`,
  brief: () => 'The original idea text changed',
  createdAt: () => 'The made-on date changed',
};

function diffMeta(a, b, out) {
  const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((k) => !HANDLED.has(k));
  for (const key of keys) {
    const x = a ? a[key] : undefined, y = b ? b[key] : undefined;
    if (same(x ?? null, y ?? null)) continue;
    const kind = x === undefined ? 'added' : y === undefined ? 'removed' : 'changed';
    const maker = META_LABEL[key];
    let label;
    if (maker && kind === 'changed') label = maker(x, y);
    else if (kind === 'added') label = `${humanize(key)} added`;
    else if (kind === 'removed') label = `${humanize(key)} removed`;
    else label = typeof y === 'object' ? `${humanize(key)} changed` : `${humanize(key)} is ${quote(y)} now (was ${quote(x)})`;
    out.push(record(kind, 'meta', {}, key, x ?? null, y ?? null, label));
  }
}

// =============================================================== entry point

export function diffDesigns(a, b) {
  const A = a && typeof a === 'object' ? a : {};
  const B = b && typeof b === 'object' ? b : {};
  const out = [];
  // Order is the reading order of the chip list: the geometry a kid touched
  // first, then the hardware and the build, then the paperwork.
  diffParts(A, B, out);
  diffHardware(A, B, out);
  diffMechanisms(A, B, out);
  diffAssembly(A, B, out);
  diffSteps(A, B, out);
  diffFitChecks(A, B, out);
  diffMeta(A, B, out);
  return out;
}

// ===========================================================================
// M4 — the three-way merge (contract §2). ADDITIVE: nothing above this line
// changed, and the DiffRecord shape is still the frozen public API.
//
//   mergeDesigns({ base, ours, theirs, choices }) -> { merged, records, conflicts }
//
// `base`  — the draft exactly as it was when the proposal was submitted.
// `ours`  — the draft NOW (the kid kept editing while Claude was thinking).
// `theirs`— Claude's proposal, generated from `base`.
//
// The rule the whole product rests on: a kid edit made while Claude thinks is
// never lost and never blindly overwritten. So this is a real three-way merge,
// property by property, keyed by IDENTITY (the same keys the differ uses):
//
//   claude didn't touch it            -> ours
//   kid didn't touch it               -> claude's
//   both changed it to the same thing -> not a conflict
//   both changed it differently       -> CONFLICT, `merged` keeps OURS
//   claude removed what the kid edited (or vice versa) -> CONFLICT, keeps OURS
//
// Conflicts carry both sides' DiffRecords so the Mat can draw the two-ghost
// picker in kid language ("You: Blade resized to 2 × 14 / Claude: ... 2 × 16").
//
// `records` is what Review mode draws: diff(ours -> claude-applied), i.e.
// Claude's changes RELABELLED against what the kid has right now, every one
// tagged { from: "claude", key, conflict }. Conflicted keys appear there too
// (showing what Claude would do), which is why the picker can re-render live.
//
// Both functions are pure — no I/O, no mutation of the inputs. `applyChoices`
// simply re-runs the merge with a new choice map, which is why the endpoint can
// be stateless and recompute after every tap.

// A canonical stringify, for the proposal base-hash. Key order in a JSON file
// is not meaningful, so the hash must not depend on it.
export const canonicalJson = (v) => stable(v);

// The conflict key, and the key every merge record is tagged with. It must
// agree with what a DiffRecord looks like, because the Mat matches the two.
export function mergeKey(scope, ref = {}, prop = null) {
  const p = prop == null ? '' : String(prop);
  switch (scope) {
    case 'part': case 'layout': case 'path': case 'count':
      return `${scope}|${ref.part ?? ''}|${p}`;
    case 'hole': case 'slit':
      return `${scope}|${ref.part ?? ''}|${ref.holeId ?? ref.slitId ?? ''}|${p}`;
    case 'hardware': case 'mechanism': case 'assembly':
      return `${scope}|${ref.id ?? ''}|${p}`;
    case 'step': case 'fitCheck':
      return `${scope}|${ref.index ?? ''}|${p}`;
    default:
      return `meta|${p}`;
  }
}

const UNSET = Symbol('unset');            // "this property/entry is not there"
const val = (v) => (v === UNSET ? undefined : v);

// ------------------------------------------------------------- merge context

function makeCtx(resolve, collect) {
  return {
    resolve,
    collect,
    conflicts: new Map(),
    note(scope, ref, prop, sides, lookup) {
      const key = mergeKey(scope, ref, prop);
      if (collect && !this.conflicts.has(key)) {
        this.conflicts.set(key, { key, scope, ref, prop, sides, lookup: lookup || { yours: key, theirs: key } });
      }
      return key;
    },
  };
}

// The heart of it. Returns the value to keep, UNSET meaning "not present".
function threeWay(ctx, scope, ref, prop, b, o, t, lookup) {
  if (same(val(b), val(t))) return o;         // Claude left it alone
  if (same(val(b), val(o))) return t;         // the kid left it alone
  if (same(val(o), val(t))) return t;         // both landed on the same thing
  const key = ctx.note(scope, ref, prop, { before: val(b), yours: val(o), theirs: val(t) }, lookup);
  return ctx.resolve(key) === 'claude' ? t : o;
}

const has = (obj, k) => obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, k);
const get = (obj, k) => (has(obj, k) ? obj[k] : UNSET);

// Merge the plain properties of one object (a part's scalars, a hardware
// entry, a step...). `scopeFor` maps a property name onto the differ's scope
// so the conflict key lines up with the record the differ will emit.
function mergeProps(ctx, obj, { base, ours, theirs, ref, scopeFor, skip = [], propName = (k) => k, lookupFor = null }) {
  const out = obj;
  const keys = new Set([
    ...Object.keys(base && typeof base === 'object' ? base : {}),
    ...Object.keys(ours && typeof ours === 'object' ? ours : {}),
    ...Object.keys(theirs && typeof theirs === 'object' ? theirs : {}),
  ]);
  for (const k of keys) {
    if (skip.includes(k)) continue;
    const scope = scopeFor(k);
    const prop = propName(k);
    const v = threeWay(ctx, scope, ref, prop, get(base, k), get(ours, k), get(theirs, k),
      lookupFor ? lookupFor(scope, prop) : null);
    if (v === UNSET) delete out[k];
    else out[k] = structuredClone(v);
  }
  return out;
}

// A list keyed by identity, merged three ways. Adds land, removals land unless
// the other side edited the thing being removed, everything else recurses.
function mergeKeyedList(ctx, {
  scope, base, ours, theirs, keyOf, refOf, mergeItem, lookupFor = null,
}) {
  const map = (list) => {
    const m = new Map();
    (Array.isArray(list) ? list : []).forEach((item, index) => {
      let key = keyOf(item, index);
      if (m.has(key)) { let n = 2; while (m.has(`${key}~${n}`)) n++; key = `${key}~${n}`; }
      m.set(key, { item, index });
    });
    return m;
  };
  const B = map(base), O = map(ours), T = map(theirs);
  const out = [];

  for (const [k, { item: o, index: oi }] of O) {
    const inB = B.has(k), inT = T.has(k);
    const b = inB ? B.get(k).item : UNSET;
    const t = inT ? T.get(k).item : UNSET;
    const ref = refOf(k, o, oi);
    const look = lookupFor ? lookupFor(k, { ours: oi, theirs: inT ? T.get(k).index : null }) : null;
    if (!inB) {
      // Something the kid added. Parts were de-collided before we got here, so
      // this is the rarer "you both invented a <hardware/step/...> with the
      // same name" — a real conflict, and the kid's copy is the default.
      if (inT && !same(o, t)) {
        const key = ctx.note(scope, ref, null, { before: null, yours: o, theirs: t }, look);
        out.push(structuredClone(ctx.resolve(key) === 'claude' ? t : o));
        continue;
      }
      out.push(structuredClone(o));
      continue;
    }
    if (!inT) {
      // Claude removed it.
      if (same(b, o)) continue;                       // the kid hadn't touched it — let it go
      const key = ctx.note(scope, ref, null, { before: b, yours: o, theirs: null }, look);
      if (ctx.resolve(key) !== 'claude') out.push(structuredClone(o));
      continue;
    }
    out.push(mergeItem(b, o, t, k, ref, look));
  }

  for (const [k, { item: t, index: ti }] of T) {
    if (O.has(k)) continue;
    const ref = refOf(k, t, ti);
    const look = lookupFor ? lookupFor(k, { ours: null, theirs: ti }) : null;
    if (!B.has(k)) { out.push(structuredClone(t)); continue; }   // Claude added it
    const b = B.get(k).item;
    if (same(b, t)) continue;                          // the kid removed it, Claude never touched it
    const key = ctx.note(scope, ref, null, { before: b, yours: null, theirs: t }, look);  // remove-vs-edit
    if (ctx.resolve(key) === 'claude') out.push(structuredClone(t));
  }
  return out;
}

// ------------------------------------------------------------------- pieces

const PART_SCOPE = (k) => (k === 'path' || k === 'backing' ? 'path' : k === 'count' ? 'count' : 'part');

// holes[] and slits[] key by entry id, with the differ's per-LIST fallback to
// position for legacy bare strings (an old doc whose slits are plain strings
// must not read as "every score line replaced").
function mergeEntries(ctx, kind, { base, ours, theirs, partId }) {
  const key = kind === 'hole' ? 'holes' : 'slits';
  const idKey = kind === 'hole' ? 'holeId' : 'slitId';
  const allIds = (l) => !Array.isArray(l) || l.length === 0 || l.every((e) => entryId(e));
  const useIds = allIds(base?.[key]) && allIds(ours?.[key]) && allIds(theirs?.[key]);
  const keyOf = useIds ? (e, i) => entryId(e) || `#${i}` : (e, i) => `#${i}`;
  return mergeKeyedList(ctx, {
    scope: kind,
    base: base?.[key], ours: ours?.[key], theirs: theirs?.[key],
    keyOf,
    refOf: (k, item) => ({ part: partId, [idKey]: entryId(item) || (useIds ? k : null) }),
    mergeItem: (b, o, t, k, ref) => {
      // The entry may be a bare string or {id, d}: merge the path either way.
      const d = threeWay(ctx, kind, ref, 'd', pathD(b), pathD(o), pathD(t));
      if (typeof o === 'string') return typeof d === 'string' ? d : o;
      const out = structuredClone(o);
      if (typeof d === 'string') out.d = d;
      return out;
    },
  });
}

function mergePart(ctx, b, o, t, id) {
  const ref = { part: id };
  const out = structuredClone(o);
  mergeProps(ctx, out, {
    base: b, ours: o, theirs: t, ref, scopeFor: PART_SCOPE,
    skip: ['id', 'holes', 'slits', 'layout'],
  });

  // layout: MOVE and TURN are three separate numbers, so a kid sliding a part
  // sideways and Claude turning it are NOT the same edit.
  const lb = b?.layout, lo = o?.layout, lt = t?.layout;
  if (lb && lo && lt && typeof lb === 'object' && typeof lo === 'object' && typeof lt === 'object') {
    const layout = structuredClone(lo);
    for (const k of ['x', 'y', 'rotDeg']) {
      const v = threeWay(ctx, 'layout', ref, `layout.${k}`, get(lb, k), get(lo, k), get(lt, k));
      if (v === UNSET) delete layout[k]; else layout[k] = v;
    }
    out.layout = layout;
  } else {
    const v = threeWay(ctx, 'layout', ref, 'layout', get(b, 'layout'), get(o, 'layout'), get(t, 'layout'));
    if (v === UNSET) delete out.layout; else out.layout = structuredClone(v);
  }

  for (const [kind, key] of [['hole', 'holes'], ['slit', 'slits']]) {
    if (!has(b, key) && !has(o, key) && !has(t, key)) continue;
    out[key] = mergeEntries(ctx, kind, { base: b, ours: o, theirs: t, partId: id });
  }
  return out;
}

const idKeyOf = (item, i) => (item && typeof item.id === 'string' ? item.id : `#${i}`);

// A part id that Claude invented can collide with one the kid just invented.
// Neither may be dropped, so Claude's copy is renamed — everywhere in Claude's
// document at once, which is safe precisely because `base` never knew that id.
function decollideParts(base, ours, theirs) {
  const known = (doc) => new Set((doc?.parts || []).map((p) => p && p.id).filter((x) => typeof x === 'string'));
  const inBase = known(base), inOurs = known(ours), inTheirs = known(theirs);
  const taken = new Set([...inBase, ...inOurs, ...inTheirs]);
  const byId = (doc, id) => (doc?.parts || []).find((p) => p && p.id === id);
  const renames = new Map();
  for (const id of inTheirs) {
    if (inBase.has(id) || !inOurs.has(id)) continue;              // not a fresh collision
    if (same(byId(ours, id), byId(theirs, id))) continue;         // literally the same new part
    let next = `${id}-c`, n = 2;
    while (taken.has(next)) next = `${id}-c${n++}`;
    taken.add(next);
    renames.set(id, next);
  }
  if (!renames.size) return { theirs, renames };
  const rename = (x) => (typeof x === 'string' && renames.has(x) ? renames.get(x) : x);
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = (k === 'part' || k === 'refPart') && typeof v === 'string' ? rename(v) : walk(v);
    }
    return out;
  };
  const clone = walk(structuredClone(theirs));
  for (const p of clone.parts || []) if (p && renames.has(p.id)) p.id = renames.get(p.id);
  return { theirs: clone, renames };
}

// ------------------------------------------------------------- the whole doc

const COLLECTIONS = new Set(['parts', 'hardware', 'mechanisms', 'assembly', 'steps', 'fitChecks']);

function mergeDoc(ctx, base, ours, theirs) {
  const out = structuredClone(ours && typeof ours === 'object' ? ours : {});

  // --- parts --------------------------------------------------------------
  if (has(base, 'parts') || has(ours, 'parts') || has(theirs, 'parts')) {
    out.parts = mergeKeyedList(ctx, {
      scope: 'part',
      base: base?.parts, ours: ours?.parts, theirs: theirs?.parts,
      keyOf: idKeyOf,
      refOf: (k, item) => ({ part: (item && item.id) || k }),
      mergeItem: (b, o, t, k) => mergePart(ctx, b, o, t, (o && o.id) || k),
    });
  }

  // --- hardware / mechanisms ---------------------------------------------
  for (const [scope, key] of [['hardware', 'hardware'], ['mechanism', 'mechanisms']]) {
    if (!has(base, key) && !has(ours, key) && !has(theirs, key)) continue;
    out[key] = mergeKeyedList(ctx, {
      scope,
      base: base?.[key], ours: ours?.[key], theirs: theirs?.[key],
      keyOf: idKeyOf,
      refOf: (k, item) => ({ id: (item && item.id) || k }),
      mergeItem: (b, o, t, k, ref) =>
        mergeProps(ctx, structuredClone(o), { base: b, ours: o, theirs: t, ref, scopeFor: () => scope, skip: ['id'] }),
    });
  }

  // --- assembly (thickness + the fold-up instances) -----------------------
  const ab = base?.assembly, ao = ours?.assembly, at = theirs?.assembly;
  if (ab && ao && at && typeof ao === 'object') {
    const asm = structuredClone(ao);
    mergeProps(ctx, asm, {
      base: ab, ours: ao, theirs: at, ref: {}, scopeFor: () => 'meta',
      propName: (k) => `assembly.${k}`, skip: ['instances'],
    });
    asm.instances = mergeKeyedList(ctx, {
      scope: 'assembly',
      base: ab.instances, ours: ao.instances, theirs: at.instances,
      keyOf: idKeyOf,
      refOf: (k, item) => ({ id: (item && item.id) || k, part: (item && item.part) || null }),
      mergeItem: (b, o, t, k, ref) =>
        mergeProps(ctx, structuredClone(o), { base: b, ours: o, theirs: t, ref, scopeFor: () => 'assembly', skip: ['id'] }),
    });
    out.assembly = asm;
  } else if (has(base, 'assembly') || has(ours, 'assembly') || has(theirs, 'assembly')) {
    const v = threeWay(ctx, 'meta', {}, 'assembly', get(base, 'assembly'), get(ours, 'assembly'), get(theirs, 'assembly'));
    if (v === UNSET) delete out.assembly; else out.assembly = structuredClone(v);
  }

  // --- steps (no ids: position IS the identity) ---------------------------
  if (has(base, 'steps') || has(ours, 'steps') || has(theirs, 'steps')) {
    out.steps = mergeKeyedList(ctx, {
      scope: 'step',
      base: base?.steps, ours: ours?.steps, theirs: theirs?.steps,
      keyOf: (_item, i) => `#${i}`,
      refOf: (k, _item, i) => ({ id: `step-${i + 1}`, index: i }),
      mergeItem: (b, o, t, k, ref) =>
        mergeProps(ctx, structuredClone(o), { base: b, ours: o, theirs: t, ref, scopeFor: () => 'step' }),
    });
  }

  // --- fitChecks (identity = the measurement they make) -------------------
  if (has(base, 'fitChecks') || has(ours, 'fitChecks') || has(theirs, 'fitChecks')) {
    out.fitChecks = mergeKeyedList(ctx, {
      scope: 'fitCheck',
      base: base?.fitChecks, ours: ours?.fitChecks, theirs: theirs?.fitChecks,
      keyOf: fitKey,
      refOf: (k, item, i) => ({ id: null, index: i, part: (item && item.a && item.a.part) || null }),
      // the differ reports a fitCheck by its POSITION in each document, so each
      // side is looked up under its own index
      lookupFor: (k, at) => ({
        yours: at.ours == null ? null : mergeKey('fitCheck', { index: at.ours }, null),
        theirs: at.theirs == null ? null : mergeKey('fitCheck', { index: at.theirs }, null),
      }),
      mergeItem: (b, o, t, k, ref, look) =>
        mergeProps(ctx, structuredClone(o), {
          base: b, ours: o, theirs: t, ref, scopeFor: () => 'fitCheck',
          lookupFor: (scope, prop) => ({
            yours: look && look.yours ? `${look.yours}${prop}` : null,
            theirs: look && look.theirs ? `${look.theirs}${prop}` : null,
          }),
        }),
    });
  }

  // --- everything else (title, tagline, finishedSize, hero, ...) ----------
  mergeProps(ctx, out, {
    base, ours, theirs, ref: {}, scopeFor: () => 'meta',
    skip: [...COLLECTIONS],
  });
  return out;
}

// ------------------------------------------------------------- record index

function indexRecords(records) {
  const exact = new Map();
  // "anything this side did to that object" — a remove-vs-edit conflict is
  // keyed on the whole object, but the sentence the kid needs to read is the
  // edit they actually made to it ("Knuckle Guard: moved 1.5\" right"), which
  // lives under a different prop.
  const anywhere = new Map();
  for (const r of records) {
    const put = (m, k) => { if (k && !m.has(k)) m.set(k, r); };
    put(exact, mergeKey(r.scope, r.ref, r.prop));
    put(anywhere, objectKey(r.ref));
    // grouped score lines carry ref.ids instead of one slitId
    if (Array.isArray(r.ref?.ids)) {
      for (const id of r.ref.ids) put(exact, mergeKey(r.scope, { ...r.ref, slitId: id }, r.prop));
    }
  }
  return {
    get: (key) => exact.get(key),
    about: (ref) => anywhere.get(objectKey(ref)),
  };
}

// Which THING a record is about, ignoring which of its properties moved.
const objectKey = (ref = {}) =>
  `${ref.part ?? ''}/${ref.holeId ?? ref.slitId ?? ''}/${ref.id ?? ''}/${ref.index ?? ''}`;

// When one side's change produces no DiffRecord of its own (a property the
// differ deliberately stays quiet about, or a side that simply has nothing
// there), the picker still needs a sentence. Never a JSON path.
function synthRecord(kind, scope, ref, prop, before, after, side) {
  const who = side === 'claude' ? 'Claude' : 'you';
  const name = ref.part ? humanize(ref.part) : ref.id ? humanize(ref.id) : 'the design';
  const label = kind === 'removed'
    ? `${name}: ${who === 'you' ? 'you took it away' : 'Claude takes it away'}`
    : kind === 'added'
      ? `${name}: ${who === 'you' ? 'you added it' : 'Claude adds it'}`
      : `${name}: ${who === 'you' ? 'the way you have it' : "Claude's version"}`;
  return { kind, scope, ref: { part: null, holeId: null, slitId: null, id: null, ...ref }, prop: prop ?? null, before: before ?? null, after: after ?? null, label };
}

// =============================================================== public API

export function mergeDesigns({ base, ours, theirs, choices } = {}) {
  const B = base && typeof base === 'object' ? base : {};
  const O = ours && typeof ours === 'object' ? ours : {};
  const raw = theirs && typeof theirs === 'object' ? theirs : {};
  const { theirs: T, renames } = decollideParts(B, O, raw);

  const pick = (key) => ((choices && choices[key] === 'claude') ? 'claude' : 'you');
  const ctx = makeCtx(pick, true);
  const merged = mergeDoc(ctx, B, O, T);

  // The same merge with every conflict resolved Claude's way: diffing THAT
  // against the kid's current draft is exactly "Claude's records, relabelled
  // against what you have now", conflicts included.
  const claudeApplied = mergeDoc(makeCtx(() => 'claude', false), B, O, T);

  const oursRecs = indexRecords(diffDesigns(B, O));
  const theirsRecs = indexRecords(diffDesigns(B, T));

  const conflicts = [...ctx.conflicts.values()].map((c) => {
    const { key, scope, ref, prop, sides, lookup } = c;
    const yoursKey = lookup && lookup.yours !== undefined ? lookup.yours : key;
    const theirsKey = lookup && lookup.theirs !== undefined ? lookup.theirs : key;
    const kindOf = (v) => (v === undefined || v === null
      ? 'removed'
      : (sides.before === undefined || sides.before === null ? 'added' : 'changed'));
    const side = (index, mine, key, who) => {
      if (key && index.get(key)) return index.get(key);
      if (prop === null && index.about(ref)) return index.about(ref);   // whole-object clash
      if (who === 'you' && (mine === undefined || mine === null) && (sides.before === undefined || sides.before === null)) return null;
      return synthRecord(kindOf(mine), scope, ref, prop, sides.before, mine ?? null, who);
    };
    const yours = side(oursRecs, sides.yours, yoursKey, 'you');
    const theirs2 = side(theirsRecs, sides.theirs, theirsKey, 'claude');
    return { key, scope, ref, prop, yours: yours || null, theirs: theirs2 };
  });
  const conflictKeys = new Set(conflicts.map((c) => c.key));

  const records = diffDesigns(O, claudeApplied).map((r) => {
    const key = mergeKey(r.scope, r.ref, r.prop);
    const ids = Array.isArray(r.ref?.ids) ? r.ref.ids : null;
    const conflict = conflictKeys.has(key)
      || (ids ? ids.some((id) => conflictKeys.has(mergeKey(r.scope, { ...r.ref, slitId: id }, r.prop))) : false);
    return { ...r, from: 'claude', key, conflict };
  });

  return {
    merged,
    records,
    conflicts,
    renames: [...renames.entries()].map(([from, to]) => ({ from, to })),
    inputs: { base: B, ours: O, theirs: raw },
  };
}

// Re-run the merge with the picker's answers. Pure: same inputs, new choices,
// whole result recomputed — which is why the Mat can tap a chip and just ask
// again. `choices` maps a conflict key to "you" | "claude".
export function applyChoices(mergeResult, choices) {
  const inputs = (mergeResult && mergeResult.inputs) || {};
  return mergeDesigns({ base: inputs.base, ours: inputs.ours, theirs: inputs.theirs, choices });
}

export default { diffDesigns, mergeDesigns, applyChoices, mergeKey, canonicalJson };
