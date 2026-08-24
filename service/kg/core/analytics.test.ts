/**
 * The claim jojo makes about usage analytics, tested rather than promised.
 *
 * With crash reporting the honest copy had to be a LIST of what is collected,
 * because "no personal data" was either unfalsifiable (web, where nothing is
 * sent) or false (the phone, where Crashlytics adds an install id and a device
 * profile by design). Usage analytics is different, and the difference is this
 * file: the vocabulary is closed and contains no free text, so "no record of
 * yours is in an event" is a property that can be CHECKED, and here it is.
 *
 * The failure this guards against is not exotic. It is somebody adding a
 * feature and writing the line every analytics tutorial shows —
 * `track('application_created', { employer, role })` — which in a job search is
 * somebody's employer, their job title and the fact that they are looking.
 */

import { describe, expect, it } from 'vitest'
import {
  EVENTS,
  bucket,
  isReportable,
  reportableProvider,
  screenForPath,
  PROVIDERS_REPORTED,
  type AnalyticsEvent,
  type EventParams,
} from './analytics'
import { PROVIDER_IDS } from './provider'

describe('the vocabulary is closed', () => {
  it('accepts only the events declared here', () => {
    expect(isReportable({ event: 'app_opened', params: {} })).toBe(true)
    expect(isReportable({ event: 'not_an_event', params: {} })).toBe(false)
    // The shape a general-purpose logger would produce.
    expect(isReportable({ event: 'button_clicked', params: {} })).toBe(false)
  })

  it('rejects any string that is not a declared value', () => {
    /*
     * The whole point. Every one of these is a real field on a real record in
     * this app, and every one of them is the thing somebody would reach for.
     */
    for (const leak of [
      { event: 'application_created', params: { source: 'manual', employer: 'Rice University' } },
      { event: 'application_created', params: { source: 'Assistant Professor' } },
      { event: 'screen_viewed', params: { screen: 'applications', role: 'Lecturer' } },
      { event: 'vault_item_added', params: { kind: 'file', name: 'Tailored-CV.pdf' } },
      { event: 'assistant_asked', params: { tools_available: 3, question: 'what about Rice' } },
      { event: 'model_connected', params: { provider: 'nvidia', endpoint: 'http://10.0.0.4:8000' } },
      { event: 'screen_viewed', params: { screen: '/applications/app:01a1-2b3c' } },
    ]) {
      expect(isReportable(leak), JSON.stringify(leak)).toBe(false)
    }
  })

  it('accepts the declared values for each event', () => {
    const good = [
      { event: 'screen_viewed', params: { screen: 'vault' } },
      { event: 'application_created', params: { source: 'scout' } },
      { event: 'application_advanced', params: { to: 'interview' } },
      { event: 'assistant_asked', params: { tools_available: 86, has_model: true } },
      { event: 'assistant_tool_decided', params: { decision: 'approved', destructive: false } },
      { event: 'scout_pipeline_started', params: { kind: 'twin' } },
      { event: 'scout_proposal_decided', params: { decision: 'declined' } },
      { event: 'vault_item_added', params: { kind: 'snippet' } },
      { event: 'model_connected', params: { provider: 'anthropic' } },
      { event: 'reader_connected', params: { via: 'extension' } },
      { event: 'backup_used', params: { direction: 'export', records: '21-50' } },
      { event: 'transfer_completed', params: { records: '6-20' } },
      { event: 'tour_used', params: { outcome: 'finished' } },
    ]
    for (const one of good) expect(isReportable(one), JSON.stringify(one)).toBe(true)
    // Every event in the table is exercised above, so a new one without a case
    // here is a gap somebody has to close deliberately.
    expect(new Set([...good.map((g) => g.event), 'app_opened']).size).toBe(EVENTS.length)
  })

  it('rejects a number that is not a number', () => {
    // NaN and Infinity serialise as `null` in JSON and read as a missing value
    // in a console, which is worse than being refused.
    expect(isReportable({ event: 'assistant_asked', params: { tools_available: Number.NaN } })).toBe(
      false,
    )
    expect(
      isReportable({ event: 'assistant_asked', params: { tools_available: Number.POSITIVE_INFINITY } }),
    ).toBe(false)
  })

  it('rejects anything that is not an object, without throwing', () => {
    for (const junk of [null, undefined, 'app_opened', 42, [], { event: 'app_opened' }]) {
      expect(() => isReportable(junk), String(junk)).not.toThrow()
      expect(isReportable(junk), String(junk)).toBe(false)
    }
  })

  it('rejects a nested object, which is where a record would hide', () => {
    expect(
      isReportable({ event: 'application_created', params: { source: 'manual', app: { role: 'x' } } }),
    ).toBe(false)
    expect(isReportable({ event: 'vault_item_added', params: { kind: 'file', tags: ['a'] } })).toBe(
      false,
    )
  })
})

