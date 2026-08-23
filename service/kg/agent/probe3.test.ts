import { test } from 'vitest'
import { writeFileSync, appendFileSync } from 'node:fs'
const F = process.env.SCRATCH + '/s3.txt'
writeFileSync(F, '')
const OUT = (...a: unknown[]) => appendFileSync(F, a.join(' ') + '\n')
import { CATALOG, toFunctionSpec, describeEntry } from './catalog'
const tok = (n: number) => Math.round(n / 3.6)
const L = (x: unknown) => JSON.stringify(x).length
const cost = (names: string[]) => L(CATALOG.filter((e) => names.includes(e.name)).map(toFunctionSpec))
const ALL = L(CATALOG.map(toFunctionSpec))

test('p3', () => {
  OUT('ALL', ALL, tok(ALL))
  // --- boilerplate in field descriptions
  const blob = JSON.stringify(CATALOG.map((e) => e.parameters))
  const phrases = [
    'May be omitted.',
    'The id of an existing record, exactly as a read tool returned it.',
    'May be null to clear it.',
    'A calendar day, as 2026-08-22.',
    'An exact time, ISO 8601, as 2026-08-22T14:30:00.000Z.',
  ]
  for (const p of phrases) {
    const n = blob.split(p).length - 1
    OUT(`phrase "${p.slice(0, 40)}" x${n} = ${n * p.length} ch ${tok(n * p.length)} tok`)
  }
  // --- shape-identical merges
  const props = (n: string) => Object.keys(((CATALOG.find((e) => e.name === n)!.parameters as any).properties) ?? {})
  const byShape = new Map<string, string[]>()
  for (const e of CATALOG) {
    if (e.effect === 'read') continue
    const p = (e.parameters as any).properties ?? {}
    const req = (e.parameters as any).required ?? []
    const key = Object.keys(p).sort().join(',') + '|req:' + [...req].sort().join(',')
    byShape.set(key, [...(byShape.get(key) ?? []), e.name])
  }
  OUT('--- IDENTICAL ARG-SHAPE CLUSTERS (writes)')
  let clusterSave = 0
  for (const [k, list] of [...byShape].sort((a, b) => b[1].length - a[1].length)) {
    if (list.length < 2) continue
    const c = cost(list)
    const one = Math.max(...list.map((n) => cost([n])))
    OUT(`  [${k}] x${list.length}: ${list.join(' ')} | now ${tok(c)} tok, merged<=${tok(one)} tok, save ${tok(c - one)}`)
    clusterSave += c - one
  }
  OUT('IDENTICAL-SHAPE MERGE SAVING', clusterSave, tok(clusterSave))
  // --- create+update pairs
  OUT('--- CREATE/UPDATE PAIRS')
  const pairs: [string, string][] = [
    ['application.create', 'application.update'],
    ['timeline.item.create', 'timeline.item.update'],
    ['vault.link.save', 'vault.link.update'],
    ['vault.file.add', 'vault.file.update'],
    ['vault.snippet.create', 'vault.snippet.update'],
    ['scout.posting.save', 'scout.posting.update'],
    ['scout.match.save', 'scout.match.update'],
    ['scout.pipeline.create', 'scout.pipeline.update'],
    ['assistant.thread.create', 'assistant.thread.set'],
  ]
  let pairSave = 0
  for (const [a, b] of pairs) {
    const ea = CATALOG.find((e) => e.name === a), eb = CATALOG.find((e) => e.name === b)
    if (!ea || !eb) { OUT('  MISSING', a, b); continue }
    const pa = new Set(props(a)), pb = new Set(props(b))
    const onlyA = [...pa].filter((x) => !pb.has(x)), onlyB = [...pb].filter((x) => !pa.has(x))
    const merged = Math.max(cost([a]), cost([b])) + 60 // + an optional id field
    const now = cost([a, b])
    pairSave += now - merged
    OUT(`  ${a}+${b}: now ${tok(now)}, merged ~${tok(merged)}, save ${tok(now - merged)} | onlyCreate=[${onlyA}] onlyUpdate=[${onlyB}]`)
  }
  OUT('CREATE/UPDATE MERGE SAVING', pairSave, tok(pairSave))
  // --- how many tools are pure {id}
  const idOnly = CATALOG.filter((e) => {
    const p = Object.keys(((e.parameters as any).properties) ?? {})
    return p.length === 1 && p[0] === 'id'
  })
  OUT('PURE {id} TOOLS', idOnly.length, idOnly.map((e) => e.name).join(' '), 'cost', tok(cost(idOnly.map((e) => e.name))))
})
