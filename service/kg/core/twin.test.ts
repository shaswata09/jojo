/**
 * Working out what the app does NOT yet know about the person.
 *
 * This is the half of the twin pipeline that does not need a model, and it
 * exists because absence is the one thing a language model is reliably bad at
 * noticing. Asked "what is missing", it lists what is present. Asked to read
 * the CV it has just been told about, it does that well.
 *
 * So most of these tests are about the boundary: which documents count, which
 * do not, and when the honest answer is that there is nothing to do.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from './snapshot'
import type { StoredNode } from './model'
import type { GraphSnapshot } from './snapshot'
import {
  mergeOffered,
  newlyReadable,
  OFFER_MEMORY_LIMIT,
  parseOffered,
  twinBriefing,
  twinOfferCopy,
  twinState,
} from './twin'

const AT = '2026-09-14T09:00:00.000Z'

const node = (id: string, type: string, props: Record<string, unknown>) =>
  ({ id, type, props, createdAt: AT, updatedAt: AT }) as unknown as StoredNode

function graph(nodes: StoredNode[], edges: { from: string; rel: string; to: string }[] = []) {
  const m = new MutableSnapshot()
  m.reset(
    nodes,
    edges.map((e) => ({
      id: `${e.from}|${e.rel}|${e.to}`,
      rel: e.rel,
      from: e.from,
      to: e.to,
      props: {},
      createdAt: AT,
    })) as never,
  )
  return m as unknown as GraphSnapshot
}

/**
 * A file with bytes behind it.
 *
 * `path` is not decoration: `worthReading` refuses a record with no document
 * under it, because a record can perfectly well exist without one — the seeded
 * data set ships three, and so does every restored backup.
 */
const file = (id: string, name: string, bucket = 'Applications') =>
  node(id, 'file', {
    slug: id,
    name,
    kind: 'pdf',
    bucket,
    size: '1 KB',
    savedOn: '2026-09-01',
    path: `${id}.pdf`,
  })

/** The same record with nothing stored under it. */
const empty = (id: string, name: string) =>
  node(id, 'file', {
    slug: id,
    name,
    kind: 'pdf',
    bucket: 'Applications',
    size: '1 KB',
    savedOn: '2026-09-01',
  })
const fact = (id: string, kind: string, title: string, source?: string) =>
  node(id, 'background', { slug: id, kind, title, ...(source ? { source } : {}) })

describe('finding the document worth reading', () => {
  it('names a CV nothing has been read from', () => {
    const state = twinState(graph([file('f1', 'CV-2026.pdf')]))
    expect(state.unread).toBe(1)
    expect(state.gaps[0]?.kind).toBe('unread-document')
    expect(state.gaps[0]?.instruction).toContain('vault.file.read')
    expect(state.gaps[0]?.instruction).toContain('profile.background.add')
  })

  it('stops naming it once a fact points back at it', () => {
    /*
     * What `source` is FOR, and the reason the field exists at all. Without it
     * there is no way to ask this question, and the pipeline would re-read the
     * same CV on every round for as long as it stayed enabled — proposing the
     * same thirty facts each time.
     */
    const state = twinState(graph([file('f1', 'CV-2026.pdf'), fact('b1', 'skill', 'Rust', 'f1')]))
    expect(state.unread).toBe(0)
    expect(state.gaps.filter((g) => g.kind === 'unread-document')).toEqual([])
  })

  it('ignores a document that is about an employer rather than the person', () => {
    /*
     * The worst inversion available here. Reading a saved job posting for the
     * person's background files the EMPLOYER's requirements as though they were
     * the person's qualifications — and the resulting record looks exactly like
     * a real one.
     */
    const state = twinState(graph([file('f1', 'Rice-job-posting.pdf'), file('f2', 'Offer-letter.pdf')]))
    expect(state.unread).toBe(0)
  })

  it('ignores a document already filed under an application', () => {
    // A tailored cover letter is about that application. Its facts are the
    // person's only incidentally, and a CV is what sits loose.
    const state = twinState(
      graph(
        [file('f1', 'CV-tailored.pdf'), node('a1', 'application', { slug: 'a1', role: 'x', roleTag: 'Lecturer', stage: 'draft', note: '', lastAction: '', lastActionAt: AT })],
        [{ from: 'f1', rel: 'FILED_UNDER', to: 'a1' }],
      ),
    )
    expect(state.unread).toBe(0)
  })

  it('recognises the other documents a person writes about themselves', () => {
    const state = twinState(
      graph([file('f1', 'Research-statement.pdf'), file('f2', 'Teaching-statement.pdf')]),
    )
    expect(state.unread).toBe(2)
  })
})

