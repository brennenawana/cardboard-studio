# Cardboard Studio 📦

Our family workshop: dream up a cardboard build with your kid, and get a printable
template bundle — cut sheets + a step-by-step guide — styled like the ones from
reuseandplay.com, but yours.

## Start it

```sh
cd server
node src/index.mjs
```

Open **http://localhost:4177**. That's it — design generation uses the Claude
subscription through the `claude` CLI already installed on this machine. No API key.


https://github.com/user-attachments/assets/332a729b-3268-4538-88b9-65d245139bff


## How a session goes

1. **Invent something** in the chat ("a dragon shield!", "a garage with a ramp!").
   The studio chats along and, when the idea is concrete, offers a build brief.
2. Hit **Make the template!** — generation takes ~5 minutes (progress shows live).
   Every design is validated: geometry is measured (fit checks — a lid that can't
   close or a crown that can't fit gets rejected and repaired automatically).
3. Open the design in **Our designs** → print the **Letter template** at
   **100% / Actual Size** → check a grid square really is 1 inch → tape the sheets
   using the crosshair marks → trace, cut, build with the guide.

## What's in a bundle

- `*_template_Lettersize.pdf` / `*_template_A4.pdf` — actual-size cut sheets with
  the 1-inch alignment grid, part labels, cut/score legend, corrugation arrows,
  piece list, and tape map.
- `*_guide.pdf` — cover, what-you-need + safety, print setup, page taping, tracing,
  cut/glue tips, illustrated steps with CHECK lines, back page.

## Under the hood

- `designs/<slug>/design.json` is the whole design (paths in inches). Edit it by
  hand and re-render: `curl -X POST localhost:4177/api/designs/<slug>/render`
- Quality process + format spec: see `CLAUDE.md` and `reference/FORMAT-SPEC.md`.
- The reference PDFs in `reference/pdfs/` are Reuse & Play's free downloads —
  personal use only; they stay on this machine.
