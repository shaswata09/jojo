import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { Txt } from '@/components/ui/Text'
import { newlyReadable, twinOfferCopy, twinState } from '@jojo/service/core/twin'
import type { TwinGap } from '@jojo/service/core/twin'
import { useGraph } from '@jojo/service/react/kg-context'
import { useRun } from '@jojo/service/react/use-tool'
import type { BackgroundDraft, RelationDraft } from '@jojo/service/agent/read-cv'
import { labelOf } from '@jojo/service/core/ontology'
import { useReadCv } from '@/lib/cv-agent'
import { useModelSettings } from '@/lib/model-settings-context'
import { useToast } from '@/lib/toast-context'
import { markOffered, offered } from '@/lib/twin-offer'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * The offer to read a newly filed document into the person's profile.
 *
 * The phone's half of web's `ProfileUpdateOffer.tsx`, and it makes the same two
 * decisions for reasons the web file argues at length: a strip at the top of
 * the app rather than a sheet, because filing a document usually happens from
 * inside a sheet and two sheets at once on a phone means the second is simply
 * invisible; and a review list before anything is written, because the consent
 * copy in `core/twin.ts` promises exactly that.
 *
 * WHAT DIFFERS HERE is the read. AsyncStorage is not synchronous, so the set of
 * ids already asked about arrives a frame or two after the first render — and
 * `null` until it does. Rendering the offer during that gap would flash a
 * consent prompt at somebody who declined it last week, so the strip renders
 * nothing at all until the answer is known.
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
  const c = useColors()
  const graph = useGraph()
  const { settings } = useModelSettings()
  const readCv = useReadCv()
  const run = useRun()
  const { toast } = useToast()

  // `null` while the store is still being read. See the header — an empty array
  // here would flash the offer at somebody who already answered it.
  const [seen, setSeen] = useState<readonly string[] | null>(null)
  // A string rather than a step name: the reader makes one pass per section of
  // the document and says which one it is on, so there is no fixed set to map.
  const [step, setStep] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<readonly BackgroundDraft[] | null>(null)
  // Beside the entries rather than inside them: a relation is about two of them
  // and belongs to neither. Shown in the same review, because it is a claim
  // about this person too and the copy promises everything is seen first.
  const [links, setLinks] = useState<readonly RelationDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    let live = true
    void offered().then((ids) => {
      if (live) setSeen(ids)
    })
    return () => {
      live = false
    }
  }, [])

  const gaps: readonly TwinGap[] = useMemo(
    () => (seen === null ? [] : newlyReadable(seen, twinState(graph, 12))),
    [graph, seen],
  )

  const target = gaps[0]
  const copy = useMemo(() => twinOfferCopy(gaps), [gaps])

  if (seen === null || !target || target.id === undefined) return null
  // A model has to be configured for "yes" to lead anywhere. An offer whose
  // only outcome is an error about Settings is worse than silence.
  if (settings.model.trim() === '') return null

  const fileId = target.id

  const remember = (ids: readonly string[]) => {
    void markOffered(ids)
    setSeen((current) => [...(current ?? []), ...ids])
  }

  const dismiss = () => {
    abort.current?.abort()
    abort.current = null
    setStep(null)
    setDrafts(null)
    setLinks([])
    setError(null)
    // Every id on offer, not just the one named: the title says "and 2 more",
    // so declining it declines all three.
    remember(gaps.map((g) => g.id).filter((id): id is string => id !== undefined))
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
      // Recorded as asked even though it failed, or the strip returns with the
      // same document and the same failure waiting behind it.
      remember([fileId])
      setError(outcome.reason)
      return
    }

    setDrafts(outcome.background)
    setLinks(outcome.relations)
    if (outcome.skipped.length > 0) {
      toast({
        title: `${String(outcome.skipped.length)} entr${outcome.skipped.length === 1 ? 'y was' : 'ies were'} skipped`,
        description: outcome.skipped[0] ?? '',
      })
    }
  }

  const confirm = () => {
    if (!drafts || drafts.length === 0) return
    const result = run('profile.background.add', {
      // `source` on every entry: `twinState` counts a document as read when a
      // fact points back at it, so omitting it would leave the document
      // eternally unread and this strip would offer it again tomorrow.
      background: drafts.map((d) => ({ ...d, source: fileId })),
    })

    /*
     * The relations, once the entries have ids to point at. The ids come back
     * in the order the entries were given, which is what makes a position
     * resolvable — and why the reader returns positions rather than asking a
     * model to copy uuids. `claim.add` refuses any the graph already holds
     * under another name, which is the feature working rather than an error.
     */
    const ids = result.ok ? (result.output as string[]) : []
    let related = 0
    if (result.ok) {
      for (const link of links) {
        const subject = ids[link.subject]
        const object = ids[link.object]
        if (subject === undefined || object === undefined) continue
        if (run('claim.add', { subject, predicate: link.predicate, object, source: fileId }).ok) {
          related += 1
        }
      }
    }

    remember([fileId])
    setDrafts(null)
    setLinks([])

    toast({
      title: result.ok
        ? `${String(drafts.length)} added to your profile`
        : 'Nothing could be added',
      description: result.ok
        ? `Read from ${target.subject}.${related > 0 ? ` ${String(related)} connection${related === 1 ? '' : 's'} recorded.` : ''}`
        : (result.errors[0]?.message ?? 'The entries were refused.'),
      ...(result.ok ? {} : { tone: 'danger' as const }),
    })
  }

  const busy = step !== null

  return (
    <View
      style={{
        backgroundColor: c.accentSoft,
        borderBottomWidth: 1,
        borderBottomColor: c.accentBorder,
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        gap: space[2],
      }}
    >
      <Txt size="sm" weight="medium">
        {copy.title}
      </Txt>
      <Txt size="xs" tone="secondary">
        {copy.body}
      </Txt>
      {error !== null && (
        <Txt size="xs" color={c.danger}>
          {error}
        </Txt>
      )}

      {drafts === null ? (
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Button
            size="sm"
            label={busy ? step : 'Read it'}
            disabled={busy}
            onPress={() => {
              void accept().catch((thrown: unknown) => {
                // Same reason as the fit panel: everything under this reports
                // failure as a value, so a throw here would otherwise leave the
                // button stuck mid-step with nothing said.
                setStep(null)
                setError(thrown instanceof Error ? thrown.message : 'Reading the document failed.')
              })
            }}
          />
          <Button size="sm" variant="ghost" label="Not now" onPress={dismiss} />
        </View>
      ) : (
        <View style={{ gap: space[2] }}>
          {/* Nothing has been written at this point. This list IS the "shown to
              you first" the copy above promises. */}
          <Txt size="sm" weight="medium">
            {drafts.length === 1
              ? '1 entry read from this document'
              : `${String(drafts.length)} entries read from this document`}
          </Txt>
          <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
            <View style={{ gap: space[1.5] }}>
              {drafts.map((d, i) => (
                <View key={`${d.kind}-${d.title}-${String(i)}`}>
                  <Txt size="xs" tone="secondary" uppercase>
                    {KIND_LABEL[d.kind] ?? d.kind}
                  </Txt>
                  <Txt size="sm">
                    {d.title}
                    {d.where === undefined ? '' : ` · ${d.where}`}
                    {d.period === undefined ? '' : ` · ${d.period}`}
                  </Txt>
                </View>
              ))}
            </View>
          </ScrollView>
          {links.length > 0 && (
            <View style={{ gap: space[1], borderTopWidth: 1, borderTopColor: c.hairline, paddingTop: space[2] }}>
              <Txt size="sm" weight="medium">
                {links.length === 1
                  ? '1 connection between them'
                  : `${String(links.length)} connections between them`}
              </Txt>
              {links.slice(0, 6).map((link) => (
                <Txt
                  key={`${String(link.subject)}-${link.predicate}-${String(link.object)}`}
                  size="xs"
                  tone="secondary"
                >
                  {drafts[link.subject]?.title ?? '?'} · {labelOf(link.predicate)} ·{' '}
                  {drafts[link.object]?.title ?? '?'}
                </Txt>
              ))}
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: space[2] }}>
            <Button
              size="sm"
              label={drafts.length === 1 ? 'Add it' : `Add all ${String(drafts.length)}`}
              onPress={confirm}
            />
            <Button size="sm" variant="ghost" label="Discard" onPress={dismiss} />
          </View>
        </View>
      )}
    </View>
  )
}
