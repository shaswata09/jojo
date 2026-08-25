import { useMemo } from 'react'
import { Panel } from '@/components/common/Panel'
import { comparisonsFor, MIN_ARM, rangeLabel } from '@jojo/service/core/segments'
import type { Arm, Comparison } from '@jojo/service/core/segments'
import { useApplications } from '@jojo/service/react/use-applications'

/**
 * Which parts of the search are doing better, and whether that means anything.
 *
 * The page's other panels count one thing at a time. This is the only one that
 * compares — and comparison is the most useful thing a tracker can do and the
 * easiest to get wrong, which is why `core/segments.ts` spends its header on
 * the problem: split nine applications any way at all and one side is ahead.
 *
 * ## The band is the point of the whole panel
 *
 * Each row draws the Wilson interval as a band and the measured rate as a line
 * inside it. That is not decoration. A bar chart of "80% vs 12%" off four
 * records a side looks exactly like one off four hundred, and the reader has no
 * way to tell which they are looking at. The band is wide when the evidence is
 * thin, so the uncertainty is the first thing seen rather than a footnote.
 *
 * ## Why the unconfident comparisons are shown at all
 *
 * They could be hidden until they separate. They are not, because "we cannot
 * tell yet" is a genuinely useful thing for somebody to know — it says the
 * split is being watched and how far off an answer is — and hiding it would
 * make the panel appear one day with a finding and no history. What must never
 * happen is the two reading the same, and the verdict line under each group is
 * what keeps them apart.
 */

function Row({ arm, leader }: { arm: Arm; leader: boolean }) {
  const low = arm.interval.low * 100
  const width = Math.max(arm.interval.high * 100 - low, 1)
  return (
    <li className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 text-sm">
      <span className={`truncate ${leader ? 'font-medium' : ''}`}>{arm.label}</span>

      <span className="relative h-2.5 rounded-full bg-well" aria-hidden>
        {/* The band: where the true rate plausibly sits. */}
        <span
          className={`absolute inset-y-0 rounded-full ${leader ? 'bg-accent/35' : 'bg-text-3/20'}`}
          style={{ left: `${String(low)}%`, width: `${String(width)}%` }}
        />
        {/* The measured rate itself, drawn as a line inside its own band so it
            never reads as the whole answer. */}
        <span
          className={`absolute inset-y-0 w-0.5 rounded ${leader ? 'bg-accent' : 'bg-text-2'}`}
          style={{ left: `calc(${String(arm.rate)}% - 1px)` }}
        />
      </span>

      <span className="whitespace-nowrap tabular-nums text-text-2">
        {arm.count} of {arm.of}
        <span className="ml-2 text-text-3">
          {arm.rate}% · likely {rangeLabel(arm)}
        </span>
      </span>
    </li>
  )
}

function Group({ c }: { c: Comparison }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">
        {c.measure === 'replied' ? 'Replies' : 'Interviews'}, by {c.dimension}
      </h3>
      <ul className="flex flex-col gap-2">
        {c.arms.map((arm) => (
          <Row key={arm.label} arm={arm} leader={c.confident && arm.label === c.best.label} />
        ))}
      </ul>
      <p className="mt-2 text-xs text-text-3">
        {c.confident
          ? `The ranges do not overlap, so this is a real difference — ${c.best.label.toLowerCase()} is worth more of your effort.`
          : 'The ranges overlap, so this is two numbers rather than a difference. More records will separate them or close the gap.'}
        {c.tooFew > 0 &&
          ` ${String(c.tooFew)} other ${c.tooFew === 1 ? 'group has' : 'groups have'} fewer than ${String(MIN_ARM)} records and ${c.tooFew === 1 ? 'is' : 'are'} not compared.`}
      </p>
    </section>
  )
}

export function WhatIsWorking() {
  const { all } = useApplications()
  const comparisons = useMemo(() => comparisonsFor(all), [all])

  // Nothing to compare is the ordinary state of a young search, and the right
  // output for it is silence rather than an empty panel explaining itself.
  if (comparisons.length === 0) return null

  return (
    <Panel aria-labelledby="what-is-working">
      <h2 id="what-is-working" className="mb-1 text-base font-medium">
        What is working
      </h2>
      <p className="mb-4 text-xs text-text-3">
        The bar is where the true rate plausibly sits; the line is what you have measured. A wide
        band means too few records to be sure yet.
      </p>
      <div className="flex flex-col gap-5">
        {comparisons.map((c) => (
          <Group key={`${c.dimension}:${c.measure}`} c={c} />
        ))}
      </div>
    </Panel>
  )
}
