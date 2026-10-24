import { useEffect, useRef, useState } from 'react'
import type { Grid } from '../life/engine.ts'
import type { SimRequest, SimResponse } from '../life/sim.worker.ts'

export type SimResult = Extract<SimResponse, { type: 'result' }>

/** Runs the simulation in a Web Worker; only the latest request is computed. */
export function useSimulation(grid: Grid, version: number, wrap: boolean, steps: number) {
  const workerRef = useRef<Worker | null>(null)
  const latest = useRef({ key: '', steps: 0 })
  const [result, setResult] = useState<SimResult | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const key = `${version}|${wrap ? 1 : 0}|${grid.cols}x${grid.rows}`

  useEffect(() => {
    const worker = new Worker(new URL('../life/sim.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<SimResponse>) => {
      const msg = e.data
      if (msg.key !== latest.current.key || msg.steps !== latest.current.steps) return
      if (msg.type === 'progress') setProgress(msg.generation / Math.max(1, msg.steps))
      else {
        setProgress(null)
        setResult(msg)
      }
    }
    workerRef.current = worker
    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    latest.current = { key, steps }
    const req: SimRequest = { key, grid, wrap, steps }
    workerRef.current?.postMessage(req)
  }, [key, steps, grid, wrap])

  const ready = result !== null && result.key === key && result.steps === steps
  return { result, ready, progress: ready ? null : (progress ?? 0) }
}
