import { describe, expect, it } from 'vitest'
import boardSource from '@/components/applications/board/ApplicationsBoard.tsx?raw'
import columnSource from '@/components/applications/board/BoardColumn.tsx?raw'
import cardSource from '@/components/applications/board/BoardCard.tsx?raw'
import stageMenuSource from '@/components/applications/StageMenu.tsx?raw'
import addByUrlSource from '@/components/applications/AddByUrl.tsx?raw'
import addFromLinkSource from '@/components/applications/AddFromLinkDialog.tsx?raw'
import linksToolSource from '@/components/vault/LinksTool.tsx?raw'
import postingsSource from '@/components/scout/PostingsPanel.tsx?raw'
import prioritySource from '@/components/dashboard/PriorityActions.tsx?raw'
import glanceSource from '@/components/dashboard/GlancePanel.tsx?raw'
import sidebarNavSource from '@/components/layout/SidebarNav.tsx?raw'
import documentsSource from '@/components/profile/DocumentsPanel.tsx?raw'
import keywordManagerSource from '@/components/settings/KeywordManager.tsx?raw'
import confirmCopySource from '@/components/settings/data-confirm-copy.tsx?raw'
import fieldSource from './Field.tsx?raw'
import revealSource from './reveal-focus.ts?raw'
import showMoreSource from './ShowMoreRows.tsx?raw'
import css from '@/index.css?raw'
import enSettings from '@/i18n/locales/en/settings.json'

/**
 * Review round 3, web layout and list findings, pinned as source (D20) where
 * the behaviour is markup, a class list or a handler's wiring. The row cap's
 * arithmetic itself is run, in `use-row-cap.test.ts`.
 */

const strip = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')

