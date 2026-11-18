/**
 * The third review's phone findings (review 2026-11-18). Pure decisions are
 * run; the wiring in files that import React Native — which this runner does
 * not load (see vitest.config.mts) — is read as text with comments removed.
 * security-2 is in `document-path.test.ts`, `documents.test.ts`,
 * `documents-trash.test.ts` and `restore-documents.test.ts`; coverage-3 in
 * `documents-trash.test.ts`; security-3 in `capture.test.ts`; leaks-2 in
 * `board-scan.test.ts`.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canvasHeightFor } from '@/lib/graph-canvas'
import { VAULT_TOOLS, isVaultTool } from '@/navigation/types'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const raw = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8')
const read = (rel: string) => strip(raw(rel))

const LOCALES = readdirSync(path.join(SRC, 'i18n/locales'))
const catalog = (locale: string, ns: string): Record<string, Record<string, unknown>> =>
  JSON.parse(raw(`i18n/locales/${locale}/${ns}.json`)) as Record<string, Record<string, unknown>>

describe('one finger on the graph canvas at fit (mobile-1)', () => {
  const zoom = read('components/graph/use-canvas-zoom.ts')
  const pinch = zoom.slice(zoom.indexOf('Gesture.Pinch()'), zoom.indexOf('Gesture.Pan()'))

  it('does not stop the page scrolling until a second finger is down or the pinch starts', () => {
    expect(pinch).not.toMatch(/\.onBegin\(/)
    expect(pinch).toMatch(
      /\.onTouchesDown\(\(e\) => \{\s*if \(e\.numberOfTouches >= 2\) lockForPinch\(\)/,
    )
    expect(pinch).toMatch(/\.onStart\(\(\) => \{\s*lockForPinch\(\)/)
  })

  it('hands the page its scrolling back only when the pinch took it', () => {
    expect(pinch).toMatch(
      /\.onFinalize\(\(\) => \{\s*if \(!pinchLocked\.value\) return\s*pinchLocked\.value = false\s*runOnJS\(onGesture\)\(false\)/,
    )
    expect(zoom).toMatch(
      /const lockForPinch = \(\) => \{\s*'worklet'\s*if \(pinchLocked\.value\) return\s*pinchLocked\.value = true\s*runOnJS\(onGesture\)\(true\)/,
    )
  })
})

describe('worklets the gestures call (coverage-5)', () => {
  /** Whether `name`'s body in `source` opens with the 'worklet' directive. */
  const isWorklet = (source: string, name: string) =>
    new RegExp(`export function ${name}\\([^)]*\\)[^{]*\\{\\s*'worklet'`).test(source)

  it('marks every function the pinch, the pan and the board drag run on the UI thread', () => {
    const canvas = raw('lib/graph-canvas.ts')
    for (const name of ['clampView', 'zoomAbout']) expect(isWorklet(canvas, name), name).toBe(true)
    const drop = raw('lib/board-drop.ts')
    for (const name of ['startOffset', 'fromStartEdge', 'columnAt', 'hoveredColumn']) {
      expect(isWorklet(drop, name), name).toBe(true)
    }
  })

  it('imports no other function from the app into the zoom hook', () => {
    const zoom = read('components/graph/use-canvas-zoom.ts')
    const imports = [...zoom.matchAll(/import \{([^}]*)\} from '@\/lib\/[^']+'/g)].flatMap((m) =>
      (m[1] ?? '').split(',').map((s) => s.trim()),
    )
    expect(imports.filter(Boolean).sort()).toEqual(['FIT', 'ZOOM_STEP', 'clampView', 'zoomAbout'])
  })
})

