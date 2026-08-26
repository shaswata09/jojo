import { describe, expect, it } from 'vitest'
import { pageNote, pageOf } from './paging'

describe('reading a document longer than one window', () => {
  /**
   * The failure this fixes, in the words the user got back:
   *
   *   "it is being truncated after the first page … the only way I can access
   *    the rest of your CV is if you upload the full file again or paste the
   *    text of those pages here."
   *
   * The model was right. `trimForModel` cut at the budget and said so, and
   * `vault.file.read` took an id and nothing else — so there was no call that
   * could have reached page two. A three-page CV was a one-page CV, and what
   * went missing was the publications.
   */
  const doc = (chars: number, mark = 'x') => mark.repeat(chars)

  it('returns the whole thing when it fits', () => {
    const page = pageOf(doc(500), 0, 12_000)
    expect(page.text).toHaveLength(500)
    expect(page.next).toBeNull()
    expect(page.total).toBe(500)
  })

  it('hands back a window and where the next one starts', () => {
    const page = pageOf(doc(30_000), 0, 12_000)
    expect(page.from).toBe(0)
    expect(page.next).toBe(12_000)
    expect(page.total).toBe(30_000)
    expect(page.text).toHaveLength(12_000)
  })

  it('reads a three-window document to the end, one call at a time', () => {
    // The whole point: following `next` has to terminate, and has to cover every
    // character exactly once.
    const whole = [...Array(30_000)].map((_, i) => String.fromCharCode(97 + (i % 26))).join('')
    let from: number | null = 0
    let seen = ''
    let calls = 0
    while (from !== null) {
      const page: ReturnType<typeof pageOf> = pageOf(whole, from, 12_000)
      seen += page.text
      from = page.next
      calls += 1
      expect(calls).toBeLessThan(10)
    }
    expect(seen).toBe(whole)
    expect(calls).toBe(3)
  })

  it('cuts on a line break rather than mid-sentence', () => {
    const lines = [...Array(400)].map((_, i) => `Line ${String(i)}: ${'y'.repeat(40)}`).join('\n')
    const page = pageOf(lines, 0, 12_000)
    expect(page.next).not.toBeNull()
    // The window ends where a line ends, so the model never reads half a row.
    expect(page.text.endsWith('\n') || !lines[page.next ?? 0]?.match(/\S/)).toBe(true)
    expect(lines.slice(page.next ?? 0, (page.next ?? 0) + 1)).toBe('\n')
  })

  it('takes the hard boundary when there is no line break to fall back on', () => {
    const page = pageOf(doc(30_000), 0, 12_000)
    expect(page.next).toBe(12_000)
  })

  it('clamps an offset past the end rather than throwing', () => {
    const page = pageOf(doc(100), 5_000, 12_000)
    expect(page.text).toBe('')
    expect(page.next).toBeNull()
  })
})

describe('what the model is told about a partial document', () => {
  it('names the exact call that reads the next part', () => {
    const note = pageNote(pageOf('z'.repeat(30_000), 0, 12_000), 'file:01H')
    expect(note).toContain('vault.file.read')
    expect(note).toContain('file:01H')
    expect(note).toContain('from 12000')
    // The instruction that stops it asking the person to paste the rest.
    expect(note).toContain('Do not ask the person to paste')
  })

  it('says so when the end has been reached', () => {
    const last = pageOf('z'.repeat(20_000), 12_000, 12_000)
    expect(last.next).toBeNull()
    expect(pageNote(last, 'file:01H')).toContain('End of the document')
  })

  it('adds nothing to a document that always fitted', () => {
    expect(pageNote(pageOf('short', 0, 12_000), 'file:01H')).toBe('')
  })
})