describe('the Applications board mounts a page of cards per column (performance-1)', () => {
  const column = strip(columnSource)
  const board = strip(boardSource)
  const card = strip(cardSource)

  it('caps each column at ROW_PAGE with a Show more at its foot', () => {
    expect(column).toMatch(/const cap = useRowCap\(\s*items\.length,/)
    expect(column).toContain('items.slice(0, cap.shown).map(')
    expect(column).not.toMatch(/[^.\w]items\.map\(/)
    expect(column).toMatch(
      /<ShowMoreRows shown=\{cap\.shown\} hidden=\{cap\.hidden\} onMore=\{cap\.more\} \/>/,
    )
    // At the foot of the cards, before the column's own Add here.
    expect(column.indexOf('<ShowMoreRows')).toBeGreaterThan(column.indexOf('<BoardCard'))
    expect(column.indexOf('<ShowMoreRows')).toBeLessThan(column.indexOf("t('board.addHere')"))
  })

  it('keeps the open card and the card just moved mounted past the cap', () => {
    expect(column).toMatch(
      /useRowCap\(\s*items\.length,\s*Math\.max\(indexOfId\(items, openId\), indexOfId\(items, dropped\)\),?\s*\)/,
    )
    // Set by every move the board makes — the drop and the stage menu both go
    // through `moveStage`.
    expect(board).toMatch(/if \(app\.stage !== stage\) setDropped\(app\.id\)/)
    expect(board).toMatch(/if \(stage && app\) moveStage\(app, stage\)/)
    expect(board).toMatch(/onMoveStage=\{moveStage\}/)
    expect(board).toMatch(/dropped=\{dropped\}/)
  })

  it('reads the location once for the board, not once per card', () => {
    expect(board).toMatch(/const keep = listStateOf\(useLocation\(\)\.search\)/)
    expect(card).not.toMatch(/useLocation/)
    expect(column).toMatch(/keep=\{keep\}/)
  })

  it('memoises the card, and its body as drawn in a column', () => {
    expect(card).toMatch(/export const BoardCard = memo\(function BoardCard\(/)
    expect(card).toMatch(/const CardBody = memo\(BoardCardBody\)/)
    expect(card).toMatch(
      /const handle = useMemo\(\(\) => \(\{ attributes, listeners \}\), \[attributes, listeners\]\)/,
    )
    expect(card).toMatch(/<CardBody\b/)
  })

  it('builds the stage menu options only while the menu is open', () => {
    const menu = strip(stageMenuSource)
    const content = /<PopoverContent\b[\s\S]*?<\/PopoverContent>/.exec(menu)?.[0] ?? ''
    expect(content).toMatch(/<StageOptions\b/)
    expect(content).not.toMatch(/STAGES\.map/)
    expect(menu).toMatch(/function StageOptions\(/)
  })
})

describe('keyboard focus inside a horizontal scroller is scrolled into view (a11y-5)', () => {
  it('reveals a keyboard-focused control, or the ancestor named, nearest edge only', () => {
    const reveal = strip(revealSource)
    expect(reveal).toMatch(/target\.matches\(':focus-visible'\)/)
    expect(reveal).toMatch(/scrollIntoView\(\{ inline: 'nearest', block: 'nearest' \}\)/)
    expect(reveal).toMatch(/target\.closest\(within\)/)
  })

  it('is wired to the board scroller and to the dashboard deck, a whole card at a time', () => {
    expect(strip(boardSource)).toMatch(
      /<PanelScroll axis="x" className="flex gap-3" onFocus=\{revealControl\}>/,
    )
    const deck = strip(prioritySource)
    expect(deck).toMatch(/const revealCard = revealFocused\('li'\)/)
    expect(deck).toMatch(/<ul\s+ref=\{track\}[\s\S]*?onFocus=\{revealCard\}/)
  })
})

describe('Show more on the last page keeps keyboard focus (webui-8)', () => {
  it('puts a focusable summary in place of the button that unmounts', () => {
    const more = strip(showMoreSource)
    expect(more).toMatch(/setPressed\(true\)\s*onMore\(\)/)
    expect(more).toMatch(/const revealedAll = pressed && hidden <= 0 && shown > 0/)
    expect(more).toMatch(/if \(revealedAll\) summary\.current\?\.focus\(\)/)
    expect(more).toMatch(/<p ref=\{summary\} tabIndex=\{-1\}/)
    expect(more).toMatch(/t\('rows\.allShown', \{ total: shown \}\)/)
    // A list that was never capped still renders nothing at its foot.
    expect(more).toMatch(/if \(hidden <= 0\) return null/)
  })
})

describe('SettingRow stacks when its row is narrow (responsive-1)', () => {
  // From the declaration to the end of its body (`\n}\n`, not the `\n})` that
  // closes its props type).
  const row = /export function SettingRow\([\s\S]*?\n\}\n/.exec(strip(fieldSource))?.[0] ?? ''

  it('wraps the control under its text instead of squeezing the text column', () => {
    expect(row).toMatch(/className="flex flex-wrap items-start justify-between/)
    expect(row).toMatch(/<div className="min-w-0 flex-\[1_1_12rem\]">/)
    expect(row).toMatch(/<div className="max-w-full min-w-0 pt-0\.5">\{control\}<\/div>/)
    expect(row).not.toMatch(/shrink-0 pt-0\.5/)
  })

  it('keeps a keyword chip inside its column', () => {
    const manager = strip(keywordManagerSource)
    expect(manager).toMatch(/shape="capsule"\s+className="max-w-full"/)
    expect(manager).toMatch(/<span className="min-w-0 truncate">\{label\.name\}<\/span>/)
  })
})

describe('RTL ellipsis boxes keep the page’s alignment (responsive-2)', () => {
  it('moves only the ellipsis, not the text, to the end of a Latin value', () => {
    const rule = /\[dir='rtl'\] \.truncate \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/unicode-bidi: plaintext;/)
    // Chrome's spelling, the standard one, and a floor for neither.
    expect(rule).toMatch(
      /text-align: right;\s*text-align: -webkit-match-parent;\s*text-align: match-parent;/,
    )
    expect(css).toMatch(/\[dir='rtl'\] \.truncate\.text-start \{\s*text-align: right;\s*\}/)
  })
})

describe('the sidebar badge stays on one line inside its item (responsive-3)', () => {
  it('keeps the pill on one line, dropping to the bare count when the name would be cut', () => {
    const nav = strip(sidebarNavSource)
    expect(nav).toMatch(/<span className="min-w-0 truncate">\{text\}<\/span>/)
    expect(nav).toMatch(/<NavBadge key=\{badge\.text\} badge=\{badge\} \/>/)
    expect(nav).toMatch(/'ms-auto shrink-0 rounded-full px-1\.5 py-px text-xs font-semibold whitespace-nowrap'/)
    expect(nav).toMatch(/if \(name\.scrollWidth > name\.clientWidth\) setShort\(true\)/)
    expect(nav).toMatch(/\{short \? String\(badge\.count\) : badge\.text\}/)
    // The words are still said, whichever form is drawn.
    expect(nav).toMatch(/<span className="sr-only"> — \{badge\.title\}<\/span>/)
  })
})

describe('URL and email fields read left to right in an RTL page (responsive-4)', () => {
  it('sets ltr on the Field box for url and email', () => {
    const field = strip(fieldSource)
    expect(field).toMatch(
      /const ltr = props\.type === 'url' \|\| props\.type === 'email' \? 'ltr' : undefined/,
    )
    expect(field).toMatch(/<div dir=\{ltr\} className="relative">/)
  })

  it('sets ltr on the raw URL boxes that carry an icon', () => {
    expect(strip(addByUrlSource)).toMatch(
      /<div dir="ltr" className=\{cn\('relative min-w-0 flex-1'/,
    )
    expect(strip(addFromLinkSource)).toMatch(/<div dir="ltr" className="relative min-w-0">/)
  })

  it('sets ltr on the plain URL boxes in Vault links and saved postings', () => {
    for (const source of [linksToolSource, postingsSource]) {
      expect(strip(source)).toMatch(/type="url"\s+dir="ltr"/)
    }
  })
})

describe('the Profile documents list mounts a page at a time (performance-3)', () => {
  it('caps the tiles, keeping the open document mounted', () => {
    const panel = strip(documentsSource)
    expect(panel).toMatch(
      /const cap = useRowCap\(documents\.length, indexOfId\(documents, viewer\.openDoc\?\.id\)\)/,
    )
    expect(panel).toContain('documents.slice(0, cap.shown).map(')
    expect(panel).not.toMatch(/[^.\w]documents\.map\(/)
    expect(panel).toMatch(
      /<ShowMoreRows shown=\{cap\.shown\} hidden=\{cap\.hidden\} onMore=\{cap\.more\} \/>/,
    )
  })
})

describe('the glance calendar heading is written in the language’s order (i18n-6)', () => {
  it('uses monthYearParts, not a month name with the year appended', () => {
    const glance = strip(glanceSource)
    expect(glance).toMatch(/domain\.monthYearParts\(view\.month, view\.year\)\.map\(/)
    expect(glance).not.toMatch(/\{month\.year\}<\/span>/)
    expect(glance).not.toMatch(/month: 'long' \}\)\.format\(\s*new Date\(year, month - 1, 1\)/)
  })
})

describe('Clear every record says where the documents go (docs-1)', () => {
  it('tells the user the files are kept 30 days, and names the control that erases them now', () => {
    const copy = strip(confirmCopySource)
    expect(copy).toMatch(
      /t\('pending\.empty\.documentsKept', \{ storage: t\('data\.clearStorage\.label'\) \}\)/,
    )
    const sentence = enSettings.pending.empty.documentsKept
    expect(sentence).toMatch(/30 days/)
    expect(sentence).toContain('{{storage}}')
  })
})
