/**
 * The second review's phone findings (mobile-3..6, health-2/3/5, i18n-5,
 * i18n-12). Pure decisions are run; the wiring in files that import React
 * Native — which this runner does not load (see vitest.config.mts) — is read as
 * text with comments removed, one assertion per line a refactor would have to
 * keep. mobile-1/2 are in `to-tab.test.ts`, mobile-7 in `timeline-form.test.ts`,
 * security-3 in `capture.test.ts` and security-5 in `handoff-server.test.ts`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isDirectional, mirrorFor } from '@/lib/directional'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const read = (rel: string) => strip(readFileSync(path.join(SRC, rel), 'utf8'))

function sources(dir: string): [string, string][] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sources(full)
    return name.endsWith('.tsx')
      ? [[path.relative(SRC, full), strip(readFileSync(full, 'utf8'))] as [string, string]]
      : []
  })
}

const LOCALES = readdirSync(path.join(SRC, 'i18n/locales'))
const catalog = (locale: string, ns: string): Record<string, Record<string, unknown>> =>
  JSON.parse(readFileSync(path.join(SRC, 'i18n/locales', locale, `${ns}.json`), 'utf8')) as Record<
    string,
    Record<string, unknown>
  >

describe("the graph's Open on a dated item (mobile-3)", () => {
  const graph = read('screens/GraphScreen.tsx')

  it('sends an event to its day on the calendar, and only a reminder to the Vault', () => {
    expect(graph).toMatch(
      /if \(item && !item\.remind\) toTab\(navigation, 'Calendar', \{ date: item\.date, focus: item\.id \}\)/,
    )
    expect(graph).toMatch(
      /else toTab\(navigation, 'Vault', \{ tool: 'reminders', focus: node\.recordId \}\)/,
    )
  })

  it('lights the item on the calendar day it lands on', () => {
    const calendar = read('screens/CalendarScreen.tsx')
    expect(calendar).toMatch(/focus=\{route\.params\?\.focus\}/)
    expect(calendar).toMatch(/<FocusTarget key=\{e\.id\} id=\{e\.id\}>/)
    expect(calendar).toMatch(/setParams\(\{ options: undefined, focus: undefined \}/)
  })
})

describe('a record found by search lands lit (mobile-5)', () => {
  const search = read('screens/SearchScreen.tsx')

  it('carries the record to the Vault tool that lists it, people included', () => {
    for (const [tool, v] of [
      ['links', 'l'],
      ['files', 'f'],
      ['snippets', 's'],
      ['people', 'p'],
    ]) {
      expect(search).toContain(`toTab(navigation, 'Vault', { tool: '${tool}', focus: ${v}.id })`)
    }
    expect(search).toMatch(/for \(const p of people\)/)
  })

  it('carries a match or a saved posting to its row on Job scout', () => {
    expect(search).toContain(
      "navigation.navigate('JobScout', { focus: { kind: 'posting', id: p.id } })",
    )
    expect(search).toContain(
      "navigation.navigate('JobScout', { focus: { kind: 'match', id: m.id } })",
    )
    const scout = read('screens/JobScoutScreen.tsx')
    expect(scout).toMatch(/focus=\{route\.params\?\.focus\?\.id \?\? route\.params\?\.section\}/)
    expect(scout).toMatch(/<FocusTarget key=\{m\.id\} id=\{m\.id\}>/)
    expect(scout).toMatch(/<FocusTarget key=\{p\.id\} id=\{p\.id\}>/)
  })

  it('scrolls to the row, lights it once and clears the arrival', () => {
    const vault = read('screens/vault/VaultScreen.tsx')
    expect(vault).toMatch(/focus=\{route\.params\?\.focus\}/)
    expect(vault).toMatch(/setParams\(\{ options: undefined, focus: undefined \}/)
    for (const [file, v] of [
      ['RemindersTool', 'r'],
      ['LinksTool', 'l'],
      ['FilesTool', 'f'],
      ['SnippetsTool', 'snippet'],
      ['PeopleTool', 'p'],
    ]) {
      expect(read(`screens/vault/${file}.tsx`), file).toContain(
        `<FocusTarget key={${v}.id} id={${v}.id}>`,
      )
    }
  })
})

describe('Stop on a pipeline round cancels its request (mobile-4)', () => {
  it('hands the engine an llmFor that aborts the HTTP call on the round’s Stop', () => {
    const pipelines = read('lib/pipelines.tsx')
    expect(pipelines).toMatch(/signal\.onAbort\?\.\(\(\) => \{\s*controller\.abort\(\)/)
    expect(pipelines).toMatch(/agentTurn\(settings, messages, tools, controller\.signal\)/)
    expect(pipelines).toMatch(/usePipelines\(\{[^}]*\bllmFor,/)
  })
})

describe('directional icons in Arabic and Urdu (mobile-6)', () => {
  it('turns round a glyph that points along the line, and nothing else', () => {
    expect(mirrorFor('chevron-right', true)).toEqual({ transform: [{ scaleX: -1 }] })
    expect(mirrorFor('chevron-left', true)).toEqual({ transform: [{ scaleX: -1 }] })
    expect(mirrorFor('arrow-right', true)).toEqual({ transform: [{ scaleX: -1 }] })
    expect(mirrorFor('chevron-right', false)).toBeUndefined()
    expect(mirrorFor('chevrons-down', true)).toBeUndefined()
    expect(isDirectional('check')).toBe(false)
  })

  it('draws every directional glyph through Icon, including inside buttons and menus', () => {
    const raw = sources(SRC)
      .filter(([file]) => file !== path.join('components', 'ui', 'Icon.tsx'))
      .flatMap(([file, src]) =>
        [...src.matchAll(/<Feather\s+name=(?:"([^"]+)"|\{([^}]+)\})/g)]
          .filter((m) => (m[1] !== undefined ? isDirectional(m[1]) : false))
          .map(() => file),
      )
    expect(raw).toEqual([])
    expect(read('components/ui/Button.tsx')).not.toMatch(/<Feather\b/)
    expect(read('components/ui/Menu.tsx')).toMatch(/<Icon name=\{a\.icon\}/)
  })
})

describe('Saved servers on the phone (health-2, health-3)', () => {
  const settings = read('screens/SettingsScreen.tsx')

  it('saves a connected server with its provider and key, as the web does', () => {
    expect(settings).toMatch(
      /remember\(\{\s*name: label,\s*endpoint,\s*model: found,\s*provider: settings\.provider,\s*\.\.\.\(settings\.apiKey \? \{ apiKey: settings\.apiKey \} : \{\}\),?\s*\}\)/,
    )
    expect(read('lib/model-settings.tsx')).toMatch(/provider\?: string[;\s]+apiKey\?: string/)
  })

  it('loads a saved row back with its own provider and key', () => {
    expect(settings).toMatch(
      /provider: providerMeta\(server\.provider \?\? settings\.provider\)\.id/,
    )
    expect(settings).toMatch(/apiKey: server\.apiKey \?\? settings\.apiKey/)
  })

  it('keeps the model the person chose when the server lists it, and on a failed test (Q172)', () => {
    expect(settings).toMatch(
      /const found = current && result\.models\.includes\(current\) \? current : \(result\.models\[0\] \?\? ''\)/,
    )
    const failure = /if \(!result\.ok\) \{([\s\S]*?)return\s*\}/.exec(settings)?.[1] ?? ''
    expect(failure).toContain('setFailure(result.reason)')
    expect(failure).not.toMatch(/setModel\(/)
  })
})

describe('Undo last in the audit log (health-5)', () => {
  const audit = read('components/common/AuditLog.tsx')

  it('is off for a trimmed entry, which repo.revert cannot put back', () => {
    expect(audit).toMatch(
      /const canUndo = top !== undefined && !wholeStore && top\.trimmed !== true/,
    )
  })

  it('says why, by case, in every language', () => {
    expect(audit).toMatch(/t\('audit\.cannotUndoTrimmed'\)/)
    for (const locale of LOCALES) {
      const value = catalog(locale, 'components').audit?.cannotUndoTrimmed
      expect(typeof value === 'string' && value.length > 0, locale).toBe(true)
    }
  })
})

describe('the toast Close button (i18n-5)', () => {
  it('reads and is announced in the language on screen', () => {
    const toast = read('lib/toast.tsx')
    expect(toast).not.toMatch(/>Close</)
    expect(toast).not.toMatch(/accessibilityLabel="Dismiss"/)
    expect(toast).toMatch(/accessibilityLabel=\{t\('actions\.close'\)\}/)
    expect(toast).toMatch(/\{t\('actions\.close'\)\}<\/Text>/)
  })
})

describe('the status notice on More (i18n-12)', () => {
  it('stays the single English source, says so in the reader’s language, and is voiced as English', () => {
    const more = read('screens/MoreScreen.tsx')
    expect(more).toMatch(/\{STATUS_HEADLINE\}/)
    expect(more).toMatch(/t\('more\.statusEnglish'\)/)
    expect((more.match(/accessibilityLanguage="en"/g) ?? []).length).toBe(3)
    for (const locale of LOCALES) {
      const value = catalog(locale, 'screens').more?.statusEnglish
      expect(typeof value === 'string' && value.length > 0, locale).toBe(true)
    }
  })
})
