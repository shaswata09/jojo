import { describe, expect, it } from 'vitest'
import dialogSource from '@/components/ui/dialog.tsx?raw'
import rowMenuSource from '@/components/common/RowMenu.tsx?raw'
import stageMenuSource from '@/components/applications/StageMenu.tsx?raw'
import detailHeaderSource from '@/components/applications/detail/DetailHeader.tsx?raw'
import detailSheetSource from '@/components/applications/detail/DetailSheet.tsx?raw'
import tableSource from '@/components/applications/table/ApplicationsTable.tsx?raw'
import keywordManagerSource from '@/components/settings/KeywordManager.tsx?raw'
import keywordChipSource from '@/components/common/KeywordChip.tsx?raw'
import labelPickerSource from '@/components/common/LabelPicker.tsx?raw'
import labelFilterSource from '@/components/common/LabelFilter.tsx?raw'
import donutSource from '@/components/charts/Donut.tsx?raw'
import pieSource from '@/components/charts/Pie.tsx?raw'
import sourcesSource from '@/components/dashboard/ApplicationSources.tsx?raw'
import eventChipSource from '@/components/calendar/EventChip.tsx?raw'
import documentsSource from '@/components/profile/DocumentsPanel.tsx?raw'
import prioritySource from '@/components/dashboard/PriorityActions.tsx?raw'
import proposalSource from '@/components/scout/ProposalQueue.tsx?raw'
import mascotSource from '@/components/brand/MascotMoves.tsx?raw'
import builtWithSource from '@/components/guide/GuideBuiltWith.tsx?raw'
import controlFlowSource from '@/components/guide/GuideControlFlow.tsx?raw'
import licenceSource from '@/components/guide/GuideLicence.tsx?raw'
import topbarSource from '@/components/layout/Topbar.tsx?raw'
import css from '@/index.css?raw'
import { i18next } from '@/i18n/i18n'
import { legendName } from '@/components/charts/legend-name'

/**
 * Review round 2: focus return, keyboard focus, accessible names, RTL text and
 * a few layout and translation fixes across the app, pinned as source (D20)
 * where the behaviour is markup or a handler's order.
 */

const strip = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')

describe('a dialog opened from a menu (web-ui-3)', () => {
  it('hands focus to the menu’s trigger before the menu closes and the action runs', () => {
    expect(strip(rowMenuSource)).toMatch(
      /trigger\.current\?\.focus\(\{ preventScroll: true \}\)\s*setOpen\(false\)/,
    )
    expect(strip(stageMenuSource)).toMatch(
      /triggerRef\.current\?\.focus\(\{ preventScroll: true \}\)\s*onSelect\(stage\.id\)/,
    )
    const header = strip(detailHeaderSource)
    expect(header).toMatch(/menuTrigger\.current\?\.focus\(\{ preventScroll: true \}\)/)
    for (const action of ['onEdit?.(a.id)', 'onDraft()', 'onDuplicate()', 'onRequestDelete()'])
      expect(header).toContain(`closeMenu()\n                  ${action}`)
  })

  it('records the surviving trigger rather than the menu item it was opened from', () => {
    const code = strip(dialogSource)
    expect(code).toMatch(/returnFocusRef\.current \?\?= survivingTrigger\(triggerElement\(\)\)/)
    expect(code).toMatch(/\[data-radix-popper-content-wrapper\]/)
  })
})

