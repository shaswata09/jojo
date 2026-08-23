import { describe, expect, it } from 'vitest'
import { kindOfFile } from './files'
import type { CaptureEnvelope } from './capture'
import {
  CAPTURE_EXTENSIONS,
  CAPTURE_HREF_ATTR,
  CAPTURE_MAX_BYTES,
  CAPTURE_REJECTION_MESSAGE,
  canonicalPostingUrl,
  captureFileName,
  captureNote,
  hostOf,
  isCaptureSource,
  readCapture,
  remoteRefCount,
} from './capture'

/**
 * The capture trust boundary.
 *
 * Everything here is about one invariant — a stored capture reaches the network
 * never — and the cases are chosen for the ways a serialiser fails QUIETLY.
 * A missing `<script>` strip is loud: the page misbehaves and somebody notices.
 * A surviving `srcset` is silent until a device rotation fetches it, which is
 * not a thing anybody reproduces on purpose.
 */

const envelope = (over: Record<string, unknown> = {}) => ({
  url: 'https://boards.greenhouse.io/acme/jobs/1',
  title: 'Senior Engineer, Inference',
  html: '<html><body><h1>Senior Engineer</h1></body></html>',
  capturedAt: '2026-10-12T09:00:00.000Z',
  dropped: 0,
  ...over,
})

describe('isCaptureSource', () => {
  it('accepts the two schemes a posting can live at', () => {
    expect(isCaptureSource('https://jobs.lever.co/acme/1')).toBe(true)
    expect(isCaptureSource('http://careers.example.org/1')).toBe(true)
  })

  it('refuses the schemes that are code rather than an address', () => {
    // The one that matters: a stored `javascript:` reaching an href is the
    // whole reason this is a declared field rather than a passthrough key.
    expect(isCaptureSource('javascript:alert(1)')).toBe(false)
    expect(isCaptureSource('data:text/html,<h1>hi')).toBe(false)
    expect(isCaptureSource('file:///etc/passwd')).toBe(false)
  })

  it('refuses a bare host — a capture source is never a guess', () => {
    // parse-posting retries these as https, because its job is guessing an
    // application out of pasted text. This is where bytes came from; if it is
    // not already absolute, whatever produced it was not a browser.
    expect(isCaptureSource('boards.greenhouse.io/acme/jobs/1')).toBe(false)
    expect(isCaptureSource('')).toBe(false)
  })
})

describe('remoteRefCount', () => {
  it('counts an http reference the serialiser failed to inline', () => {
    expect(remoteRefCount('<img src="https://cdn.example.com/logo.png">')).toBe(1)
    expect(remoteRefCount("<link href='http://x.test/a.css'>")).toBe(1)
  })

  it('counts a protocol-relative reference, which is the one people forget', () => {
    expect(remoteRefCount('<img src="//cdn.example.com/logo.png">')).toBe(1)
  })

  it('does not count a posting that quotes markup in its own body text', () => {
    // Measured against a fixture. `&lt;img src="…"&gt;` in the source serialises
    // with real quotes, and an unanchored pattern threw the whole capture away
    // over the posting's own words.
    const prose =
      '<p>To embed it write &lt;img src="https://example.com/x.png"&gt; in the body.</p>'
    expect(remoteRefCount(prose)).toBe(0)
  })

  it('does not count prose, and every posting contains prose about URLs', () => {
    const body = '<p>Apply at https://example.com/careers or email us.</p>'
    expect(remoteRefCount(body)).toBe(0)
  })

  it('does not count what inlining produces', () => {
    expect(remoteRefCount('<img src="data:image/png;base64,iVBORw0KGgo=">')).toBe(0)
    expect(remoteRefCount('<iframe src="about:blank">')).toBe(0)
  })

  it('counts a url() inside a style attribute, which attribute-name matching misses', () => {
    // The shape that actually shipped: an early `continue` in the web
    // serialiser skipped the inline-style rewrite for <img>, and this scan
    // reported zero while a live CDN address sat in the stored file.
    expect(
      remoteRefCount('<img src="data:," style="background: url(https://cdn.test/x.png)">'),
    ).toBe(1)
    expect(remoteRefCount('<div style="background:url(\'//cdn.test/x.png\')"></div>')).toBe(1)
  })

  it('counts a url() inside a style block', () => {
    expect(remoteRefCount('<style>@font-face{src:url("https://cdn.test/f.woff2")}</style>')).toBe(1)
  })

  it('still does not count an inlined url()', () => {
    expect(remoteRefCount('<style>.a{background:url("data:image/png;base64,iVBO")}</style>')).toBe(
      0,
    )
  })

  it('counts a bare @import, which has no url( and no attribute', () => {
    // The one that got through. The walk sanitises imports it can see in the
    // page's own <style> blocks; a stylesheet FETCHED by the inliner could carry
    // its own `@import "https://…"`, which reached a stored capture untouched
    // and was fetched by the viewer on every open.
    expect(remoteRefCount('<style>@import "https://cdn.test/x.css";</style>')).toBe(1)
    expect(remoteRefCount("<style>@import url('https://cdn.test/x.css');</style>")).toBe(1)
    expect(remoteRefCount('<style>@import url(https://cdn.test/x.css);</style>')).toBe(1)
    expect(remoteRefCount('<style>@import "//cdn.test/x.css";</style>')).toBe(1)
  })

  it('does not count an @import the pipeline already resolved', () => {
    expect(remoteRefCount('<style>@import "data:text/css,a{}";</style>')).toBe(0)
    expect(remoteRefCount('<style>@import url("__JOJO_ASSET_0__");</style>')).toBe(0)
  })

  it('counts a surviving anchor href, because a click inside the frame is a fetch', () => {
    // The sandbox stops scripts, popups and top navigation. It does not stop a
    // click navigating the frame itself, so a live href in an archive is one
    // click from a request to the company the capture is about.
    expect(remoteRefCount('<a href="https://acme.test/apply">Apply now</a>')).toBe(1)
  })

  it('does not count an anchor the serialiser rewrote', () => {
    const rewritten = `<a ${CAPTURE_HREF_ATTR}="https://acme.test/apply">Apply now</a>`
    expect(remoteRefCount(rewritten)).toBe(0)
  })
})

