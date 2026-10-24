import { useState, type ReactNode } from 'react'

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="section-body">{children}</div>
    </details>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint !== undefined && <span className="field-hint">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

interface RangeProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  onChange: (v: number) => void
}

export function Range({ label, value, min, max, step = 1, format, onChange }: RangeProps) {
  return (
    <Field label={label} hint={format ? format(value) : String(value)}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  )
}

interface NumberInputProps {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  className?: string
  'aria-label'?: string
}

/** Number input that commits (clamped) on blur or Enter, so typing intermediate values is possible. */
export function NumberInput({ value, min, max, onChange, ...rest }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const n = Math.round(Number(draft))
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
    setDraft(null)
  }
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      {...rest}
    />
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