describe('connecting what is already known', () => {
  it('notices a skill that is not one of their keywords', () => {
    /*
     * The "connecting" half, and what turns a list of facts into a graph: once
     * "Rust" is a keyword, every application tagged with it is joined to the CV
     * entry that proves it, and a query can walk from a posting's requirement to
     * the evidence for it in one hop.
     */
    const state = twinState(graph([fact('b1', 'skill', 'Rust', 'f1')]))
    const gap = state.gaps.find((g) => g.kind === 'skill-not-keyword')
    expect(gap?.subject).toBe('Rust')
    expect(gap?.instruction).toContain('keyword.create')
  })

  it('says nothing when the keyword already exists, whatever its case', () => {
    const state = twinState(
      graph([fact('b1', 'skill', 'Rust', 'f1'), node('k1', 'keyword', { slug: 'k1', name: 'rust', tone: 'gray' })]),
    )
    expect(state.gaps.filter((g) => g.kind === 'skill-not-keyword')).toEqual([])
  })

  it('does not propose keywords for things that are not skills', () => {
    // A publication title is not a tag. Every paper becoming a keyword would
    // make the keyword list useless for the thing it is for.
    const state = twinState(graph([fact('b1', 'publication', 'Consistent snapshots', 'f1')]))
    expect(state.gaps.filter((g) => g.kind === 'skill-not-keyword')).toEqual([])
  })
})

describe('when there is nothing to do', () => {
  it('says an empty twin with no documents needs one, rather than inventing work', () => {
    const state = twinState(graph([]))
    expect(state.gaps).toHaveLength(1)
    expect(state.gaps[0]?.kind).toBe('no-background')
    expect(state.gaps[0]?.instruction).toContain('rather than guessing')
  })

  it('does not also say that when there IS a document to read', () => {
    // One situation, one fix. Saying both duplicates the instruction and
    // invites the model to answer the wrong half.
    const state = twinState(graph([file('f1', 'CV.pdf')]))
    expect(state.gaps.filter((g) => g.kind === 'no-background')).toEqual([])
  })

  it('returns an empty briefing when a full twin has no gaps, so nothing is appended', () => {
    /*
     * A prompt ending in "here is what is missing:" followed by nothing reads
     * as a truncated instruction, and models treat it as one — which is why
     * this returns a sentence or an empty string and never a bare heading.
     */
    const state = twinState(
      graph([fact('b1', 'skill', 'Rust', 'f1'), node('k1', 'keyword', { slug: 'k1', name: 'Rust', tone: 'gray' })]),
    )
    expect(state.gaps).toEqual([])
    expect(twinBriefing(state)).toContain('nothing obvious is missing')
  })

  it('returns a genuinely empty string for an empty store with nothing to say', () => {
    expect(twinBriefing({ facts: 0, unread: 0, gaps: [] })).toBe('')
  })
})

describe('the briefing', () => {
  it('puts reading a document before rearranging what is known', () => {
    /*
     * Reading is the only operation here that ADDS a fact. Everything else
     * moves existing ones around, and a round that tags three applications
     * while an unread CV sits in the Vault has done the cheap half.
     */
    const state = twinState(graph([file('f1', 'CV.pdf'), fact('b1', 'skill', 'Rust')]))
    expect(state.gaps[0]?.kind).toBe('unread-document')
  })

  it('caps the list, because a model handed forty instructions follows none', () => {
    const files = Array.from({ length: 20 }, (_, i) => file(`f${String(i)}`, `CV-${String(i)}.pdf`))
    expect(twinState(graph(files)).gaps.length).toBeLessThanOrEqual(6)
  })

  it('numbers the gaps so the model can be told to work through them', () => {
    const briefing = twinBriefing(twinState(graph([file('f1', 'CV.pdf')])))
    expect(briefing).toContain('1.')
    expect(briefing).toContain('most useful first')
  })

  it('leads with the fact count once there is one, and counts in English', () => {
    // "holds 1 facts" makes a person trust the rest of the output less — and it
    // goes into a prompt a model then echoes back.
    const one = twinBriefing(twinState(graph([file('f1', 'CV.pdf'), fact('b1', 'skill', 'Go')])))
    expect(one).toContain('1 fact ')
    expect(one).not.toContain('1 facts')

    const two = twinBriefing(
      twinState(graph([file('f1', 'CV.pdf'), fact('b1', 'skill', 'Go'), fact('b2', 'award', 'x')])),
    )
    expect(two).toContain('2 facts')
  })
})

