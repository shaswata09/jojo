/**
 * What a job step COSTS, measured by counting the per-record scans.
 *
 * `about` snapshots used to be recomputed eagerly for every record ever asked
 * about, on every notify — records × jobs per step, and the records were never
 * forgotten. The scan is counted through the core helper rather than timed,
 * so the assertion is exact instead of a flaky stopwatch.
 */

import { describe, expect, it, vi } from 'vitest'

const scans = vi.hoisted(() => ({ count: 0 }))

vi.mock('../core/jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/jobs')>()
  return {
    ...actual,
    about: (...args: Parameters<typeof actual.about>) => {
      scans.count += 1
      return actual.about(...args)
    },
  }
})

const { createJobs } = await import('./jobs')

describe('about() cost', () => {
  it('does not rescan records nobody is reading when a job steps', () => {
    const jobs = createJobs<{ aborted: boolean }>({
      newSignal: () => ({ signal: { aborted: false }, abort: () => {} }),
      now: () => '2026-09-13T09:00:00.000Z',
    })
    // A hundred panels opened once, over a session.
    for (let i = 0; i < 100; i += 1) jobs.about(`application:${String(i)}`)

    let step: (s: string) => void = () => {}
    jobs.start({
      id: 'a',
      kind: 'fit',
      label: 'Fit',
      about: 'application:0',
      run: (control) => {
        step = control.onStep
        return new Promise(() => {})
      },
    })
    scans.count = 0
    for (let i = 0; i < 50; i += 1) step(`step ${String(i)}`)
    // Fifty steps, nobody reading: no scans at all. Eagerly, this was 5,000.
    expect(scans.count).toBe(0)
    jobs.about('application:0')
    expect(scans.count).toBe(1)
  })
})
