import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export const FONTS = {
  sans: { label: 'Sans', css: 'var(--font-text)' },
  serif: { label: 'Serif', css: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif" },
  mono: { label: 'Mono', css: 'var(--font-mono)' }
} as const

export const SPACING = {
  compact: { label: 'Compact', value: 1.45 },
  normal: { label: 'Normal', value: 1.65 },
  relaxed: { label: 'Relaxed', value: 1.9 }
} as const

export const WIDTHS = {
  narrow: { label: 'Narrow', css: '640px' },
  medium: { label: 'Medium', css: '760px' },
  wide: { label: 'Wide', css: '960px' },
  full: { label: 'Full', css: '100%' }
} as const

export const MIN_SIZE = 12
export const MAX_SIZE = 28

export interface Appearance {
  font: keyof typeof FONTS
  size: number
  spacing: keyof typeof SPACING
  width: keyof typeof WIDTHS
}

export const DEFAULT_APPEARANCE: Appearance = { font: 'sans', size: 16, spacing: 'normal', width: 'medium' }

const STORAGE_KEY = 'appearance'

function load(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Appearance>
    const merged = { ...DEFAULT_APPEARANCE, ...saved }
    return {
      font: merged.font in FONTS ? merged.font : DEFAULT_APPEARANCE.font,
      size: Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number(merged.size) || DEFAULT_APPEARANCE.size)),
      spacing: merged.spacing in SPACING ? merged.spacing : DEFAULT_APPEARANCE.spacing,
      width: merged.width in WIDTHS ? merged.width : DEFAULT_APPEARANCE.width
    }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

interface AppearanceState {
  appearance: Appearance
  update(patch: Partial<Appearance> | ((prev: Appearance) => Partial<Appearance>)): void
  reset(): void
}

const AppearanceContext = createContext<AppearanceState | null>(null)

/** Reading preferences for this computer. They change how notes look, not what's saved in them. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState(load)

  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--editor-font', FONTS[appearance.font].css)
    root.setProperty('--editor-font-size', `${appearance.size}px`)
    root.setProperty('--editor-line-height', String(SPACING[appearance.spacing].value))
    root.setProperty('--editor-width', WIDTHS[appearance.width].css)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance))
    } catch {
      // Storage may be unavailable; the setting just won't persist.
    }
  }, [appearance])

  const value = useMemo<AppearanceState>(
    () => ({
      appearance,
      update: (patch) =>
        setAppearance((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) })),
      reset: () => setAppearance(DEFAULT_APPEARANCE)
    }),
    [appearance]
  )
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceState {
  const ctx = useContext(AppearanceContext)
  if (!ctx) throw new Error('useAppearance must be used inside <AppearanceProvider>')
  return ctx
}
