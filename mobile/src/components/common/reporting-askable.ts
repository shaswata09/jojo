import { CRASH_CAPABILITY } from '@/lib/crash'
import { ANALYTICS_CAPABILITY } from '@/lib/analytics'

/**
 * Whether there is anything to ask at all.
 *
 * Read by the onboarding sequencer BEFORE this component is mounted, rather
 * than returning `null` from the render. A step that renders nothing and never
 * calls `onDone` is a step the flow stops on: the stage is never marked, so the
 * tour is never offered and setup ends silently on a blank screen. Deciding it
 * outside means the sequencer simply moves to the next question. Apart from
 * `ReportingStep.tsx` so that file exports its component only, which is what
 * lets a fast refresh keep its state.
 */
export const REPORTING_ASKABLE = CRASH_CAPABILITY !== 'off' || ANALYTICS_CAPABILITY !== 'off'