describe('readCapture', () => {
  it('returns the envelope when the serialiser did its job', () => {
    const read = readCapture(envelope())
    expect(read).toMatchObject({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      title: 'Senior Engineer, Inference',
      dropped: 0,
    })
  })

  it('refuses anything that is not an envelope at all', () => {
    expect(readCapture(null)).toBe('not-a-page')
    expect(readCapture('<html>')).toBe('not-a-page')
    expect(readCapture(envelope({ html: 42 }))).toBe('not-a-page')
  })

  it('refuses a source that is not http(s)', () => {
    expect(readCapture(envelope({ url: 'javascript:alert(1)' }))).toBe('bad-source')
  })

  it('refuses an empty document — a page that had not finished loading', () => {
    expect(readCapture(envelope({ html: '   ' }))).toBe('empty')
  })

  it('refuses a capture that still points at the site it came from', () => {
    const leaky = envelope({ html: '<img src="https://cdn.example.com/px.gif">' })
    expect(readCapture(leaky)).toBe('leaks')
  })

  it('checks size before scanning, so a huge string never reaches the regex', () => {
    const huge = envelope({ html: 'x'.repeat(CAPTURE_MAX_BYTES + 1) })
    expect(readCapture(huge)).toBe('too-large')
  })

  it('counts UTF-8 bytes rather than code units for the cap', () => {
    // Four bytes each, so a quarter of the cap in CHARACTERS is exactly the cap
    // in bytes — half that in `.length`, which is what a code-unit count would
    // have measured and waved through.
    const atCap = '🙂'.repeat(CAPTURE_MAX_BYTES / 4)
    expect(typeof readCapture(envelope({ html: atCap }))).toBe('object')

    const overCap = `${atCap}🙂`
    expect(readCapture(envelope({ html: overCap }))).toBe('too-large')
  })

  it('normalises a missing or nonsense dropped count rather than trusting it', () => {
    expect(readCapture(envelope({ dropped: undefined }))).toMatchObject({ dropped: 0 })
    expect(readCapture(envelope({ dropped: -3 }))).toMatchObject({ dropped: 0 })
    expect(readCapture(envelope({ dropped: Number.NaN }))).toMatchObject({ dropped: 0 })
  })

  it('has a written sentence for every rejection', () => {
    for (const reason of ['not-a-page', 'bad-source', 'empty', 'too-large', 'leaks'] as const) {
      expect(CAPTURE_REJECTION_MESSAGE[reason].length).toBeGreaterThan(0)
    }
  })
})

