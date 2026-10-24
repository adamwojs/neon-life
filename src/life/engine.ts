/** Conway's Game of Life (B3/S23) on a finite grid. */

export interface Grid {
  cols: number
  rows: number
  cells: Uint8Array
}

/** Sentinel for cells that have never been alive. */
export const NEVER_ALIVE = 0xffff

export interface LifeState {
  cols: number
  rows: number
  generation: number
  /** 1 = alive, 0 = dead. This is the exact Game of Life state. */
  cells: Uint8Array
  /** Consecutive generations a living cell has survived (1 = just born). */
  age: Uint32Array
  /** Generations since a dead cell last died (NEVER_ALIVE if it never lived). */
  sinceDeath: Uint16Array
}

export interface CycleInfo {
  /** First generation of the repeating sequence. */
  start: number
  /** 1 = still life, >1 = oscillator period. */
  period: number
}

export function createGrid(cols: number, rows: number): Grid {
  return { cols, rows, cells: new Uint8Array(cols * rows) }
}

export function countAlive(cells: Uint8Array): number {
  let n = 0
  for (let i = 0; i < cells.length; i++) n += cells[i]
  return n
}

/** Computes one generation from `src` into `dst`. */
export function stepCells(
  src: Uint8Array,
  dst: Uint8Array,
  cols: number,
  rows: number,
  wrap: boolean,
): void {
  // Per-row vertical sums: colSum[x + 1] = up + mid + down, with padding at both ends.
  const colSum = new Uint8Array(cols + 2)
  for (let y = 0; y < rows; y++) {
    const yu = y > 0 ? y - 1 : wrap ? rows - 1 : -1
    const yd = y < rows - 1 ? y + 1 : wrap ? 0 : -1
    const ru = yu * cols
    const r = y * cols
    const rd = yd * cols
    for (let x = 0; x < cols; x++) {
      colSum[x + 1] = src[r + x] + (yu >= 0 ? src[ru + x] : 0) + (yd >= 0 ? src[rd + x] : 0)
    }
    if (wrap) {
      colSum[0] = colSum[cols]
      colSum[cols + 1] = colSum[1]
    } else {
      colSum[0] = 0
      colSum[cols + 1] = 0
    }
    for (let x = 0; x < cols; x++) {
      const self = src[r + x]
      const n = colSum[x] + colSum[x + 1] + colSum[x + 2] - self
      dst[r + x] = n === 3 || (n === 2 && self === 1) ? 1 : 0
    }
  }
}

/** Live-neighbour count for every cell (used for colouring). */
export function neighbourCounts(cells: Uint8Array, cols: number, rows: number, wrap: boolean): Uint8Array {
  const out = new Uint8Array(cells.length)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          let nx = x + dx
          let ny = y + dy
          if (wrap) {
            nx = (nx + cols) % cols
            ny = (ny + rows) % rows
          } else if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
          n += cells[ny * cols + nx]
        }
      }
      out[y * cols + x] = n
    }
  }
  return out
}

function hashCells(cells: Uint8Array): number {
  let h = 0x811c9dc5
  const words = cells.length >> 2
  const view = new Uint32Array(cells.buffer, cells.byteOffset, words)
  for (let i = 0; i < words; i++) h = Math.imul(h ^ view[i], 0x01000193)
  for (let i = words << 2; i < cells.length; i++) h = Math.imul(h ^ cells[i], 0x01000193)
  return h >>> 0
}

/** Incremental simulator that tracks extra history (age / trails) without altering the rules. */
export class LifeSim {
  readonly state: LifeState
  readonly wrap: boolean
  private next: Uint8Array

  constructor(initial: Grid, wrap: boolean) {
    const { cols, rows } = initial
    const cells = initial.cells.slice()
    const age = new Uint32Array(cells.length)
    const sinceDeath = new Uint16Array(cells.length).fill(NEVER_ALIVE)
    for (let i = 0; i < cells.length; i++) {
      if (cells[i]) {
        age[i] = 1
        sinceDeath[i] = 0
      }
    }
    this.state = { cols, rows, generation: 0, cells, age, sinceDeath }
    this.wrap = wrap
    this.next = new Uint8Array(cells.length)
  }

