import { describe, expect, it } from 'vitest'
import { measuredText, serversText } from './measured-dates'
import bench from './tool-bench.json'
import toolEval from './tool-eval.json'

const label = (m: string) => ({ a: 'Gemma 4 31B', b: 'GPT-OSS 120B', c: 'MiniMax M2.1' })[m] ?? m

describe('saying when a published table was measured', () => {
  it('says the one date when there is no per-model record, or every model shares it', () => {
    expect(measuredText('2026-10-23T21:28:00Z', undefined, label)).toBe('October 23, 2026')
    expect(measuredText('2026-10-23T21:28:00Z', { a: '2026-10-23T10:00:00Z', b: '2026-10-23T12:00:00Z' }, label)).toBe(
      'October 23, 2026',
    )
  })

  it('says each model’s own date when they differ, naming the models that share one', () => {
    expect(
      measuredText(
        '2026-11-21T08:00:00Z',
        { a: '2026-10-23T21:28:00Z', b: '2026-10-23T21:28:00Z', c: '2026-11-21T08:00:00Z' },
        label,
      ),
    ).toBe('October 23, 2026 (Gemma 4 31B and GPT-OSS 120B), November 21, 2026 (MiniMax M2.1)')
  })

  it('counts the servers rather than claiming three', () => {
    expect(serversText(1)).toBe('one vLLM server')
    expect(serversText(3)).toBe('three vLLM servers')
    expect(serversText(12)).toBe('12 vLLM servers')
  })

  it('dates every model a published table carries, and no model it does not', () => {
    /*
     * A model added to a payload by hand (MiniMax was merged in beside rows
     * whose explanations had been edited since they were run) would otherwise
     * be printed under the other models' date, and a date left behind for a
     * dropped model would name it in the footer of a table it is not in.
     */
    const tables = [
      ['tool-bench', bench.report.map((r) => r.model), (bench as { measured?: Record<string, string> }).measured],
      ['tool-eval', toolEval.rows.map((r) => r.model), (toolEval as { measured?: Record<string, string> }).measured],
    ] as const
    for (const [name, models, measured] of tables) {
      if (measured === undefined) continue
      expect(Object.keys(measured).sort(), name).toEqual([...new Set(models)].sort())
      for (const [model, at] of Object.entries(measured)) expect(Number.isNaN(Date.parse(at)), `${name}: ${model}`).toBe(false)
    }
  })
})
