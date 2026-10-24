import { NEVER_ALIVE, neighbourCounts, type LifeState } from './engine.ts'

export type ColorMode = 'age' | 'neighbours' | 'gradient' | 'solid'
export type CellShape = 'square' | 'rounded' | 'circle'
/** Where the blur is applied: whole image, edges only (sharp centre) or centre only (sharp edges). */
export type BlurMode = 'uniform' | 'edges' | 'center'

export interface Palette {
  id: string
  name: string
  colors: string[]
  background: string
}

export const PALETTES: Palette[] = [
  { id: 'cyberpunk', name: 'Cyberpunk', colors: ['#00f0ff', '#ff00e5', '#ffe600'], background: '#05010d' },
  { id: 'synthwave', name: 'Synthwave', colors: ['#05d9e8', '#d300c5', '#ff2a6d'], background: '#0b0221' },
  { id: 'toxic', name: 'Toxic', colors: ['#e1ff00', '#39ff14', '#00ffa3'], background: '#010a04' },
  { id: 'ice', name: 'Ice', colors: ['#ffffff', '#7df9ff', '#2b6cff'], background: '#00040d' },
  { id: 'inferno', name: 'Inferno', colors: ['#fff200', '#ff5e00', '#ff0055'], background: '#0d0102' },
  { id: 'aurora', name: 'Aurora', colors: ['#00ffd5', '#7b61ff', '#ff61d2'], background: '#020611' },
  { id: 'vapor', name: 'Vaporwave', colors: ['#ff71ce', '#01cdfe', '#05ffa1', '#b967ff'], background: '#0a0014' },
]

export interface RenderOptions {
  colors: string[]
  background: string
  colorMode: ColorMode
  shape: CellShape
  /** Gap between cells as a fraction of cell size (0..0.45). */
  gap: number
  /** Glow strength (0 = off). */
  glow: number
  /** Draws a bright core inside each cell for a neon-tube look. */
  core: boolean
  /** Shows fading trails of cells that died within `trailLength` generations. */
  trails: boolean
  trailLength: number
  /** Ages at or above this value use the last palette colour. */
  ageSpan: number
  /** Faint lattice behind the cells. */
  backgroundGrid: boolean
  /** Blur radius in cells (0 = off). Relative to cell size so preview and export match. */
  blur: number
  blurMode: BlurMode
  /** Size of the sharp area for 'edges' / blurred area for 'center' (0..1 of the half-diagonal). */
  blurFocus: number
}

export interface Layout {
  /** Output size in pixels. */
  width: number
  height: number
  /** Cell size in output pixels. */
  cellSize: number
}

/** Grid size required to cover an image of the given size. */
export function gridSizeFor(width: number, height: number, cellSize: number) {
  return { cols: Math.max(1, Math.ceil(width / cellSize)), rows: Math.max(1, Math.ceil(height / cellSize)) }
}

