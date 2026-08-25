/**
 * The pipeline policy, tested as the pure functions it is.
 *
 * The allowlists are the trust boundary for the whole feature, so the tests
 * that matter most here are the negative ones: what a pipeline may NOT do. A
 * test that only checks the happy path passes just as well against an allowlist
 * that allows everything.
 *
 * Whether the names in those lists are real tools cannot be asked here — L1 may
 * not import the registry — so `tools.test.ts` asks it, on the other side of the
 * boundary where `TOOLS` is in scope.
 */

import { describe, expect, it } from 'vitest'
import {
  AUTO_CAPABLE,
  IDLE_ROUNDS_BEFORE_SHUTDOWN,
  SCOUT_TOOLS,
  TWIN_TOOLS,
  WORKING_GAP_MS,
  intervalMs,
  isDue,
  isKnownPosting,
  isSettled,
  scheduleOf,
  mayPropose,
  postingKey,
  proposalDetail,
  shouldOfferShutdown,
} from './proposal'
import { PIPELINE_KINDS, PROPOSAL_STATUSES } from './model'

describe('what a pipeline may propose', () => {
  it('lets a twin write notes and tags', () => {
    expect(mayPropose('twin', 'application.note.set')).toBe(true)
    expect(mayPropose('twin', 'keyword.attach')).toBe(true)
    expect(mayPropose('twin', 'timeline.item.create')).toBe(true)
  })

  it('lets a scout fill its two inboxes and nothing else', () => {
    expect(mayPropose('scout', 'scout.posting.save')).toBe(true)
    expect(mayPropose('scout', 'scout.match.save')).toBe(true)
    expect(SCOUT_TOOLS).toHaveLength(2)
  })

  /*
   * The four that decide the feature is safe. Each is a thing a plausible model
   * would try — "this application looks like a duplicate", "the user clearly
   * meant to withdraw" — and each has to be refused by the LIST rather than by
   * the prompt, because a prompt is a request.
   */
  it('refuses a twin the power to delete anything', () => {
    expect(mayPropose('twin', 'application.delete')).toBe(false)
    expect(mayPropose('twin', 'vault.file.delete')).toBe(false)
    expect(mayPropose('twin', 'timeline.item.delete')).toBe(false)
    expect(mayPropose('twin', 'memory.clear')).toBe(false)
  })

  it('refuses a twin the power to restage or rewrite an application', () => {
    expect(mayPropose('twin', 'application.update')).toBe(false)
    expect(mayPropose('twin', 'application.stage.set')).toBe(false)
  })

  it('refuses a scout everything that is not its own inbox', () => {
    for (const tool of TWIN_TOOLS) expect(mayPropose('scout', tool)).toBe(false)
    expect(mayPropose('scout', 'application.create')).toBe(false)
    expect(mayPropose('scout', 'scout.posting.promote')).toBe(false)
  })

  it('holds no delete in either list, by inspection as well as by example', () => {
    for (const tool of [...TWIN_TOOLS, ...SCOUT_TOOLS]) {
      expect(tool.endsWith('.delete')).toBe(false)
    }
  })

  it('refuses a tool nobody has heard of', () => {
    expect(mayPropose('twin', '')).toBe(false)
    expect(mayPropose('twin', 'application.note')).toBe(false)
  })
})

describe('unattended running', () => {
  it('is offered to the twin and never to the scout', () => {
    expect(AUTO_CAPABLE.twin).toBe(true)
    expect(AUTO_CAPABLE.scout).toBe(false)
  })

  it('answers for every kind there is', () => {
    for (const kind of PIPELINE_KINDS) expect(typeof AUTO_CAPABLE[kind]).toBe('boolean')
  })
})

