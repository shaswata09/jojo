/**
 * Owner requests about the tailored materials on an application:
 * - Q254: they show as cards without their content, and Preview opens the
 *   snippet preview dialog;
 * - Q257: a card's description sits on a second row of its own, not squeezed
 *   under the title beside the buttons.
 *
 * JSX-only decisions, so D20 leaves a narrow source read of `TailoredCard`.
 */

import { describe, expect, it } from 'vitest'
import panel from './TailoredPanel.tsx?raw'
import en from '@/i18n/locales/en/applications.json'

const card = /function TailoredCard\([\s\S]*$/.exec(panel)?.[0] ?? ''

describe('Q254 — tailored materials are cards, previewed in a dialog', () => {
  it('found the card', () => {
    expect(card).not.toBe('')
  })

  it('never prints the tailored body on the card', () => {
    expect(card).not.toMatch(/\bs\.body\b/)
  })

  it('opens the snippet from a Preview button and from the title', () => {
    expect(card).toMatch(
      /onClick=\{onPreview\}\s*aria-label=\{t\('filed\.previewName', \{ name: s\.title \}\)\}\s*>\s*\{t\('common\.preview'\)\}/,
    )
    expect(en.filed.previewName).toBe('Preview {{name}}')
    expect(en.common.preview).toBe('Preview')
    expect(card).toMatch(/<button\s+type="button"\s+onClick=\{onPreview\}/)
  })

  it('previews in the snippet preview dialog', () => {
    expect(panel).toContain('onPreview={() => setPreviewing(s.id)}')
    expect(panel).toMatch(/<SnippetPreviewDialog\s+snippet=\{preview && asPreview\(preview\)\}/)
  })
})

describe('Q257 — the description is a second row of its own', () => {
  it('puts the provenance line after the title row closes, as the card’s own row', () => {
    const titleRowEnd = card.indexOf('</RowMenu>')
    const description = card.indexOf("{t('tailored.provenance', {")
    expect(titleRowEnd).toBeGreaterThan(0)
    expect(description).toBeGreaterThan(titleRowEnd)
    // A paragraph directly in the card, the full width of it.
    expect(card).toMatch(
      /<\/div>\s*<\/div>\s*\{\/\*[\s\S]*?\*\/\}\s*<p className="mt-1 truncate text-xs text-text-3">\s*\{t\('tailored\.provenance', \{\s*tag: s\.tag/,
    )
    expect(en.tailored.provenance).toBe('{{tag}} · from {{from}} · {{model}}')
  })
})

describe('the tailoring chooser in another language (review 3: i18n-2)', () => {
  it('names each document by its translated kind, not core’s English label', () => {
    expect(panel).toMatch(/sentenceStart\(domain\.document\(c\.kind\), i18n\.language\)/)
    expect(panel).not.toMatch(/c\.label\.charAt\(0\)/)
    expect(panel).toMatch(/word\.charAt\(0\)\.toLocaleUpperCase\(language\)/)
  })
})
