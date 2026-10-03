import { describe, expect, it } from 'vitest'
import { approvalText, diffRequirements, requirementLines, riskyLine } from './trust'

describe('environment lists', () => {
  it('reads package lines without comments or blanks', () => {
    expect(requirementLines('# lab packages\nnumpy==2.1.0\n\npandas  # tables\n')).toEqual(['numpy==2.1.0', 'pandas'])
  })

  it('shows what changed since the list approved last', () => {
    expect(diffRequirements('numpy==2.1.0\npandas\n', 'numpy==2.2.0\npandas\nscipy\n')).toEqual({
      added: ['numpy==2.2.0', 'scipy'],
      removed: ['numpy==2.1.0']
    })
    expect(diffRequirements(null, 'numpy\n')).toEqual({ added: ['numpy'], removed: [] })
  })

  it('points out lines that install from somewhere other than the package index', () => {
    expect(riskyLine('numpy==2.1.0')).toBeNull()
    expect(riskyLine('pandas>=2')).toBeNull()
    expect(riskyLine('--index-url https://pypi.evil.example/simple')).toMatch(/where packages are downloaded/)
    expect(riskyLine('--extra-index-url https://x')).toMatch(/where packages are downloaded/)
    expect(riskyLine('-e git+https://github.com/x/y')).toMatch(/folder or repository/)
    expect(riskyLine('-r other.txt')).toMatch(/another file/)
    expect(riskyLine('--pre')).toMatch(/installer option/)
    expect(riskyLine('https://example.org/pkg-1.0.tar.gz')).toMatch(/web address/)
    expect(riskyLine('git+https://github.com/x/y')).toMatch(/web address/)
    expect(riskyLine('mypkg @ https://example.org/mypkg.whl')).toMatch(/web address/)
    expect(riskyLine('premtiny @ file:///tmp/premtiny-1.0-py3-none-any.whl')).toMatch(/file from this computer/)
    expect(riskyLine('./local-package')).toMatch(/file from this computer/)
    expect(riskyLine('C:\\pkgs\\a.whl')).toMatch(/file from this computer/)
  })
})

describe('approvalText', () => {
  it('ignores trailing space, but nothing else', () => {
    expect(approvalText('print(1)\n\n  ')).toBe('print(1)')
    expect(approvalText('  print(1)')).toBe('  print(1)')
  })
})