describe('the loop closes', () => {
  /**
   * The property that makes the pipeline safe to leave switched on.
   *
   * A twin pipeline runs on a schedule. If reading a document did not stop it
   * being reported as unread, every round would propose the same thirty facts
   * again — and the person would arrive at a queue of duplicates growing by the
   * hour, which is worse than a pipeline that does nothing.
   *
   * `source` is what closes it, and this is the test that says so.
   */
  it('goes from one gap to none across a read', () => {
    const before = twinState(graph([file('f1', 'CV-2026.pdf')]))
    expect(before.gaps.map((g) => g.kind)).toEqual(['unread-document'])

    // What the pipeline writes: facts that name the document they came from.
    const after = twinState(
      graph([
        file('f1', 'CV-2026.pdf'),
        fact('b1', 'education', 'PhD, Computer Science', 'f1'),
        fact('b2', 'publication', 'Consistent snapshots', 'f1'),
      ]),
    )
    expect(after.unread).toBe(0)
    expect(after.facts).toBe(2)
    expect(after.gaps.filter((g) => g.kind === 'unread-document')).toEqual([])
  })

  it('does not close when the facts forget to say where they came from', () => {
    /*
     * The failure this guards. `profile.background.add` takes `source` as an
     * optional field, because somebody typing a fact by hand has no document —
     * so a model that omits it produces records that look perfectly correct and
     * leave the document eternally unread.
     *
     * The prompt therefore says to pass it on every entry, and this test is why
     * that sentence is not decoration.
     */
    const after = twinState(
      graph([file('f1', 'CV-2026.pdf'), fact('b1', 'education', 'PhD', undefined)]),
    )
    expect(after.unread).toBe(1)
  })

  it('moves on to connecting once the reading is done', () => {
    // The second phase, and it only appears after the first is finished —
    // which is what stops a round tagging applications while a CV sits unread.
    const after = twinState(graph([file('f1', 'CV.pdf'), fact('b1', 'skill', 'Rust', 'f1')]))
    expect(after.gaps.map((g) => g.kind)).toEqual(['skill-not-keyword'])
  })
})

describe('deciding when to ask permission', () => {
  it('offers a document nobody has been asked about yet', () => {
    const state = twinState(graph([file('f1', 'CV-2026.pdf')]))
    expect(newlyReadable([], state).map((g) => g.id)).toEqual(['f1'])
  })

  it('stops offering the same document once it has been declined', () => {
    /*
     * The property this whole function exists for. "There are unread documents"
     * stays true for as long as somebody keeps saying no, so an offer built on
     * the COUNT reappears on every render and becomes the thing they dismiss
     * without reading — which is how a consent prompt stops being consent.
     *
     * A difference against what they have already been shown is true once.
     */
    const state = twinState(graph([file('f1', 'CV-2026.pdf')]))
    expect(newlyReadable(['f1'], state)).toEqual([])
  })

  it('offers a second document even though the first was declined', () => {
    // The other half: declining once must not silence the question forever.
    // A CV added in March and a statement added in June are two decisions.
    const state = twinState(graph([file('f1', 'CV-2026.pdf'), file('f2', 'research statement.pdf')]))
    expect(newlyReadable(['f1'], state).map((g) => g.id)).toEqual(['f2'])
  })

  it('never offers anything but a document to read', () => {
    /*
     * `twinState` also reports skills that are not keywords, and those are
     * rearrangements of facts the person already approved. Asking permission
     * for one would train them to click through the prompt that matters.
     */
    const state = twinState(graph([file('f1', 'CV.pdf'), fact('b1', 'skill', 'Rust', 'f1')]))
    expect(state.gaps.map((g) => g.kind)).toEqual(['skill-not-keyword'])
    expect(newlyReadable([], state)).toEqual([])
  })

  it('says nothing when the document is about an employer', () => {
    // Inherited from twinState rather than re-decided here, and asserted so a
    // change to `worthReading` cannot quietly start asking about job postings.
    const state = twinState(graph([file('f1', 'Acme job posting.pdf')]))
    expect(newlyReadable([], state)).toEqual([])
  })
})

