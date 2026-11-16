/**
 * Approving a Job Scout suggestion, as wiring. The hooks cannot be mounted
 * here (D20), so the chain is read out of the source, one link per assertion.
 *
 * Q291 — an approved suggestion was filed into the scout's own lists and
 *        stopped, so it never showed in the applications table. Approval now
 *        promotes what it saved into a draft. The tool half — the draft is in
 *        the list the table reads — is `service/kg/tools/scout.requests.test.ts`.
 * Q292 — the draft gets the posting's page, captured and stored with it, and is
 *        filled from READING the page (employer, title, details, tags) rather
 *        than from the listing title. What the fill writes is
 *        `fill-from-posting.test.ts`; this pins that approval starts it, that
 *        it reads with the model when there is one and only keeps the page when
 *        there is not, and that the page is filed under the draft.
 */
import { describe, expect, it } from 'vitest'
import actions from './use-proposal-actions.ts?raw'
import fillDraft from './use-fill-draft.ts?raw'
import fillFromPosting from '@/lib/fill-from-posting.ts?raw'

/** Comments removed, so prose about a call does not count as the call. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('Q291 approving a scouted job makes it an application', () => {
  const src = code(actions)

  it('promotes what the approval saved into a draft, a posting and a match alike', () => {
    expect(src).toMatch(
      /const draftFrom = \(kind: ApprovedJob\['kind'\], id: string\) =>\s*kind === 'match' \? promoteToApplication\(id\) : promotePosting\(id\)/,
    )
    // In that order: the suggestion's own save first, then the draft from it.
    const approve = src.indexOf('const made = engine.approve(id)')
    const draft = src.indexOf('const application = draftFrom(kind, made)')
    expect(approve).toBeGreaterThan(-1)
    expect(draft).toBeGreaterThan(approve)
  })
})

describe('Q292 the approved draft is filled from its page, and keeps the page', () => {
  it('reads the posting into the draft on Approve and on Approve all', () => {
    const src = code(actions)
    expect(src).toMatch(
      /if \(page\) void fillDraft\(application, page\.url, page\.title, proposal\)/,
    )
    expect(src).toMatch(
      /if \(page\) await fillDraft\(application, page\.url, page\.title, proposal\)/,
    )
  })

  it('asks the model when one is set up, and only keeps the page when none is', () => {
    const src = code(fillDraft)
    expect(src).toMatch(
      /if \(!isConfigured\(settings\)\) \{\s*pages\.keepAndReport\(postingUrl, title\)\s*return\s*\}/,
    )
    expect(src).toMatch(
      /await fillFromPosting\(\{\s*applicationId: application\.id,\s*url: postingUrl,/,
    )
  })

  it('files the page it read under the draft once the fields are written', () => {
    const src = code(fillFromPosting)
    const patch = src.indexOf('fillPatch(\n')
    const filed = src.indexOf('fileUnder(read.file.id, id)\n\n      const after')
    expect(patch).toBeGreaterThan(-1)
    expect(filed).toBeGreaterThan(patch)
    // And a read whose model step failed still files the page it kept.
    expect(src).toMatch(/if \(!read\.ok\) \{\s*if \(read\.file\) fileUnder\(read\.file\.id, id\)/)
  })
})