describe('recognising a job already seen', () => {
  it('reads three spellings of one LinkedIn job as one job', () => {
    const canonical = postingKey('https://www.linkedin.com/jobs/view/4021234567/')
    expect(postingKey('https://www.linkedin.com/jobs/view/senior-engineer-4021234567')).toBe(
      canonical,
    )
    expect(
      postingKey('https://www.linkedin.com/jobs/search/?currentJobId=4021234567&keywords=x'),
    ).toBe(canonical)
  })

  it('keeps two different jobs apart', () => {
    expect(postingKey('https://www.linkedin.com/jobs/view/4021234567/')).not.toBe(
      postingKey('https://www.linkedin.com/jobs/view/4021234568/'),
    )
  })

  it('ignores the fragment and a trailing slash on any board', () => {
    expect(postingKey('https://boards.greenhouse.io/acme/jobs/55#apply')).toBe(
      postingKey('https://boards.greenhouse.io/acme/jobs/55/'),
    )
  })

  /*
   * The query string SURVIVES on a board we have no canonicaliser for, and that
   * is the deliberate half. On Workday and Greenhouse the parameters are often
   * the posting's whole identity, so stripping them to look tidy would fold two
   * different jobs into one and silently drop the second.
   */
  it('keeps the query string where it carries the identity', () => {
    expect(postingKey('https://acme.wd1.myworkdayjobs.com/careers?job=R-101')).not.toBe(
      postingKey('https://acme.wd1.myworkdayjobs.com/careers?job=R-102'),
    )
  })

  it('folds text that is not a URL rather than throwing', () => {
    expect(postingKey('  Senior Engineer at Acme ')).toBe('senior engineer at acme')
  })

  it('finds a job in a list under a different spelling', () => {
    const known = ['https://www.linkedin.com/jobs/view/senior-engineer-4021234567']
    expect(isKnownPosting(known, 'https://www.linkedin.com/jobs/view/4021234567/')).toBe(true)
    expect(isKnownPosting(known, 'https://www.linkedin.com/jobs/view/9999999999/')).toBe(false)
    expect(isKnownPosting([], 'https://example.com/a')).toBe(false)
  })
})

describe('when a pipeline offers to switch itself off', () => {
  it('waits for two empty rounds, not one', () => {
    expect(shouldOfferShutdown(1, 0)).toBe(false)
    expect(shouldOfferShutdown(IDLE_ROUNDS_BEFORE_SHUTDOWN, 0)).toBe(true)
  })

  /*
   * The case the constant exists for. A queue the user has not answered is the
   * opposite of "nothing left to do", and asking to shut down while cards sit
   * unanswered reads as the app giving up on its own suggestions.
   */
  it('never offers while suggestions are still waiting for an answer', () => {
    expect(shouldOfferShutdown(99, 1)).toBe(false)
  })
})

describe('a settled proposal', () => {
  it('is anything that is no longer pending', () => {
    expect(isSettled('pending')).toBe(false)
    for (const status of PROPOSAL_STATUSES.filter((s) => s !== 'pending')) {
      expect(isSettled(status)).toBe(true)
    }
  })
})

describe('when the next round is due', () => {
  const at = (ms: number) => new Date(Date.parse('2026-08-23T09:00:00.000Z') + ms).toISOString()
  const START = at(0)

  it('runs a pipeline that has never run, immediately', () => {
    expect(isDue('daily', undefined, START)).toBe(true)
  })

  /*
   * The case the whole cadence exists for. A daily pipeline that just found six
   * things has no business waiting until tomorrow to look for a seventh — the
   * toggle promises it works through the backlog, and a schedule applied while
   * there is still work turns that into a poll.
   */
  it('keeps a working pipeline working, whatever its schedule says', () => {
    expect(isDue('weekly', START, at(WORKING_GAP_MS - 1), 0)).toBe(false)
    expect(isDue('weekly', START, at(WORKING_GAP_MS), 0)).toBe(true)
    expect(isDue('daily', START, at(WORKING_GAP_MS), 1)).toBe(true)
  })

  /*
   * And the other half: once it has proven twice that there is nothing left,
   * the schedule takes over. This is the state a pipeline spends its life in.
   */
  it('falls back to the schedule once it has run out of work', () => {
    const idle = IDLE_ROUNDS_BEFORE_SHUTDOWN
    expect(isDue('daily', START, at(WORKING_GAP_MS), idle)).toBe(false)
    expect(isDue('daily', START, at(intervalMs('daily')), idle)).toBe(true)
    expect(isDue('hourly', START, at(intervalMs('hourly')), idle)).toBe(true)
    expect(isDue('hourly', START, at(intervalMs('hourly') - 1), idle)).toBe(false)
  })

  it('reads a schedule nobody recognises as daily', () => {
    expect(scheduleOf('fortnightly')).toBe('daily')
    expect(scheduleOf('  WEEKLY ')).toBe('weekly')
    expect(intervalMs('nonsense')).toBe(intervalMs('daily'))
  })

  it('runs rather than stalling when a stored instant is unreadable', () => {
    expect(isDue('daily', 'not a date', START, 99)).toBe(true)
  })
})

