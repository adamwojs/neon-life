# Neon Life

Generate neon wallpapers from Conway's Game of Life (B3/S23). Every lit cell in the exported
image is a live cell of the simulated generation — the picture is the real state of the automaton.

## Features

- **Initial state control** – random soup (density, filled area, seed, mirror/rotational symmetry),
  a single centred pattern, scattered copies of a pattern, freehand painting (draw / erase / stamp
  with rotate & flip), and RLE / plaintext import & export.
- **Evolution steps** – choose any generation from 0 to 10 000. The simulation runs in a Web Worker
  with checkpoints, so scrubbing is fast. Stable, oscillating and extinct states are detected.
- **Playback** – watch the evolution from generation 0 to the selected step.
- **Neon styling** – palettes or custom colours, colour by age / neighbours / position, cell shape,
  gap, glow, neon core, background lattice and optional afterglow of recently dead cells.
- **Export** – PNG / JPEG / WebP at preset (Full HD, QHD, 4K, ultrawide, phones…), screen or
  custom resolutions. The grid size is derived from the resolution and cell size, so the preview
  matches the exported wallpaper exactly. Wrapped (toroidal) edges are supported.

## Development

Requires Node.js 20.19+.

```bash
npm install
npm run dev     # start dev server
npm run build   # type-check and build
npm run lint
```

## Structure

- `src/life/engine.ts` – Game of Life engine, age/afterglow tracking, seekable trajectory with cycle detection
- `src/life/patterns.ts` – presets, RLE parsing/encoding, seeding generators
- `src/life/render.ts` – neon renderer shared by preview and export
- `src/life/sim.worker.ts` – background simulation worker
- `src/components/Preview.tsx` – preview canvas and cell painting
