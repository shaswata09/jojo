/**
 * Q165: when a record cannot be read, the banner that says so leads to a list
 * that names it.
 *
 * It used to point at "Settings → Diagnostics" in words, and the panel there
 * listed nothing anybody recognised. The fix is a link with a `focus` the panel
 * scrolls to and lights, and a row that names the skipped records by id — read
 * from the same `sessionOf(state).skipped` the banner counts. All of it is JSX
 * (D20), so it is pinned as source; `settingsPath` is called for real.
 */

import { describe, expect, it } from 'vitest'
import { settingsPath } from '@/lib/links'
import bannerSource from './StorageBanner.tsx?raw'
import layoutCatalog from '@/i18n/locales/en/layout.json?raw'
import diagnosticsSource from '@/components/settings/Diagnostics.tsx?raw'
import settingsSource from '@/routes/Settings.tsx?raw'

const strip = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

const banner = strip(bannerSource)
const diagnostics = strip(diagnosticsSource)

describe('the unreadable-record banner (Q165)', () => {
  it('counts the records the boot skipped', () => {
    expect(banner).toContain('const skipped = sessionOf(state)?.skipped ?? []')
    expect(banner).toMatch(/if \(skipped\.length > 0\) \{/)
  })

  it('links to the skipped-records row in Settings, not to the page in general', () => {
    const notice = banner.slice(banner.indexOf('if (skipped.length > 0) {'))
    expect(notice).toMatch(/<Link\s+to=\{settingsPath\(\{ focus: 'skipped' \}\)\}/)
    expect(settingsPath({ focus: 'skipped' })).toBe('/settings?focus=skipped')
  })
})

describe('Settings → Diagnostics (Q165)', () => {
  it('is on the Settings page', () => {
    expect(strip(settingsSource)).toMatch(/<Diagnostics\s*\/>/)
  })

  it('names every skipped record, read from the same session the banner counts', () => {
    expect(diagnostics).toContain('const session = sessionOf(state)')
    expect(diagnostics).toContain("(session?.skipped ?? []).map((d) => d.id).join(', ')")
  })

  it('scrolls to that row and lights it when the banner’s link arrives', () => {
    expect(diagnostics).toMatch(
      /if \(focus !== 'skipped'\) return\s*skippedRef\.current\?\.scrollIntoView\(/,
    )
    const row = diagnostics.slice(diagnostics.indexOf('ref={skippedRef}'))
    expect(row.slice(0, 300)).toContain("focus === 'skipped' ? 'arrival-highlight'")
  })
})

/**
 * Q097: a substantial change prompts a backup download, on screen, persistently.
 *
 * `useBackup` computed `shouldNudge` and nothing read it. The counting and the
 * "Not now" rule are tested as functions in `lib/backup.test.ts`; what is
 * pinned here is the JSX that shows them (D20).
 */
describe('the backup prompt (Q097)', () => {
  const prompt = banner.slice(banner.indexOf('function BackupPrompt()'))

  it('is the last arm of the storage banner, below every failure', () => {
    const main = banner.slice(
      banner.indexOf('export function StorageBanner()'),
      banner.indexOf('function BackupPrompt()'),
    )
    expect(main.trimEnd()).toMatch(/return <BackupPrompt \/>\s*\}$/)
    expect(main.lastIndexOf('return null')).toBe(-1)
  })

  it('shows only when useBackup says a substantial change has gone unbacked-up', () => {
    expect(prompt).toContain('const backup = useBackup(exportJSON)')
    expect(prompt).toMatch(/if \(!backup\.shouldNudge\) return null/)
    expect(prompt).toContain('backupPromptText(backup.changed, backup.lastBackupAt)')
  })

  it('downloads the same backup Settings does, and says how it went', () => {
    expect(prompt).toContain('const name = exportFilename(new Date())')
    expect(prompt).toMatch(/backup\s*\.download\(name\)/)
    expect(prompt).toContain('backupToast(outcome, name)')
    expect(prompt).toMatch(/onClick=\{onDownload\}>[\s\S]*?t\('banner\.backup\.download'\)/)
    expect(JSON.parse(layoutCatalog).banner.backup.download).toBe('Download a backup')
  })

  it('can be put away until the next substantial change', () => {
    expect(prompt).toMatch(/onClick=\{backup\.dismiss\}>\s*\{t\('banner\.backup\.notNow'\)\}/)
    expect(JSON.parse(layoutCatalog).banner.backup.notNow).toBe('Not now')
  })
})
