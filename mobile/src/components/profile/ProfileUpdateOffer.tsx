import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { Txt } from '@/components/ui/Text'
import { newlyReadable, twinOfferCopy, twinState } from '@jojo/service/core/twin'
import type { TwinGap } from '@jojo/service/core/twin'
import { useGraph } from '@jojo/service/react/kg-context'
import { useRun } from '@jojo/service/react/use-tool'
import type { BackgroundDraft } from '@jojo/service/agent/read-cv'
import { useReadCv } from '@/lib/cv-agent'
import type { CvStep } from '@/lib/cv-agent'
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

const STEP_LABEL: Record<CvStep, string> = {
  reading: 'Opening the document',
  asking: 'Reading what it says',
}

const KIND_LABEL: Record<string, string> = {
  education: 'Education',
  employment: 'Employment',
  publication: 'Publication',
  skill: 'Skill',
  teaching: 'Teaching',
  award: 'Award',
  service: 'Service',
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
  const [step, setStep] = useState<CvStep | null>(null)
  const [drafts, setDrafts] = useState<readonly BackgroundDraft[] | null>(null)
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

    remember([fileId])
    setDrafts(null)

    toast({
      title: result.ok
        ? `${String(drafts.length)} added to your profile`
        : 'Nothing could be added',
      description: result.ok
        ? `Read from ${target.subject}.`
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
            label={busy ? STEP_LABEL[step] : 'Read it'}
            disabled={busy}
            onPress={() => void accept()}
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
