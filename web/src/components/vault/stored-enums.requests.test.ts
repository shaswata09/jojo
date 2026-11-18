/**
 * Review 3, i18n-1: a link's category, a snippet's tag, an application's
 * source and a file's drawer are stored in English and were printed raw in
 * every language — `すべて 8 | Posting 2 | Institution 2` on the Links chips in
 * Japanese. Each place one is shown now goes through `domain.<field>(value)`
 * (`kg/core/domain-text.ts`), which passes anything off the fixed list through
 * as stored. Read as source: these are components (D20).
 */
import { describe, expect, it } from 'vitest'
import linkRow from './links/LinkRow.tsx?raw'
import linkEditor from './links/LinkEditor.tsx?raw'
import linksTool from './LinksTool.tsx?raw'
import snippetsTool from './SnippetsTool.tsx?raw'
import snippetCard from './snippets/SnippetCard.tsx?raw'
import snippetEditor from './snippets/SnippetEditor.tsx?raw'
import applicationFields from '@/components/applications/dialog/ApplicationFields.tsx?raw'
import sources from '@/components/dashboard/ApplicationSources.tsx?raw'
import working from '@/components/statistics/WhatIsWorking.tsx?raw'
import build from '@/lib/graph/build.ts?raw'

describe('stored enum values are shown in the language on screen (i18n-1)', () => {
  it('names link categories through domain.linkCategory', () => {
    expect(linkRow).toContain('{domain.linkCategory(c)}')
    expect(linkEditor).toContain('{domain.linkCategory(c)}')
    expect(linksTool).toMatch(
      /labels=\{Object\.fromEntries\(LINK_CATEGORIES\.map\(\(c\) => \[c, domain\.linkCategory\(c\)\]\)\)\}/,
    )
    expect(linksTool).toContain(
      "t('links.empty.bucketTitle', { category: domain.linkCategory(bucket) })",
    )
  })

  it('names snippet tags through domain.snippetTag', () => {
    expect(snippetCard).toContain('{domain.snippetTag(tag)}')
    expect(snippetEditor).toContain('label: domain.snippetTag(tag)')
    expect(snippetsTool).toContain('SNIPPET_TAGS.map((tag) => [tag, domain.snippetTag(tag)])')
    expect(snippetsTool).not.toMatch(/\{ tag: (editing|record|copy)\.tag \}/)
  })

  it('names application sources through domain.source, and a comparison’s arms by its dimension', () => {
    expect(applicationFields).toContain('label: say(s)')
    expect(applicationFields).toContain('domain.source)')
    expect(sources).toContain('label: domain.source(s.source)')
    expect(working).toContain('domain.armLabel(dimension, arm.label)')
    expect(working).toContain('domain.armLabel(c.dimension, c.best.label)')
  })

  it('gives the graph’s detail line the translated value, not the stored one', () => {
    expect(build).toContain('detail: domain.linkCategory(node.props.category)')
    expect(build).toContain('detail: domain.fileBucket(node.props.bucket)')
    expect(build).toContain('detail: domain.snippetTag(node.props.tag)')
  })
})
