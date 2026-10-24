import { useCallback, useEffect, useMemo, useState } from 'react'
import { Preview, type Tool } from './components/Preview.tsx'
import { Field, NumberInput, Range, Section, Segmented } from './components/ui.tsx'
import { useSimulation, type SimResult } from './hooks/useSimulation.ts'
import { countAlive, LifeSim, resizeCentered, type Grid, type LifeState } from './life/engine.ts'
import {
  centeredGrid,
  parsePattern,
  PRESETS,
  randomGrid,
  scatterGrid,
  toRle,
  transformPattern,
  type Pattern,
  type Symmetry,
} from './life/patterns.ts'
import { gridSizeFor, PALETTES, renderNeon, type BlurMode, type CellShape, type ColorMode, type RenderOptions } from './life/render.ts'

const RESOLUTIONS = [
  { id: 'fhd', name: 'Full HD', w: 1920, h: 1080 },
  { id: 'qhd', name: 'QHD', w: 2560, h: 1440 },
  { id: '4k', name: '4K UHD', w: 3840, h: 2160 },
  { id: 'uw', name: 'Ultrawide', w: 3440, h: 1440 },
  { id: 'mbp', name: 'MacBook Pro 16"', w: 3456, h: 2234 },
  { id: 'phone', name: 'iPhone', w: 1179, h: 2556 },
  { id: 'android', name: 'Android', w: 1440, h: 3200 },
  { id: 'square', name: 'Square', w: 2048, h: 2048 },
]

const MAX_STEPS = 10000
const SLIDER_STEPS = 2000
const MAX_SIZE = 8192

type GeneratorType = 'random' | 'pattern' | 'scatter'
type View = 'initial' | 'result'
type ExportFormat = 'png' | 'jpeg' | 'webp'

interface GenSettings {
  type: GeneratorType
  seed: number
  density: number
  area: number
  symmetry: Symmetry
  patternId: string
  scatterCount: number
  randomOrientation: boolean
}

const randomSeed = () => Math.floor(Math.random() * 1_000_000)

function buildGrid(cols: number, rows: number, g: GenSettings, pattern: Pattern): Grid {
  if (g.type === 'pattern') return centeredGrid(cols, rows, pattern)
  if (g.type === 'scatter')
    return scatterGrid(cols, rows, pattern, { seed: g.seed, count: g.scatterCount, randomOrientation: g.randomOrientation })
  return randomGrid(cols, rows, { seed: g.seed, density: g.density, area: g.area, symmetry: g.symmetry })
}

const INITIAL_GEN: GenSettings = {
  type: 'random',
  seed: randomSeed(),
  density: 0.25,
  area: 1,
  symmetry: 'mirror-xy',
  patternId: 'r-pentomino',
  scatterCount: 40,
  randomOrientation: true,
}

const INITIAL_STYLE: RenderOptions = {
  colors: PALETTES[0].colors,
  background: PALETTES[0].background,
  colorMode: 'age',
  shape: 'rounded',
  gap: 0.18,
  glow: 1,
  core: true,
  trails: false,
  trailLength: 6,
  ageSpan: 40,
  backgroundGrid: false,
  blur: 0,
  blurMode: 'uniform',
  blurFocus: 0.35,
}

function describe(result: SimResult): string {
  const c = result.cycle
  if (!c) return 'still evolving'
  if (result.extinctAt !== null) return `extinct since gen ${result.extinctAt}`
  if (c.period === 1) return `stable since gen ${c.start}`
  return `oscillating (period ${c.period}) since gen ${c.start}`
}

function presetPattern(id: string): Pattern {
  return parsePattern((PRESETS.find((p) => p.id === id) ?? PRESETS[0]).rle)
}

