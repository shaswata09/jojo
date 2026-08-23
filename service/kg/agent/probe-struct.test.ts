import { test } from 'vitest'
import { writeFileSync, appendFileSync } from 'node:fs'
const F = '/private/tmp/claude-501/-Users-shaswatamitra-Desktop-Files-Work-Projects-github-jojo/f34d0cf9-cc58-4b88-94a8-d8f177bf948d/scratchpad/struct.txt'
writeFileSync(F, '')
const OUT = (...a: unknown[]) => appendFileSync(F, a.join(' ') + '\n')
import { CATALOG, functionSpecs, toFunctionSpec, describeEntry } from './catalog'
import { TOOLS } from '../tools/index'
import { READS } from './queries'

const tok = (n: number) => Math.round(n / 3.6)
const L = (x: unknown) => JSON.stringify(x).length

test('probe', () => {
  const specs = functionSpecs()
  const total = L(specs)
  OUT('FULL', total, tok(total), 'entries', CATALOG.length)

  // breakdown
  let names = 0, descs = 0, params = 0
  for (const e of CATALOG) {
    names += L(e.wireName)
    descs += L(describeEntry(e))
    params += L(e.parameters)
  }
  OUT('names', names, tok(names), '| descs', descs, tok(descs), '| params', params, tok(params))
  OUT('envelope overhead', total - names - descs - params)

  // description text INSIDE schemas
  let schemaDesc = 0, schemaEnum = 0
  const walk = (s: any) => {
    if (!s || typeof s !== 'object') return
    if (typeof s.description === 'string') schemaDesc += L(s.description) + 14
    if (s.enum) schemaEnum += L(s.enum) + 7
    if (s.properties) for (const k of Object.keys(s.properties)) walk(s.properties[k])
    if (s.items) walk(s.items)
  }
  for (const e of CATALOG) walk(e.parameters)
  OUT('schema descriptions', schemaDesc, tok(schemaDesc), '| enums', schemaEnum, tok(schemaEnum))

  // duplication of property subtrees across tools
  const seen = new Map<string, number>()
  for (const e of CATALOG) {
    const p = (e.parameters as any).properties ?? {}
    for (const k of Object.keys(p)) {
      const key = k + '::' + JSON.stringify(p[k])
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  }
  let dupBytes = 0, uniqBytes = 0, propCount = 0
  for (const [key, n] of seen) {
    const body = key.slice(key.indexOf('::') + 2).length
    propCount += n
    uniqBytes += body
    dupBytes += body * (n - 1)
  }
  OUT('distinct props', seen.size, 'occurrences', propCount, 'uniq bytes', uniqBytes, tok(uniqBytes), 'DUP bytes', dupBytes, tok(dupBytes))

  // domains
  const dom = new Map<string, string[]>()
  for (const e of CATALOG) {
    const d = e.name.split('.')[0]
    dom.set(d, [...(dom.get(d) ?? []), e.name])
  }
  const readNames = Object.keys(READS)
  const readSpecs = CATALOG.filter((e) => e.effect === 'read')
  const readCost = L(readSpecs.map(toFunctionSpec))
  OUT('READS ONLY', readCost, tok(readCost), readSpecs.length)
  for (const [d, list] of [...dom].sort()) {
    const c = L(CATALOG.filter((e) => list.includes(e.name)).map(toFunctionSpec))
    OUT('domain', d, list.length, c, tok(c))
  }

  // menu: name + title + summary only, no schema
  const menu = CATALOG.map((e) => `${e.wireName}: ${e.title}. ${e.summary}`).join('\n')
  OUT('MENU all 82', menu.length, tok(menu.length))
  const domMenu = [...dom].map(([d, l]) => `${d} (${l.length})`).join(', ')
  OUT('DOMAIN MENU', domMenu.length, tok(domMenu.length), domMenu)

  // heaviest
  const per = CATALOG.map((e) => [e.name, L(toFunctionSpec(e))] as const).sort((a, b) => b[1] - a[1])
  OUT('top15', per.slice(0, 15).map(([n, c]) => `${n}=${tok(c)}`).join(' '))
  const median = per[Math.floor(per.length / 2)]
  OUT('median', median[0], tok(median[1]))
  // tail: how much do the bottom 50 cost
  const tail = per.slice(32)
  OUT('bottom 50 sum', tail.reduce((a, b) => a + b[1], 0), tok(tail.reduce((a, b) => a + b[1], 0)))
})
