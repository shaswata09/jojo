/**
 * What the 2026-11-17 emulator pass found that the unit tests had passed: the
 * phone's review fixes driven on an Android 13 AVD (Transfer_Phone_API33,
 * 1080×2400 at 420dpi). Wiring in files that import React Native — which this
 * runner does not load (see vitest.config.mts) — is read as text with comments
 * removed, the way `review-2026-11-16b.requests.test.ts` does it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { STAGES } from '@jojo/service/data/seed'
import { hoveredColumn } from '@/lib/board-drop'
import { keyboardOverlap } from '@/lib/keyboard-overlap'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) =>
  readFileSync(path.join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('the Assistant composer above the keyboard on Android', () => {
  // Measured on the AVD with the composer focused: keyboard top 577.9dp
  // (`screenY`), the Assistant frame drawn from 80dp (status bar 24 + header
  // 56) and 834.3dp tall. `measureInWindow` said y=56 — 24dp short — so the
  // frame was padded 24dp too little and the composer sat under the keyboard.
  const keyboardTop = 577.9
  const height = 834.3

  it('pads by what the keyboard covers on screen, not 24dp less', () => {
    expect(keyboardOverlap(80, height, keyboardTop)).toBe(336)
    expect(keyboardOverlap(56, height, keyboardTop)).toBe(312)
  })

  it('reads the view in the keyboard’s coordinates on Android', () => {
    const hook = read('lib/use-keyboard-overlap.ts')
    expect(hook).toMatch(/Platform\.OS === 'android'\)\s*\{\s*view\.measure\(/)
    expect(hook).toMatch(/keyboardOverlap\(pageY, height, edge\)/)
  })
})

describe('the board drag while the board scrolls itself', () => {
  // The AVD's numbers: a 387dp viewport at x=12, 1562dp of columns, stride 260.
  const N = STAGES.length
  const viewportX = 12
  const viewportW = 387.4
  const contentW = 1562.3
  const max = contentW - viewportW
  const stride = 260

  it('names the column now under a finger held still as the board scrolls on', () => {
    // RTL on Android: the native offset is physical, `max` at the start.
    const finger = 42 // held inside the left (end) edge zone
    const before = hoveredColumn(finger, viewportX, viewportW, max, contentW, true, true, stride, N)
    const after = hoveredColumn(
      finger,
      viewportX,
      viewportW,
      max - 520,
      contentW,
      true,
      true,
      stride,
      N,
    )
    expect(before).toBe(1)
    expect(after).toBe(3)
    // LTR: the same two columns' worth of scroll moves the hover two columns.
    expect(hoveredColumn(380, viewportX, viewportW, 0, contentW, false, false, stride, N)).toBe(1)
    expect(hoveredColumn(380, viewportX, viewportW, 520, contentW, false, false, stride, N)).toBe(3)
  })

  it('asks again from the edge auto-scroll, not only when the finger moves', () => {
    const board = read('screens/applications/Board.tsx')
    const frame = board.slice(board.indexOf('useFrameCallback('))
    expect(frame).toMatch(
      /scrollTo\(scroller, scrollX\.value, 0, false\)\s*const idx = hoveredColumn\(\s*pointerX\.value,/,
    )
    expect(frame).toMatch(
      /if \(idx !== hoverSV\.value\) \{\s*hoverSV\.value = idx\s*runOnJS\(setHover\)\(idx\)/,
    )
  })
})

describe('the audit log while Undo is off', () => {
  it('stacks the explanation over the button, so the reason under it cannot squeeze the text to nothing', () => {
    const log = read('components/common/AuditLog.tsx')
    expect(log).toMatch(/<View style=\{\[blocker \? styles\.stacked : s\.row, /)
    expect(log).toMatch(/<Txt size="xs" tone="muted" style=\{blocker \? undefined : s\.fill\}>/)
    // Still disabled, and still saying why, on a trimmed top row.
    expect(log).toMatch(/const canUndo = top !== undefined && !wholeStore && top\.trimmed !== true/)
    expect(log).toMatch(/disabled=\{!canUndo\}\s*blocker=\{blocker\}/)
  })
})

/*
 * The four smaller things the first pass saw, fixed in a second one
 * (2026-11-17): the composer's placeholder, digits in Bengali and Marathi,
 * blocked buttons in rows, and form sheets that closed with typed text.
 */

const LOCALES = path.join(SRC, 'i18n/locales')

describe('the Assistant composer placeholder', () => {
  it('is short enough for one line of the composer in every language', () => {
    // The old English one ran 58 characters into a ~280dp field: on the AVD it
    // wrapped to a clipped second line, or ran off the end ("…a follow-up em").
    for (const locale of readdirSync(LOCALES)) {
      const screens = JSON.parse(readFileSync(path.join(LOCALES, locale, 'screens.json'), 'utf8'))
      const placeholder: string = screens.assistant.scripted.placeholder
      expect([...placeholder].length, locale).toBeLessThanOrEqual(24)
      expect(placeholder.endsWith('…'), locale).toBe(true)
    }
  })
})

