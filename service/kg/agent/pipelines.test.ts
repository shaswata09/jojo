/**
 * The proposing host, tested against a fake `ToolHost`.
 *
 * A fake rather than a real runtime because the claim under test is about what
 * the wrapper FORWARDS — which tool it calls, with which arguments, and what it
 * hands back to the model. A real runtime would answer that question too, and
 * bury it: the assertion would be on a graph, one layer past the thing that is
 * actually being checked. `tools.test.ts` owns the graph half.
 */

import { describe, expect, it, vi } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { edgeId } from '../core/ref'
import { SCOUT_TOOLS, TWIN_TOOLS } from '../core/proposal'
import type { ToolHost } from './execute'
import { PIPELINE_PROMPTS, proposalTitle, proposingHost, toolsForKind } from './pipelines'

type Call = { name: string; input: unknown }

function fakeHost(overrides: Partial<ToolHost> = {}) {
  const calls: Call[] = []
  const host: ToolHost = {
    memory: () => new MutableSnapshot(),
    today: () => '2026-08-25',
    check: (_name, input) => ({ ok: true, value: input }),
    run: (name, input) => {
      calls.push({ name, input })
      return { ok: true, output: 'proposal-1', announcement: { title: 'Suggested' }, undo: null }
    },
    ...overrides,
  }
  return { host, calls }
}

const sink = { pipelineId: 'pipeline-1' as never, kind: 'twin' as const, rationale: () => 'because' }

describe('what each pipeline is offered', () => {
  it('gives a twin every read and its own writes, and none of the scout’s', () => {
    const tools = toolsForKind('twin')
    expect(tools).toContain('memory.overview')
    expect(tools).toContain('graph.query')
    for (const t of TWIN_TOOLS) expect(tools).toContain(t)
    for (const t of SCOUT_TOOLS) expect(tools).not.toContain(t)
  })

  it('gives a scout the reads it needs to dedupe, and two writes', () => {
    const tools = toolsForKind('scout')
    expect(tools).toContain('memory.search')
    for (const t of SCOUT_TOOLS) expect(tools).toContain(t)
    for (const t of TWIN_TOOLS) expect(tools).not.toContain(t)
  })

  it('never offers either of them a way to delete something', () => {
    for (const kind of ['twin', 'scout'] as const) {
      expect(toolsForKind(kind).some((t) => t.endsWith('.delete'))).toBe(false)
    }
  })

  it('tells both of them, in prose, that their calls do not take effect', () => {
    for (const prompt of Object.values(PIPELINE_PROMPTS)) {
      expect(prompt).toContain('queued')
      expect(prompt).toContain('Never invent a fact')
    }
  })
})

