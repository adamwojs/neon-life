import { applyPalette, GIFEncoder, quantize, type Encoder } from 'gifenc'

export type GifWorkerRequest =
  | { type: 'start'; width: number; height: number; repeat: number }
  | { type: 'frame'; rgba: ArrayBuffer; delay: number }
  | { type: 'finish' }

export type GifWorkerResponse =
  | { type: 'ack' }
  | { type: 'done'; bytes: ArrayBuffer }
  | { type: 'error'; message: string }

interface WorkerScope {
  onmessage: ((e: MessageEvent<GifWorkerRequest>) => void) | null
  postMessage(message: GifWorkerResponse, transfer?: Transferable[]): void
}

const ctx = self as unknown as WorkerScope

let encoder: Encoder | null = null
let width = 0
let height = 0
let repeat = 0
let first = true

ctx.onmessage = (e) => {
  const msg = e.data
  try {
    if (msg.type === 'start') {
      encoder = GIFEncoder({ initialCapacity: 1 << 20 })
      width = msg.width
      height = msg.height
      repeat = msg.repeat
      first = true
    } else if (msg.type === 'frame') {
      const rgba = new Uint8Array(msg.rgba)
      // Per-frame palette keeps the neon colours accurate as the pattern changes.
      const palette = quantize(rgba, 256)
      const index = applyPalette(rgba, palette)
      encoder!.writeFrame(index, width, height, { palette, delay: msg.delay, ...(first ? { repeat } : {}) })
      first = false
      ctx.postMessage({ type: 'ack' })
    } else {
      encoder!.finish()
      const bytes = encoder!.bytes()
      encoder = null
      ctx.postMessage({ type: 'done', bytes: bytes.buffer as ArrayBuffer }, [bytes.buffer as ArrayBuffer])
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', message: (err as Error).message })
  }
}
