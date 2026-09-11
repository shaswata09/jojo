import { describe, expect, it } from 'vitest'
// @ts-expect-error — a plain ES module loaded from disk by the browser, with no
// types of its own. Imported for its behaviour. See `web/extension/save-file.js`.
import { asFile, fileNameFor } from '../../extension/save-file.js'

type Kept = { url?: string; title?: string; capturedAt?: string; html?: string }
const file = asFile as (k: Kept) => string
const name = fileNameFor as (k: Kept) => string

const KEPT: Kept = {
  url: 'https://boards.example.com/jobs/4711',
  title: 'Senior ML Engineer',
  capturedAt: '2026-09-11T06:31:10.680Z',
  html: '<!doctype html><html><head><title>t</title></head><body><p>posting</p></body></html>',
}

describe('the saved file', () => {
  it('keeps the page and names where and when it came from', () => {
    const out = file(KEPT)
    expect(out).toContain('<p>posting</p>')
    expect(out).toContain('https://boards.example.com/jobs/4711')
    expect(out).toContain('2026-09-11T06:31:10.680Z')
  })

  it('puts the comment after an existing doctype, and does not add a second', () => {
    const out = file(KEPT)
    expect(out.startsWith('<!doctype html>\n<!-- Saved by the jojo extension')).toBe(true)
    expect(out.match(/<!doctype/gi)).toHaveLength(1)
  })

  it('adds a doctype when the page has none, so it does not open in quirks mode', () => {
    const out = file({ ...KEPT, html: '<html><body><p>posting</p></body></html>' })
    expect(out.startsWith('<!doctype html>\n<!--')).toBe(true)
  })

  it('cannot have its comment closed early by the address', () => {
    /*
     * An HTML comment cannot contain `--`, and an address carrying `-->` would
     * end it and spill the rest of the sentence into the saved page as visible
     * text. The comment must end exactly once, where it is meant to.
     */
    const out = file({ ...KEPT, url: 'https://evil.example/a--b-->injected<script>' })
    const comment = out.slice(out.indexOf('<!--'), out.indexOf('<html'))
    expect(comment.match(/-->/g)).toHaveLength(1)
    expect(comment.trimEnd().endsWith('-->')).toBe(true)
  })
})

describe('the file name', () => {
  it('is the title and the day it was kept', () => {
    expect(name(KEPT)).toBe('senior-ml-engineer-2026-09-11.html')
  })

  it('folds accents rather than dropping the letters', () => {
    expect(name({ ...KEPT, title: 'Ingénieur Données — Zürich' })).toBe(
      'ingenieur-donnees-zurich-2026-09-11.html',
    )
  })

  it('falls back to the host, then to a plain name', () => {
    expect(name({ ...KEPT, title: '' })).toBe('boards-example-com-2026-09-11.html')
    expect(name({ ...KEPT, title: '', url: 'not a url' })).toBe('kept-page-2026-09-11.html')
    expect(name({ title: '🚀🚀' })).toBe('kept-page.html')
  })

  it('stays safe on every filesystem', () => {
    const n = name({ ...KEPT, title: 'a/b\\c:d*e?f"g<h>i|j' })
    expect(n).toMatch(/^[a-z0-9-]+\.html$/)
  })

  it('caps a very long title without leaving a trailing dash', () => {
    const n = name({ ...KEPT, title: `${'word '.repeat(60)}end` })
    const stem = n.replace(/-2026-09-11\.html$/, '')
    expect(stem.length).toBeLessThanOrEqual(80)
    expect(stem.endsWith('-')).toBe(false)
  })

  it('leaves the date off when it is not a date', () => {
    expect(name({ ...KEPT, capturedAt: 'yesterday' })).toBe('senior-ml-engineer.html')
  })
})
