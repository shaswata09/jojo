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
import { isDevMatch, isDevPack, shippedMatches } from '../../scripts/extension-origins.mjs'

/** Every API permission, and the one feature that would break without it. */
const WHY: Record<string, string> = {
  scripting: 'running the harvester in the tab being captured',
  tabs: 'reading the URL and title of the tab being captured',
  // Not redundant beside the broad host grant: a person can set the extension's
  // site access to "on click" (Chrome) or leave host access ungranted
  // (Firefox), and then the toolbar click's activeTab grant is the only thing
  // that lets "Keep this page" read the tab.
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

  it('ships the localhost dev ports only in a dev pack (review 2, security-1)', () => {
    // The checked-in list is the unpacked DEV build's. Vite's default ports are
    // every other local project's too, so the zip everyone downloads leaves
    // them out and keeps only the deployed origin.
    const matches = manifest.content_scripts[0]?.matches ?? []
    expect(matches.some(isDevMatch)).toBe(true)
    const shipped = shippedMatches(matches)
    expect(shipped).toEqual(['https://shaswata09.github.io/jojo/*'])
    expect(shipped.some(isDevMatch)).toBe(false)
    // A fork's origin is added, as a pattern with a path.
    expect(shippedMatches(matches, { origin: 'https://example.org/jojo/' })).toEqual([
      'https://shaswata09.github.io/jojo/*',
      'https://example.org/jojo/*',
    ])
    // A dev pack keeps them.
    expect(shippedMatches(matches, { dev: true })).toEqual(matches)
    expect(isDevPack(['--dev'], {})).toBe(true)
    expect(isDevPack([], { JOJO_PACK_DEV: '1' })).toBe(true)
    expect(isDevPack([], {})).toBe(false)
  })

  /*
   * The store description is the extension's one-line privacy claim. It said
   * "Nothing is uploaded anywhere", which was false: the extension relays the
   * model requests jojo writes to the provider the person chose, and those
   * carry a posting's text and parts of their records. The stores cut a
   * description at 132 characters.
   */
  it('says what it sends where, in a description the stores will show whole', () => {
    expect(manifest.description.length).toBeLessThanOrEqual(132)
    expect(manifest.description).not.toMatch(/nothing is uploaded/i)
    expect(manifest.description).toMatch(/model provider/i)
  })

  /*
   * Firefox requires new add-ons to declare what they transmit
   * (`data_collection_permissions`). Declared as `required` because the relay
   * is part of what the extension does and it asks no runtime opt-in; the two
   * categories are what a relayed model request can carry — a page's text,
   * and whatever of the person's own records jojo puts in the prompt. `none`
   * would be the false "nothing is uploaded" again, in another file.
   */
  it('declares to Firefox what it transmits, under an id on a domain jojo owns', () => {
    const gecko = manifest.browser_specific_settings.gecko
    expect(gecko.id).toBe('capture@askjojo.app')
    expect([...gecko.data_collection_permissions.required].sort()).toEqual([
      'personallyIdentifyingInfo',
      'websiteContent',
    ])
    expect(gecko.data_collection_permissions.required).not.toContain('none')
  })

  it('runs the bridge at document_idle, not document_start', () => {
    // `document_start` runs before the page's own scripts and before jojo has
    // decided anything. Nothing here needs to be that early.
    for (const entry of manifest.content_scripts) expect(entry.run_at).toBe('document_idle')
  })
})