describe('the applications table (web-ui-4, performance-4)', () => {
  const code = strip(tableSource)

  it('declares its sort header at module scope, so a pressed header keeps focus', () => {
    expect(code).toMatch(/^function SortHeader\(/m)
    expect(code).not.toMatch(/const SortHeader = /)
  })

  it('mounts a page of rows at a time, always including the open record', () => {
    expect(code).toMatch(/useRowCap\(rows\.length, openId \?/)
    expect(code).toMatch(/rows\.slice\(0, cap\.shown\)\.map/)
  })
})

describe('Tab wrapping in the record sheet (web-a11y-6)', () => {
  it('scrolls a focused control into view inside the sheet', () => {
    expect(strip(detailSheetSource)).toMatch(
      /onFocusCapture=\{[\s\S]*?scrollIntoView\?\.\(\{ block: 'nearest' \}\)/,
    )
  })
})

describe('keyword names (web-ui-7)', () => {
  it('are capped at the tools’ 40 characters in every keyword input', () => {
    for (const source of [
      keywordManagerSource,
      keywordChipSource,
      labelPickerSource,
      labelFilterSource,
    ])
      expect(source).toMatch(/maxLength=\{KEYWORD_NAME_MAX\}/)
  })

  it('keep the typed name with a reason when the add is refused, and do not call a long name “taken”', () => {
    const code = strip(keywordManagerSource)
    expect(code).toMatch(/if \(!addLabel\(name\)\) \{/)
    expect(code).toMatch(/keywords\.errors\.tooLong/)
    expect(strip(keywordChipSource)).toMatch(/keywordChip\.tooLong/)
  })
})

describe('chart legend names (web-a11y-4)', () => {
  it('separates the count from the percentage for a screen reader', () => {
    expect(legendName(i18next.t, 'en', 'Job scout', 4, 33)).toBe('Job scout: 4, 33%')
    for (const source of [donutSource, pieSource, sourcesSource])
      expect(source).toMatch(/aria-label=\{legendName\(/)
  })
})

describe('Latin user text in a right-to-left page (web-a11y-3)', () => {
  it('isolates ellipsis boxes and titles so the start of a title is not cut', () => {
    expect(css).toMatch(/\[dir='rtl'\] \.truncate \{\s*unicode-bidi: plaintext;/)
    expect(eventChipSource).toMatch(/<span dir="auto" className=\{cn\('block truncate'/)
    expect(tableSource).toMatch(/dir="auto"/)
  })
})

describe('focus not obscured (web-a11y-2)', () => {
  it('pads the page’s scroll by the sticky top bar and the chat dock', () => {
    expect(css).toMatch(/scroll-padding-top: var\(--topbar-clearance, 0px\)/)
    expect(css).toMatch(/scroll-padding-bottom: calc\(var\(--dock-clearance, 0px\) \+ 1rem\)/)
    expect(topbarSource).toMatch(/setProperty\('--topbar-clearance'/)
  })
})

describe('the profile documents actions (web-a11y-5)', () => {
  it('wrap rather than run off the card', () => {
    expect(documentsSource).toMatch(
      /className="flex flex-wrap gap-2" data-focus-id="profile-documents-upload"/,
    )
  })
})

describe('the dashboard decision deck (performance-1)', () => {
  const code = strip(prioritySource)

  it('reads the timeline once for the deck, not once per card', () => {
    const cards = code.slice(
      code.indexOf('function ItemControls'),
      code.indexOf('const DECK_SHOWN'),
    )
    expect(cards).not.toMatch(/useTimeline\(\)/)
    const deck = code.slice(
      code.indexOf('function DecisionTimeline'),
      code.indexOf('function useFirstStepsProgress'),
    )
    expect(deck.match(/useTimeline\(\)/g)).toHaveLength(1)
    expect(deck).toMatch(/<DecisionCard action=\{action\} timeline=\{timeline\} \/>/)
  })

  it('caps the deck with a Show all stop', () => {
    expect(code).toMatch(/const DECK_SHOWN = 20/)
    expect(code).toMatch(/actions\.slice\(0, DECK_SHOWN\)/)
  })
})

describe('approved scout suggestions (i18n-4)', () => {
  it('name their outcome from the catalog', () => {
    const code = strip(proposalSource)
    expect(code).toMatch(/'proposals\.status\.savedToMatches'/)
    expect(code).toMatch(/'proposals\.status\.savedToPostings'/)
    expect(code).not.toMatch(/approvedLabel\(/)
  })
})

describe('the mascot credit (i18n-8)', () => {
  it('is one catalog sentence with the work, artist and licence as links', () => {
    expect(mascotSource).toMatch(/i18nKey="moves\.modelCreditFull"/)
    expect(mascotSource).toMatch(/work: <a href=\{MODEL_URL\}/)
    expect(mascotSource).toMatch(/artist: \(?\s*<a href=\{ARTIST_URL\}/)
  })
})

describe('the English-only developer pages (i18n-12)', () => {
  it('say in the reader’s language that the page is in English', () => {
    for (const source of [builtWithSource, controlFlowSource, licenceSource])
      expect(source).toMatch(/<\/?PageHeader[\s\S]*?\/>\s*<EnglishOnlyNotice \/>/)
  })
})