/** Top-left offset (px) of the grid so it is centred in the image. */
export function gridOffset(layout: Layout, cols: number, rows: number) {
  return {
    x: (layout.width - cols * layout.cellSize) / 2,
    y: (layout.height - rows * layout.cellSize) / 2,
  }
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const LEVELS = 48

function buildLut(colors: string[]): string[] {
  const rgb = colors.map(hexToRgb)
  const lut: string[] = []
  for (let i = 0; i < LEVELS; i++) {
    const t = rgb.length === 1 ? 0 : (i / (LEVELS - 1)) * (rgb.length - 1)
    const a = Math.min(Math.floor(t), rgb.length - 1)
    const b = Math.min(a + 1, rgb.length - 1)
    const f = t - a
    const c = rgb[a].map((v, k) => Math.round(v + (rgb[b][k] - v) * f))
    lut.push(`rgb(${c[0]},${c[1]},${c[2]})`)
  }
  return lut
}

const layerCaches = [new WeakMap<HTMLCanvasElement, HTMLCanvasElement>(), new WeakMap<HTMLCanvasElement, HTMLCanvasElement>()]

/** Offscreen canvas of the same size as `target`; `slot` selects one of several independent buffers. */
function getLayer(target: HTMLCanvasElement, slot = 0): HTMLCanvasElement {
  const cache = layerCaches[slot]
  let layer = cache.get(target)
  if (!layer) {
    layer = document.createElement('canvas')
    cache.set(target, layer)
  }
  if (layer.width !== target.width || layer.height !== target.height) {
    layer.width = target.width
    layer.height = target.height
  }
  return layer
}

/**
 * Renders a Game of Life state as a neon image. Every lit cell corresponds to a live cell
 * of `state` (trails, if enabled, show cells that were alive in recent generations).
 */
export function renderNeon(
  target: HTMLCanvasElement,
  state: LifeState,
  layout: Layout,
  opts: RenderOptions,
  wrap: boolean,
): void {
  const { cols, rows, cells, age, sinceDeath } = state
  const cs = layout.cellSize
  const off = gridOffset(layout, cols, rows)
  const lut = buildLut(opts.colors)
  const neighbours = opts.colorMode === 'neighbours' ? neighbourCounts(cells, cols, rows, wrap) : null

  const colorIndex = (i: number, x: number, y: number, alive: boolean): number => {
    switch (opts.colorMode) {
      case 'age':
        return alive ? Math.min(1, (age[i] - 1) / Math.max(1, opts.ageSpan - 1)) * (LEVELS - 1) : 0
      case 'neighbours':
        return alive ? (Math.max(0, neighbours![i] - 1) / 7) * (LEVELS - 1) : LEVELS - 1
      case 'gradient':
        return ((x / Math.max(1, cols - 1) + y / Math.max(1, rows - 1)) / 2) * (LEVELS - 1)
      default:
        return 0
    }
  }

  // Bucket cells by colour (and alpha for trails) so each bucket is a single path fill.
  const ALPHA_LEVELS = 8
  const buckets = new Map<number, number[]>()
  const add = (key: number, i: number) => {
    let b = buckets.get(key)
    if (!b) buckets.set(key, (b = []))
    b.push(i)
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      if (cells[i]) {
        add(Math.round(colorIndex(i, x, y, true)) * (ALPHA_LEVELS + 1) + ALPHA_LEVELS, i)
      } else if (opts.trails && sinceDeath[i] !== NEVER_ALIVE && sinceDeath[i] <= opts.trailLength) {
        const fade = 1 - (sinceDeath[i] - 1) / opts.trailLength
        const a = Math.max(1, Math.round(fade * (ALPHA_LEVELS - 2)))
        add(Math.round(colorIndex(i, x, y, false)) * (ALPHA_LEVELS + 1) + a, i)
      }
    }
  }

  const layer = getLayer(target)
  const lctx = layer.getContext('2d')!
  lctx.clearRect(0, 0, layer.width, layer.height)

  const inset = (cs * opts.gap) / 2
  const size = Math.max(0.5, cs - inset * 2)
  const radius = opts.shape === 'rounded' ? size * 0.3 : 0

  const tracePath = (ctx: CanvasRenderingContext2D, idx: number[], scale: number) => {
    const s = size * scale
    const pad = (cs - s) / 2
    ctx.beginPath()
    for (const i of idx) {
      const x = off.x + (i % cols) * cs + pad
      const y = off.y + Math.floor(i / cols) * cs + pad
      if (opts.shape === 'circle') {
        ctx.moveTo(x + s, y + s / 2)
        ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2)
      } else if (opts.shape === 'rounded') ctx.roundRect(x, y, s, s, radius * scale)
      else ctx.rect(x, y, s, s)
    }
  }

  // Trails first (dimmer), then live cells on top.
  const keys = [...buckets.keys()].sort((a, b) => (a % (ALPHA_LEVELS + 1)) - (b % (ALPHA_LEVELS + 1)))
  for (const key of keys) {
    const ci = Math.floor(key / (ALPHA_LEVELS + 1))
    const a = key % (ALPHA_LEVELS + 1)
    const idx = buckets.get(key)!
    const alive = a === ALPHA_LEVELS
    lctx.globalAlpha = alive ? 1 : (a / ALPHA_LEVELS) * 0.55
    lctx.fillStyle = lut[ci]
    tracePath(lctx, idx, alive ? 1 : 0.7)
    lctx.fill()
    if (alive && opts.core) {
      lctx.globalAlpha = 0.75
      lctx.fillStyle = '#ffffff'
      tracePath(lctx, idx, 0.38)
      lctx.fill()
    }
  }
  lctx.globalAlpha = 1

  const ctx = target.getContext('2d')!
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.filter = 'none'
  ctx.fillStyle = opts.background
  ctx.fillRect(0, 0, target.width, target.height)

  if (opts.backgroundGrid && cs >= 3) {
    ctx.strokeStyle = lut[Math.floor(LEVELS / 2)]
    ctx.globalAlpha = 0.07
    ctx.lineWidth = Math.max(0.5, cs * 0.04)
    ctx.beginPath()
    for (let x = 0; x <= cols; x++) {
      ctx.moveTo(off.x + x * cs, 0)
      ctx.lineTo(off.x + x * cs, target.height)
    }
    for (let y = 0; y <= rows; y++) {
      ctx.moveTo(0, off.y + y * cs)
      ctx.lineTo(target.width, off.y + y * cs)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  ctx.globalCompositeOperation = 'lighter'
  if (opts.glow > 0) {
    const passes = [
      { blur: 3.2, alpha: 0.9 },
      { blur: 1.2, alpha: 0.9 },
      { blur: 0.4, alpha: 1 },
    ]
    for (const p of passes) {
      ctx.globalAlpha = Math.min(1, p.alpha * opts.glow)
      ctx.filter = `blur(${cs * p.blur * Math.max(0.5, opts.glow)}px)`
      ctx.drawImage(layer, 0, 0)
    }
    ctx.globalAlpha = 1
    ctx.filter = 'none'
  }
  ctx.drawImage(layer, 0, 0)
  ctx.restore()

  if (opts.blur > 0) applyBlur(target, cs * opts.blur, opts)
}

/** Blurs the composed image, optionally masked by a radial gradient (tilt-shift style). */
function applyBlur(target: HTMLCanvasElement, radius: number, opts: RenderOptions): void {
  const { width: w, height: h } = target
  const blurred = getLayer(target, 1)
  const bctx = blurred.getContext('2d')!
  bctx.save()
  bctx.globalCompositeOperation = 'source-over'
  bctx.globalAlpha = 1
  // Solid background underneath keeps the image edges from fading to transparent.
  bctx.filter = 'none'
  bctx.fillStyle = opts.background
  bctx.fillRect(0, 0, w, h)
  bctx.filter = `blur(${radius}px)`
  bctx.drawImage(target, 0, 0)
  bctx.filter = 'none'

  if (opts.blurMode !== 'uniform') {
    const cx = w / 2
    const cy = h / 2
    const half = Math.hypot(cx, cy)
    const inner = half * Math.min(0.95, opts.blurFocus)
    const outer = Math.max(inner + half * 0.05, Math.min(half, inner + half * 0.45))
    const g = bctx.createRadialGradient(cx, cy, inner, cx, cy, outer)
    const [a, b] = opts.blurMode === 'edges' ? ['rgba(0,0,0,0)', 'rgba(0,0,0,1)'] : ['rgba(0,0,0,1)', 'rgba(0,0,0,0)']
    g.addColorStop(0, a)
    g.addColorStop(1, b)
    bctx.globalCompositeOperation = 'destination-in'
    bctx.fillStyle = g
    bctx.fillRect(0, 0, w, h)
  }
  bctx.restore()

  const ctx = target.getContext('2d')!
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  ctx.drawImage(blurred, 0, 0)
  ctx.restore()
}
