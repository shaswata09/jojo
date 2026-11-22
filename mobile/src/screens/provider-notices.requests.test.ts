/**
 * The phone's provider notices and its privacy link (2026-11-21).
 *
 * Three disclosure gaps, each pinned on the source that closes it (screens are
 * React Native and are not rendered here — see `vitest.config.mts`):
 *
 * - The cloud-provider consent notice was English in all twenty languages:
 *   `CloudTerms` rendered core's sentences with no `t()` on the path. It now
 *   hands core this screen's translator, and the English catalog must say
 *   exactly what core says (`CLOUD_TERMS_EN`), so there is one English.
 * - A model server typed under "Ollama" or "a local server" at a public
 *   address got no notice at all, because neither provider is `cloud`. The
 *   endpoint field now says so, by core's `isRemoteEndpoint`.
 * - The privacy notice had no link from the phone. More now opens the
 *   published copy at core's `PRIVACY_URL`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLOUD_TERMS_EN } from '@jojo/service/core/cloud-terms'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const read = (file: string) => strip(readFileSync(path.join(HERE, file), 'utf8'))
const screensEn = JSON.parse(
  readFileSync(path.join(HERE, '..', 'i18n', 'locales', 'en', 'screens.json'), 'utf8'),
) as {
  settings: { cloudNotice?: unknown; model: Record<string, string> }
  more: Record<string, unknown>
}

describe('the cloud notice, in the reader’s language', () => {
  const settings = read('SettingsScreen.tsx')

  it('reads core’s sentences through this screen’s translator', () => {
    expect(settings).toMatch(
      /cloudTerms\(provider, \(key, options\) => t\(`settings\.cloudNotice\.\$\{key\}`, options\)\)/,
    )
    expect(settings).not.toMatch(/cloudTerms\(provider\)/)
  })

  it('holds the notice in the English core writes it in', () => {
    expect(screensEn.settings.cloudNotice).toEqual(CLOUD_TERMS_EN)
  })
})

describe('a model server somewhere else', () => {
  it('gets a notice under the address when it is not on this phone’s network', () => {
    const settings = read('SettingsScreen.tsx')
    expect(settings).toMatch(/!provider\.fixedEndpoint && isRemoteEndpoint\(endpoint\) \?/)
    expect(settings).toContain("t('settings.model.remote')")
    expect(screensEn.settings.model['remote']).toMatch(/not on this device or your local network/)
  })
})

describe('the privacy notice, from More', () => {
  it('opens the published notice at core’s address', () => {
    const more = read('MoreScreen.tsx')
    expect(more).toContain("from '@jojo/service/core/privacy'")
    expect(more).toMatch(/Linking\.openURL\(PRIVACY_URL\)/)
    expect(more).toContain("t('more.privacy')")
    expect(typeof screensEn.more['privacy']).toBe('string')
  })
})
