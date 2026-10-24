import { createGrid, type Grid } from './engine.ts'

export interface Pattern {
  cols: number
  rows: number
  cells: Uint8Array
}

export interface PatternPreset {
  id: string
  name: string
  rle: string
}

export const PRESETS: PatternPreset[] = [
  { id: 'glider', name: 'Glider', rle: 'bo$2bo$3o!' },
  { id: 'lwss', name: 'Lightweight spaceship', rle: 'bo2bo$o4b$o3bo$4ob!' },
  { id: 'r-pentomino', name: 'R-pentomino (methuselah)', rle: 'b2o$2ob$bo!' },
  { id: 'acorn', name: 'Acorn (methuselah)', rle: 'bo5b$3bo3b$2o2b3o!' },
  { id: 'diehard', name: 'Diehard', rle: '6bob$2o6b$bo3b3o!' },
  { id: 'rabbits', name: 'Rabbits', rle: 'o3b3o$3o2bob$bo!' },
  {
    id: 'gosper-gun',
    name: 'Gosper glider gun',
    rle: '24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4bobo$10bo5bo7bo$11bo3bo$12b2o!',
  },
  {
    id: 'pulsar',
    name: 'Pulsar',
    rle: '2b3o3b3o2b2$o4bobo4bo$o4bobo4bo$o4bobo4bo$2b3o3b3o2b2$2b3o3b3o2b$o4bobo4bo$o4bobo4bo$o4bobo4bo2$2b3o3b3o!',
  },
  { id: 'pentadecathlon', name: 'Pentadecathlon', rle: '2bo4bo2b$2ob4ob2o$2bo4bo!' },
  { id: 'line', name: 'Infinite growth line', rle: '8ob5o3b3o6b7ob5o!' },
]

/** Deterministic PRNG (mulberry32). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Parses RLE (with optional header/comments) or plaintext (.cells) patterns. */
export function parsePattern(text: string): Pattern {
  const lines = text.replace(/\r/g, '').split('\n')
  const content = lines.filter((l) => !l.startsWith('!') && !l.startsWith('#') && l.trim() !== '')
  const isPlain = content.length > 0 && content.every((l) => /^[.O*]+$/.test(l.trim()))
  if (isPlain) {
    const rowsText = lines.filter((l) => !l.startsWith('!') && !l.startsWith('#')).map((l) => l.trimEnd())
    while (rowsText.length && rowsText[0] === '') rowsText.shift()
    while (rowsText.length && rowsText[rowsText.length - 1] === '') rowsText.pop()
    const rows = rowsText.length
    const cols = Math.max(0, ...rowsText.map((l) => l.length))
    if (!rows || !cols) throw new Error('Pattern is empty')
    const cells = new Uint8Array(cols * rows)
    rowsText.forEach((l, y) => {
      for (let x = 0; x < l.length; x++) if (l[x] === 'O' || l[x] === '*') cells[y * cols + x] = 1
    })
    return { cols, rows, cells }
  }

  const body = lines
    .filter((l) => !l.trim().startsWith('#') && !/^\s*x\s*=/.test(l))
    .join('')
    .replace(/\s+/g, '')
  const points: [number, number][] = []
  let x = 0
  let y = 0
  let cols = 0
  let num = ''
  for (const ch of body) {
    if (ch >= '0' && ch <= '9') {
      num += ch
      continue
    }
    const n = num ? parseInt(num, 10) : 1
    num = ''
    if (ch === 'b' || ch === '.') x += n
    else if (ch === '$') {
      y += n
      x = 0
    } else if (ch === '!') break
    else if (/[a-zA-Z*]/.test(ch)) {
      for (let i = 0; i < n; i++) points.push([x + i, y])
      x += n
    } else throw new Error(`Unexpected character "${ch}" in RLE`)
    cols = Math.max(cols, x)
  }
  if (!points.length) throw new Error('Pattern has no live cells')
  const rows = Math.max(...points.map((p) => p[1])) + 1
  cols = Math.max(cols, ...points.map((p) => p[0] + 1))
  const cells = new Uint8Array(cols * rows)
  for (const [px, py] of points) cells[py * cols + px] = 1
  return { cols, rows, cells }
}

/** Encodes the bounding box of live cells as RLE. */
export function toRle(grid: Grid): string {
  const { cols, rows, cells } = grid
  let minX = cols, minY = rows, maxX = -1, maxY = -1
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (cells[y * cols + x]) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
  if (maxX < 0) return 'x = 0, y = 0, rule = B3/S23\n!'
  const out: string[] = []
  const push = (count: number, ch: string) => {
    if (count > 0) out.push((count > 1 ? String(count) : '') + ch)
  }
  let pendingRows = 0
  for (let y = minY; y <= maxY; y++) {
    const line: [string, number][] = []
    for (let x = minX; x <= maxX; x++) {
      const ch = cells[y * cols + x] ? 'o' : 'b'
      const last = line[line.length - 1]
      if (last && last[0] === ch) last[1]++
      else line.push([ch, 1])
    }
    if (line.length && line[line.length - 1][0] === 'b') line.pop()
    if (!line.length) {
      pendingRows++
      continue
    }
    if (y > minY) push(pendingRows + 1, '$')
    pendingRows = 0
    for (const [ch, n] of line) push(n, ch)
  }
  const text = out.join('') + '!'
  const wrapped = text.match(/.{1,70}/g)?.join('\n') ?? text
  return `x = ${maxX - minX + 1}, y = ${maxY - minY + 1}, rule = B3/S23\n${wrapped}`
}

