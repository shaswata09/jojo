/**
 * Q328 — the full review of 2026-11-16, the phone's half: each fix pinned
 * where a refactor would undo it. These files import React Native, which this
 * runner does not load (see vitest.config.mts), so they are read as text with
 * comments removed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) =>
  readFileSync(path.join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('sheets hold their content (Q328)', () => {
  const sheet = read('components/ui/Sheet.tsx')

  it('measure their 92% cap against the screen, not against their own content', () => {
    expect(sheet).toMatch(/keyboard: \{ flex: 1, justifyContent: 'flex-end' \}/)
  })

  it('scroll a body sized to its content, so nothing is drawn through the footer', () => {
    expect(sheet).toMatch(/scroll = size === 'auto'/)
    expect(sheet).toMatch(/\{scroll \? \(\s*<ScrollView/)
  })

  it('let the tall forms that outgrow the screen scroll too', () => {
    for (const file of ['screens/vault/FileViewer.tsx', 'screens/vault/PeopleTool.tsx']) {
      expect(read(file), file).toMatch(/size="tall"\s*scroll\b/)
    }
  })
})

describe('edits that undo and save what they say (Q328)', () => {
  it('opens the note editor on the record’s current note, not the one at mount', () => {
    expect(read('screens/ApplicationDetailScreen.tsx')).toMatch(
      /if \(!editingNote\) setNote\(a\.note\)\s*\}, \[a\.note, editingNote\]\)/,
    )
  })

  it('moves the calendar deadline by comparing with the one stored, not the one it opened with', () => {
    expect(read('sheets/ApplicationSheet.tsx')).toMatch(
      /if \(form\.deadline === \(existing\?\.date \?\? ''\)\) return null/,
    )
  })

  it('takes back every field an event edit wrote, including ones it added', () => {
    expect(read('sheets/TimelineItemSheet.tsx')).toMatch(
      /for \(const key of Object\.keys\(patch\)\)\s*revert\[key\] = beforeItem\[key as keyof TimelineItem\]/,
    )
  })

  it('asks before Cancel throws away a half-written snippet', () => {
    expect(read('screens/vault/SnippetsTool.tsx')).toMatch(
      /label="Cancel"[^\n]*onPress=\{askOrClose\}/,
    )
  })

  it('says saving the profile writes it to the phone', () => {
    const profile = read('screens/ProfileScreen.tsx')
    expect(profile).toMatch(/saving writes them to this phone/)
    expect(profile).not.toMatch(/not to disk/)
  })
})

describe('links into a tab that is already open (Q328)', () => {
  it('apply a stage or a sort to Applications, then clear them', () => {
    expect(read('screens/ApplicationsScreen.tsx')).toMatch(
      /navigation\.setParams\(\{ stage: undefined, sort: undefined \}\)/,
    )
  })

  it('clear the Vault tool and the Calendar date once followed, so the same link works twice', () => {
    expect(read('screens/vault/VaultScreen.tsx')).toMatch(
      /navigation\.setParams\(\{ tool: undefined \}/,
    )
    expect(read('screens/CalendarScreen.tsx')).toMatch(
      /navigation\.setParams\(\{ date: undefined \}/,
    )
  })
})

describe('the phone counts the same features the web does (Q328)', () => {
  /** Every non-test source file under src, read raw. */
  const all = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) return all(full)
      return /\.tsx?$/.test(name) && !name.includes('.test.') ? [readFileSync(full, 'utf8')] : []
    })
  const sent = new Set(
    all(SRC).flatMap((src) => [...src.matchAll(/report\('([a-z_]+)'/g)].map((m) => m[1]!)),
  )

  it('sends each feature event the web sends, so opted-in phone usage is not just opens', () => {
    // `transfer_completed` and `backup_used` belong to the transfer work, which
    // has its own owner and wiring; the rest are the phone's to send.
    for (const event of [
      'application_created',
      'application_advanced',
      'assistant_asked',
      'assistant_tool_decided',
      'scout_pipeline_started',
      'scout_proposal_decided',
      'vault_item_added',
      'model_connected',
      'model_failed',
      'reader_connected',
      'tour_used',
    ]) {
      expect(sent, event).toContain(event)
    }
  })

  it('reads a CV into the profile in one undoable write, as the web does', () => {
    const offer = read('components/profile/ProfileUpdateOffer.tsx')
    expect(offer).toMatch(/run\('profile\.background\.import'/)
    expect(offer).not.toMatch(/run\('claim\.add'/)
    expect(offer).toMatch(/action: \{ label: 'Undo', onPress: undo \}/)
  })
})

describe("the profile's sector switches reach the scout (Q328)", () => {
  it("appends the sector rule to every scout round's instructions", () => {
    // Resolved through the package's exports map, as any import is.
    const file = createRequire(import.meta.url).resolve('@jojo/service/react/use-pipelines')
    const pipelines = readFileSync(file, 'utf8')
    expect(pipelines).toMatch(
      /const sector = profile \? sectorRule\(profile\) : ''\s*if \(sector\) parts\.push\(sector\)/,
    )
  })
})
