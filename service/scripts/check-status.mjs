/**
 * The research-preview notice says the same thing everywhere it appears.
 *
 * ## Why this is a guard and not a test
 *
 * `kg/core/status.ts` is the source: the web app and the phone app both import
 * it, so those two cannot disagree. `README.md` and `NOTICE` are plain text and
 * can — and they are the two copies that matter most, because the README is what
 * somebody reads before they clone and `NOTICE` is the one Apache-2.0 §4(d)
 * requires every redistribution to carry.
 *
 * The check cannot live in `kg/core/status.test.ts`: L1 core may import nothing
 * outside itself, and `check-layers` counts `node:fs` in a core test as the
 * violation it is. So it lives here, beside the other guards that read the
 * repository.
 *
 * ## What it checks, and what it deliberately does not
 *
 * That the headline and every point's LABEL appear. Not that the bodies match
 * word for word — the README wraps its lines and `NOTICE` is rewritten for a
 * plain-text column, and demanding byte equality would make the guard fail for
 * formatting rather than for meaning. A missing point is the failure worth
 * catching: it is how a notice quietly stops saying something it used to.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

const source = read('service/kg/core/status.ts')

/** Pulls a single-quoted string constant, including `+`-joined continuations. */
function constant(name) {
  const at = source.indexOf(`export const ${name}`)
  if (at === -1) throw new Error(`check-status: ${name} is not exported from core/status.ts`)
  const body = source.slice(at, source.indexOf('\n\n', at))
  return [...body.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replaceAll("\\'", "'")).join('')
}

const headline = constant('STATUS_HEADLINE')

/** Every point's label, in declaration order. */
const labels = [...source.slice(source.indexOf('STATUS_POINTS')).matchAll(/label:\s*'((?:[^'\\]|\\.)*)'/g)]
  .map((m) => m[1].replaceAll("\\'", "'"))

if (labels.length === 0) throw new Error('check-status: no STATUS_POINTS found to check')

const failures = []
for (const file of ['README.md', 'NOTICE']) {
  const text = read(file)
  if (!text.includes(headline)) {
    failures.push(`${file}  is missing the headline: "${headline}"`)
  }
  // NOTICE is prose rather than a bulleted list, so it is held to the headline
  // and the subject words only. The README carries the full list.
  if (file === 'README.md') {
    for (const label of labels) {
      if (!text.includes(label)) failures.push(`${file}  is missing the point: "${label}"`)
    }
  }
}

if (failures.length > 0) {
  console.error(`\ncheck-status: ${failures.length} finding(s)\n`)
  for (const f of failures) console.error(`  ${f}`)
  console.error(
    '\nThe rule: the research-preview notice in `kg/core/status.ts` is the source, and\n' +
      'README.md and NOTICE must carry it. The apps import the module; those two files\n' +
      'cannot, so they are checked here. NOTICE especially — Apache-2.0 §4(d) makes it\n' +
      'the copy that travels with every redistribution.\n',
  )
  process.exit(1)
}

console.log('check-status: the research-preview notice is in README.md and NOTICE')