/** Rotates (quarter turns clockwise) and optionally mirrors a pattern. */
export function transformPattern(p: Pattern, quarterTurns: number, flip: boolean): Pattern {
  let cur = p
  if (flip) {
    const cells = new Uint8Array(cur.cells.length)
    for (let y = 0; y < cur.rows; y++)
      for (let x = 0; x < cur.cols; x++) cells[y * cur.cols + (cur.cols - 1 - x)] = cur.cells[y * cur.cols + x]
    cur = { ...cur, cells }
  }
  for (let t = 0; t < ((quarterTurns % 4) + 4) % 4; t++) {
    const cols = cur.rows
    const rows = cur.cols
    const cells = new Uint8Array(cur.cells.length)
    for (let y = 0; y < cur.rows; y++)
      for (let x = 0; x < cur.cols; x++) cells[x * cols + (cur.rows - 1 - y)] = cur.cells[y * cur.cols + x]
    cur = { cols, rows, cells }
  }
  return cur
}

/** Adds the live cells of `p` with its top-left corner at (x, y). */
export function stamp(grid: Grid, p: Pattern, x: number, y: number, wrap: boolean): void {
  for (let py = 0; py < p.rows; py++)
    for (let px = 0; px < p.cols; px++) {
      if (!p.cells[py * p.cols + px]) continue
      let gx = x + px
      let gy = y + py
      if (wrap) {
        gx = ((gx % grid.cols) + grid.cols) % grid.cols
        gy = ((gy % grid.rows) + grid.rows) % grid.rows
      } else if (gx < 0 || gy < 0 || gx >= grid.cols || gy >= grid.rows) continue
      grid.cells[gy * grid.cols + gx] = 1
    }
}

export type Symmetry = 'none' | 'mirror-x' | 'mirror-y' | 'mirror-xy' | 'rotate-180'

export interface RandomSeedOptions {
  seed: number
  density: number
  /** Fraction (0..1] of width/height filled, centred. */
  area: number
  symmetry: Symmetry
}

export function randomGrid(cols: number, rows: number, o: RandomSeedOptions): Grid {
  const grid = createGrid(cols, rows)
  const rng = createRng(o.seed)
  const aw = Math.max(1, Math.round(cols * o.area))
  const ah = Math.max(1, Math.round(rows * o.area))
  const x0 = Math.floor((cols - aw) / 2)
  const y0 = Math.floor((rows - ah) / 2)
  for (let y = y0; y < y0 + ah; y++)
    for (let x = x0; x < x0 + aw; x++) grid.cells[y * cols + x] = rng() < o.density ? 1 : 0
  applySymmetry(grid, o.symmetry)
  return grid
}

export function applySymmetry(grid: Grid, symmetry: Symmetry): void {
  const { cols, rows, cells } = grid
  if (symmetry === 'mirror-x' || symmetry === 'mirror-xy')
    for (let y = 0; y < rows; y++)
      for (let x = Math.ceil(cols / 2); x < cols; x++) cells[y * cols + x] = cells[y * cols + (cols - 1 - x)]
  if (symmetry === 'mirror-y' || symmetry === 'mirror-xy')
    for (let y = Math.ceil(rows / 2); y < rows; y++)
      for (let x = 0; x < cols; x++) cells[y * cols + x] = cells[(rows - 1 - y) * cols + x]
  if (symmetry === 'rotate-180') {
    const n = cells.length
    for (let i = Math.ceil(n / 2); i < n; i++) cells[i] = cells[n - 1 - i]
  }
}

export interface ScatterOptions {
  seed: number
  count: number
  randomOrientation: boolean
}

export function scatterGrid(cols: number, rows: number, p: Pattern, o: ScatterOptions): Grid {
  const grid = createGrid(cols, rows)
  const rng = createRng(o.seed)
  for (let i = 0; i < o.count; i++) {
    const t = o.randomOrientation ? transformPattern(p, Math.floor(rng() * 4), rng() < 0.5) : p
    const x = Math.floor(rng() * Math.max(1, cols - t.cols))
    const y = Math.floor(rng() * Math.max(1, rows - t.rows))
    stamp(grid, t, x, y, false)
  }
  return grid
}

export function centeredGrid(cols: number, rows: number, p: Pattern): Grid {
  const grid = createGrid(cols, rows)
  stamp(grid, p, Math.floor((cols - p.cols) / 2), Math.floor((rows - p.rows) / 2), false)
  return grid
}
