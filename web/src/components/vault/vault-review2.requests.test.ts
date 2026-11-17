import { describe, expect, it } from 'vitest'
import snippetsSource from './SnippetsTool.tsx?raw'
import remindersSource from './RemindersTool.tsx?raw'
import reminderRowSource from './reminders/ReminderRow.tsx?raw'
import calculatorSource from './Calculator.tsx?raw'
import fileRowSource from './files/FileRow.tsx?raw'
import inlineEditSource from './files/InlineEdit.tsx?raw'
import filesToolSource from './FilesTool.tsx?raw'
import viewerSource from './FileViewer.tsx?raw'
import annotateSource from './pdf/PdfAnnotatePanel.tsx?raw'
import pagesSource from './pdf/PdfPagesPanel.tsx?raw'
import rowCapSource from '@/components/common/use-row-cap.ts?raw'
import { fileBucketLabel } from './files/bucket-label'
import { FILE_BUCKETS } from '@/data/vault'

/**
 * Review round 2 (web-ui-1, -2, -5, -8, -9, performance-3, -4, security-2,
 * i18n-11): behaviour of the Vault tools that lives in JSX and handlers, pinned
 * as source (D20) where rendering it would need the whole store.
 */

const strip = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')

describe('a snippet save’s Undo (web-ui-1)', () => {
  const code = strip(snippetsSource)
  const save = code.slice(code.indexOf('const save = '), code.indexOf('const record = addSnippet('))

  it('reverts through the journal, not a hand-built patch that keeps the new formatting', () => {
    expect(save).toMatch(
      /undoable\(\(\) => \{[\s\S]*updateSnippet\([\s\S]*commitKeywords\(id, chosen\)/,
    )
    expect(save).not.toMatch(/updateSnippet\(id, before\)/)
    expect(save).toMatch(/restore\(\)/)
  })

  it('re-seeds the open editor from the store after Undo — marks and filing included', () => {
    expect(save).toMatch(/repo\.getSnapshot\(\)/)
    expect(save).toMatch(/props\.bodyFormat/)
    expect(save).toMatch(/applicationIds: stored\.applicationIds,\s*keywords/)
  })
})

describe('ticking a reminder (web-ui-2, web-ui-9, performance-3)', () => {
  const code = strip(remindersSource)

  it('ignores a second activation of a row already in flight', () => {
    expect(code).toMatch(/if \(inFlight\.current\.has\(id\)\) return/)
  })

  it('flushes a pending write when the tool unmounts instead of dropping it', () => {
    const cleanup = code.slice(code.indexOf('const inFlight'), code.indexOf('const play = '))
    expect(cleanup).toMatch(/for \(const commit of flush\) commit\(\)/)
  })

  it('undoes a reopen back to the day it was completed, not today', () => {
    expect(code).toMatch(/const before = item\.completedOn \?\? null/)
    expect(code).toMatch(/update\(item\.id, \{ completedOn: before \}\)/)
    expect(code).not.toMatch(/completedOn: done \? TODAY : null/)
  })

  it('hands the rows one stable actions object, and the row is memoized', () => {
    expect(code).toMatch(/const actions = useMemo<RowActions>\(/)
    expect(strip(reminderRowSource)).toMatch(/export const ReminderRow = memo\(/)
  })

  it('defers the search query so typing is not blocked by the filter', () => {
    expect(code).toMatch(/useDeferredValue\(query\)/)
  })
})

describe('the calculator keypad (web-ui-8)', () => {
  const code = strip(calculatorSource)

  it('declares no component inside the render, so a pressed key keeps focus', () => {
    expect(code).not.toMatch(/const (Digit|Operator) = \(/)
    expect(code).not.toMatch(/<(Digit|Operator)\b/)
    expect(code).toMatch(/\{digitKey\('7'\)\}/)
  })
})

describe('a file note edited in its row (web-ui-5)', () => {
  it('is a textarea, so its paragraph breaks survive', () => {
    const row = strip(fileRowSource)
    expect(row).toMatch(
      /key="note"[\s\S]*?multiline[\s\S]*?onSave=\{\(next\) => onNote\(f, next\)\}/,
    )
    expect(strip(inlineEditSource)).toMatch(/multiline \? \(\s*<TextareaField/)
  })
})

describe('the PDF preview frame (security-2)', () => {
  const code = strip(viewerSource)

  it('frames only bytes that sniff as a PDF, re-typed as application/pdf', () => {
    expect(code).toMatch(/isPdfHeader\(new Uint8Array\(head\)\)/)
    expect(code).toMatch(/new Blob\(\[real\], \{ type: 'application\/pdf' \}\)/)
    expect(code).not.toMatch(/URL\.createObjectURL\(real\)/)
  })
})

describe('long Vault lists (performance-4)', () => {
  it('mount a page of rows at a time, keeping the row a link arrived at', () => {
    for (const code of [strip(filesToolSource), strip(remindersSource)]) {
      expect(code).toMatch(/useRowCap\(/)
      expect(code).toMatch(/r?\.id === focus|f\.id === focus/)
      expect(code).toMatch(/<ShowMoreRows\b/)
    }
  })
})

describe('the Files drawer names (i18n-11)', () => {
  it('shows each built-in drawer by its translated label and leaves anything else as stored', () => {
    for (const bucket of FILE_BUCKETS) expect(fileBucketLabel(bucket)).toBeTruthy()
    expect(fileBucketLabel('Job postings')).toBe('Job postings')
    expect(fileBucketLabel('My own drawer')).toBe('My own drawer')
    expect(strip(filesToolSource)).toMatch(/labels=\{fileBucketLabels\(\)\}/)
  })
})

describe('opening a PDF in the Annotate and Pages panels (web-ui-6)', () => {
  it('drops an open that a later pick has overtaken, and clears the old document at once', () => {
    for (const code of [strip(annotateSource), strip(pagesSource)]) {
      expect(code).toMatch(/const ticket = \+\+request\.current/)
      expect(code).toMatch(/if \(ticket !== request\.current\) \{\s*opened\.close\(\)\s*return/)
      expect(code).toMatch(/setChoice\(picked\)\s*setDocument\(null\)/)
    }
  })
})

describe('the row cap (performance-4)', () => {
  it('stays raised after the arrival parameter clears, so the arrived row is not unmounted', () => {
    expect(strip(rowCapSource)).toMatch(/if \(keep \+ 1 > limit\) setLimit\(keep \+ 1\)/)
  })
})
