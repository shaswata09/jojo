import { describe, expect, it } from 'vitest'
import { MAX_HISTORY, withEntry, type HistoryEntry } from './calculator-history'
import calculatorSource from './Calculator.tsx?raw'

/**
 * Q055: the Vault calculator keeps a history and switches between a basic and
 * a scientific pad.
 *
 * The arithmetic is tested in `service/kg/core/calculator.test.ts`. The history
 * is the half that lived only in the component, so its step is a pure function
 * now and tested here; the mode switch and the history panel are JSX, so they
 * are pinned as source (D20).
 */

const run = (exprs: readonly string[], max?: number) =>
  exprs.reduce<HistoryEntry[]>((prev, expr) => withEntry(prev, expr, `=${expr}`, max), [])

describe('the calculator history (Q055)', () => {
  it('puts the latest calculation on top', () => {
    const history = run(['1 + 1', '2 × 3', '9 ÷ 3'])
    expect(history.map((h) => h.expr)).toEqual(['9 ÷ 3', '2 × 3', '1 + 1'])
    expect(history[0]?.value).toBe('=9 ÷ 3')
  })

  it('gives every entry its own id, so a list keyed on it never collides', () => {
    const ids = run(['a', 'b', 'c', 'd']).map((h) => h.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps only the most recent, dropping the oldest past the cap', () => {
    const exprs = Array.from({ length: MAX_HISTORY + 5 }, (_, i) => `n${String(i)}`)
    const history = run(exprs)
    expect(history).toHaveLength(MAX_HISTORY)
    expect(history[0]?.expr).toBe(`n${String(MAX_HISTORY + 4)}`)
    expect(history.map((h) => h.expr)).not.toContain('n0')
  })

  it('does not change the list it was handed', () => {
    const before = run(['1 + 1'])
    const snapshot = [...before]
    withEntry(before, '2 + 2', '4')
    expect(before).toEqual(snapshot)
  })
})

describe('the calculator pad (Q055)', () => {
  const code = calculatorSource.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

  it('records each finished calculation through the history step', () => {
    expect(code).toContain('setHistory((prev) => withEntry(prev, expr, value))')
    expect(code.match(/\brecord\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('offers a basic and a scientific mode, and shows the scientific keys only in the second', () => {
    expect(code).toContain("{ value: 'basic', label: 'Basic' }")
    expect(code).toContain("{ value: 'scientific', label: 'Scientific' }")
    expect(code).toMatch(/<Segment label="Calculator mode" options=\{MODES\} value=\{mode\} onChange=\{setMode\}/)
    expect(code).toMatch(/mode === 'scientific' \? \(\s*<div[^>]*>\s*\{UNARY\.map\(/)
  })

  it('has a History toggle that opens a panel listing the entries', () => {
    expect(code).toMatch(/onClick=\{\(\) => setShowHistory\(\(v\) => !v\)\}/)
    expect(code).toMatch(/showHistory \? \(/)
    expect(code).toContain('history.map((h) =>')
  })
})
