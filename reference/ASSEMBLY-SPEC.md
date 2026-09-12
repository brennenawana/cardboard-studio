# 3D Assembly Spec — Cardboard Studio viewer

Extends design.json with an `assembly` block so the browser viewer (Three.js r180,
WebGL2) can animate the flat cut parts folding and flying into the finished toy.
The bar for look/feel is Origami Simulator (running at http://localhost:4178):
one big viewport, a continuous Flat⟷Built slider, orbit controls, crisp faces + edges.

## Coordinate conventions

- Part 2D space (u,v): the part's template path coordinates, inches, v down.
- Part local 3D: X = u, Y = -v (so "down the template" = down in 3D), Z = out of the
  front face. Cardboard thickness extrudes from z=0 (back) to z=+thicknessIn (front).
- World: y-up, inches. Ground plane y=0 is the "table".

## design.json additions

```json
"assembly": {
  "thicknessIn": 0.15,
  "instances": [
    {
      "id": "body-0",            // unique
      "part": "sword-body",      // part id
      "copy": 0,                 // 0..count-1 (each copy that participates gets an instance)
      "order": 0,                // build order; equal orders animate together
      "step": 2,                 // optional: index into design.steps for the caption shown
      "pos": [0, 0.15, 0],       // FINAL position of part-local origin, world in
      "rot": [-90, 0, 0],        // FINAL rotation, degrees, applied X→Y→Z
      "mirror": false,           // true = mirror through part plane (back layers)
      "folds": [                 // optional hinge/curl at the part's slit lines
        { "slit": "all", "angleDeg": 12 },   // same angle at every slit = smooth curl
        { "slit": 3, "angleDeg": 90 }         // or per-slit (box wall folds)
      ]
    }
  ]
}
```

## Fold semantics (one mechanism for folds AND curls)

A part's `slits` that are straight lines spanning the part are hinge lines. Order them
along their common perpendicular axis. Segment the part outline at those lines
(clip the sampled outline polygon against half-planes — Sutherland–Hodgman). Segment 0
(lowest u or v along the axis) stays in the part's base frame; each segment k>0 hangs
in a nested group pivoted at line k, rotated by its `angleDeg × t`. Positive angle folds
the far side toward +Z (the front face becomes the inside of the curl).
Holes/decorative slits that don't span the part are not hinges: assign each to the
segment containing its centroid.

- Box wall fold: one slit, 90°.
- Knuckle guard / crown curl: N slits, each ~totalCurl/N.
- A crease is just a tiny-radius bend: this matches real cardboard behavior.

## Animation timeline

Global build parameter t ∈ [0,1] (the slider; also a Play button ~8s sweep).
- Flat pose (t=0): every instance lies flat on the table (part plane horizontal,
  front face up), folds at 0°, arranged in a non-overlapping grid roughly matching
  the template-sheet layout, spread around the assembly footprint.
- Distinct order values O1<…<On each get a window of t (overlap ~30% with the next).
  Order values are time slots: skipping values (e.g. 0 then 7) stretches the earlier
  order's window across the gap — use it to give a long fold (a box net) more time.
  Inside its window an instance eases (smoothstep) position (lerp), rotation (quaternion
  slerp), and fold angles 0→target simultaneously. Before its window: flat pose.
  After: final pose.
- t=1: the assembled toy. Camera auto-fits the assembled bounding box at load.

## Viewer requirements

- Route: GET /viewer/:slug (express) serves public/viewer.html; it fetches
  /api/designs/:slug. three.js served locally: /vendor/three/three.module.js and
  /vendor/three/OrbitControls.js via an import map (no CDN).
- WebGLRenderer (three r180 = WebGL2), antialias, shadows (soft), pixelRatio-aware.
- Materials: front/back kraft #C9AB84 (MeshStandardMaterial, high roughness), extruded
  edges darker #9E8261; subtle THREE.EdgesGeometry lines (#5c4a36, threshold ~25°) for
  the crisp die-cut look. Ground: ShadowMaterial contact shadow only. Background:
  #FAF6EF (matches studio paper). Hemisphere light + one shadowed directional key.
- UI (match studio branding, minimal like the bar): top bar with design title +
  "← back"; bottom center: FLAT ⟷ BUILT slider + Play/Pause + Reset view; a caption
  line showing the current step title (from instance.step) as t sweeps.
- The 2D↔3D link: pressing/holding a part row in a small parts list (side) highlights
  that instance (emissive pulse) — lets a family match template part ↔ 3D placement.
- Add a "3D preview" button per design in the main UI (index.html gallery/detail).

## Validation (schema.mjs)

`assembly` optional but validated when present: instance part ids exist, copy < count,
slit indices valid, |angleDeg| ≤ 178 per hinge, thickness 0.1–0.25, every multi-part
design SHOULD cover each part's copies (warn, not error). AI prompt (GEOMETRY_RULES)
must require an assembly block on new designs.
