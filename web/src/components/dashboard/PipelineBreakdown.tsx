import { useNavigate } from 'react-router'
import { ClipboardList, Plus } from 'lucide-react'
import type { Stage } from '@jojo/service/data/seed'
import { useApplications } from '@jojo/service/react/use-applications'
import { Pie } from '@/components/charts/Pie'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { useDialogs } from '@/lib/dialogs-context'
import { applicationsPath } from '@/lib/links'

/**
 * Where everything currently sits. The single most informative thing a job
 * dashboard can show: totals say how much you've done, this says whether it's
 * progressing or piling up in one stage.
 *
 * A pie, because the question is share-of-total — "is half of this still in
 * draft?" — and a pie answers that in one glance where six bars ask you to
 * compare lengths and add up. The bars it replaced were a funnel, which read
 * beautifully as a sequence and could not show you that one stage held most of
 * the pipeline without arithmetic.
 *
 * The legend is not decoration and is not optional. A pie cannot be read to a
 * number, so the counts and the percentages live beside it, and every row is
 * the control: pressing a stage opens the applications list filtered to it,
 * which is what the dashboard's other panels already do.
 *
 * Colour is chosen here rather than upstream. `stageCounts` deliberately
 * carries none — it is minted in `kg/react`, which mounts unchanged on React
 * Native, where a CSS variable means nothing.
 */

/**
 * The six stage hues, as values rather than as the Tailwind classes in
 * `STAGE_DOT`.
 *
 * `STAGE_DOT` gives `bg-stage-draft`, which is a class and cannot be handed to
 * an SVG `fill`. These are the same tokens one layer down — the custom
 * properties those classes resolve to — so the pie, the chips and the board
 * dots stay the same six colours, validated once in `index.css` for contrast
 * and for separation under colour-blind simulation.
 */
const STAGE_FILL: Record<Stage, string> = {
  draft: 'var(--stage-draft)',
  submitted: 'var(--stage-submitted)',
  screen: 'var(--stage-screen)',
  interview: 'var(--stage-interview)',
  offer: 'var(--stage-offer)',
  closed: 'var(--stage-closed)',
}

/** How many applications sit in each stage. */
export function PipelineBody() {
  const { all, stageCounts } = useApplications()
  const { open } = useDialogs()
  const navigate = useNavigate()

  return (
    <>
      {/* `stageCounts` always returns all six stages, so on an empty store this
          rendered six labelled rows of zero — technically true and useless, and
          reachable now that Settings can clear the records. A chart with
          nothing in it should say what would fill it. */}
      {all.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nothing in the pipeline"
          description="Each application sits in one stage, and this shows how they are spread across them. Add one and the first slice appears."
          action={
            <Button size="sm" onClick={() => open('application')}>
              <Plus className="size-3.5" strokeWidth={2} aria-hidden />
              New application
            </Button>
          }
        />
      ) : (
        <Pie
          className="flex-1 content-center"
          ariaLabel={`${all.length} applications by stage`}
          data={stageCounts.map((s) => ({
            key: s.id,
            label: s.label,
            value: s.count,
            color: STAGE_FILL[s.id],
          }))}
          onSelect={(key) => navigate(applicationsPath({ stage: key as Stage }))}
        />
      )}
    </>
  )
}
