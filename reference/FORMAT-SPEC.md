# Reuse & Play Template Format — Reverse-Engineered Spec

Source: 4 free bundles from reuseandplay.com (in `reference/pdfs/`), store catalog of 55 products.
This is the bar our generated designs are judged against, blind.

## Product bundle structure (what a "design" ships as)

A ZIP containing:
- `<Part>_A4.pdf` — template sheets on A4 (595.32 x 841.92 pt)
- `<Part>_Lettersize.pdf` — same template re-tiled for US Letter (612 x 792 pt)
- `<Name>_guide_v1.pdf` — step-by-step assembly guide (Letter portrait)
- Simple designs (swords): one 2-page template PDF per variant, no guide
- Multi-assembly designs (toy garage): one draft PDF per sub-assembly (Base, Tower, Slide, Elevator…), landscape or portrait as fits
- File naming: `<TemplateSize>_<PaperStandard>_<TemplateName>` e.g. `96in_A4_Moon_Props`

## Template sheet conventions (the cut sheets)

- **Grid**: 1-inch light-gray grid (~0.5pt, #C8C8C8) + 3-inch heavier gray grid (~1.5pt, #999) covering the FULL page edge-to-edge. The grid is global: it continues seamlessly across pages so tiled parts re-align. Pages overlap: each page repeats an overlap margin (printer-dependent); users overlap sheets until visible grid squares are exactly 1in/3x3in.
- **Page number**: giant light-gray numeral (~120-200pt, #AAA, behind artwork) on every template page, per PDF file (1, 2, 3…).
- **Part outlines**: bold black stroke (~2.5-4pt). Solid = cut line.
- **Dashed gray outlines**: "second, larger copy" — a backing/underlay layer. Annotated inline with small text ("Dash lines is for second, larger copy").
- **Thin dashed lines** inside a part: fold/slit lines ("Cut these slits halfway through from the back side to make your template bendable").
- **Part labels**: plain black text near/inside each part: `Forehead - 1 pcs`, `Jaw 2 - 1pcs`, `Top 1pcs`. Labels may be rotated 180° with the part (parts nest in any orientation).
- **Corrugation arrows**: short dark-gray arrow with a dot tail placed inside each part = direction of corrugated flutes.
- **Parts span pages freely**; the grid + overlap system reassembles them. No registration crosses beyond the grid itself in newer sheets (older ones use red-circled cross marks in the guide illustrations).
- **A4 vs Letter are separate retilings** of the same 1:1 geometry (A4: narrower/taller; Letter: wider/shorter). Never scaled — always 100% actual size.

## Guide PDF anatomy (Letter portrait)

Standard page sequence (skull guide, 23pp; rock shelf guide, 6pp):
1. **Cover**: white bg, large beauty photo of finished build, product title (large, thin sans — looks like Myriad/Open Sans family), subtitle "step by step guide", crimson (#A6224A-ish) "CLICK HERE FOR VIDEO TUTORIAL" button bar with YouTube icon, website URL.
2. **Paper size**: two gray panels comparing INTERNATIONAL (EUROPEAN) A4 vs NORTH AMERICA Letter, dimensions in mm+in, file-naming explainer, "Template part has more height/width" captions.
3. **NOTE – printer set up**: red warning banner "Be sure your printer is set to print in 100% ACTUAL SIZE" with warning triangles + annotated screenshot of Adobe print dialog (Actual size radio checked, red V mark).
4. **Pages overlap and positioning**: numbered callouts ①②③ explaining overlap margin, 1in/3in grid, aligning to a 3x3in square; photos; red circles/arrows annotations; crimson video-instruction button.
5. **Tracing**: Method 1 (cut template, tape, trace outline) as numbered text; Method 2 (tape + tracing wheel / pen pressure) as 3 photos with ①②③ captions.
6. **NOTE – mind cardboard structure direction**: tips with photos — cut slits to bend smoothly, crease slits with fingernails, "paper bleed" technique (cut half through, peel corrugation, leave one face layer — clean glue surface/edges).
7. **NOTE – tips and tricks**: "HOW TO CUT CARDBOARD" (sharp blade, metal ruler, 2-3 light passes) and "HOW TO GLUE CARDBOARD" (hot glue + tape; white glue for laminating panels; seamless overlap with paper bleed) — each bullet block paired with a video-thumbnail link card.
8. **Sizing page** (wearables): "How to Measure your head" — 4 photo steps.
9. **Build steps**: pages titled `Step N. <Part Name>` — each mixes:
   - annotated template diagrams (vector outline of the part with callouts: corrugation arrow legend, dashed = larger backing copy, slit instructions)
   - photo sequences with bold-numbered captions (**1.** Glue two parts together …)
   - occasional variant comparisons ("5 top pieces helmet" vs "8 top pieces helmet")
10. **Bonus/stand parts**: full-page actual-size cut shapes embedded in the guide itself with one-line caption.
11. **Back cover / license**: R&P logo, "PERSONAL OR PROFESSIONAL USE ONLY, This file may not be shared…", FOLLOW AND SUBSCRIBE, site, YouTube, social icons, contact email.

Header convention on every content page: small logo square at top-left + underlined bold section title, e.g. `NOTE - printer set up`, `Step 2. Face Part`.

Tone of instructions: terse, imperative, friendly-imperfect English ("Prepaper the second stripe"), bold step numerals, safety notes where needed ("Be sure hot glue is not leaking!").

## Catalog range (ideation space, from store)

armor-and-weapons (swords, katana, shields, helmets), crowns-helmets-hats, chest-boxes (treasure chest, gift boxes), cardboard_furniture (kids coat rack, bookshelves, puzzle storage), toy-car-garage (garages, play mats, playsets), cardboard-truck-patterns (trucks, monster truck, train, lowrider), photo-props (giant stars, hearts, ferris wheel, sleigh, cactus), giant-letters / giant-numbers (marquee, block, light-up). Price range $3.50–$15; free items are simpler single-file or draft-quality bundles.

## What OUR system does differently (by necessity)

- Step photos → clean vector step diagrams (exploded views built from the same part geometry). Everything else — grids, tiling, labels, boilerplate pages, license, layout — matches the R&P structure.
- Boilerplate pages (2–8 above) are a standard reusable page library, rendered deterministically.
- All precision (grid math, tiling, overlap, actual-size) is deterministic code; AI only designs geometry, steps, and copy.
