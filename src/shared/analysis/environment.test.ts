import { describe, expect, it } from 'vitest'
import { buildSteps, environmentPython, errorTail, isCurrent, type EnvironmentStamp } from './environment'

const stamp = (requirementsHash: string): EnvironmentStamp => ({
  requirementsHash,
  tool: 'venv',
  pythonVersion: '3.12.4',
  packages: '',
  id: 'abc',
  created: ''
})

describe('environments', () => {
  it('is rebuilt only when environment.txt changes', () => {
    expect(isCurrent(stamp('aa'), 'aa')).toBe(true)
    expect(isCurrent(stamp('aa'), 'bb')).toBe(false)
    expect(isCurrent(null, 'aa')).toBe(false)
  })

  it('finds the Python inside an environment on each platform', () => {
    expect(environmentPython('/envs/v1', false)).toBe('/envs/v1/bin/python')
    expect(environmentPython('C:\\envs\\v1', true)).toBe('C:\\envs\\v1\\Scripts\\python.exe')
  })

  it('builds with uv when it is installed', () => {
    const steps = buildSteps({
      tool: 'uv',
      python: '/usr/bin/python3',
      uv: '/home/me/.local/bin/uv',
      dir: '/envs/v1',
      requirements: '/envs/v1.requirements.txt',
      windows: false
    })
    expect(steps.map((s) => [s.command, ...s.args])).toEqual([
      ['/home/me/.local/bin/uv', 'venv', '--python', '/usr/bin/python3', '--seed', '/envs/v1'],
      ['/home/me/.local/bin/uv', 'pip', 'install', '--python', '/envs/v1/bin/python', '-r', '/envs/v1.requirements.txt']
    ])
  })

  it('falls back to venv and pip, and skips installing when there is nothing to install', () => {
    const steps = buildSteps({
      tool: 'venv',
      python: 'python3',
      uv: null,
      dir: '/envs/v1',
      requirements: null,
      windows: false
    })
    expect(steps.map((s) => [s.command, ...s.args])).toEqual([['python3', '-m', 'venv', '/envs/v1']])
  })

  it('keeps the end of an installer’s output, where the error is', () => {
    expect(errorTail('a\n\nb\nc\nd', 2)).toBe('c\nd')
  })
})
