import { writeFileSync } from "node:fs"
import { test } from 'vitest'
import { CATALOG, describeEntry, functionSpecs, toFunctionSpec } from './catalog'

const L: string[] = []
const console2 = { log: (...a: unknown[]) => L.push(a.map(String).join(" ")) }
const T = (n: number) => Math.round(n / 3.6)

test('measure', () => {
  const specs = functionSpecs()
  const total = JSON.stringify(specs).length
  console2.log('TOTAL chars', total, 'tok', T(total))

  // per-tool breakdown
  let nameCh = 0, descCh = 0, paramCh = 0
  const rows = CATALOG.map((e) => {
    const s = toFunctionSpec(e)
    const whole = JSON.stringify(s).length
    const d = JSON.stringify(s.function.description).length
    const p = JSON.stringify(s.function.parameters).length
    const n = JSON.stringify(s.function.name).length
    nameCh += n; descCh += d; paramCh += p
    return { name: e.name, whole, d, p, tok: T(whole), dtok: T(d), ptok: T(p) }
  })
  console2.log('name chars', nameCh, T(nameCh), '| desc chars', descCh, T(descCh), '| param chars', paramCh, T(paramCh))
  rows.sort((a, b) => b.whole - a.whole)
  console2.log('TOP 20:')
  for (const r of rows.slice(0, 20)) console2.log(`  ${r.name.padEnd(30)} ${String(r.tok).padStart(4)} = desc ${String(r.dtok).padStart(4)} + params ${String(r.ptok).padStart(4)}`)

  // repeated boilerplate frequency
  const blob = JSON.stringify(specs)
  const phrases = [
    'The id of an existing record, exactly as a read tool returned it.',
    'Must be the id of a ',
    'May be omitted.',
    'May be null to clear it.',
    '"additionalProperties":false',
    'A calendar day, as 2026-08-22.',
    'An exact time, ISO 8601, as 2026-08-22T14:30:00.000Z.',
    'Destructive: this removes a record. Confirm with the user before calling it.',
    'Destructive and NOT undoable:',
    '"type":"object"',
    '"type":"string"',
    '"description":',
    '"required":',
  ]
  for (const ph of phrases) {
    const c = blob.split(ph).length - 1
    console2.log(`  x${String(c).padStart(3)}  ${c * ph.length} ch  ${T(c * ph.length)} tok  :: ${ph.slice(0, 60)}`)
  }
  writeFileSync('/private/tmp/claude-501/-Users-shaswatamitra-Desktop-Files-Work-Projects-github-jojo/f34d0cf9-cc58-4b88-94a8-d8f177bf948d/scratchpad/q1.txt', L.join('\n'))
})