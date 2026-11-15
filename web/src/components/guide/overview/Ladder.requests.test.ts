import { describe, expect, it } from 'vitest'
import ladder from '@/components/guide/overview/Ladder.tsx?raw'

/**
 * Q100 — the guide's Ladder describes the setup as it is now, not the old
 * localhost pairing bridge. Source read (D20); comments stripped, because the
 * Ladder's own comment explains that the bridge half went.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const code = strip(ladder)

describe('the Ladder (Q100)', () => {
  it('says nothing about a bridge or a pairing token', () => {
    expect(code).not.toMatch(/bridge/i)
    expect(code).not.toMatch(/pairing|token/i)
  })

  it('climbs the rungs that exist: browser, backup, local model, document reader, extension', () => {
    const rungs = [...code.matchAll(/name: '([^']+)'/g)].map((m) => m[1])
    expect(rungs).toEqual([
      'Browser only',
      '+ A backup you keep',
      '+ Local model',
      '+ Document reader',
      '+ The extension',
    ])
  })
})
