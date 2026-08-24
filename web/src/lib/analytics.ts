import { isReportable, type AnalyticsEvent, type EventParams } from '@jojo/service/core/analytics'
import { crashCapability, crashReportingOn } from '@jojo/service/core/crash-config'
import { readStored, writeStored } from '@/lib/storage'

/**
 * Usage analytics for the web app: Firebase's GA4 property, over gtag.
 *
 * ## Why gtag and not the `firebase` npm package
 *
 * Firebase Analytics on the web IS gtag — `getAnalytics()` loads the same
 * `gtag.js` and posts to the same GA4 property behind a wrapper. Taking the npm
 * package would put the Firebase SDK into a bundle that a person who declines
 * analytics still downloads, in an app whose README argues about self-hosting
 * fonts to avoid a third-party request. This way the measurement ID is a build
 * value, the script is fetched only when somebody has said yes, and a build
 * without the ID contains no analytics code path that can run.
 *
 * The cost, stated: no `isSupported()` and no offline queueing. Neither matters
 * for counting which screens get opened.
 *
 * ## Nothing is sent that this app did not declare
 *
 * `core/analytics.ts` holds the whole vocabulary and `isReportable` is checked
 * again HERE, at the last point before the wire, because a cast or a generic
 * upstream is exactly how a record would arrive. An event that fails is dropped
 * and complained about on the console rather than sent — the mistake is in the
 * calling code, and sending a sanitised version would hide it.
 */

/** The GA4 measurement ID from the build. Empty means no analytics at all. */
const MEASUREMENT_ID = (import.meta.env['VITE_ANALYTICS_ID'] as string | undefined) ?? ''

/**
 * What this build allows, on the same terms as crash reporting.
 *
 * Both must say yes: a build flag AND an ID. `crashCapability` is reused because
 * the question is identical — "does an explicit yes appear in the config" — and
 * two spellings of that would drift.
 */
export const ANALYTICS_CAPABILITY =
  MEASUREMENT_ID.trim().length > 0
    ? crashCapability(import.meta.env['VITE_ANALYTICS'] as string | undefined)
    : ('off' as const)

const ENABLED_KEY = 'jojo/analytics/v1'

/** Whether the user opted in. Its own key: agreeing to crashes is not this. */
export function analyticsEnabled(): boolean {
  return readStored(ENABLED_KEY) === 'on'
}

export function setAnalyticsEnabled(on: boolean): void {
  writeStored(ENABLED_KEY, on ? 'on' : 'off')
}

/** Whether anything would actually be sent right now. */
export function analyticsOn(): boolean {
  return crashReportingOn(ANALYTICS_CAPABILITY, { enabled: analyticsEnabled() })
}

/* ------------------------------- the transport ---------------------------- */

let loading: Promise<boolean> | null = null

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

/**
 * Loads gtag once, and only when somebody has said yes.
 *
 * Deliberately NOT loaded at startup and gated later: a request to
 * googletagmanager.com is itself the thing being consented to, and firing it
 * before the answer would make the answer cosmetic.
 */
function ensureLoaded(): Promise<boolean> {
  if (loading) return loading
  loading = new Promise<boolean>((resolve) => {
    try {
      const script = document.createElement('script')
      script.async = true
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`
      script.onload = () => {
        window.dataLayer = window.dataLayer ?? []
        const gtag: Window['gtag'] = (...args) => {
          window.dataLayer?.push(args)
        }
        window.gtag = gtag
        gtag('js', new Date())
        /*
         * `anonymize_ip` and no ad signals. GA4 does not need either to answer
         * "which screens get used", and leaving them on would collect for a
         * purpose nobody was asked about.
         */
        gtag('config', MEASUREMENT_ID, {
          anonymize_ip: true,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
        })
        resolve(true)
      }
      script.onerror = () => {
        resolve(false)
      }
      document.head.appendChild(script)
    } catch {
      resolve(false)
    }
  })
  return loading
}

/**
 * Reports one thing that happened, if the user asked for that.
 *
 * NEVER THROWS and never rejects. It is called from click handlers and effects,
 * and analytics that can break a feature is worse than no analytics.
 *
 * Typed so the parameters must match the event: `report('screen_viewed', {...})`
 * will not compile with the wrong shape, and `isReportable` catches the rest.
 */
export function report<E extends AnalyticsEvent>(event: E, params: EventParams[E]): void {
  try {
    if (!analyticsOn()) return
    const payload = { event, params }
    if (!isReportable(payload)) {
      // Loud, because this is a bug in the caller: something outside the
      // vocabulary was passed, and the vocabulary is the whole safety story.
      console.warn('[jojo] refusing to report an event outside the vocabulary', event)
      return
    }
    void ensureLoaded().then((ready) => {
      if (ready) window.gtag?.('event', event, params)
    })
  } catch {
    /* analytics must never take a feature down */
  }
}
