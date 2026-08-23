import { test } from 'vitest'
import { writeFileSync, appendFileSync } from 'node:fs'
const F = process.env.SCRATCH + '/s2.txt'
writeFileSync(F, '')
const OUT = (...a: unknown[]) => appendFileSync(F, a.join(' ') + '\n')
import { CATALOG, toFunctionSpec } from './catalog'
const tok = (n: number) => Math.round(n / 3.6)
const L = (x: unknown) => JSON.stringify(x).length

test('p2', () => {
  for (const n of ['application.update', 'application.stage.advance', 'graph.query', 'vault.file.add']) {
    const e = CATALOG.find((x) => x.name === n)!
    OUT('=====', n, tok(L(toFunctionSpec(e))))
    OUT(JSON.stringify(e.parameters, null, 1).slice(0, 2600))
  }
  // duplicated property shapes, top offenders
  const seen = new Map<string, { n: number; len: number }>()
  for (const e of CATALOG) {
    const p = (e.parameters as any).properties ?? {}
    for (const k of Object.keys(p)) {
      const key = k + '::' + JSON.stringify(p[k])
      const cur = seen.get(key) ?? { n: 0, len: JSON.stringify(p[k]).length }
      cur.n++; seen.set(key, cur)
    }
  }
  const top = [...seen].map(([k, v]) => ({ k: k.split('::')[0], n: v.n, len: v.len, waste: v.len * (v.n - 1) }))
    .sort((a, b) => b.waste - a.waste).slice(0, 15)
  OUT('===== TOP DUPLICATED PROPERTY SHAPES (chars wasted)')
  for (const t of top) OUT(`${t.k} x${t.n} len=${t.len} waste=${t.waste} (${tok(t.waste)} tok)`)
})
