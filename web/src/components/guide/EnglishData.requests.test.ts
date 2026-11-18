import { describe, expect, it } from 'vitest'
import pageSource from './GuideTools.tsx?raw'
import dataSource from './EnglishData.tsx?raw'
import benchSource from './ToolBenchTable.tsx?raw'
import evalSource from './ToolEvalTable.tsx?raw'
import reasoningSource from './ReasoningTables.tsx?raw'
import explorerSource from './BenchExplorer.tsx?raw'

/**
 * Review round 3 (i18n-7): the benchmark tables on the translated Guide → Tools
 * page stay English — they report what was run, in the words it ran in — and
 * say so in the reader's language, marked `lang="en"` for assistive tech.
 */

const strip = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

describe('the benchmark tables on Guide → Tools (i18n-7)', () => {
  it('sit inside an English block that says why, on every table', () => {
    const page = strip(pageSource)
    for (const table of ['ToolEvalTable', 'ToolBenchTable', 'ReasoningTables', 'BenchExplorer']) {
      expect(page).toMatch(new RegExp(`<EnglishData>\\s*<${table} />\\s*</EnglishData>`))
    }
    const block = strip(dataSource)
    expect(block).toMatch(/<div lang="en">\{children\}<\/div>/)
    expect(block).toMatch(/\{t\('englishData'\)\}/)
  })

  it('formats their numbers and dates as English, not the browser’s default', () => {
    for (const source of [benchSource, evalSource, reasoningSource, explorerSource]) {
      expect(strip(source)).not.toMatch(/toLocale(Date)?String\(\)/)
    }
  })
})
