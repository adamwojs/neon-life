import { LifeSim, type Grid } from './engine.ts'
import type { GifWorkerRequest, GifWorkerResponse } from './gif.worker.ts'
import { renderNeon, type RenderOptions } from './render.ts'

export interface GifExportOptions {
  initial: Grid
  wrap: boolean
  /** First and last generation (inclusive). */
  from: number
  to: number
  /** Generations advanced between frames. */
  every: number
  fps: number
  /** Extra time (ms) the last frame stays on screen. */
  holdLast: number
  loop: boolean
  /** Output size and cell size in pixels (already scaled). */
  width: number
  height: number
  cellSize: number
  style: RenderOptions
}

/** Generations that become frames: from, from+every, …, always ending exactly at `to`. */
export function gifFrameGenerations(from: number, to: number, every: number): number[] {
  const gens: number[] = []
  for (let g = from; g < to; g += Math.max(1, every)) gens.push(g)
  gens.push(to)
  return gens
}

const MAX_IN_FLIGHT = 3

/** Renders the evolution as an animated GIF. Rejects with an AbortError when `signal` aborts. */
export async function exportGif(
  o: GifExportOptions,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const gens = gifFrameGenerations(o.from, o.to, o.every)
  const frameDelay = Math.max(20, Math.round(1000 / o.fps))
  const worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' })

  try {
    return await new Promise<Blob>((resolve, reject) => {
      let inFlight = 0
      let encoded = 0
      let wake: (() => void) | null = null

      const fail = (err: Error) => {
        reject(err)
        wake?.()
      }
      signal.addEventListener('abort', () => fail(new DOMException('GIF export cancelled', 'AbortError')), { once: true })

      worker.onerror = (e) => fail(new Error(e.message || 'GIF worker failed'))
      worker.onmessage = (e: MessageEvent<GifWorkerResponse>) => {
        const msg = e.data
        if (msg.type === 'ack') {
          inFlight--
          encoded++
          onProgress(encoded, gens.length)
          wake?.()
        } else if (msg.type === 'done') resolve(new Blob([msg.bytes], { type: 'image/gif' }))
        else fail(new Error(msg.message))
      }

      const post = (msg: GifWorkerRequest, transfer: Transferable[] = []) => worker.postMessage(msg, transfer)

      const run = async () => {
        const canvas = document.createElement('canvas')
        canvas.width = o.width
        canvas.height = o.height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        const sim = new LifeSim(o.initial, o.wrap)
        post({ type: 'start', width: o.width, height: o.height, repeat: o.loop ? 0 : -1 })
        onProgress(0, gens.length)

        for (let i = 0; i < gens.length; i++) {
          while (inFlight >= MAX_IN_FLIGHT && !signal.aborted) await new Promise<void>((r) => (wake = r))
          if (signal.aborted) return
          sim.run(gens[i] - sim.state.generation)
          renderNeon(canvas, sim.state, { width: o.width, height: o.height, cellSize: o.cellSize }, o.style, o.wrap)
          const { data } = ctx.getImageData(0, 0, o.width, o.height)
          const delay = i === gens.length - 1 ? frameDelay + o.holdLast : frameDelay
          inFlight++
          post({ type: 'frame', rgba: data.buffer, delay }, [data.buffer])
        }
        post({ type: 'finish' })
      }
      run().catch(fail)
    })
  } finally {
    worker.terminate()
  }
}
