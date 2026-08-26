/**
 * What the extension asks the browser for, pinned so it cannot quietly grow.
 *
 * The install prompt is the only privacy statement most people will read, and
 * this manifest writes it. Adding one entry to `permissions` can turn "read the
 * page you are on" into "read and change all your data on all websites", and
 * nothing about the diff would look alarming.
 *
 * So each grant is listed here with the feature that needs it. A new one fails
 * this test, which is the point: the failure is a prompt to justify it in this
 * file, beside the others, rather than a line nobody reviewed.
 *
 * The broad host permission IS deliberate and is not a finding. Board scanning
 * means opening job boards a person configures themselves, and there is no
 * smaller set that can be known in advance. `optional_host_permissions` with a
 * per-board request at the moment a board is added would be better, and it is a
 * change that cannot be verified without loading the extension in a browser —
 * so it is not made blind. What this file does instead is make the current
 * grant deliberate and its widening loud.
 */
import { describe, expect, it } from 'vitest'
import manifest from '../../extension/manifest.json'
import pkg from '../../package.json'

/** Every API permission, and the one feature that would break without it. */
const WHY: Record<string, string> = {
  scripting: 'running the harvester in the tab being captured',
  tabs: 'reading the URL and title of the tab being captured',
  activeTab: 'temporary access to the current tab, granted by the toolbar click',
  storage: 'the extension’s own settings — which boards, which model hosts',
  unlimitedStorage: 'a captured posting is the whole page text, and can be large',
}

describe('the extension manifest', () => {
  it('asks for nothing that is not justified here', () => {
    expect([...manifest.permissions].sort()).toEqual(Object.keys(WHY).sort())
  })

  it('keeps the broad host grant to the two web schemes', () => {
    // Not `<all_urls>`, which also covers file:// and ftp://. Board scanning
    // opens web pages; it has no business reading the disk.
    expect([...manifest.host_permissions].sort()).toEqual(['http://*/*', 'https://*/*'])
  })

  it('injects its bridge only into jojo’s own origins', () => {
    // The content script is what lets the page talk to the worker, so its match
    // list is the boundary of who can ask the extension for anything. Every
    // entry must be a jojo deployment or a local dev server — a wildcard here
    // would hand any site the extension's permissions.
    for (const entry of manifest.content_scripts) {
      for (const match of entry.matches) {
        expect(match).toMatch(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/|^https:\/\/[^/*]+\//)
        expect(match).not.toContain('*://')
        expect(match).not.toMatch(/^https?:\/\/\*/)
      }
    }
  })

  it('carries the same version as the app it belongs to', () => {
    // The manifest's version was hardcoded, so a release that bumped
    // `web/package.json` shipped an extension still calling itself 0.1.0 — and
    // a browser decides whether an update is an update by comparing exactly
    // this string. Two places to edit and one of them silent is the shape of
    // every version bug; this makes the second one loud.
    expect(manifest.version).toBe(pkg.version)
  })

  it('runs the bridge at document_idle, not document_start', () => {
    // `document_start` runs before the page's own scripts and before jojo has
    // decided anything. Nothing here needs to be that early.
    for (const entry of manifest.content_scripts) expect(entry.run_at).toBe('document_idle')
  })
})
