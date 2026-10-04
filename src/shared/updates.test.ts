import { describe, expect, it } from 'vitest'
import { canAutoUpdate } from './updates'

describe('canAutoUpdate', () => {
  const base = { packaged: true, signed: true, appImage: false, enabled: true }
  it('updates signed installed copies, and AppImages, when the setting is on', () => {
    expect(canAutoUpdate(base)).toBe(true)
    expect(canAutoUpdate({ ...base, signed: false, appImage: true })).toBe(true)
  })
  it('never updates from source, unsigned installers, or with the setting off', () => {
    expect(canAutoUpdate({ ...base, packaged: false })).toBe(false)
    expect(canAutoUpdate({ ...base, signed: false })).toBe(false)
    expect(canAutoUpdate({ ...base, enabled: false })).toBe(false)
  })
})