describe('what the offer actually says', () => {
  it('names the document, because that is what makes it answerable', () => {
    /*
     * "Read your CV into your profile?" is a question somebody can answer where
     * they are standing. "Update your profile?" is one they have to open
     * something else to understand, and the two get the same click.
     */
    const state = twinState(graph([file('f1', 'CV-2026.pdf')]))
    const copy = twinOfferCopy(newlyReadable([], state))
    expect(copy.title).toContain('CV-2026.pdf')
  })

  it('counts the rest rather than listing them', () => {
    const state = twinState(
      graph([file('f1', 'CV.pdf'), file('f2', 'statement.pdf'), file('f3', 'bio.pdf')]),
    )
    const copy = twinOfferCopy(newlyReadable([], state))
    expect(copy.title).toContain('CV.pdf')
    expect(copy.title).toContain('2 more')
  })

  it('describes what is about to happen, not a euphemism for it', () => {
    /*
     * Somebody agreeing to this is agreeing that a model may read a document
     * about them and write what it finds into their own records. The body has
     * to say so, and has to say that they see each entry first — otherwise the
     * prompt is asking for permission to do something quieter than what happens.
     */
    const copy = twinOfferCopy(twinState(graph([file('f1', 'CV.pdf')])).gaps)
    expect(copy.body).toMatch(/shown to you first/i)
    expect(copy.body).toMatch(/which document/i)
  })

  it('does not fall over when asked about nothing', () => {
    // Reachable: a document can be filed under an application between the
    // render that raised the offer and the one that draws it.
    expect(twinOfferCopy([]).title).toBe('Read that document into your profile?')
  })
})

describe('remembering what has been asked', () => {
  it('reads back what was written', () => {
    expect(parseOffered(JSON.stringify(['f1', 'f2']))).toEqual(['f1', 'f2'])
  })

  it('reads nothing stored as nothing asked yet', () => {
    // The ordinary first run, not an error.
    expect(parseOffered(null)).toEqual([])
  })

  it('reads a malformed record as nothing asked yet', () => {
    /*
     * The safe direction, and the reason one JSON key is acceptable where
     * `lib/onboarding.ts` argues for one key per flag. Failing to "nothing
     * asked" asks again. Failing the other way would leave a document silently
     * never read while the record claimed the person had been consulted.
     */
    expect(parseOffered('{not json')).toEqual([])
    expect(parseOffered(JSON.stringify({ f1: true }))).toEqual([])
  })

  it('drops entries that are not ids', () => {
    expect(parseOffered(JSON.stringify(['f1', 42, null, { id: 'f2' }]))).toEqual(['f1'])
  })

  it('records a document whichever way it was answered', () => {
    /*
     * One function rather than two, and this is the case that decides it. A
     * version that remembered only declines would re-offer a document the
     * instant its extraction failed — precisely when the person least wants the
     * same question again.
     */
    expect(mergeOffered(['f1'], ['f1'])).toEqual(['f1'])
  })

  it('leaves the set alone when nothing was asked', () => {
    // Reached on every render where the offer resolves to nothing, so it must
    // not churn a store the graph shares.
    const current = ['f1']
    expect(mergeOffered(current, [])).toBe(current)
  })

  it('keeps the newest when it overflows', () => {
    const many = Array.from({ length: OFFER_MEMORY_LIMIT + 60 }, (_, i) => `f${String(i)}`)
    const kept = mergeOffered([], many)
    expect(kept).toHaveLength(OFFER_MEMORY_LIMIT)
    expect(kept[kept.length - 1]).toBe(`f${String(OFFER_MEMORY_LIMIT + 59)}`)
  })

  it('moves a re-asked document to the end rather than leaving it where it was', () => {
    // So the limit drops what has genuinely been quiet longest, not what
    // happened to be stored first and has been asked about since.
    expect(mergeOffered(['f1', 'f2'], ['f1'])).toEqual(['f2', 'f1'])
  })

  it('does not store the same id twice from one offer', () => {
    // `newlyReadable` cannot produce a duplicate today; the store must not
    // depend on that staying true.
    expect(mergeOffered([], ['f1', 'f1'])).toEqual(['f1'])
  })
})

