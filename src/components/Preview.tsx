import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Grid, LifeState } from '../life/engine.ts'
import type { Pattern } from '../life/patterns.ts'
import { gridOffset, renderNeon, type RenderOptions } from '../life/render.ts'

export type Tool = 'draw' | 'erase' | 'stamp'

interface PreviewProps {
  width: number
  height: number
  cellSize: number
  state: LifeState
  /** Bump to force a redraw when `state` was mutated in place (animation). */
  frame: number
  options: RenderOptions
  wrap: boolean
  editable: boolean
  tool: Tool
  brush: number
  stampPattern: Pattern | null
  onEdit: (mutate: (g: Grid) => void) => void
  children?: ReactNode
}

interface Cell {
  x: number
  y: number
}

function paintBrush(g: Grid, c: Cell, size: number, value: number, wrap: boolean) {
  const start = -Math.floor((size - 1) / 2)
  for (let dy = start; dy < start + size; dy++)
    for (let dx = start; dx < start + size; dx++) {
      let x = c.x + dx
      let y = c.y + dy
      if (wrap) {
        x = ((x % g.cols) + g.cols) % g.cols
        y = ((y % g.rows) + g.rows) % g.rows
      } else if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) continue
      g.cells[y * g.cols + x] = value
    }
}

function lineCells(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = []
  let { x, y } = a
  const dx = Math.abs(b.x - x)
  const dy = -Math.abs(b.y - y)
  const sx = x < b.x ? 1 : -1
  const sy = y < b.y ? 1 : -1
  let err = dx + dy
  for (;;) {
    out.push({ x, y })
    if (x === b.x && y === b.y) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
  }
  return out
}

function stampAnchor(c: Cell, p: Pattern): Cell {
  return { x: c.x - Math.floor(p.cols / 2), y: c.y - Math.floor(p.rows / 2) }
}

export function Preview(props: PreviewProps) {
  const { width, height, cellSize, state, frame, options, wrap, editable, tool, brush, stampPattern, onEdit } = props
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<Cell | null>(null)
  const painting = useRef<{ value: number; last: Cell } | null>(null)

  useLayoutEffect(() => {
    const el = boxRef.current!
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect
      setBox({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scale = box.w && box.h ? Math.min(box.w / width, box.h / height) : 0
  const displayW = Math.max(1, Math.floor(width * scale))
  const displayH = Math.max(1, Math.floor(height * scale))
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const pxW = Math.max(1, Math.round(displayW * dpr))
  const pxH = Math.max(1, Math.round(displayH * dpr))
  const k = pxW / width
  const { cols, rows } = state

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !scale) return
    if (canvas.width !== pxW) canvas.width = pxW
    if (canvas.height !== pxH) canvas.height = pxH
    renderNeon(canvas, state, { width: pxW, height: pxH, cellSize: cellSize * k }, options, wrap)
  }, [state, frame, options, wrap, pxW, pxH, k, cellSize, scale])

  useEffect(() => {
    const canvas = overlayRef.current
    if (!canvas || !scale) return
    if (canvas.width !== pxW) canvas.width = pxW
    if (canvas.height !== pxH) canvas.height = pxH
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, pxW, pxH)
    if (!editable) return
    const cs = cellSize * k
    const off = gridOffset({ width: pxW, height: pxH, cellSize: cs }, cols, rows)
    if (cs >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x <= cols; x++) {
        const px = Math.round(off.x + x * cs) + 0.5
        ctx.moveTo(px, 0)
        ctx.lineTo(px, pxH)
      }
      for (let y = 0; y <= rows; y++) {
        const py = Math.round(off.y + y * cs) + 0.5
        ctx.moveTo(0, py)
        ctx.lineTo(pxW, py)
      }
      ctx.stroke()
    }
    if (!hover) return
    if (tool === 'stamp' && stampPattern) {
      const a = stampAnchor(hover, stampPattern)
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      for (let y = 0; y < stampPattern.rows; y++)
        for (let x = 0; x < stampPattern.cols; x++)
          if (stampPattern.cells[y * stampPattern.cols + x])
            ctx.fillRect(off.x + (a.x + x) * cs, off.y + (a.y + y) * cs, Math.max(1, cs), Math.max(1, cs))
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.setLineDash([4, 4])
      ctx.strokeRect(off.x + a.x * cs, off.y + a.y * cs, stampPattern.cols * cs, stampPattern.rows * cs)
    } else {
      const start = -Math.floor((brush - 1) / 2)
      ctx.strokeStyle = tool === 'erase' ? 'rgba(255,80,80,0.9)' : 'rgba(255,255,255,0.9)'
      ctx.lineWidth = Math.max(1, dpr)
      ctx.strokeRect(off.x + (hover.x + start) * cs, off.y + (hover.y + start) * cs, brush * cs, brush * cs)
    }
  }, [editable, hover, tool, brush, stampPattern, cols, rows, pxW, pxH, k, cellSize, scale, dpr])

  const toCell = (e: React.PointerEvent): Cell => {
    const rect = overlayRef.current!.getBoundingClientRect()
    const ex = ((e.clientX - rect.left) / rect.width) * width
    const ey = ((e.clientY - rect.top) / rect.height) * height
    const off = gridOffset({ width, height, cellSize }, cols, rows)
    return { x: Math.floor((ex - off.x) / cellSize), y: Math.floor((ey - off.y) / cellSize) }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable) return
    e.preventDefault()
    const c = toCell(e)
    if (tool === 'stamp') {
      if (!stampPattern) return
      const a = stampAnchor(c, stampPattern)
      onEdit((g) => {
        for (let y = 0; y < stampPattern.rows; y++)
          for (let x = 0; x < stampPattern.cols; x++) {
            if (!stampPattern.cells[y * stampPattern.cols + x]) continue
            paintBrush(g, { x: a.x + x, y: a.y + y }, 1, 1, wrap)
          }
      })
      return
    }
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const value = tool === 'erase' || e.button === 2 ? 0 : 1
    painting.current = { value, last: c }
    onEdit((g) => paintBrush(g, c, brush, value, wrap))
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!editable) return
    const c = toCell(e)
    setHover((h) => (h && h.x === c.x && h.y === c.y ? h : c))
    const p = painting.current
    if (!p || (p.last.x === c.x && p.last.y === c.y)) return
    const pts = lineCells(p.last, c)
    p.last = c
    onEdit((g) => pts.forEach((pt) => paintBrush(g, pt, brush, p.value, wrap)))
  }

  const endPaint = () => {
    painting.current = null
  }

  return (
    <div className="preview-box" ref={boxRef}>
      <div className="preview-frame" style={{ width: displayW, height: displayH }}>
        <canvas ref={canvasRef} className="preview-canvas" style={{ width: displayW, height: displayH }} />
        <canvas
          ref={overlayRef}
          className={`preview-overlay ${editable ? `editable tool-${tool}` : ''}`}
          style={{ width: displayW, height: displayH }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPaint}
          onPointerCancel={endPaint}
          onPointerLeave={() => setHover(null)}
          onContextMenu={(e) => editable && e.preventDefault()}
        />
        {props.children}
      </div>
    </div>
  )
}
