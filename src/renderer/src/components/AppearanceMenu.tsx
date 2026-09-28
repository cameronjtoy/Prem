import { useEffect, useRef, useState } from 'react'
import {
  FONTS,
  MAX_SIZE,
  MIN_SIZE,
  SPACING,
  useAppearance,
  WIDTHS,
  type Appearance
} from '../state/AppearanceContext'

function Choice<K extends string>(props: {
  label: string
  options: Record<K, { label: string }>
  value: K
  onChange(value: K): void
}) {
  return (
    <div className="setting-row">
      <span className="setting-label">{props.label}</span>
      <div className="segmented" role="radiogroup" aria-label={props.label}>
        {(Object.keys(props.options) as K[]).map((key) => (
          <button
            key={key}
            role="radio"
            aria-checked={props.value === key}
            className={props.value === key ? 'on' : undefined}
            onClick={() => props.onChange(key)}
          >
            {props.options[key].label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function AppearanceMenu() {
  const { appearance, update, reset } = useAppearance()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  const clamp = (size: number): number => Math.min(MAX_SIZE, Math.max(MIN_SIZE, size))
  const setSize = (size: number): void => update({ size: clamp(size) })
  const stepSize = (delta: number): void => update((prev) => ({ size: clamp(prev.size + delta) }))

  return (
    <div className="appearance" ref={ref}>
      <button
        className={open ? 'text-button on' : 'text-button'}
        onClick={() => setOpen((o) => !o)}
        title="Font and text size"
        aria-expanded={open}
      >
        <span className="aa">Aa</span> Appearance
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Appearance">
          <Choice<Appearance['font']> label="Font" options={FONTS} value={appearance.font} onChange={(font) => update({ font })} />
          <div className="setting-row">
            <span className="setting-label">Text size</span>
            <div className="stepper">
              <button onClick={() => stepSize(-1)} disabled={appearance.size <= MIN_SIZE} aria-label="Smaller text">
                A−
              </button>
              <input
                type="range"
                min={MIN_SIZE}
                max={MAX_SIZE}
                value={appearance.size}
                onChange={(e) => setSize(Number(e.target.value))}
                aria-label="Text size"
              />
              <button onClick={() => stepSize(1)} disabled={appearance.size >= MAX_SIZE} aria-label="Larger text">
                A+
              </button>
              <span className="size-value">{appearance.size}px</span>
            </div>
          </div>
          <Choice<Appearance['spacing']>
            label="Line spacing"
            options={SPACING}
            value={appearance.spacing}
            onChange={(spacing) => update({ spacing })}
          />
          <Choice<Appearance['width']> label="Page width" options={WIDTHS} value={appearance.width} onChange={(width) => update({ width })} />
          <div className="popover-footer">
            <span className="hint">Applies to every note on this computer.</span>
            <button className="text-button" onClick={reset}>
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
