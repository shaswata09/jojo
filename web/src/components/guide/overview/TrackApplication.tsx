import { Panel, PanelTitle } from '@/components/common/Panel'
import { Kbd } from '@/components/guide/Kbd'
import { Go } from '@/components/guide/overview/Go'
import { StageRail } from '@/components/guide/overview/StageRail'
import { STAGE_ASKS } from '@/components/guide/overview/stage-asks'
import { STAGES } from '@/data/seed'
import { applicationsPath, statisticsPath } from '@/lib/links'

export function TrackApplicationSection() {
  return (
    <Panel id="application" className="scroll-mt-4">
      <PanelTitle hint="the record everything else hangs off">
        Track an application from applying to an offer
      </PanelTitle>

      <p className="text-sm text-text-2">
        An application is one position at one employer. Dates, notes, documents, keywords and every
        figure on the <Go to={statisticsPath()}>statistics</Go> page point back at one of these, so
        it is the first record worth making. They live on <Go to={applicationsPath()}>the board</Go>
        ; to add one, press <Kbd>n</Kbd> anywhere in the app, or use the checklist above.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-5 lg:grid-cols-[auto_1fr] lg:gap-6">
        <StageRail />

        <div className="min-w-0">
          <h3 className="text-sm font-medium">What each move asks for</h3>
          {/* Was "Moving a card is a drag on the board, or the stage menu on a
              row or a detail page. Four of the six destinations open a short
              form first" — which reads as true of all three, and only the
              third one is. Drag, the board pill and the table chip share one
              path that never asks (`Applications.tsx` onMoveStage: set the
              stage, toast, offer Undo). `stageNeedsDetails` is called from
              exactly one place, `onMoveStage` in `routes/ApplicationDetail.tsx`.
              Someone who
              dragged a card to Offer and waited for the form to appear would
              have been told to expect it here. */}
          <p className="mt-1 text-sm text-text-2">
            Where you move it from decides what you are asked. On the board or the table — a drag,
            the pill on a card, the chip on a row — the move just happens, with an Undo in the
            toast. From inside the record, four of the six destinations open a short form first; the
            other two still just happen, because a dialog whose only content is a Confirm button is
            a speed bump rather than a step.
          </p>
          <dl className="mt-3 divide-y divide-hairline text-sm">
            {STAGES.map((stage) => (
              <div key={stage.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
                <dt className="flex basis-32 items-baseline gap-2 font-medium">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 translate-y-px rounded-full"
                    style={{ background: `var(--stage-${stage.id})` }}
                  />
                  {stage.label}
                </dt>
                <dd className="min-w-0 flex-1 basis-64 text-text-2">
                  {STAGE_ASKS[stage.id] === ''
                    ? 'Nothing — the move happens as you make it.'
                    : STAGE_ASKS[stage.id]}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-text-2">
            One extra question, whatever the destination: moving an application that already has an
            offer asks whether to keep the offer details or clear them. An offer belongs to the
            round that produced it, so dropping it is a decision rather than a side effect.
          </p>
        </div>
      </div>

      <h3 className="mt-5 text-sm font-medium">Once the record exists</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          Opening one keeps the list where it was — the record opens over it, and Back closes the
          record rather than losing your filters. The address is a name rather than a number, so a
          link to an application survives a reload.
        </li>
        <li>
          The note saves when you click away from it, and says so underneath. There is no Save
          button to forget.
        </li>
        <li>
          <span className="font-medium text-text-1">Duplicate</span> is for applying again: the copy
          starts back at Draft carrying the role, note, location and link, and deliberately not the
          offer, the outcome or the dates. jojo records that the two are copies of each other.
        </li>
        <li>
          Deleting an application deletes the application and its note. Anything you filed under it
          — reminders, documents, keywords — is unlinked, not deleted, and the confirmation says
          which.
        </li>
        {/* The offer link was `applicationsPath({ stage: 'offer' })` and read
            "everything at offer" while landing on everything. `?stage=` is
            read by `Applications.tsx`, but only `tableRows` narrows by it and
            only the table renders the stage chips — the board draws `pool`,
            which is filtered by the search and the keyword and role
            selections and never by the stage, because it is already grouped
            into stage columns. Since `view` defaults to `board`, the link
            opened the board and the filter went nowhere: 12 shown of 12,
            under a label promising one. Naming the table is the fix, and the
            sentence above it now says which controls the table owns rather
            than implying the address bar drives both views equally. */}
        <li>
          The view, the search box, the stage filter and the sort all live in the address bar, so a
          view you set up is a link you can keep:{' '}
          <Go to={applicationsPath({ view: 'table', sort: 'stage' })}>
            the table, sorted by stage
          </Go>{' '}
          and <Go to={applicationsPath({ view: 'table', stage: 'offer' })}>everything at offer</Go>{' '}
          are just URLs. Both of those name the table deliberately: the stage chips and the column
          sort are the table&rsquo;s own controls, and the board has no stage filter because it is
          already six columns of stage — so a stage in the address does nothing until the address
          also says table. The search box works in both. The role filter and the keyword chips
          beside it are in neither: they are this tab&rsquo;s selection rather than part of the
          address, and they reset when you reload.
        </li>
      </ul>
    </Panel>
  )
}