describe('the graph screen (mobile-2, mobile-3, mobile-4)', () => {
  const screen = read('screens/GraphScreen.tsx')

  it('runs an example question once per graph and lists at most a panel of its answers', () => {
    expect(screen).toMatch(
      /const result = useMemo\(\(\) => \(query \? query\.run\(graph\) : null\), \[query, graph\]\)/,
    )
    expect(screen).toMatch(/result\.slice\(0, PATTERN_SHOWN\)\.map\(/)
    expect(screen).not.toMatch(/result\.map\(/)
    expect(screen).toMatch(/t\('graph\.andMore', \{ count: result\.length - PATTERN_SHOWN \}\)/)
  })

  it('offers Open only for a record with a page, and says so for the rest', () => {
    expect(screen).toMatch(
      /\{opensRecord\(selected\) \? \(\s*<Button\s*label=\{t\('graph\.openRecord'\)\}/,
    )
    expect(screen).toMatch(/t\('graph\.derivedRecord'\)/)
    const set = /const OPENS_RECORD[^=]*= new Set<GraphNodeType>\(\[([^\]]*)\]\)/.exec(screen)?.[1]
    const opens = (set ?? '').match(/'[a-z]+'/g)?.map((s) => s.slice(1, -1))
    expect(opens?.sort()).toEqual([
      'application',
      'file',
      'item',
      'link',
      'match',
      'posting',
      'snippet',
    ])
    // Every type it lists is one `openRecord` has a branch for.
    for (const type of opens ?? []) expect(screen).toContain(`'${type}'`)
    for (const locale of LOCALES) {
      const text = (catalog(locale, 'screens').graph as Record<string, unknown>).derivedRecord
      expect(typeof text === 'string' && text.length > 0, locale).toBe(true)
    }
  })

  it('sizes the canvas by the window height too, so a phone on its side sees all of it', () => {
    // Portrait phones are unchanged; a 411dp-tall landscape window gets 308, not 560.
    expect(canvasHeightFor(400, 900)).toBe(520)
    expect(canvasHeightFor(800, 411)).toBe(308)
    expect(canvasHeightFor(800, 300)).toBe(260)
    expect(canvasHeightFor(1000, 1400)).toBe(560)
    expect(screen).toMatch(/const canvasHeight = canvasHeightFor\(canvasWidth, windowHeight\)/)
    expect(screen).not.toMatch(/Math\.max\(340, width \* 1\.3\)/)
  })
})

describe('a Vault link that names no tool (mobile-7)', () => {
  it('opens on the reminders instead of a blank Vault', () => {
    for (const tool of VAULT_TOOLS) expect(isVaultTool(tool)).toBe(true)
    for (const junk of ['x', '', undefined, null, 'toString', 'constructor']) {
      expect(isVaultTool(junk)).toBe(false)
    }
    const vault = read('screens/vault/VaultScreen.tsx')
    expect(vault).toMatch(
      /isVaultTool\(route\.params\?\.tool\) \? route\.params\.tool : 'reminders'/,
    )
    expect(vault).toMatch(/if \(isVaultTool\(linkTool\)\) setTool\(linkTool\)/)
  })
})

describe('the saved-page viewer (security-1)', () => {
  it('shows the stored page under the same CSP lock the web viewer uses', () => {
    const viewer = read('screens/vault/PageViewer.tsx')
    expect(viewer).toMatch(/source=\{\{ html: lockedCaptureHtml\(html\) \}\}/)
    expect(viewer).not.toMatch(/source=\{\{ html \}\}/)
    expect(viewer).toMatch(/javaScriptEnabled=\{false\}/)
    expect(viewer).toMatch(/originWhitelist=\{\['about:'\]\}/)
    expect(viewer).toMatch(/allowUniversalAccessFromFileURLs=\{false\}/)
  })
})

describe("only the app's own documents leave the filesystem layer (security-2)", () => {
  it('guards every read, move, delete and share behind ownDocumentPath', () => {
    expect(read('lib/capture.ts')).toMatch(
      /readStoredCapture[\s\S]*?const path = ownDocumentPath\(uri\)\s*if \(path === null\) return null/,
    )
    expect(read('lib/handoff-serve.ts')).toMatch(
      /readStoredDocument[\s\S]*?const path = ownDocumentPath\(uri\)\s*if \(path === null\) return null/,
    )
    expect(read('lib/read-document.ts')).toMatch(
      /if \(!record\?\.uri \|\| ownDocumentPath\(record\.uri\) === null\)/,
    )
    const docs = read('lib/documents.ts')
    expect(docs).toMatch(
      /async function setAside[\s\S]*?if \(ownDocumentPath\(from\) === null\) return null/,
    )
    expect(docs).toMatch(/export async function openDocument[\s\S]*?if \(path === null\) throw/)
  })
})

describe('the posting browser trusts the WebView for the address (security-3)', () => {
  it("passes the native event's url, not the page's message, to the inliner", () => {
    const browser = read('screens/PostingBrowserScreen.tsx')
    expect(browser).toMatch(/const pageUrl = event\.nativeEvent\.url \|\| currentRef\.current/)
    expect(browser).toMatch(/await inlineCapture\(raw, now\(\), pageUrl\)/)
  })
})

describe('Russian on the phone (i18n-3, i18n-4)', () => {
  it('does not call an application a tag, and keyword deletes have their own words', () => {
    const ru = catalog('ru', 'screens')
    const rows = ru.rowActions as Record<string, string>
    for (const key of ['confirmTitle', 'deletedTitle'])
      expect(rows[key], key).not.toMatch(/[Мм]етк/)
    const settings = read('screens/SettingsScreen.tsx')
    expect(settings).toMatch(/t\('settings\.keywords\.deletedTitle', \{ name: target\.name \}\)/)
    expect(settings).toMatch(/t\('settings\.keywords\.confirmTitle', \{ name: deleting\.name \}\)/)
    expect(settings).not.toMatch(/rowActions\./)
    for (const locale of LOCALES) {
      const keywords = (
        catalog(locale, 'screens').settings as Record<string, Record<string, string>>
      ).keywords
      for (const key of ['confirmTitle', 'deletedTitle']) {
        expect(keywords?.[key], `${locale} ${key}`).toContain('{{name}}')
      }
    }
  })

  it('reads a declined assistant step as declined, not as a turned-down offer', () => {
    const trace = (catalog('ru', 'components').trace as Record<string, Record<string, string>>)
      .status
    expect(trace?.declined).toBe('Отклонено')
  })
})

describe('documentation that drifted from its code (mobile-5, mobile-6, docs-6)', () => {
  it('attaches the wipe contract to forgetDocuments itself', () => {
    const docs = raw('lib/documents.ts')
    expect(docs).toMatch(
      /Never rejects, for the same reason `forgetDocument` never does[^/]*\*\/\nexport async function forgetDocuments/,
    )
    expect(docs).not.toMatch(/a few kilobytes that leave with the app\.\n \*\/\n\/\*\*/)
  })

  it('no longer exports English-only phrase helpers', () => {
    const text = read('lib/text.ts')
    expect(text).not.toMatch(/export (const|function) (plural|listJoin)\b/)
  })

  it('says the overview marks are rebuilt per committed zoom', () => {
    const overview = raw('components/graph/OverviewCanvas.tsx')
    expect(overview).not.toMatch(/Memoised on\s+\* the layout alone/)
    expect(overview).toMatch(/once per\s+\* COMMITTED zoom level/)
  })
})

describe('the mobile test glob (coverage-13, coverage-14)', () => {
  it('runs every test under src and gives a loaded machine thirty seconds', () => {
    // Not stripped: `src/**/*.test.ts` reads as a comment opener to `strip`.
    const config = readFileSync(path.join(SRC, '..', 'vitest.config.mts'), 'utf8')
    expect(config).toMatch(/include: \['src\/\*\*\/\*\.test\.ts'\]/)
    expect(config).toMatch(/testTimeout: 30_000/)
  })
})