describe('which documents count', () => {
  it('takes the bucket as the signal, whatever the file is called', () => {
    /*
     * The bucket is the user saying what kind of document this is, in the
     * app's own vocabulary — `core/model.ts` defines `Applications` as "the
     * drawer for the things a person WROTE". A name pattern is a guess at the
     * same question, and it fails on `Shaswata.pdf`.
     */
    const state = twinState(graph([file('f1', 'Shaswata.pdf')]))
    expect(state.gaps.map((g) => g.id)).toEqual(['f1'])
  })

  it('still takes the name for something filed elsewhere', () => {
    // A CV dropped into "To read" is still a CV, which is why this is an OR
    // rather than a bucket check alone.
    const state = twinState(graph([file('f1', 'my-cv.pdf', 'To read')]))
    expect(state.gaps.map((g) => g.id)).toEqual(['f1'])
  })

  it('ignores an unrelated document filed somewhere else', () => {
    const state = twinState(graph([file('f1', 'conference-programme.pdf', 'To read')]))
    expect(state.gaps.filter((g) => g.kind === 'unread-document')).toEqual([])
  })

  it('refuses a record with no document behind it', () => {
    /*
     * Found by looking at what the demo data set would do. It ships
     * `CV-2026-academic.pdf` and two statements as records with no bytes, so
     * without this a fresh install opens with an offer to read a CV that cannot
     * be opened — a consent prompt whose only possible outcome is an error, put
     * in front of somebody on their first run.
     *
     * Every file in a backup restored onto a machine that never held the
     * originals is the same case, and it is not rare.
     */
    const state = twinState(graph([empty('f1', 'CV-2026-academic.pdf')]))
    expect(state.unread).toBe(0)
    expect(state.gaps.map((g) => g.kind)).toEqual(['no-background'])
  })

  it('accepts the phone’s way of holding bytes as well as the browser’s', () => {
    // `path` is web's flag and `uri` is the phone's. Both are checked in core
    // because "can this be opened at all" is the same question on both.
    const onPhone = node('f1', 'file', {
      slug: 'f1',
      name: 'CV.pdf',
      kind: 'pdf',
      bucket: 'Applications',
      size: '1 KB',
      savedOn: '2026-09-01',
      uri: 'file:///documents/f1.pdf',
    })
    expect(twinState(graph([onPhone])).unread).toBe(1)
  })
})

describe('the documents worth reading', () => {
  it('offers a research statement and a teaching philosophy', () => {
    /*
     * These state what a CV cannot. A CV lists papers; a research statement
     * says what the person works ON, which is the thing an academic posting
     * asks for and the thing the graph had no way to hold.
     */
    const state = twinState(
      graph([file('f1', 'Research-statement-v4.doc'), file('f2', 'Teaching philosophy.pdf', 'To read')]),
    )
    expect(state.gaps.map((g) => g.id).sort()).toEqual(['f1', 'f2'])
  })

  it('offers a master cover letter that is not attached to a job', () => {
    // The generic one people keep and adapt. A tailored copy filed under an
    // application is excluded by the `FILED_UNDER` rule, which is what keeps
    // this from reading somebody's pitch to one employer as their background.
    const state = twinState(graph([file('f1', 'Cover letter — master.docx', 'To read')]))
    expect(state.gaps.map((g) => g.id)).toEqual(['f1'])
  })

  it('still refuses an offer letter, which is the employer’s document', () => {
    // `ABOUT_AN_EMPLOYER` vetoes before the bucket, and "letter" appearing in
    // the person-document pattern must not undo that.
    const state = twinState(graph([file('f1', 'Offer letter — Rice.pdf')]))
    expect(state.gaps.filter((g) => g.kind === 'unread-document')).toEqual([])
  })
})