describe('what a proposal would write', () => {
  /*
   * The gap this exists for, found by running the real page: the card named
   * the operation and the reason, and never showed the note. Approving a
   * change you have not been shown is not approving it.
   */
  it('shows the note a note-setting proposal would write', () => {
    expect(
      proposalDetail(JSON.stringify({ id: 'app:01a0-2da4-76d0', note: 'Deadline is a Friday.' })),
    ).toBe('Deadline is a Friday.')
  })

  it('joins the fields of a richer proposal in payload order', () => {
    expect(
      proposalDetail(
        JSON.stringify({ title: 'Follow up with Rice', date: '2026-09-01', kind: 'reminder' }),
      ),
    ).toBe('Follow up with Rice · 2026-09-01 · reminder')
  })

  it('drops ids, which mean nothing to the person reading the card', () => {
    expect(proposalDetail(JSON.stringify({ id: 'app:01a02da4-c3f4-76d0', record: 'kw:01a02da4-c3f4-76d0' }))).toBe(
      null,
    )
  })

  it('survives a payload that is not an object, or not JSON', () => {
    expect(proposalDetail('not json')).toBe(null)
    expect(proposalDetail('[1,2]')).toBe(null)
    expect(proposalDetail('{}')).toBe(null)
  })

  it('truncates rather than letting a long body take over the card', () => {
    const long = proposalDetail(JSON.stringify({ body: 'x'.repeat(500) }))
    expect(long).not.toBeNull()
    expect(long!.length).toBeLessThanOrEqual(220)
    expect(long!.endsWith('…')).toBe(true)
  })
})

describe('a bulk proposal shows what it would write', () => {
  /**
   * This showed nothing at all until a tool arrived whose payload was a list.
   *
   * `proposalDetail` read strings and numbers, so `{ background: [ … thirty
   * facts … ] }` produced `null` and the card rendered a title with no values
   * under it — the exact gap the note on that function records having closed
   * once already, reopened by a shape it had not met.
   *
   * It matters most for that tool in particular. Those entries are claims about
   * the PERSON, read by a model out of their own CV, and approving them unseen
   * is worse than approving an unseen note about a job.
   */
  const detail = (input: unknown) => proposalDetail(JSON.stringify(input))

  it('names the entries rather than rendering nothing', () => {
    const line = detail({
      background: [
        { kind: 'education', title: 'PhD, Computer Science', where: 'Illinois' },
        { kind: 'skill', title: 'Rust' },
      ],
    })
    expect(line).toContain('PhD, Computer Science')
    expect(line).toContain('Rust')
  })

  it('says how many more there are, because thirty is a different act from three', () => {
    const line = detail({
      background: Array.from({ length: 9 }, (_, i) => ({ kind: 'skill', title: `S${String(i)}` })),
    })
    expect(line).toContain('and 6 more')
  })

  it('does not list all nine, because the fourth never changes a decision', () => {
    const line = detail({
      background: Array.from({ length: 9 }, (_, i) => ({ kind: 'skill', title: `S${String(i)}` })),
    })
    expect(line).not.toContain('S7')
  })

  it('prefers the field a person recognises over whatever comes first', () => {
    const line = detail({ files: [{ kind: 'pdf', name: 'CV-2026.pdf', size: '1 KB' }] })
    expect(line).toContain('CV-2026.pdf')
  })

  it('still drops ids, which mean nothing to the reader', () => {
    const line = detail({ items: [{ id: 'app_01H8XYZ', title: 'A real title' }] })
    expect(line).toContain('A real title')
    expect(line).not.toContain('app_01H8XYZ')
  })

  it('leaves scalar payloads exactly as they were', () => {
    // The regression risk: every existing card renders through this function.
    expect(detail({ note: 'Chased them on Tuesday' })).toBe('Chased them on Tuesday')
  })

  it('returns null for an array with nothing nameable in it', () => {
    // Rather than an empty string, which renders as a blank line under a title
    // and reads as a value that failed to load.
    expect(detail({ keywords: ['kw_01H8', 'kw_01H9'] })).toBeNull()
  })
})