describe('captureFileName', () => {
  it('reads as the posting did, with the day it was taken', () => {
    expect(captureFileName('https://x.test/1', 'Senior Engineer, Inference', '2026-10-12')).toBe(
      'Senior-Engineer-Inference-2026-10-12.html',
    )
  })

  it('falls back to the host, because a title is not guaranteed', () => {
    expect(captureFileName('https://www.workday.com/job/123', '', '2026-10-12')).toBe(
      'wwwworkdaycom-2026-10-12.html',
    )
  })

  it('drops path separators and anything else a filename cannot carry', () => {
    const name = captureFileName('https://x.test/1', 'R&D / ML — "lead"', '2026-10-12')
    expect(name).toBe('RD-ML-lead-2026-10-12.html')
    expect(name).not.toMatch(/[/\\"&]/)
  })

  it('caps the stem so a list stays readable', () => {
    const name = captureFileName('https://x.test/1', 'a'.repeat(200), '2026-10-12')
    expect(name.length).toBeLessThanOrEqual(60 + '-2026-10-12.html'.length)
  })

  it('never produces a name that is only a date', () => {
    expect(captureFileName('https://x.test/1', '中', '2026-10-12')).not.toBe('-2026-10-12.html')
    expect(captureFileName('not a url', '!!!', '2026-10-12')).toBe('posting-2026-10-12.html')
  })
})

describe('hostOf', () => {
  it('names the site', () => {
    expect(hostOf('https://boards.greenhouse.io/acme/jobs/1')).toBe('boards.greenhouse.io')
  })

  it('answers rather than throwing for something that is not a URL', () => {
    expect(hostOf('nonsense')).toBe('posting')
  })
})

describe('canonicalPostingUrl', () => {
  it('leaves a LinkedIn job URL that already works alone', () => {
    expect(canonicalPostingUrl('https://www.linkedin.com/jobs/view/4378357766/')).toBe(
      'https://www.linkedin.com/jobs/view/4378357766/',
    )
  })

  it('rewrites the job-alert email shape, which redirects to the login wall', () => {
    // Measured: /comm/jobs/view/<id> 302s to /uas/login, while /jobs/view/<id>
    // serves the whole description signed out.
    expect(canonicalPostingUrl('https://www.linkedin.com/comm/jobs/view/4378357766')).toBe(
      'https://www.linkedin.com/jobs/view/4378357766/',
    )
  })

  it('rewrites the app share shape, which redirects too', () => {
    expect(
      canonicalPostingUrl(
        'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4378357766',
      ),
    ).toBe('https://www.linkedin.com/jobs/view/4378357766/')
  })

  it('takes the id off a slugged URL rather than being confused by the slug', () => {
    expect(
      canonicalPostingUrl(
        'https://www.linkedin.com/jobs/view/software-engineer-at-nuvo-4378357766',
      ),
    ).toBe('https://www.linkedin.com/jobs/view/4378357766/')
  })

  it('touches nothing on any other board', () => {
    // Deliberately narrow: Greenhouse and Workday put identity in the path, but
    // smaller boards use `?id=`, and a generic tracking-param strip would
    // eventually throw away the posting itself.
    for (const url of [
      'https://job-boards.greenhouse.io/anthropic/jobs/5390799008',
      'https://jobs.lever.co/matchgroup/1deea0b0?lever-source=X',
      'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/x?currentJobId=9',
    ]) {
      expect(canonicalPostingUrl(url)).toBe(url)
    }
  })

  it('answers rather than throwing for something that is not a URL', () => {
    expect(canonicalPostingUrl('nonsense')).toBe('nonsense')
  })
})

describe('shadowRoots and the note', () => {
  it('carries a shadow-root count through the trust boundary', () => {
    // Both serialisers send one and `readCapture` used to drop it, so the count
    // was computed on every capture and read by nothing.
    const read = readCapture(envelope({ shadowRoots: 3 }))
    expect(read).toMatchObject({ shadowRoots: 3 })
  })

  it('defaults the count rather than trusting what arrived', () => {
    expect(readCapture(envelope({ shadowRoots: undefined }))).toMatchObject({ shadowRoots: 0 })
    expect(readCapture(envelope({ shadowRoots: -2 }))).toMatchObject({ shadowRoots: 0 })
    expect(readCapture(envelope({ shadowRoots: 'lots' }))).toMatchObject({ shadowRoots: 0 })
  })

  it('says only what happened', () => {
    const clean = readCapture(envelope())
    expect(typeof clean).toBe('object')
    expect(captureNote(clean as CaptureEnvelope)).toBe('Captured from boards.greenhouse.io')
  })

  it('names both kinds of loss, and pluralises each', () => {
    const lossy = readCapture(envelope({ dropped: 1, shadowRoots: 2 })) as CaptureEnvelope
    expect(captureNote(lossy)).toBe(
      'Captured from boards.greenhouse.io · 1 asset could not be kept · 2 parts of the page could not be copied',
    )
  })
})

describe('CAPTURE_EXTENSIONS and kindOfFile', () => {
  it('agree, without one importing the other', () => {
    // The comment on CAPTURE_EXTENSIONS says the two lists are checked against
    // each other rather than shared, because collapsing them would put a
    // capture concern inside a map thirty unrelated extensions live in. This is
    // that check — without it the claim is decoration.
    for (const ext of CAPTURE_EXTENSIONS) {
      expect(kindOfFile(`posting.${ext}`)).toBe('page')
    }
  })

  it('does not claim an extension that means something else', () => {
    expect(kindOfFile('cv.pdf')).toBe('pdf')
    expect(kindOfFile('notes.md')).toBe('note')
  })
})

describe('canonicalising the four boards the scout reads', () => {
  /*
   * These were added when the scout started reading search-results pages, which
   * is what makes them load-bearing rather than tidy: a results page attaches
   * its own tracking to every row, so the same job reached from a search and
   * from a saved link read as two different jobs and the scout proposed it
   * twice. Every pair below is one job under two real spellings.
   */
  const same = (a: string, b: string) =>
    expect(canonicalPostingUrl(a)).toBe(canonicalPostingUrl(b))

  it('folds Greenhouse’s two live hostnames and its search tracking', () => {
    same(
      'https://boards.greenhouse.io/anthropic/jobs/5390799008',
      'https://job-boards.greenhouse.io/anthropic/jobs/5390799008?gh_src=abc123',
    )
    expect(canonicalPostingUrl('https://boards.greenhouse.io/anthropic/jobs/5390799008')).toBe(
      'https://job-boards.greenhouse.io/anthropic/jobs/5390799008',
    )
  })

  it('keeps two different Greenhouse jobs apart', () => {
    expect(canonicalPostingUrl('https://job-boards.greenhouse.io/acme/jobs/1')).not.toBe(
      canonicalPostingUrl('https://job-boards.greenhouse.io/acme/jobs/2'),
    )
  })

  it('reads Lever’s /apply as the same job with the form open', () => {
    same(
      'https://jobs.lever.co/matchgroup/1deea0b0-9f37-4f2a-b8c1-0d4e5f6a7b8c',
      'https://jobs.lever.co/matchgroup/1deea0b0-9f37-4f2a-b8c1-0d4e5f6a7b8c/apply?lever-source=LinkedIn',
    )
  })

  it('reads Ashby’s /application the same way', () => {
    same(
      'https://jobs.ashbyhq.com/openai/6ba0a5e0-3a1f-4c2b-9d8e-1f2a3b4c5d6e',
      'https://jobs.ashbyhq.com/openai/6ba0a5e0-3a1f-4c2b-9d8e-1f2a3b4c5d6e/application?utm_source=x',
    )
  })

  /*
   * Workday's own site structure changes between /job/<location>/<slug>_<REQ>
   * and /details/<slug>_<REQ> for one posting. The req is unique within a
   * tenant and the tenant is the hostname, so everything between them is
   * decoration.
   */
  it('reduces Workday to its tenant and its requisition number', () => {
    same(
      'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Software-Engineer_JR1988734',
      'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/details/Senior-Software-Engineer_JR1988734?source=LinkedIn',
    )
    expect(
      canonicalPostingUrl(
        'https://nvidia.wd5.myworkdayjobs.com/en-US/Site/job/Loc/Engineer_JR1988734',
      ),
    ).toBe('https://nvidia.wd5.myworkdayjobs.com/JR1988734')
  })

  it('keeps two tenants apart even at the same requisition number', () => {
    expect(
      canonicalPostingUrl('https://a.wd5.myworkdayjobs.com/en-US/S/job/L/E_JR1'),
    ).not.toBe(canonicalPostingUrl('https://b.wd5.myworkdayjobs.com/en-US/S/job/L/E_JR1'))
  })

  /*
   * The philosophy the file states, held as a test: a board this does not
   * recognise is returned untouched rather than tidied, because plenty of
   * smaller boards put the posting's identity in a query parameter.
   */
  it('leaves a board it does not recognise exactly as it found it', () => {
    const odd = 'https://jobs.example.test/listing?id=99&utm_source=x#top'
    expect(canonicalPostingUrl(odd)).toBe(odd)
  })

  it('leaves a board’s own index page alone rather than inventing an id', () => {
    expect(canonicalPostingUrl('https://jobs.lever.co/matchgroup')).toBe(
      'https://jobs.lever.co/matchgroup',
    )
    expect(canonicalPostingUrl('https://job-boards.greenhouse.io/anthropic')).toBe(
      'https://job-boards.greenhouse.io/anthropic',
    )
  })
})
