import { writeFileSync } from 'node:fs'
import { test } from 'vitest'
import { CATALOG, toFunctionSpec } from './catalog'
import type { JsonSchema } from './json-schema'
const L: string[] = []
const log = (...a: unknown[]) => L.push(a.map(String).join(' '))
const T = (n: number) => Math.round(n / 3.6)
const ID_SENT = 'The id of an existing record, exactly as a read tool returned it.'
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// walk a schema, applying a transform to each (key,node) pair
function walk(s: JsonSchema, key: string | undefined, f: (n: JsonSchema, k?: string) => JsonSchema): JsonSchema {
  let out = f({ ...s }, key)
  if (out.properties) {
    const p: Record<string, JsonSchema> = {}
    for (const [k, v] of Object.entries(out.properties)) p[k] = walk(v, k, f)
    out = { ...out, properties: p }
  }
  if (out.items) out = { ...out, items: walk(out.items, undefined, f) }
  return out
}
const strip = (d: string | undefined, ph: string) => d?.split(ph).join('').replace(/\s+/g, ' ').trim()
function setDesc(n: JsonSchema, d: string | undefined): JsonSchema {
  const { description: _x, ...rest } = n
  return d && d.length > 0 ? { ...rest, description: d } : rest
}

const t1 = (n: JsonSchema) =>
  n.description?.includes('Must be the id of a') ? setDesc(n, strip(n.description, ID_SENT)) : n
const t2 = (n: JsonSchema, k?: string) => {
  if (!k || !n.description) return n
  const first = n.description.split('. ')[0]
  return norm(first) === norm(k) ? setDesc(n, n.description.slice(first.length + 1).trim()) : n
}
const t3 = (n: JsonSchema) =>
  n.description?.includes('May be omitted.') ? setDesc(n, strip(n.description, 'May be omitted.')) : n
const t5 = (n: JsonSchema) =>
  n.format === 'date' || n.format === 'date-time'
    ? setDesc(n, strip(strip(n.description, 'A calendar day, as 2026-08-22.'), 'An exact time, ISO 8601, as 2026-08-22T14:30:00.000Z.'))
    : n

function total(fs: ((n: JsonSchema, k?: string) => JsonSchema)[], descFn?: (d: string) => string) {
  const specs = CATALOG.map((e) => {
    const s = toFunctionSpec(e)
    let p = s.function.parameters
    for (const f of fs) p = walk(p, undefined, f)
    return { ...s, function: { ...s.function, description: descFn ? descFn(s.function.description) : s.function.description, parameters: p } }
  })
  return JSON.stringify(specs).length
}

test('m3', () => {
  const base = total([])
  log(`BASE                       ${base} ch  ${T(base)} tok`)
  const cases: [string, ((n: JsonSchema, k?: string) => JsonSchema)[]][] = [
    ['T1 drop generic id sentence', [t1]],
    ['T2 drop label==key', [t2]],
    ['T3 drop "May be omitted."', [t3]],
    ['T5 drop date/instant prose', [t5]],
    ['T1+T2', [t1, t2]],
    ['T1+T2+T3', [t1, t2, t3]],
    ['T1+T2+T3+T5', [t1, t2, t3, t5]],
  ]
  for (const [nm, fs] of cases) {
    const c = total(fs)
    log(`${nm.padEnd(28)} ${c} ch  ${T(c)} tok   saved ${T(base - c)} tok (${((1 - c / base) * 100).toFixed(1)}%)`)
  }
  // how many descriptions vanish entirely under T1+T2+T3
  let gone = 0, kept = 0
  for (const e of CATALOG) {
    walk(toFunctionSpec(e).function.parameters, undefined, (n, k) => {
      if (n.description === undefined) return n
      const after = [t1, t2, t3].reduce<JsonSchema>((acc, f) => f(acc, k), n)
      if (after.description === undefined) gone++
      else kept++
      return n
    })
  }
  log(`descriptions: ${gone} become empty, ${kept} retain real prose`)

  // create/update near-duplicate pairs
  const byName = new Map(CATALOG.map((e) => [e.name, e]))
  let pairCh = 0
  const pairs: string[] = []
  for (const e of CATALOG) {
    if (!e.name.endsWith('.create')) continue
    const u = byName.get(e.name.replace(/\.create$/, '.update'))
    if (!u) continue
    const cs = JSON.stringify(toFunctionSpec(e)).length
    const us = JSON.stringify(toFunctionSpec(u)).length
    pairCh += Math.min(cs, us)
    pairs.push(`  ${e.name} ${T(cs)} / ${u.name} ${T(us)}`)
  }
  log(`create+update pairs: ${pairs.length}, collapsing each saves the smaller = ${T(pairCh)} tok`)
  for (const p of pairs) log(p)
  writeFileSync(process.env.OUTF!, L.join('\n'))
})
