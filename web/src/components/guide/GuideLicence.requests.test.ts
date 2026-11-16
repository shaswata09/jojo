import { describe, expect, it } from 'vitest'
import { STATUS_HEADLINE, STATUS_POINTS, STATUS_SUMMARY } from '@jojo/service/core/status'
import { GUIDE_PAGES, guidePath } from '@/lib/links'
import appSource from '@/App.tsx?raw'
import pageSource from './GuideLicence.tsx?raw'

/**
 * The guide's Licence page — what the owner asked it to say (Q187, Q227, Q231).
 *
 * D20 rules out mounting it, and most of what it says is prose that is free to
 * be reworded. What is pinned is what the requests named: that the page exists
 * at its own address, that it names the licence and the free use, that the
 * third parties the owner listed each get their disclaimer, and that the
 * research-preview notice — work in progress, research and testing, copying,
 * liability — is rendered from the shared module rather than retyped.
 */

/** The JSX with its comments removed, so a sentence that survives only in a comment does not count. */
const page = pageSource.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
/** Rendered text runs together across lines and `{' '}` joins; this is the shape to search. */
const prose = page.replace(/\{' '\}/g, ' ').replace(/\s+/g, ' ')

describe('Q187: the Licence page', () => {
  it('is a guide page of its own, at /guide/licence', () => {
    expect(GUIDE_PAGES).toContain('licence')
    expect(guidePath('licence')).toBe('/guide/licence')
    expect(appSource).toMatch(/<Route path="licence" element=\{<GuideLicence \/>\} \/>/)
  })

  it('states the open-source licence and that use is free', () => {
    expect(prose).toContain('jojo is open source under the Apache License 2.0')
    expect(prose).toContain('There is no fee')
  })

  it('carries a disclaimer for NVIDIA, Microsoft and the other third parties', () => {
    expect(prose).toContain('title="NVIDIA (build.nvidia.com)"')
    expect(prose).toContain('title="MarkItDown (Microsoft)"')
    expect(prose).toContain('title="Anthropic · OpenAI · OpenRouter · Groq"')
    expect(prose).toMatch(
      /not endorsed by, sponsored by or affiliated with NVIDIA, Microsoft, Anthropic, OpenAI, Groq or OpenRouter\./,
    )
  })
})

describe('Q227: the page says Apache-2.0', () => {
  it('names Apache-2.0 in its subtitle and its own-licence heading', () => {
    expect(prose).toMatch(/subtitle="jojo is a research preview under Apache-2\.0\./)
    expect(prose).toMatch(/hint="Apache-2\.0 · free for any use, including commercial"/)
  })
})

describe('Q231: the research-preview notice heads the page', () => {
  it('renders the shared notice, headline, summary and every point', () => {
    expect(page).toContain('{STATUS_HEADLINE}')
    expect(page).toContain('{STATUS_SUMMARY}')
    expect(page).toMatch(/STATUS_POINTS\.map\(/)
    // First on the page: above the licence it qualifies.
    expect(page.indexOf('{STATUS_HEADLINE}')).toBeLessThan(page.indexOf('jojo’s own licence'))
  })

  it('says work in progress, research and testing, asks against redistribution, and disclaims liability', () => {
    expect(STATUS_HEADLINE.toLowerCase()).toContain('work in progress')
    const byLabel = new Map(STATUS_POINTS.map((p) => [p.label, p.body]))
    expect(byLabel.has('For research and testing')).toBe(true)
    expect(STATUS_SUMMARY).toContain('research')
    expect(byLabel.get('Copying and distribution')).toMatch(/we ask is that you do not pass it on/)
    expect(byLabel.get('No warranty, and no liability')).toMatch(/no liability for any loss/)
  })
})
