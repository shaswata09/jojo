/**
 * Q123: the category chips with counts keep their shape while a snippet is
 * being edited.
 *
 * Opening the editor narrows the list panel beside it, and the chips used to
 * compress below their content and break inside themselves — "Cover letter"
 * over two lines with its count underneath. The fix is two classes on the chip
 * and a wrapping row around them, which only exist in JSX (D20), so they are
 * pinned as source. The Snippets tab is checked to be using this component, so
 * the fix reaches the screen it was asked for.
 */

import { describe, expect, it } from 'vitest'
import filterSource from './BucketFilter.tsx?raw'
import snippetsSource from '@/components/vault/SnippetsTool.tsx?raw'
import vaultEn from '@/i18n/locales/en/vault.json'

const strip = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

const code = strip(filterSource)

describe('a count chip keeps its shape (Q123)', () => {
  it('neither shrinks nor wraps inside itself', () => {
    const chip = code.slice(code.indexOf('const chip ='), code.indexOf('return ('))
    expect(chip).toContain("'shrink-0 whitespace-nowrap'")
  })

  it('wraps between chips instead, in a row that may run onto a second line', () => {
    expect(code).toMatch(/<div role="radiogroup"[^>]*className="[^"]*\bflex-wrap\b/)
  })

  it('is the filter the Snippets tab draws its kinds with', () => {
    expect(strip(snippetsSource)).toMatch(/<BucketFilter\s+label=\{t\('snippets\.filterLabel'\)\}/)
    expect(vaultEn.snippets.filterLabel).toBe('Filter snippets by kind')
  })
})
