import type { Application, Stage } from '@/data/seed'

/** The four stages that carry a field block. Draft and Screen collect nothing. */
const BLOCKED_STAGES: readonly Stage[] = ['submitted', 'interview', 'offer', 'closed']

/**
 * Whether moving this application to `target` has anything to ask about.
 *
 * Call it before opening the sheet: a move to Draft or Screening call should
 * just happen, and a sheet whose only content is a Confirm button is a speed
 * bump rather than a step.
 *
 * Leaving an offer is the exception, whatever the destination — the details
 * have to be kept or dropped deliberately, because nothing else in the app can
 * put a respond-by date and a package back once they are gone.
 *
 * A rule rather than a component export, so the caller that decides whether to
 * open the sheet does not have to import the sheet to find out.
 */
export function stageNeedsDetails(application: Application, target: Stage) {
  if (application.stage === target) return false
  if (application.offer && target !== 'offer') return true
  return BLOCKED_STAGES.includes(target)
}
