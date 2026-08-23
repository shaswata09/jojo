import { writeFileSync } from 'node:fs'
import { test } from 'vitest'
import { CATALOG, toFunctionSpec } from './catalog'
const L: string[] = []
const log = (...a: unknown[]) => L.push(a.map(String).join(' '))
test('m2', () => {
  for (const n of ['application.update', 'graph.query', 'application.create']) {
    const e = CATALOG.find((c) => c.name === n)!
    log('=== ' + n + ' ===')
    log(JSON.stringify(toFunctionSpec(e), null, 1))
  }
  writeFileSync(process.env.OUTF!, L.join('\n'))
})