describe('the parameter table itself carries no free text', () => {
  it('declares no bare `string` for any event', () => {
    /*
     * A type-level assertion, checked by the compiler rather than at runtime:
     * if any value type in `EventParams` were `string`, this stops compiling.
     * That is the real guard — `isReportable` catches a bad VALUE, and this
     * catches somebody widening the TYPE so bad values become legal.
     */
    type ValuesOf<T> = T[keyof T]
    type AnyParamValue = ValuesOf<{ [E in AnalyticsEvent]: ValuesOf<EventParams[E]> }>
    // `string` is assignable to AnyParamValue only if some param IS `string`.
    type NoBareString = string extends AnyParamValue ? 'A PARAM IS A BARE STRING' : 'ok'
    const check: NoBareString = 'ok'
    expect(check).toBe('ok')
  })
})

describe('narrowing a provider', () => {
  it('keeps the providers jojo ships', () => {
    for (const id of PROVIDER_IDS) {
      expect(reportableProvider(id), id).toBe(id)
      expect(isReportable({ event: 'model_connected', params: { provider: reportableProvider(id) } })).toBe(
        true,
      )
    }
  })

  it('answers `other` for anything else, rather than passing it through', () => {
    // A saved server from a future version, a hand-edited backup, an endpoint
    // somebody typed into a field this app did not expect.
    for (const junk of ['', 'my-companys-gateway', 'http://10.0.0.4:8000', 'OLLAMA']) {
      expect(reportableProvider(junk), junk).toBe('other')
    }
  })

  it('every provider jojo ships is one the vocabulary names', () => {
    // Not the same claim as the first test: this one fails when somebody adds a
    // provider to `core/provider.ts` and forgets this file, which is the moment
    // real usage would start being filed under 'other'.
    for (const id of PROVIDER_IDS) {
      expect(PROVIDERS_REPORTED as readonly string[], id).toContain(id)
    }
  })
})

describe('turning a path into a screen', () => {
  it('reports the screen for the paths jojo has', () => {
    expect(screenForPath('/')).toBe('dashboard')
    expect(screenForPath('')).toBe('dashboard')
    expect(screenForPath('/applications')).toBe('applications')
    expect(screenForPath('/vault')).toBe('vault')
    expect(screenForPath('/guide/tools')).toBe('guide')
    expect(screenForPath('/settings?tab=model')).toBe('settings')
    // No segment at all is the root, however it is spelled.
    expect(screenForPath('//')).toBe('dashboard')
  })

  it('never lets a record out through the path', () => {
    /*
     * The whole reason this function exists. Each of these is a real URL this
     * app produces, and each one has somebody's record in it — reporting
     * `pathname` would put an application id and an employer's name into an
     * analytics console, and it would look exactly like normal screen tracking.
     */
    expect(screenForPath('/applications/app:01a1-2b3c')).toBe('applications')
    expect(screenForPath('/employers/rice-university')).toBe(null)
    expect(screenForPath('/employers/some-startup?from=scout')).toBe(null)
  })

  it('answers null rather than inventing a screen', () => {
    for (const junk of ['/nope', '/../etc', '/APPLICATIONS', '/applications2']) {
      expect(screenForPath(junk), junk).toBe(null)
    }
  })

  it('only ever answers something reportable', () => {
    for (const path of ['/', '/vault', '/applications/x', '/employers/y', '/nope', '/graph']) {
      const screen = screenForPath(path)
      if (screen === null) continue
      expect(isReportable({ event: 'screen_viewed', params: { screen } }), path).toBe(true)
    }
  })

  it('does not throw on input that is not a path', () => {
    for (const junk of [null, undefined, 42, {}]) {
      expect(() => screenForPath(junk as unknown as string), String(junk)).not.toThrow()
      expect(screenForPath(junk as unknown as string), String(junk)).toBe(null)
    }
  })
})

describe('bucketing a count', () => {
  it('answers the product question without fingerprinting', () => {
    // "47 applications" identifies somebody in a small user base; "21-50"
    // answers "do people use this a lot" just as well.
    expect(bucket(0)).toBe('0')
    expect(bucket(1)).toBe('1')
    expect(bucket(5)).toBe('2-5')
    expect(bucket(6)).toBe('6-20')
    expect(bucket(20)).toBe('6-20')
    expect(bucket(21)).toBe('21-50')
    expect(bucket(50)).toBe('21-50')
    expect(bucket(51)).toBe('50+')
    expect(bucket(100000)).toBe('50+')
  })

  it('never throws, and never invents a bucket', () => {
    for (const n of [Number.NaN, Number.POSITIVE_INFINITY, -1, -0]) {
      expect(() => bucket(n), String(n)).not.toThrow()
      expect(bucket(n), String(n)).toBe('0')
    }
  })

  it('only ever answers with a declared bucket', () => {
    for (let n = -5; n < 200; n += 1) {
      expect(isReportable({ event: 'transfer_completed', params: { records: bucket(n) } })).toBe(true)
    }
  })
})
