/**
 * Q184: filing a document in the Applications bucket asks the person (the
 * profile update offer) before reading it into their profile, and only what
 * they approve is added.
 *
 * WHEN to ask is a pure rule in `service/kg/core/twin.ts`, held by
 * `twin.test.ts` ("takes the bucket as the signal, whatever the file is
 * called", "offers a document nobody has been asked about yet"). What only
 * exists in the component is the order — ask, read, show, and write only on the
 * person's confirm — so D20 leaves a narrow source read.
 */

import { describe, expect, it } from 'vitest'
import offer from './ProfileUpdateOffer.tsx?raw'
import shell from '@/components/layout/AppShell.tsx?raw'

/** One `const name = (async) () => { … }` handler, up to its closing brace. */
const handler = (name: string) =>
  new RegExp(`const ${name} = (?:async )?\\(\\) => \\{[\\s\\S]*?\\n {2}\\}\\n`).exec(offer)?.[0] ?? ''

describe('Q184 — a document filed for applications is read into the profile only with consent', () => {
  it('is on every page, deciding what to offer from the newly readable documents', () => {
    expect(shell).toContain('<ProfileUpdateOffer />')
    expect(offer).toMatch(/newlyReadable\(\s*seen,\s*twinState\(graph, 12, \(f\) => blobs\.has\(f\.id\)\),?\s*\)/)
  })

  it('reads only when the person presses Read it', () => {
    const accept = handler('accept')
    expect(accept).toContain('const outcome = await readCv({')
    expect(offer).toMatch(/onClick=\{\(\) => \{\s*void accept\(\)/)
  })

  it('writes nothing while reading — the profile changes only on confirm', () => {
    expect(handler('accept')).not.toMatch(/\brun\(/)
    const writes = offer.match(/\brun\('[^']+'/g) ?? []
    expect(writes).toEqual(["run('profile.background.import'"])
    expect(handler('confirm')).toContain("run('profile.background.import', {")
    expect(offer).toMatch(/<Button size="sm" onClick=\{confirm\}/)
  })

  it('adds only the entries the person kept', () => {
    const confirm = handler('confirm')
    expect(confirm).toContain('.filter(({ at }) => !dropped.has(at))')
    expect(confirm).toContain('background: keeping.map(({ draft }) => draft),')
  })
})
