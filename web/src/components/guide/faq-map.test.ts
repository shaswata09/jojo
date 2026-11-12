/**
 * The FAQ page's map names over a hundred files. A map whose names have rotted
 * sends a reader to put code somewhere that no longer exists, so every path it
 * names must still be in the repo.
 *
 * Listed with FILE-relative globs, as `code-structure.test.ts` does, so the
 * test walks out of the app without `node:fs`. Lazy rather than eager: only the
 * keys are wanted, and `?raw` keeps `check-no-copies` from reading these as
 * imports of the service.
 */

import { describe, expect, it } from 'vitest'
import { FAQ_FLOWS, FAQ_LAYERS, faqPaths } from './faq-map'

const listed = import.meta.glob(
  [
    '../../../../service/{kg,data,scripts,test}/**/*.{ts,tsx,mjs}',
    '../../../../web/{src,scripts}/**/*.{ts,tsx,mjs}',
    '../../../../web/extension/*.{js,json}',
    '../../../../mobile/{src,scripts}/**/*.{ts,tsx,mjs}',
    '../../../../mobile/App.tsx',
    '../../../../jojo-bridge.mjs',
    '../../../../gate.sh',
    '../../../../.github/workflows/ci.yml',
  ],
  { query: '?raw', import: 'default' },
)

/**
 * Repo-relative, the way the map spells them.
 *
 * Vite rewrites each key relative to THIS file, however the pattern was
 * written — a web file comes back as `../../../extension/bridge.js`, a service
 * file as `../../../../service/…` — so a key is resolved against this file's
 * folder rather than stripped of its leading `../`.
 */
const HERE = ['web', 'src', 'components', 'guide']
const repoPath = (key: string) => {
  const parts = key.startsWith('/') ? ['web', ...key.slice(1).split('/')] : [...HERE, ...key.split('/')]
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part !== '.') out.push(part)
  }
  return out.join('/')
}
const files = new Set(Object.keys(listed).map(repoPath))
// Vite leaves the calling module out of its own glob.
files.add('web/src/components/guide/faq-map.test.ts')

const exists = (path: string) =>
  files.has(path) || [...files].some((file) => file.startsWith(`${path}/`))

describe('the FAQ code map', () => {
  it('globbed the repo at all, so the check below is not vacuous', () => {
    expect(files.has('service/kg/core/model.ts')).toBe(true)
    expect(files.has('web/src/App.tsx')).toBe(true)
    expect(files.has('mobile/App.tsx')).toBe(true)
    expect(files.has('.github/workflows/ci.yml')).toBe(true)
  })

  it('names only paths that exist', () => {
    expect(faqPaths().filter((path) => !exists(path))).toEqual([])
  })

  it('draws every flow step in a layer the map defines', () => {
    const layers = new Set(FAQ_LAYERS.map((layer) => layer.id))
    for (const flow of FAQ_FLOWS) {
      for (const step of flow.steps) expect(layers.has(step.layer), step.path).toBe(true)
    }
  })
})
