import { describe, expect, it } from 'vitest'
import ladder from '@/components/guide/overview/Ladder.tsx?raw'
import en from '@/i18n/locales/en/guide.json'

/**
 * Q100 — the guide's Ladder describes the setup as it is now, not the old
 * localhost pairing bridge. Source read (D20); comments stripped, because the
 * Ladder's own comment explains that the bridge half went. The words live in
 * the English catalog now, so that is read too: the source names each rung by
 * id, and the catalog holds what the rung says.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const code = strip(ladder)
const words = JSON.stringify(en.overview.ladder)

describe('the Ladder (Q100)', () => {
  it('says nothing about a bridge or a pairing token', () => {
    expect(code).not.toMatch(/bridge/i)
    expect(code).not.toMatch(/pairing|token/i)
    expect(words).not.toMatch(/bridge/i)
    expect(words).not.toMatch(/pairing|token/i)
  })

  it('climbs the rungs that exist: browser, backup, local model, document reader, extension', () => {
    const layers: Record<string, { name: string }> = en.overview.ladder.layers
    const rungs = [...code.matchAll(/id: '([^']+)'/g)].map((m) => layers[m[1] ?? '']?.name)
    expect(rungs).toEqual([
      'Browser only',
      '+ A backup you keep',
      '+ Local model',
      '+ Document reader',
      '+ The extension',
    ])
  })
})
