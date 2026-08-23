import { writeFileSync } from 'node:fs'
import { test } from 'vitest'
import { CATALOG, toFunctionSpec } from './catalog'
const L: string[] = []
const log = (...a: unknown[]) => L.push(a.map(String).join(' '))
const T = (n: number) => Math.round(n / 3.6)
test('m4', () => {
  const blob = JSON.stringify(CATALOG.map(toFunctionSpec))
  // enum cost
  let enumCh = 0
  const enums = new Map<string, number>()
  const w = (s: any) => {
    if (!s || typeof s !== 'object') return
    if (Array.isArray(s.enum)) {
      const j = JSON.stringify(s.enum)
      enumCh += j.length
      enums.set(j, (enums.get(j) ?? 0) + 1)
    }
    if (s.properties) Object.values(s.properties).forEach(w)
    if (s.items) w(s.items)
    if (s.additionalProperties && typeof s.additionalProperties === 'object') w(s.additionalProperties)
  }
  CATALOG.forEach((e) => w(toFunctionSpec(e).function.parameters))
  log(`enum arrays total ${enumCh} ch = ${T(enumCh)} tok`)
  const rep = [...enums.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] * b[0].length - a[1] * a[0].length)
  log('repeated enums (dup cost = (n-1)*len):')
  let dup = 0
  for (const [j, c] of rep.slice(0, 12)) { dup += (c - 1) * j.length; log(`  x${c} ${(c - 1) * j.length} ch  ${j.slice(0, 90)}`) }
  log(`total duplicate-enum bytes ${dup} = ${T(dup)} tok`)

  // graph.query full
  log('=== graph.query params ===')
  log(JSON.stringify(CATALOG.find((c) => c.name === 'graph.query')!.parameters))
  // title+summary of the 8 reads
  log('=== reads ===')
  for (const e of CATALOG.slice(0, 10)) log(`  ${e.name} ${T(JSON.stringify(toFunctionSpec(e)).length)} tok :: ${e.effect}`)
  // total read block
  const reads = CATALOG.filter((e) => e.effect === 'read')
  log(`reads: ${reads.length} tools, ${T(JSON.stringify(reads.map(toFunctionSpec)).length)} tok`)
  log(`blob ${blob.length}`)
  writeFileSync(process.env.OUTF!, L.join('\n'))
})