describe('the proposing host', () => {
  it('turns an allowed write into a raised proposal and nothing else', () => {
    const { host, calls } = fakeHost()
    const result = proposingHost(host, sink).run('application.note.set' as never, {
      id: 'application-1',
      note: 'Deadline is a Friday.',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe('pipeline.proposal.raise')
    const input = calls[0]?.input as Record<string, unknown>
    expect(input['tool']).toBe('application.note.set')
    expect(input['kind']).toBe('twin')
    expect(input['pipelineId']).toBe('pipeline-1')
    expect(input['rationale']).toBe('because')
    expect(JSON.parse(String(input['input']))).toEqual({
      id: 'application-1',
      note: 'Deadline is a Friday.',
    })
    expect(result.ok).toBe(true)
  })

  /*
   * The dishonesty this design exists to avoid. A wrapper that answered "Done
   * (id: file-3)" would hand the model an id for a record that does not exist,
   * and `renderOutcome` appends exactly that id to what the model reads next.
   */
  it('hands the model no id and says the change has not happened', () => {
    const { host } = fakeHost()
    const result = proposingHost(host, sink).run('application.note.set' as never, { id: 'a' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.output).toBeNull()
    expect(result.announcement.title).toBe('Queued for approval')
    expect(result.announcement.description).toContain('Nothing has changed yet')
    expect(result.undo).toBeNull()
  })

  it('refuses a tool outside its kind without calling anything', () => {
    const { host, calls } = fakeHost()
    const result = proposingHost(host, sink).run('application.delete' as never, { id: 'a' })

    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
    if (!result.ok) expect(result.errors[0]?.message).toContain('not available to this pipeline')
  })

  it('refuses a scout everything but its own inbox', () => {
    const { host, calls } = fakeHost()
    const scout = proposingHost(host, { ...sink, kind: 'scout' })
    expect(scout.run('application.note.set' as never, { id: 'a' }).ok).toBe(false)
    expect(scout.run('scout.posting.save' as never, { url: 'https://x.test/1' }).ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  /*
   * Checked at proposal time, not at approval time. The user should not press
   * Approve on a card whose arguments were never going to parse.
   */
  it('rejects arguments the real tool would reject, before queueing them', () => {
    const { host, calls } = fakeHost({
      check: () => ({ ok: false, issues: [{ path: 'note', message: 'Cannot be blank' }] }),
    })
    const result = proposingHost(host, sink).run('application.note.set' as never, { id: 'a' })

    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
    if (!result.ok) expect(result.errors[0]?.message).toBe('note: Cannot be blank')
  })

  /*
   * Found by running the whole thing: the scout reported "nothing here can open
   * a web page" on a machine where the extension was installed and answering,
   * because this wrapper rebuilt the host and left `scan` behind. Every
   * capability on `ToolHost` is optional, so it typechecked perfectly.
   */
  it('forwards every capability the real host has, not just the ones it knows', () => {
    const scan = async () => ({ ok: true as const, rows: [] })
    const convert = async () => ({ ok: true as const, markdown: '' })
    const { host } = fakeHost({ scan, convert })
    const wrapped = proposingHost(host, sink)
    expect(wrapped.scan).toBe(scan)
    expect(wrapped.convert).toBe(convert)
  })

  it('leaves an absent capability absent rather than undefined', () => {
    const { host } = fakeHost()
    expect('scan' in proposingHost(host, sink)).toBe(false)
  })

  it('passes reads straight through so the agent sees the real graph', () => {
    const memory = new MutableSnapshot()
    const { host } = fakeHost({ memory: () => memory })
    expect(proposingHost(host, sink).memory()).toBe(memory)
  })

  it('reads the rationale at call time, not at wrap time', () => {
    const { host, calls } = fakeHost()
    const rationale = vi.fn(() => 'the latest note')
    const wrapped = proposingHost(host, { ...sink, rationale })

    wrapped.run('application.note.set' as never, { id: 'a' })
    expect(rationale).toHaveBeenCalledTimes(1)
    expect((calls[0]?.input as Record<string, unknown> | undefined)?.['rationale']).toBe(
      'the latest note',
    )
  })

  it('reports a failure to raise rather than swallowing it', () => {
    const { host } = fakeHost({
      run: () => ({ ok: false, errors: [{ message: 'That pipeline is gone.' }] }),
    })
    expect(proposingHost(host, sink).run('application.note.set' as never, { id: 'a' }).ok).toBe(
      false,
    )
  })
})

describe('refusing a job the person has already seen', () => {
  const at = '2026-01-01T00:00:00.000Z'
  const withPosting = (url: string) => {
    const m = new MutableSnapshot()
    m.putNode({
      id: 'posting:1' as never,
      type: 'posting',
      props: { slug: 'p', title: 'A job', url, savedOn: '2026-01-01', size: '—' },
      createdAt: at,
      updatedAt: at,
    })
    return m
  }

  const scoutOn = (memory: MutableSnapshot) => {
    const calls: Call[] = []
    const host: ToolHost = {
      memory: () => memory,
      today: () => '2026-08-25',
      check: (_n, input) => ({ ok: true, value: input }),
      run: (name, input) => {
        calls.push({ name, input })
        return { ok: true, output: 'p', announcement: { title: 'Suggested' }, undo: null }
      },
    }
    return { wrapped: proposingHost(host, { ...sink, kind: 'scout' }), calls }
  }

  /*
   * The case the canonicaliser exists for, and the reason this is not left to
   * the prompt: the same LinkedIn job reached from a search, an alert email and
   * a shared link is three different URLs, and telling them apart is not
   * something a small local model does reliably.
   */
  it('recognises a saved posting under a different spelling of its link', () => {
    const { wrapped, calls } = scoutOn(withPosting('https://www.linkedin.com/jobs/view/4021234567/'))
    const result = wrapped.run('scout.posting.save' as never, {
      url: 'https://www.linkedin.com/jobs/search/?currentJobId=4021234567&keywords=x',
    })
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
    if (!result.ok) expect(result.errors[0]?.message).toContain('already saved')
  })

  it('still proposes a job it has not seen', () => {
    const { wrapped, calls } = scoutOn(withPosting('https://www.linkedin.com/jobs/view/4021234567/'))
    expect(wrapped.run('scout.posting.save' as never, { url: 'https://example.test/jobs/9' }).ok).toBe(
      true,
    )
    expect(calls).toHaveLength(1)
  })

  it('refuses one it has already proposed but nobody has answered yet', () => {
    const m = new MutableSnapshot()
    m.putNode({
      id: 'proposal:1' as never,
      type: 'proposal',
      props: {
        slug: 'x',
        kind: 'scout',
        tool: 'scout.posting.save',
        input: JSON.stringify({ url: 'https://example.test/jobs/9' }),
        title: 'Save posting',
        rationale: '',
        status: 'pending',
        proposedAt: at,
      },
      createdAt: at,
      updatedAt: at,
    })
    const { wrapped } = scoutOn(m)
    expect(wrapped.run('scout.posting.save' as never, { url: 'https://example.test/jobs/9' }).ok).toBe(
      false,
    )
  })

  it('refuses one the person has already applied to', () => {
    const m = new MutableSnapshot()
    m.putNode({
      id: 'app:1' as never,
      type: 'application',
      props: {
        slug: 'a',
        role: 'CS',
        note: '',
        roleTag: 'Assistant Professor',
        stage: 'draft',
        lastAction: '',
        lastActionAt: at,
        url: 'https://example.test/jobs/9',
      } as never,
      createdAt: at,
      updatedAt: at,
    })
    const { wrapped } = scoutOn(m)
    expect(wrapped.run('scout.posting.save' as never, { url: 'https://example.test/jobs/9' }).ok).toBe(
      false,
    )
  })

  it('does not dedupe a twin’s writes, which are not jobs', () => {
    const { host, calls } = fakeHost()
    expect(proposingHost(host, sink).run('application.note.set' as never, { id: 'a', note: 'x' }).ok).toBe(
      true,
    )
    expect(calls).toHaveLength(1)
  })
})

describe('naming a proposal', () => {
  const memory = new MutableSnapshot()

  /*
   * The bug this branch was written against, found by running the real page:
   * an application's employer is an `AT` EDGE, not a prop, so reading
   * `props.org` produced "Edit note · CS" — a role with no employer, which on a
   * page listing eight applications names none of them.
   */
  it('names an application by its employer as well as its role', () => {
    const withOrg = new MutableSnapshot()
    withOrg.putNode({
      id: 'org:1' as never,
      type: 'organisation',
      props: { slug: 'baylor', name: 'Baylor' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    withOrg.putNode({
      id: 'app:1' as never,
      type: 'application',
      props: { slug: 'baylor-cs', role: 'CS', stage: 'draft', note: '', roleTag: 'Assistant Professor' } as never,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    withOrg.putEdge({
      // The id is derived, not invented: the edge indexes key on it.
      id: edgeId('app:1' as never, 'AT', 'org:1' as never),
      rel: 'AT',
      from: 'app:1' as never,
      to: 'org:1' as never,
      props: {},
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(proposalTitle(withOrg, 'application.note.set', { id: 'app:1' })).toBe(
      'Edit note · Baylor — CS',
    )
  })

  it('falls back to the catalog’s verb when the input names nothing', () => {
    expect(proposalTitle(memory, 'application.note.set', {})).toBe('Edit note')
  })

  it('uses what a create calls itself', () => {
    expect(proposalTitle(memory, 'timeline.item.create', { title: 'Follow up with Rice' })).toBe(
      'Add to the timeline · Follow up with Rice',
    )
  })

  it('does not crash on an input that is not an object', () => {
    expect(proposalTitle(memory, 'application.note.set', null)).toBeTruthy()
    expect(proposalTitle(memory, 'unknown.tool', {})).toBe('unknown.tool')
  })
})