  step(): void {
    const s = this.state
    stepCells(s.cells, this.next, s.cols, s.rows, this.wrap)
    const { age, sinceDeath } = s
    const nxt = this.next
    for (let i = 0; i < nxt.length; i++) {
      if (nxt[i]) {
        age[i] = s.cells[i] ? age[i] + 1 : 1
        sinceDeath[i] = 0
      } else {
        age[i] = 0
        if (s.cells[i]) sinceDeath[i] = 1
        else if (sinceDeath[i] < NEVER_ALIVE - 1) sinceDeath[i]++
      }
    }
    this.next = s.cells
    s.cells = nxt
    s.generation++
  }

  run(steps: number): void {
    for (let i = 0; i < steps; i++) this.step()
  }

  snapshot(): LifeState {
    const s = this.state
    return { ...s, cells: s.cells.slice(), age: s.age.slice(), sinceDeath: s.sinceDeath.slice() }
  }

  restore(snap: LifeState): void {
    const s = this.state
    s.generation = snap.generation
    s.cells.set(snap.cells)
    s.age.set(snap.age)
    s.sinceDeath.set(snap.sinceDeath)
  }
}

/**
 * A simulation that can seek to any generation. Stores periodic checkpoints so moving
 * backwards is cheap, and detects when the pattern starts repeating.
 */
export class Trajectory {
  readonly sim: LifeSim
  cycle: CycleInfo | null = null
  extinctAt: number | null = null
  private hashes = new Map<number, number>()
  private checkpoints = new Map<number, LifeState>()
  private maxGen = 0
  private readonly interval: number

  constructor(initial: Grid, wrap: boolean, maxCheckpointBytes = 96 * 1024 * 1024) {
    this.sim = new LifeSim(initial, wrap)
    const bytesPerSnapshot = initial.cells.length * 7
    // Aim for at most ~maxCheckpointBytes when going up to 10k generations.
    this.interval = Math.max(25, Math.ceil((10000 * bytesPerSnapshot) / maxCheckpointBytes / 25) * 25)
    this.checkpoints.set(0, this.sim.snapshot())
    this.hashes.set(hashCells(this.sim.state.cells), 0)
  }

  get state(): LifeState {
    return this.sim.state
  }

  /** Moves towards `target`, performing at most `budget` steps. Returns true once reached. */
  seek(target: number, budget = Infinity): boolean {
    const sim = this.sim
    if (target < sim.state.generation) {
      const base = Math.floor(target / this.interval) * this.interval
      sim.restore(this.checkpoints.get(base) ?? this.checkpoints.get(0)!)
    } else if (target - sim.state.generation > this.interval) {
      const base = Math.floor(target / this.interval) * this.interval
      const cp = this.checkpoints.get(base)
      if (cp && cp.generation > sim.state.generation) sim.restore(cp)
    }
    let done = 0
    while (sim.state.generation < target && done < budget) {
      sim.step()
      done++
      const g = sim.state.generation
      if (g > this.maxGen) {
        this.maxGen = g
        if (g % this.interval === 0) this.checkpoints.set(g, sim.snapshot())
        if (!this.cycle) {
          const h = hashCells(sim.state.cells)
          const prev = this.hashes.get(h)
          if (prev !== undefined) {
            this.cycle = { start: prev, period: g - prev }
            if (countAlive(sim.state.cells) === 0) this.extinctAt = prev
            this.hashes.clear()
          } else this.hashes.set(h, g)
        }
      }
    }
    return sim.state.generation === target
  }

  /** Cycle info, but only if it was already observable by generation `gen`. */
  cycleAt(gen: number): CycleInfo | null {
    return this.cycle && this.cycle.start + this.cycle.period <= gen ? this.cycle : null
  }
}

/** Copies `src` into a new grid of the given size, keeping it centred. */
export function resizeCentered(src: Grid, cols: number, rows: number): Grid {
  const out = createGrid(cols, rows)
  const ox = Math.floor((cols - src.cols) / 2)
  const oy = Math.floor((rows - src.rows) / 2)
  for (let y = 0; y < src.rows; y++) {
    const ty = y + oy
    if (ty < 0 || ty >= rows) continue
    for (let x = 0; x < src.cols; x++) {
      const tx = x + ox
      if (tx < 0 || tx >= cols) continue
      out.cells[ty * cols + tx] = src.cells[y * src.cols + x]
    }
  }
  return out
}
