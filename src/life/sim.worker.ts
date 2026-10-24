import { countAlive, Trajectory, type CycleInfo, type Grid, type LifeState } from './engine.ts'

export interface SimRequest {
  key: string
  grid: Grid
  wrap: boolean
  steps: number
}

export type SimResponse =
  | { type: 'progress'; key: string; steps: number; generation: number }
  | {
      type: 'result'
      key: string
      steps: number
      state: LifeState
      population: number
      cycle: CycleInfo | null
      extinctAt: number | null
    }

interface WorkerScope {
  onmessage: ((e: MessageEvent<SimRequest>) => void) | null
  postMessage(message: SimResponse, transfer?: Transferable[]): void
}

const ctx = self as unknown as WorkerScope

let trajectory: Trajectory | null = null
let trajectoryKey = ''
let job: SimRequest | null = null
let running = false

ctx.onmessage = (e: MessageEvent<SimRequest>) => {
  job = e.data
  if (!running) {
    running = true
    setTimeout(tick, 0)
  }
}

function tick() {
  const j = job!
  if (!trajectory || j.key !== trajectoryKey) {
    trajectory = new Trajectory(j.grid, j.wrap)
    trajectoryKey = j.key
  }
  const t0 = performance.now()
  let done = false
  while (!done && performance.now() - t0 < 40) done = trajectory.seek(j.steps, 16)

  if (!done) {
    ctx.postMessage({ type: 'progress', key: j.key, steps: j.steps, generation: trajectory.state.generation } satisfies SimResponse)
    setTimeout(tick, 0)
    return
  }

  const s = trajectory.state
  const state: LifeState = { ...s, cells: s.cells.slice(), age: s.age.slice(), sinceDeath: s.sinceDeath.slice() }
  const cycle = trajectory.cycleAt(j.steps)
  const msg: SimResponse = {
    type: 'result',
    key: j.key,
    steps: j.steps,
    state,
    population: countAlive(state.cells),
    cycle,
    extinctAt: cycle ? trajectory.extinctAt : null,
  }
  ctx.postMessage(msg, [state.cells.buffer, state.age.buffer, state.sinceDeath.buffer])
  if (job === j) running = false
  else setTimeout(tick, 0)
}