/** Every non-test source file under `src`, comments removed. */
function sources(dir = SRC): [string, string][] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === 'i18n' ? [] : sources(full)
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return []
    return [[path.relative(SRC, full), read(path.relative(SRC, full))] as [string, string]]
  })
}

describe('numbers in the language on screen', () => {
  it('hands every Intl formatter the app language through intlLocale', () => {
    // Without it Bengali dates and grouped numbers came out in Bengali digits
    // beside i18next counts in Latin ones: "মঙ্গলবার ১৭ নভেম্বর · 12টি আবেদন".
    const call =
      /(?:new\s+)?Intl\.(?:DateTimeFormat|NumberFormat|ListFormat|RelativeTimeFormat)\(([^)]*)|\.toLocale(?:Date|Time)?String\(([^)]*)/g
    const offenders: string[] = []
    let calls = 0
    for (const [file, text] of sources()) {
      for (const m of text.matchAll(call)) {
        calls += 1
        const arg = (m[1] ?? m[2] ?? '').trim()
        if (arg === '' || /^['"]/.test(arg) || arg.startsWith('intlLocale(')) continue
        offenders.push(`${file}: ${m[0]}`)
      }
    }
    expect(calls).toBeGreaterThan(3)
    expect(offenders).toEqual([])
  })
})

describe('a blocked button beside text', () => {
  it('puts the Reset button under its label while it says why it is off', () => {
    const field = read('components/ui/Field.tsx')
    expect(field).toMatch(/<View style=\{stacked \? styles\.settingStacked : styles\.settingRow\}>/)
    expect(field).toMatch(/<View style=\{stacked \? undefined : s\.fill\}>/)
    const settings = read('screens/SettingsScreen.tsx')
    expect(settings).toMatch(
      /focusId="settings\.data\.reset"[\s\S]{0,200}stacked=\{isEmpty\}[\s\S]{0,300}blocker=\{isEmpty \? t\('settings\.data\.resetBlocker'\)/,
    )
  })

  it('keeps the posting browser address readable while a page loads', () => {
    const browser = read('screens/PostingBrowserScreen.tsx')
    expect(browser).toMatch(
      /blocker=\{loading \? t\('postingBrowser\.waitForLoad'\) : undefined\}\s*style=\{styles\.keep\}/,
    )
    expect(browser).toMatch(/keep: \{ maxWidth: '45%' \}/)
  })
})

describe('form sheets holding typed text', () => {
  it('ask before the reminder, link, person and stage sheets throw it away', () => {
    const guard = read('components/ui/discard-guard.tsx')
    expect(guard).toMatch(/if \(dirty\) setAsking\(true\)\s*else onClose\(\)/)
    expect(guard).toMatch(/title=\{t\('discard\.title'\)\}/)

    const reminder = read('sheets/TimelineItemSheet.tsx')
    expect(reminder).toMatch(/useDiscardGuard\(typed !== opened, \(\) => onOpenChange\(false\)\)/)
    expect(reminder).toMatch(/onClose=\{close\}/)
    expect(reminder).toMatch(
      /label=\{t\('common\.cancel'\)\}\s*variant="ghost"\s*size="md"\s*onPress=\{close\}/,
    )
    expect(reminder).toContain('{guard}')

    for (const file of ['screens/vault/LinksTool.tsx', 'screens/vault/PeopleTool.tsx']) {
      const editor = read(file)
      expect(editor, file).toMatch(/useDiscardGuard\(typed !== opened, onClose\)/)
      expect(editor, file).toMatch(/onClose=\{close\}/)
      expect(editor, file).toMatch(
        /label=\{t\('common\.cancel'\)\} variant="ghost" size="md" onPress=\{close\}/,
      )
      expect(editor, file).toContain('{guard}')
    }

    const stage = read('sheets/StageTransitionSheet.tsx')
    expect(stage).toMatch(/useDiscardGuard\(dirty, \(\) => onOpenChange\(false\)\)/)
    expect(stage).toMatch(/onCancel=\{close\}/)
    expect(stage).toMatch(/full onPress=\{onCancel\}/)
  })

  it('measures typed text against what the sheet opened with', () => {
    // Tapping into a field and back out is not a change; only a difference is.
    for (const file of [
      'sheets/TimelineItemSheet.tsx',
      'screens/vault/LinksTool.tsx',
      'screens/vault/PeopleTool.tsx',
      'sheets/StageTransitionSheet.tsx',
    ]) {
      expect(read(file), file).toMatch(/const \[opened\] = useState\(typed\)/)
    }
  })
})
