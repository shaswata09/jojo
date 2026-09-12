/**
 * Re-scores a `live-fit` report offline, with the `assess` that is on disk now.
 *
 *   npx tsx scripts/rescore-fit.mts <report.json> [<report.json> ...]
 *
 * A report carries every fact the models filed and every requirement they
 * read (`raw`), and the verdict is arithmetic over those two lists — so a
 * change to `core/assess.ts` or `core/tailor.ts` can be measured against a
 * real run in a second, without the models. What it cannot do is re-read
 * anything: a prompt change still needs `JOJO_FIT=1`.
 */
import { readFileSync } from 'node:fs'
import { assess } from '../kg/core/assess'
import type { Evidence, Requirement } from '../kg/core/assess'
import { guidanceFrom } from '../kg/core/tailor'
import { EXPECTED_FIT } from '../kg/agent/fit-fixtures'

type Report = {
  raw?: {
    facts: Record<string, Evidence[]>
    requirements: Record<string, Requirement[]>
  }
}

let failures = 0
for (const path of process.argv.slice(2)) {
  const report = JSON.parse(readFileSync(path, 'utf8')) as Report
  if (!report.raw) {
    console.log(`${path}: no raw section (older report)`)
    continue
  }
  const people = Object.keys(report.raw.facts)
  const postings = Object.keys(report.raw.requirements)
  for (const personKey of people) {
    const [model, person] = personKey.split(':') as [string, string]
    const evidence = report.raw.facts[personKey] ?? []
    for (const postingKey of postings) {
      const posting = postingKey.split(':')[1] ?? ''
      if (!postingKey.startsWith(`${model}:`)) continue
      const requirements = report.raw.requirements[postingKey] ?? []
      const assessment = assess(requirements, evidence)
      const guidance = guidanceFrom(assessment)
      const want = EXPECTED_FIT.find((e) => e.person === person && e.posting === posting)
      let ok = true
      if (
        want?.atLeastTailoring &&
        !(guidance.verdict === 'strong' || guidance.verdict === 'worth-tailoring')
      )
        ok = false
      if (want?.notStrong && guidance.verdict === 'strong') ok = false
      if (!ok) failures += 1
      const gaps = assessment.gaps.map(
        (g) => `${g.requirement.essential ? '[R] ' : ''}${g.requirement.text}`,
      )
      console.log(
        `${model.padEnd(13)} ${person.padEnd(6)} × ${posting.padEnd(12)} ${String(assessment.score).padStart(4)}  ${guidance.verdict.padEnd(16)} ${want ? (ok ? 'ok ' : 'NOT') : '   '}`,
      )
      for (const t of guidance.tailor.slice(0, 3))
        console.log(`      lead: ${t.evidence.title} ← ${t.answers}`)
      for (const g of gaps) console.log(`      gap:  ${g}`)
    }
  }
}
console.log(
  failures === 0 ? '\nall expectations hold' : `\n${String(failures)} expectation(s) failed`,
)
process.exit(failures === 0 ? 0 : 1)
