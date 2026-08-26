import { useMemo, useRef, useState } from 'react'
import { Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { newlyReadable, twinOfferCopy, twinState } from '@jojo/service/core/twin'
import type { TwinGap } from '@jojo/service/core/twin'
import { useGraph } from '@jojo/service/react/kg-context'
import { useRun } from '@jojo/service/react/use-tool'
import { useToast } from '@jojo/service/react/toast'
import type { BackgroundDraft, RelationDraft } from '@jojo/service/agent/read-cv'
import { labelOf } from '@jojo/service/core/ontology'
import { useReadCv } from '@/lib/cv-agent'
import { useModelSettings } from '@/lib/model-settings-context'
import { markOffered, offered } from '@/lib/twin-offer'

/**
 * The offer to read a newly filed document into the person's profile.
 *
 * ## Why a banner and not a dialog
 *
 * The obvious shape is a modal, and it is wrong here for a reason the dialog
 * host states itself: exactly one dialog is open at a time and opening a second
 * replaces the first. The moment this fires is the moment somebody has filed a
 * document — which they very often do from inside another form — so a modal
 * would destroy what they were in the middle of in order to ask them a favour.
 *
 * A banner sits above the route, is visible from every screen, and waits. That
 * is the correct amount of insistence for a question whose answer can be "not
 * now" forever.
 *
 * ## Why it asks at all
 *
 * Reading a CV means a model reads a document about a person and writes what it
 * finds into their own records. That is not the same act as tidying their job
 * list, and it is not covered by having once enabled a pipeline. The wording is
 * in `core/twin.ts` next to the function that decides when to ask, because both
 * apps use both and the sentence IS the consent.
 *
 * ## What "yes" does, and what it does not
 *
 * It reads. Every entry then goes on screen with the document it came from, and
 * nothing is written until the person presses Add. The copy promises exactly
 * that, so the write deliberately does not live in `cv-agent.ts` — it lives
 * here, next to the list they are looking at.
 */

const KIND_LABEL: Record<string, string> = {
  education: 'Education',
  employment: 'Employment',
  publication: 'Publication',
  skill: 'Skill',
  teaching: 'Teaching',
  award: 'Award',
  service: 'Service',
  certification: 'Certification',
  language: 'Language',
  project: 'Project',
  volunteering: 'Volunteering',
  membership: 'Membership',
  grant: 'Grant',
  patent: 'Patent',
}

export function ProfileUpdateOffer() {
  const graph = useGraph()
  const { settings } = useModelSettings()
  const readCv = useReadCv()
  const run = useRun()
  const { toast } = useToast()

  /*
   * The ids asked about, held in state rather than read from storage on every
   * render. Storage is the durable copy; this is what makes the banner
   * disappear the instant it is answered, without waiting for a graph change to
   * re-run the selector.
   */
  const [seen, setSeen] = useState<readonly string[]>(() => offered())
  /*
   * The label the reader is on, already worded for a person.
   *
   * A string rather than a step name, because there is no longer a fixed set of
   * them: the reader makes one pass per section of the document and says which
   * one it is on. A `Record<Step, string>` here would have had to be kept in
   * step with a list the reader computes.
   */
  const [step, setStep] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<readonly BackgroundDraft[] | null>(null)
  /*
   * Held beside the entries rather than inside them, because a relation is
   * about two of them and belongs to neither. Shown in the same review for the
   * same reason the entries are: a relation is a claim about this person too,
   * and the copy promises everything is seen first.
   */
  const [links, setLinks] = useState<readonly RelationDraft[]>([])
  /*
   * Which entries the person still wants, by position.
   *
   * A set of the DROPPED ones rather than the kept ones, so the default is
   * everything: a review that started with nothing selected would make the
   * common case — the reading was fine — the one that takes the most clicks.
   *
   * This exists because the review was all-or-nothing, which is the worst
   * possible shape for the models most people run. A 1–3B reading a CV will get
   * two entries wrong out of thirty, and the only remedy was to discard the
   * whole read and pay for it again, or accept the errors and delete them one
   * at a time afterwards.
   */
  const [dropped, setDropped] = useState<ReadonlySet<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  const gaps: readonly TwinGap[] = useMemo(
    () => newlyReadable(seen, twinState(graph, 12)),
    [graph, seen],
  )

  const target = gaps[0]
  const copy = useMemo(() => twinOfferCopy(gaps), [gaps])

  /*
   * Nothing to ask, or nothing to ask WITH. A model has to be configured for
   * "yes" to lead anywhere, and an offer whose only outcome is an error about
   * Settings is worse than silence — the document stays unread either way, and
   * this way it does not also interrupt.
   */
  if (!target || target.id === undefined) return null
  if (settings.model.trim() === '') return null

  const fileId = target.id

  const dismiss = () => {
    abort.current?.abort()
    abort.current = null
    setStep(null)
    setDrafts(null)
    setLinks([])
    setDropped(new Set())
    setError(null)
    // Every id currently on offer, not just the one named. The title says "and
    // 2 more", so saying no to it is saying no to all three — leaving the other
    // two unrecorded would put the same banner straight back on screen.
    const ids = gaps.map((g) => g.id).filter((id): id is string => id !== undefined)
    markOffered(ids)
    setSeen((current) => [...current, ...ids])
  }

  const accept = async () => {
    setError(null)
    const stop = new AbortController()
    abort.current = stop

    const outcome = await readCv({
      fileId,
      name: target.subject,
      settings,
      onStep: setStep,
      signal: stop.signal,
    })

    abort.current = null
    setStep(null)

    if (!outcome.ok) {
      /*
       * Recorded as asked even though it failed. Without this the banner comes
       * straight back with the same document and the same failure waiting
       * behind it — a loop the person can only escape by declining something
       * they already said yes to.
       */
      markOffered([fileId])
      setSeen((current) => [...current, fileId])
      setError(outcome.reason)
      return
    }

    setDrafts(outcome.background)
    setLinks(outcome.relations)
    setDropped(new Set())
    if (outcome.skipped.length > 0) {
      toast({
        title: `${String(outcome.skipped.length)} entr${outcome.skipped.length === 1 ? 'y was' : 'ies were'} skipped`,
        description: outcome.skipped[0] ?? '',
      })
    }
  }

  const confirm = () => {
    if (!drafts || drafts.length === 0) return

    /*
     * Only what survived the review, and the ORIGINAL positions are kept
     * alongside so the relations can still be resolved: `claim.add` refers to
     * entries by their position in the list the model was shown, and filtering
     * renumbers everything.
     */
    const keeping = drafts
      .map((draft, at) => ({ draft, at }))
      .filter(({ at }) => !dropped.has(at))
    if (keeping.length === 0) return

    const result = run('profile.background.add', {
      // `source` on every entry, and this is the line that closes the loop:
      // `twinState` counts a document as read when a fact points back at it, so
      // an import that omitted it would leave the document eternally unread and
      // this banner would offer it again tomorrow.
      background: keeping.map(({ draft }) => ({ ...draft, source: fileId })),
    })

    /*
     * The relations, once the entries have ids to point at.
     *
     * `profile.background.add` returns the ids in the order it was given the
     * entries, which is what makes a position resolvable at all — and why the
     * reader returns positions rather than asking a model to copy uuids.
     *
     * Each is offered to `claim.add`, which refuses any the graph already holds
     * under another name. A refusal here is the feature working, not an error,
     * so nothing is reported for it.
     */
    const ids = result.ok ? (result.output as string[]) : []
    /*
     * Original position -> the id it was actually written under. Built from
     * `keeping`, so a relation naming an entry the person dropped resolves to
     * nothing and is skipped rather than silently pointing at whichever entry
     * shifted into that slot.
     */
    const idAt = new Map(keeping.map(({ at }, i) => [at, ids[i]]))
    let related = 0
    if (result.ok) {
      for (const link of links) {
        const subject = idAt.get(link.subject)
        const object = idAt.get(link.object)
        if (subject === undefined || object === undefined) continue
        const out = run('claim.add', {
          subject,
          predicate: link.predicate,
          object,
          source: fileId,
        })
        if (out.ok) related += 1
      }
    }

    markOffered([fileId])
    setSeen((current) => [...current, fileId])
    setDrafts(null)
    setLinks([])

    toast({
      title: result.ok
        ? `${String(keeping.length)} added to your profile`
        : 'Nothing could be added',
      description: result.ok
        ? `Read from ${target.subject}.${related > 0 ? ` ${String(related)} connection${related === 1 ? '' : 's'} between them recorded.` : ''} jojo can now weigh a posting against what you have done.`
        : (result.errors[0]?.message ?? 'The entries were refused.'),
      ...(result.ok ? {} : { tone: 'danger' as const }),
    })
  }

  const busy = step !== null

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border border-accent-border bg-accent-soft px-4 py-3 text-sm"
    >
      <div className="flex flex-wrap items-start gap-2.5">
        <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{copy.title}</p>
          <p className="mt-1 text-muted-foreground">{copy.body}</p>
          {error !== null && <p className="mt-2 text-danger">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {drafts === null && (
            <Button size="sm" disabled={busy} onClick={() => {
              void accept().catch((thrown: unknown) => {
                // Same reason as the fit panel: everything under this reports
                // failure as a value, so a throw here would otherwise leave the
                // button stuck mid-step with nothing said.
                setStep(null)
                setError(thrown instanceof Error ? thrown.message : 'Reading the document failed.')
              })
            }}>
              {busy ? (
                <>
                  <Loader2 aria-hidden className="size-3.5 animate-spin" />
                  {step}
                </>
              ) : (
                'Read it'
              )}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={dismiss}
            aria-label={drafts === null ? 'Not now' : 'Discard these entries'}
          >
            <X aria-hidden className="size-4" />
          </Button>
        </div>
      </div>

      {/* The review. Nothing has been written at this point — this list IS the
          "shown to you first" the copy above promises. */}
      {drafts !== null && (
        <div className="rounded-md border border-border bg-background px-3 py-2.5">
          <p className="mb-2 font-medium">
            {drafts.length === 1
              ? '1 entry read from this document'
              : `${String(drafts.length - dropped.size)} of ${String(drafts.length)} entries will be added`}
            <span className="ml-2 font-normal text-text-3">Untick anything it got wrong.</span>
          </p>
          <ul className="max-h-64 space-y-1.5 overflow-y-auto text-muted-foreground">
            {drafts.map((d, i) => (
              <li key={`${d.kind}-${d.title}-${String(i)}`} className="flex items-start gap-2">
                {/* A checkbox per entry, ticked by default. The review was
                    all-or-nothing, which is the worst shape for the models most
                    people run: a small model gets two of thirty wrong, and the
                    only remedy was to discard the whole read and pay for it
                    again. Default-ticked so the common case — the reading was
                    fine — stays one click. */}
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 shrink-0 accent-accent"
                  checked={!dropped.has(i)}
                  aria-label={`Add ${d.title}`}
                  onChange={() =>
                    setDropped((held) => {
                      const next = new Set(held)
                      if (next.has(i)) next.delete(i)
                      else next.add(i)
                      return next
                    })
                  }
                />
                <span className="w-24 shrink-0 text-xs uppercase tracking-wide">
                  {KIND_LABEL[d.kind] ?? d.kind}
                </span>
                <span
                  className={`min-w-0 flex-1 ${dropped.has(i) ? 'text-text-3 line-through' : 'text-foreground'}`}
                >
                  {d.title}
                  {d.where !== undefined && <span className="text-muted-foreground"> · {d.where}</span>}
                  {d.period !== undefined && <span className="text-muted-foreground"> · {d.period}</span>}
                </span>
              </li>
            ))}
          </ul>
          {links.length > 0 && (
            <div className="mt-3 border-t border-hairline pt-2.5">
              <p className="mb-1.5 font-medium">
                {links.length === 1
                  ? '1 connection between them'
                  : `${String(links.length)} connections between them`}
              </p>
              <ul className="max-h-32 space-y-1 overflow-y-auto text-muted-foreground">
                {links.map((link) => (
                  <li key={`${String(link.subject)}-${link.predicate}-${String(link.object)}`}>
                    {drafts[link.subject]?.title ?? '?'}{' '}
                    <span className="text-foreground">{labelOf(link.predicate)}</span>{' '}
                    {drafts[link.object]?.title ?? '?'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={confirm} disabled={dropped.size === drafts.length}>
              {drafts.length - dropped.size === 1
                ? 'Add it to my profile'
                : `Add ${String(drafts.length - dropped.size)} to my profile`}
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
