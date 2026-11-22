/**
 * `board.search` and the sites whose terms forbid automated reading.
 *
 * The rest of this read is pinned in `queries.test.ts` ('reading a job board').
 * This file holds the refusal added 2026-11-21: LinkedIn, Indeed, Glassdoor
 * and ZipRecruiter are never opened by a pipeline, even one whose owner typed
 * them in long ago — and such a stored pipeline does not break, it is told why.
 */

import { describe, expect, it } from 'vitest'
import { noAutomatedAccessReason, parseSources } from '../../core/board'
import { MutableSnapshot } from '../../core/snapshot'
import { boardSearch } from './board'

const TODAY = '2026-11-21' as never

describe('a pipeline that names a site which forbids robots', () => {
  const memory = new MutableSnapshot()

  it('is refused with the reason, and nothing is opened', async () => {
    const opened: string[] = []
    const boards = parseSources('linkedin.com/jobs/search?keywords=lecturer, cra.org/ads')
    const out = (await boardSearch.read(
      memory,
      { url: 'https://www.linkedin.com/jobs/search?keywords=lecturer' },
      {
        today: TODAY,
        boards,
        scan: async (url) => {
          opened.push(url)
          return { ok: true as const, rows: [] }
        },
      },
    )) as { ok: boolean; hint: string }
    expect(out.ok).toBe(false)
    expect(out.hint).toBe(noAutomatedAccessReason('linkedin.com'))
    expect(opened).toEqual([])
  })

  it('still reads the other boards the same pipeline names', async () => {
    const opened: string[] = []
    const out = (await boardSearch.read(
      memory,
      { url: 'https://cra.org/ads' },
      {
        today: TODAY,
        boards: parseSources('indeed.com, cra.org/ads'),
        scan: async (url) => {
          opened.push(url)
          return { ok: true as const, rows: [] }
        },
      },
    )) as { ok: boolean }
    expect(out.ok).toBe(true)
    expect(opened).toHaveLength(1)
  })

  it('is refused on a country domain the person did not even name', async () => {
    const out = (await boardSearch.read(
      memory,
      { url: 'https://uk.indeed.com/jobs?q=ml' },
      { today: TODAY, boards: [], scan: async () => ({ ok: true as const, rows: [] }) },
    )) as { ok: boolean; hint: string }
    expect(out.hint).toBe(noAutomatedAccessReason('indeed.com'))
  })
})
