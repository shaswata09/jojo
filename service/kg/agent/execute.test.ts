/**
 * Turning a tool's outcome back into something a person can read.
 *
 * `renderOutcome` writes one string that carries two completely different
 * things depending on the tool's effect, and `readStepDetail` is what tells
 * them apart again for the trace. The tests that matter here are the ones about
 * the boundary between them, and about the truncated case — which is where a
 * naive "try JSON.parse and see" gets it exactly backwards.
 */

import { describe, expect, it } from 'vitest'
import { entryFor } from './catalog'
import { callTool, readStepDetail, renderOutcome } from './execute'
import { CONTEXT_BUDGET, pageNote, pageOf } from './paging'

describe('reading a step’s result back', () => {
  /*
   * `detail` is one string carrying two different things, because
   * `renderOutcome` branches on effect. The trace was rendering both as the
   * same wall of monospace, which for a read of forty records is one
   * 6000-character line.
   */
  it('parses a read’s result, which is machine data', () => {
    const out = readStepDetail({ effect: 'read', status: 'done', detail: '[{"id":"app:1"}]' })
    expect(out).toEqual({ kind: 'json', value: [{ id: 'app:1' }], truncated: false })
  })

  it('leaves a write’s result as the sentence it is', () => {
    const said = 'Added Rice — Senior Engineer (id: app:1)'
    expect(readStepDetail({ effect: 'create', status: 'done', detail: said })).toEqual({
      kind: 'text',
      value: said,
    })
  })

  /*
   * The trap a try/catch sniffer falls into: the banner is appended OUTSIDE the
   * JSON, so the longest results — the only ones anybody needs help reading —
   * are exactly the ones that will not parse.
   */
  it('does not choke on a truncated read', () => {
    const long = renderOutcome(
      { ok: true, entry: { effect: 'read' } as never, result: Array.from({ length: 400 }, (_, i) => ({ n: i })) },
      200,
    )
    const out = readStepDetail({ effect: 'read', status: 'done', detail: long })
    expect(out?.kind).toBe('text')
    expect((out as { value: string }).value).toContain('[Truncated at 200 characters')
  })

  it('never parses a failed or declined step, whatever it starts with', () => {
    expect(readStepDetail({ effect: 'read', status: 'failed', detail: '{"a":1}' })).toEqual({
      kind: 'text',
      value: '{"a":1}',
    })
    expect(readStepDetail({ effect: 'read', status: 'declined', detail: '{}' })?.kind).toBe('text')
  })

  it('has nothing to say about a step with no detail', () => {
    expect(readStepDetail({ effect: 'read', status: 'done' })).toBeNull()
    expect(readStepDetail({ effect: 'read', status: 'done', detail: '' })).toBeNull()
  })
})

/*
 * The cut, applied to a read that had already cut itself.
 *
 * `vault.file.read` hands back one `pageOf` window — CONTEXT_BUDGET characters
 * of Markdown with a note naming the offset to call back with. `renderOutcome`
 * then cut the whole thing at 6,000, which is half a window, so a 12,136
 * character page reached the model as 6,087 and the note at the END of it went
 * with the half that was thrown away. The note is the only thing telling the
 * model more exists; without it a model concludes it cannot read further and
 * asks the person to paste the rest, which is the exact failure `paging.ts`
 * was written to end.
 */
describe('a read that already paged itself', () => {
  // Built with the real pager rather than a string of the right length: the
  // property under test is that these two cuts do not compose, so both have to
  // be the ones that ship.
  const document = 'A line of a document, long enough to be prose.\n'.repeat(2_000)
  const page = pageOf(document, 0)
  const result = {
    ok: true,
    name: 'CV-2026.pdf',
    markdown: page.text + pageNote(page, 'file:01H'),
    from: page.from,
    next: page.next,
    total: page.total,
  }
  const outcome = { ok: true, entry: entryFor('vault.file.read')!, result } as const

  it('reaches the model whole, note and all', () => {
    expect(page.next).not.toBeNull()
    expect(page.text.length).toBeGreaterThan(6_000)

    const text = renderOutcome(outcome)
    expect(text).toBe(JSON.stringify(result))
    expect(text).not.toContain('[Truncated at')
    // The sentence that makes the next call possible.
    expect(text).toContain('THE DOCUMENT CONTINUES')
    expect(text).toContain(`from ${String(page.next)}`)
  })

  it('is still bounded — the exemption is a bigger ceiling, not none', () => {
    // JSON escaping can at worst double a run of text, so the ceiling is twice
    // the pager's window. Real Markdown inflates about 4%.
    expect(renderOutcome(outcome).length).toBeLessThanOrEqual(CONTEXT_BUDGET * 2)
  })

  it('does not lift the cut for a read whose size nothing else bounds', () => {
    // Guards the guard: an exemption that leaked to every read would give a
    // `memory.list` over a full store the run of the window.
    const rows = Array.from({ length: 400 }, (_, i) => ({ id: `app:${String(i)}`, org: 'Org' }))
    const text = renderOutcome({ ok: true, entry: entryFor('memory.list')!, result: rows })
    expect(text).toContain('[Truncated at 6000 characters')
  })
})

describe('what a write hands back to the model', () => {
  const wrote = (result: unknown) =>
    renderOutcome({
      ok: true,
      entry: { effect: 'create' } as never,
      result,
      announcement: { title: 'Saved' },
    })

  it('names one id', () => {
    expect(wrote('note:0193c')).toBe('Saved (id: note:0193c)')
  })

  /*
   * `vault.file.add` returns a list and `profile.background.add` returns
   * `{ ids, created }`; both used to come back with no id at all, so the model
   * had just made records it could not name.
   */
  it('names every id a write returned as a list or inside an object', () => {
    expect(wrote(['file:1', 'file:2'])).toBe('Saved (ids: file:1, file:2)')
    expect(wrote({ ids: ['background:1', 'background:2'], created: 2 })).toBe(
      'Saved (ids: background:1, background:2)',
    )
  })

  /* A snooze returns the date it moved to, which was labelled `id:`. */
  it('does not call a date an id', () => {
    const said = wrote('2026-11-20')
    expect(said).not.toContain('id:')
    expect(said).toContain('2026-11-20')
  })
})

describe('a call that throws', () => {
  const base = {
    memory: () => ({}) as never,
    today: () => '2026-10-12',
    check: () => ({ ok: true as const, value: {} }),
  }

  /*
   * `callTool` promises never to throw. A read awaits the app's own network
   * code and a write can rethrow a non-`ToolFailure`; either used to end the
   * turn with the step stuck at `running`.
   */
  it('turns a thrown write into a result the model can read', async () => {
    const out = await callTool(
      {
        ...base,
        run: () => {
          throw new Error('disk full')
        },
      },
      'sticky.note.create',
      { text: 'x' },
    )
    expect(out.ok).toBe(false)
    expect((out as { error: string }).error).toContain('disk full')
  })

  it('turns a thrown read into a result the model can read', async () => {
    const out = await callTool(
      {
        ...base,
        memory: () => ({ node: () => ({ id: 'file:1', type: 'file', props: { name: 'CV' } }) }) as never,
        run: () => ({ ok: false as const, errors: [] }),
        convert: () => Promise.reject(new Error('reader offline')),
      },
      'vault.file.read',
      { id: 'file:0192f4c1-7b3e-7a41-9c2d-8f5e1a0b6d33' },
    )
    expect(out.ok).toBe(false)
    expect((out as { error: string }).error).toContain('reader offline')
  })
})
