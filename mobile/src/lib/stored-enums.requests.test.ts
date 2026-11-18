/**
 * Review 3, i18n-1, the phone's half: the vault tools named their chips
 * through identity maps (`CATEGORY_LABELS`, `TAG_LABELS`, `BUCKET_LABELS`), so
 * a link's category, a snippet's tag and a file's drawer — and the application
 * sheet's sources — read in English in every language. Each now goes through
 * `domain.<field>(value)` (`kg/core/domain-text.ts`). Read as source: these
 * files import React Native.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8')

describe('stored enum values are shown in the language on screen (i18n-1)', () => {
  it('has no identity label map left in the vault tools', () => {
    for (const file of [
      'screens/vault/LinksTool.tsx',
      'screens/vault/SnippetsTool.tsx',
      'screens/vault/FilesTool.tsx',
    ]) {
      expect(read(file)).not.toMatch(/\.map\(\((\w+)\) => \[\1, \1\]\)/)
    }
  })

  it('names categories, tags and drawers through domain, on chips, filters and menus', () => {
    const links = read('screens/vault/LinksTool.tsx')
    expect(links).toContain('{domain.linkCategory(l.category)}')
    expect(links).toContain('say: domain.linkCategory')
    const snippets = read('screens/vault/SnippetsTool.tsx')
    expect(snippets).toContain('{domain.snippetTag(snippet.tag)}')
    expect(snippets).toContain('say: domain.snippetTag')
    const files = read('screens/vault/FilesTool.tsx')
    expect(files).toContain('{domain.fileBucket(f.bucket)}')
    expect(files).toContain('say: domain.fileBucket')
    expect(read('components/common/recordMenu.ts')).toContain(
      'move.say ? move.say(option) : option',
    )
  })

  it('names sources through domain.source on the sheet, the record and the statistics', () => {
    expect(read('sheets/ApplicationSheet.tsx')).toContain('label: say(s)')
    expect(read('screens/ApplicationDetailScreen.tsx')).toContain('domain.source(a.source)')
    expect(read('screens/StatisticsScreen.tsx')).toContain('{domain.source(source.source)}')
    expect(read('components/statistics/WhatIsWorking.tsx')).toContain(
      'domain.armLabel(dimension, arm.label)',
    )
  })

  it('gives the graph’s detail line the translated value', () => {
    const graph = read('lib/graph.ts')
    expect(graph).toContain('domain.linkCategory(l.category)')
    expect(graph).toContain('domain.snippetTag(s.tag)')
    expect(graph).toContain('domain.fileBucket(f.bucket)')
  })
})