export default function App() {
  const [size, setSize] = useState({ w: 1920, h: 1080, preset: 'fhd' })
  const [cellSize, setCellSize] = useState(12)
  const { cols, rows } = gridSizeFor(size.w, size.h, cellSize)

  const [gen, setGen] = useState<GenSettings>(INITIAL_GEN)
  const [imported, setImported] = useState<Pattern | null>(null)
  const patternById = useCallback(
    (id: string): Pattern => (id === 'imported' && imported ? imported : presetPattern(id)),
    [imported],
  )

  const [initial, setInitial] = useState(() => ({
    grid: buildGrid(cols, rows, INITIAL_GEN, presetPattern(INITIAL_GEN.patternId)),
    version: 0,
  }))
  const [wrap, setWrap] = useState(true)
  const [steps, setSteps] = useState(200)
  const [view, setView] = useState<View>('result')

  const [tool, setTool] = useState<Tool>('draw')
  const [brush, setBrush] = useState(1)
  const [stamp, setStamp] = useState({ id: 'glider', turns: 0, flip: false })
  const stampPattern = useMemo(
    () => transformPattern(patternById(stamp.id), stamp.turns, stamp.flip),
    [patternById, stamp],
  )

  const [style, setStyle] = useState<RenderOptions>(INITIAL_STYLE)
  const [paletteId, setPaletteId] = useState(PALETTES[0].id)
  const [format, setFormat] = useState<ExportFormat>('png')
  const [quality, setQuality] = useState(0.92)
  const [exporting, setExporting] = useState(false)

  const [rleText, setRleText] = useState('')
  const [rleError, setRleError] = useState<string | null>(null)

  const sim = useSimulation(initial.grid, initial.version, wrap, steps)

  // Animated playback from generation 0 up to `steps` (the LifeSim is mutated in place).
  const [anim, setAnim] = useState<LifeSim | null>(null)
  const [animFrame, setAnimFrame] = useState(0)
  const [speed, setSpeed] = useState(30)

  useEffect(() => {
    if (!anim) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    const loop = (now: number) => {
      acc += ((now - last) / 1000) * speed
      last = now
      let n = Math.floor(acc)
      acc -= n
      while (n-- > 0 && anim.state.generation < steps) anim.step()
      setAnimFrame(anim.state.generation)
      if (anim.state.generation >= steps) {
        setAnim(null)
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [anim, speed, steps])

  const stopAnimation = useCallback(() => setAnim(null), [])

  const startAnimation = () => {
    setAnimFrame(0)
    setAnim(new LifeSim(initial.grid, wrap))
    setView('result')
  }

  const replaceInitial = useCallback(
    (grid: Grid) => {
      stopAnimation()
      setInitial((prev) => ({ grid, version: prev.version + 1 }))
    },
    [stopAnimation],
  )

  const editInitial = useCallback(
    (mutate: (g: Grid) => void) => {
      stopAnimation()
      setInitial((prev) => {
        const grid = { ...prev.grid, cells: prev.grid.cells.slice() }
        mutate(grid)
        return { grid, version: prev.version + 1 }
      })
    },
    [stopAnimation],
  )

  const regenerate = (over: Partial<GenSettings> = {}) => {
    const g = { ...gen, ...over }
    setGen(g)
    replaceInitial(buildGrid(cols, rows, g, patternById(g.patternId)))
  }

  const applyCanvas = (w: number, h: number, cs: number, preset: string) => {
    setSize({ w, h, preset })
    setCellSize(cs)
    const next = gridSizeFor(w, h, cs)
    if (next.cols !== initial.grid.cols || next.rows !== initial.grid.rows)
      replaceInitial(resizeCentered(initial.grid, next.cols, next.rows))
  }

  const changeSteps = (v: number) => {
    stopAnimation()
    setSteps(Math.min(MAX_STEPS, Math.max(0, v)))
  }

  const initialState: LifeState = useMemo(() => new LifeSim(initial.grid, wrap).state, [initial, wrap])
  const initialPop = useMemo(() => countAlive(initial.grid.cells), [initial])

  let shownState: LifeState = initialState
  let frame = 0
  if (view === 'result') {
    if (anim) {
      shownState = anim.state
      frame = animFrame
    } else if (sim.result) shownState = sim.result.state
  }

  const exportWallpaper = async () => {
    if (!sim.ready || !sim.result) return
    setExporting(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = size.w
      canvas.height = size.h
      renderNeon(canvas, sim.result.state, { width: size.w, height: size.h, cellSize }, style, wrap)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, `image/${format}`, quality))
      if (!blob) throw new Error('Could not encode image')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `neon-life-${size.w}x${size.h}-gen${steps}.${format === 'jpeg' ? 'jpg' : format}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (err) {
      alert(`Export failed: ${(err as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  const loadRle = (mode: 'replace' | 'stamp') => {
    try {
      const p = parsePattern(rleText)
      setRleError(null)
      setImported(p)
      setView('initial')
      if (mode === 'replace') replaceInitial(centeredGrid(cols, rows, p))
      else {
        setStamp({ id: 'imported', turns: 0, flip: false })
        setTool('stamp')
      }
    } catch (err) {
      setRleError((err as Error).message)
    }
  }

  const adoptResult = () => {
    if (!sim.result) return
    const s = sim.result.state
    replaceInitial({ cols: s.cols, rows: s.rows, cells: s.cells.slice() })
    setView('initial')
  }

  const setStyleKey = <K extends keyof RenderOptions>(key: K, value: RenderOptions[K]) =>
    setStyle((s) => ({ ...s, [key]: value }))

  const patternOptions = [
    ...PRESETS.map((p) => ({ id: p.id, name: p.name })),
    ...(imported ? [{ id: 'imported', name: `Imported (${imported.cols}×${imported.rows})` }] : []),
  ]

  const progressPct = Math.round((sim.progress ?? 0) * 100)

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="brand">
          <h1>
            <span className="neon-text">Neon</span> Life
          </h1>
          <p>Wallpapers grown by Conway's Game of Life</p>
        </header>

        <Section title="Canvas">
          <Field label="Resolution">
            <select
              value={size.preset}
              onChange={(e) => {
                const id = e.target.value
                if (id === 'screen') {
                  const dpr = window.devicePixelRatio || 1
                  applyCanvas(Math.round(screen.width * dpr), Math.round(screen.height * dpr), cellSize, 'screen')
                } else if (id === 'custom') setSize((s) => ({ ...s, preset: 'custom' }))
                else {
                  const r = RESOLUTIONS.find((r) => r.id === id)!
                  applyCanvas(r.w, r.h, cellSize, id)
                }
              }}
            >
              {RESOLUTIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {r.w}×{r.h}
                </option>
              ))}
              <option value="screen">This screen</option>
              <option value="custom">Custom…</option>
            </select>
          </Field>
          <div className="row">
            <Field label="Width">
              <NumberInput value={size.w} min={64} max={MAX_SIZE} onChange={(w) => applyCanvas(w, size.h, cellSize, 'custom')} />
            </Field>
            <span className="times">×</span>
            <Field label="Height">
              <NumberInput value={size.h} min={64} max={MAX_SIZE} onChange={(h) => applyCanvas(size.w, h, cellSize, 'custom')} />
            </Field>
            <button type="button" className="icon-btn" title="Swap orientation" onClick={() => applyCanvas(size.h, size.w, cellSize, 'custom')}>
              ⇄
            </button>
          </div>
          <Range
            label="Cell size"
            value={cellSize}
            min={3}
            max={64}
            format={(v) => `${v}px`}
            onChange={(v) => applyCanvas(size.w, size.h, v, size.preset)}
          />
          <p className="note">
            Grid: {cols} × {rows} = {(cols * rows).toLocaleString()} cells
          </p>
        </Section>

        <Section title="Initial state (generation 0)">
          <Field label="Generator">
            <Segmented<GeneratorType>
              value={gen.type}
              onChange={(type) => regenerate({ type })}
              options={[
                { value: 'random', label: 'Random soup' },
                { value: 'pattern', label: 'Pattern' },
                { value: 'scatter', label: 'Scatter' },
              ]}
            />
          </Field>

          {gen.type === 'random' && (
            <>
              <Range
                label="Density"
                value={gen.density}
                min={0.02}
                max={0.8}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(density) => regenerate({ density })}
              />
              <Range
                label="Filled area"
                value={gen.area}
                min={0.05}
                max={1}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(area) => regenerate({ area })}
              />
              <Field label="Symmetry">
                <select value={gen.symmetry} onChange={(e) => regenerate({ symmetry: e.target.value as Symmetry })}>
                  <option value="none">None</option>
                  <option value="mirror-x">Mirror horizontally</option>
                  <option value="mirror-y">Mirror vertically</option>
                  <option value="mirror-xy">Mirror both (kaleidoscope)</option>
                  <option value="rotate-180">Rotational (180°)</option>
                </select>
              </Field>
            </>
          )}

          {gen.type !== 'random' && (
            <Field label="Pattern">
              <select value={gen.patternId} onChange={(e) => regenerate({ patternId: e.target.value })}>
                {patternOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {gen.type === 'scatter' && (
            <>
              <Range label="Copies" value={gen.scatterCount} min={1} max={400} onChange={(scatterCount) => regenerate({ scatterCount })} />
              <label className="check">
                <input type="checkbox" checked={gen.randomOrientation} onChange={(e) => regenerate({ randomOrientation: e.target.checked })} />
                Random rotation / mirroring
              </label>
            </>
          )}

          {gen.type !== 'pattern' && (
            <Field label="Seed">
              <div className="row">
                <NumberInput value={gen.seed} min={0} max={2 ** 31 - 1} onChange={(seed) => regenerate({ seed })} />
                <button type="button" className="icon-btn" title="New random seed" onClick={() => regenerate({ seed: randomSeed() })}>
                  🎲
                </button>
              </div>
            </Field>
          )}

          <div className="row buttons">
            <button type="button" onClick={() => regenerate()}>
              Regenerate
            </button>
            <button type="button" onClick={() => replaceInitial({ cols, rows, cells: new Uint8Array(cols * rows) })}>
              Clear
            </button>
          </div>

          <h3>Paint cells</h3>
          <p className="note">Paint directly on the “Generation 0” canvas. Right-click erases.</p>
          <Segmented<Tool>
            value={tool}
            onChange={(t) => {
              setTool(t)
              setView('initial')
            }}
            options={[
              { value: 'draw', label: '✎ Draw' },
              { value: 'erase', label: '⌫ Erase' },
              { value: 'stamp', label: '⎘ Stamp' },
            ]}
          />
          {tool !== 'stamp' ? (
            <Range label="Brush" value={brush} min={1} max={9} format={(v) => `${v}×${v}`} onChange={setBrush} />
          ) : (
            <>
              <Field label="Stamp pattern">
                <select value={stamp.id} onChange={(e) => setStamp({ id: e.target.value, turns: 0, flip: false })}>
                  {patternOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="row buttons">
                <button type="button" onClick={() => setStamp((s) => ({ ...s, turns: (s.turns + 1) % 4 }))}>
                  ↻ Rotate
                </button>
                <button type="button" onClick={() => setStamp((s) => ({ ...s, flip: !s.flip }))}>
                  ⇋ Flip
                </button>
              </div>
            </>
          )}

          <h3>RLE / plaintext pattern</h3>
          <textarea
            value={rleText}
            spellCheck={false}
            placeholder={'Paste a pattern, e.g.\nx = 3, y = 3\nbo$2bo$3o!'}
            onChange={(e) => setRleText(e.target.value)}
            rows={4}
          />
          {rleError && <p className="error">{rleError}</p>}
          <div className="row buttons wrap">
            <button type="button" disabled={!rleText.trim()} onClick={() => loadRle('replace')}>
              Load centred
            </button>
            <button type="button" disabled={!rleText.trim()} onClick={() => loadRle('stamp')}>
              Use as stamp
            </button>
            <button type="button" onClick={() => setRleText(toRle(initial.grid))}>
              Get gen 0
            </button>
            <button type="button" disabled={!sim.ready} onClick={() => sim.result && setRleText(toRle(sim.result.state))}>
              Get gen {steps}
            </button>
          </div>
        </Section>

        <Section title="Simulation">
          <Field label="Evolution steps" hint={`${steps} generations`}>
            <input type="range" min={0} max={Math.max(SLIDER_STEPS, steps)} value={steps} onChange={(e) => changeSteps(Number(e.target.value))} />
          </Field>
          <div className="row">
            <button type="button" className="icon-btn" onClick={() => changeSteps(steps - 1)} title="Previous generation">
              −1
            </button>
            <NumberInput aria-label="Evolution steps" value={steps} min={0} max={MAX_STEPS} onChange={changeSteps} />
            <button type="button" className="icon-btn" onClick={() => changeSteps(steps + 1)} title="Next generation">
              +1
            </button>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={wrap}
              onChange={(e) => {
                stopAnimation()
                setWrap(e.target.checked)
              }}
            />
            Wrap edges (toroidal world)
          </label>
          <Range label="Playback speed" value={speed} min={1} max={240} format={(v) => `${v} gen/s`} onChange={setSpeed} />
          <div className="row buttons">
            {anim ? (
              <button type="button" onClick={stopAnimation}>
                ■ Stop
              </button>
            ) : (
              <button type="button" onClick={startAnimation} disabled={steps === 0}>
                ▶ Play 0 → {steps}
              </button>
            )}
            <button type="button" disabled={!sim.ready} onClick={adoptResult} title="Continue evolving from this state">
              Use as new gen 0
            </button>
          </div>
        </Section>

        <Section title="Neon style">
          <Field label="Palette">
            <div className="palettes">
              {PALETTES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.name}
                  aria-label={p.name}
                  className={`swatch ${paletteId === p.id ? 'active' : ''}`}
                  style={{ background: `linear-gradient(90deg, ${p.colors.join(',')})` }}
                  onClick={() => {
                    setPaletteId(p.id)
                    setStyle((s) => ({ ...s, colors: p.colors, background: p.background }))
                  }}
                />
              ))}
            </div>
          </Field>
          <div className="row colors">
            {style.colors.map((c, i) => (
              <input
                key={i}
                type="color"
                value={c}
                title={`Colour ${i + 1}`}
                onChange={(e) => {
                  setPaletteId('custom')
                  setStyleKey('colors', style.colors.map((x, j) => (j === i ? e.target.value : x)))
                }}
              />
            ))}
            {style.colors.length < 6 && (
              <button
                type="button"
                className="icon-btn"
                title="Add colour"
                onClick={() => setStyleKey('colors', [...style.colors, style.colors[style.colors.length - 1]])}
              >
                +
              </button>
            )}
            {style.colors.length > 1 && (
              <button type="button" className="icon-btn" title="Remove colour" onClick={() => setStyleKey('colors', style.colors.slice(0, -1))}>
                −
              </button>
            )}
            <span className="spacer" />
            <span className="mini-label">BG</span>
            <input type="color" value={style.background} title="Background" onChange={(e) => setStyleKey('background', e.target.value)} />
          </div>
          <Field label="Colour by">
            <select value={style.colorMode} onChange={(e) => setStyleKey('colorMode', e.target.value as ColorMode)}>
              <option value="age">Cell age (young → old)</option>
              <option value="neighbours">Live neighbours</option>
              <option value="gradient">Position gradient</option>
              <option value="solid">Single colour</option>
            </select>
          </Field>
          {style.colorMode === 'age' && (
            <Range label="Age span" value={style.ageSpan} min={2} max={300} format={(v) => `${v} gens`} onChange={(v) => setStyleKey('ageSpan', v)} />
          )}
          <Field label="Cell shape">
            <Segmented<CellShape>
              value={style.shape}
              onChange={(v) => setStyleKey('shape', v)}
              options={[
                { value: 'square', label: 'Square' },
                { value: 'rounded', label: 'Rounded' },
                { value: 'circle', label: 'Circle' },
              ]}
            />
          </Field>
          <Range label="Gap" value={style.gap} min={0} max={0.45} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setStyleKey('gap', v)} />
          <Range label="Glow" value={style.glow} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => setStyleKey('glow', v)} />
          <Range label="Blur" value={style.blur} min={0} max={4} step={0.05} format={(v) => (v ? `${v.toFixed(2)} cells` : 'off')} onChange={(v) => setStyleKey('blur', v)} />
          {style.blur > 0 && (
            <>
              <Field label="Blur area">
                <Segmented<BlurMode>
                  value={style.blurMode}
                  onChange={(v) => setStyleKey('blurMode', v)}
                  options={[
                    { value: 'uniform', label: 'Whole', title: 'Blur the whole image' },
                    { value: 'edges', label: 'Edges', title: 'Sharp centre, blurred edges (tilt-shift)' },
                    { value: 'center', label: 'Centre', title: 'Blurred centre, sharp edges' },
                  ]}
                />
              </Field>
              {style.blurMode !== 'uniform' && (
                <Range
                  label={style.blurMode === 'edges' ? 'Sharp area' : 'Blurred area'}
                  value={style.blurFocus}
                  min={0}
                  max={0.95}
                  step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => setStyleKey('blurFocus', v)}
                />
              )}
            </>
          )}
          <label className="check">
            <input type="checkbox" checked={style.core} onChange={(e) => setStyleKey('core', e.target.checked)} />
            Bright neon core
          </label>
          <label className="check">
            <input type="checkbox" checked={style.backgroundGrid} onChange={(e) => setStyleKey('backgroundGrid', e.target.checked)} />
            Faint background lattice
          </label>
          <label className="check">
            <input type="checkbox" checked={style.trails} onChange={(e) => setStyleKey('trails', e.target.checked)} />
            Afterglow of recently dead cells
          </label>
          {style.trails && (
            <Range label="Afterglow length" value={style.trailLength} min={1} max={40} format={(v) => `${v} gens`} onChange={(v) => setStyleKey('trailLength', v)} />
          )}
        </Section>

        <Section title="Export wallpaper">
          <Field label="Format">
            <Segmented<ExportFormat>
              value={format}
              onChange={setFormat}
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'jpeg', label: 'JPEG' },
                { value: 'webp', label: 'WebP' },
              ]}
            />
          </Field>
          {format !== 'png' && (
            <Range label="Quality" value={quality} min={0.5} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={setQuality} />
          )}
          <button type="button" className="primary" disabled={!sim.ready || exporting} onClick={exportWallpaper}>
            {exporting ? 'Rendering…' : sim.ready ? `⬇ Download ${size.w}×${size.h}` : `Simulating… ${progressPct}%`}
          </button>
          <p className="note">
            Every lit cell is a live cell of generation {steps}
            {style.trails ? '; afterglow marks cells that died in the last generations' : ''}.
          </p>
        </Section>
      </aside>

      <main className="stage">
        <div className="toolbar">
          <Segmented<View>
            value={view}
            onChange={(v) => {
              if (v === 'initial') stopAnimation()
              setView(v)
            }}
            options={[
              { value: 'initial', label: '✎ Generation 0 (edit)' },
              { value: 'result', label: `✦ Generation ${steps}` },
            ]}
          />
          <div className="stats">
            {view === 'initial' ? (
              <span>{initialPop.toLocaleString()} live cells · paint to edit</span>
            ) : anim ? (
              <span>
                ▶ generation {animFrame} / {steps}
              </span>
            ) : sim.ready && sim.result ? (
              <span>
                {sim.result.population.toLocaleString()} live cells · {describe(sim.result)}
              </span>
            ) : (
              <span>Simulating… {progressPct}%</span>
            )}
          </div>
        </div>
        <Preview
          width={size.w}
          height={size.h}
          cellSize={cellSize}
          state={shownState}
          frame={frame}
          options={style}
          wrap={wrap}
          editable={view === 'initial'}
          tool={tool}
          brush={brush}
          stampPattern={stampPattern}
          onEdit={editInitial}
        >
          {view === 'result' && !anim && !sim.ready && (
            <div className="progress">
              <div style={{ width: `${progressPct}%` }} />
            </div>
          )}
        </Preview>
      </main>
    </div>
  )
}
