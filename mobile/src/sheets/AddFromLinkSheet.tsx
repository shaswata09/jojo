import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { useModelSettings } from '@/lib/model-settings-context'
import { useReadPosting } from '@/lib/posting-agent'
import type { PostingStep } from '@/lib/posting-agent'
import { useSheets } from '@/lib/sheets-context'
import { draftFromUrl } from '@jojo/service/core/parse-posting'
import { useToast } from '@/lib/toast-context'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * Paste a posting URL and let the model fill the form in.
 *
 * The phone's twin of web's `AddFromLinkDialog`, down to the wording of the
 * three steps: it is one feature, and somebody who learns it on the laptop
 * should recognise it here.
 *
 * Reached two ways: the create menu, which opens it empty, and the "From link"
 * field beside the Applications search box, which opens it on the pasted URL
 * and starts at once when a model is connected. Without one, that field fills
 * the form from the address alone — instant, needs nothing running, and
 * cannot see a deadline. The phone has no extension, so the page is always
 * fetched by the document reader here.
 *
 * Both end in the same place: the ordinary create sheet, prefilled, waiting to
 * be checked. Nothing here writes an application. What it DOES write is the
 * page, because a posting is worth keeping whether or not it becomes one.
 */

const STEPS: { id: PostingStep; label: string }[] = [
  { id: 'reading', label: 'Fetching the page' },
  { id: 'asking', label: 'Reading it' },
  { id: 'saving', label: 'Saving the posting' },
]

export function AddFromLinkSheet({
  open,
  url: opening = '',
  start = false,
}: {
  open: boolean
  /** The URL "From link" was pressed with. Empty when the create menu opened this. */
  url?: string | undefined
  /** Read it straight away: the person has already pressed a button for it once. */
  start?: boolean | undefined
}) {
  const c = useColors()
  const { open: openSheet, close } = useSheets()
  const { settings, reader } = useModelSettings()
  const readPosting = useReadPosting()
  const { toast } = useToast()

  const [url, setUrl] = useState(opening)
  const [step, setStep] = useState<PostingStep | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  const busy = step !== null

  const dismiss = () => {
    // A close mid-read has to stop the read, or the create sheet opens on top
    // of nothing a few seconds after the user decided against it.
    abort.current?.abort()
    close()
  }

  // Memoised for the effect below; see web's `AddFromLinkDialog`.
  const submit = useCallback(
    (value: string = url) => {
      const text = value.trim()
      if (!text || busy) return
      setError(null)
      const stop = new AbortController()
      abort.current = stop

      void (async () => {
        const outcome = await readPosting({
          url: text,
          settings,
          reader,
          signal: stop.signal,
          onStep: setStep,
        })

        abort.current = null
        setStep(null)

        if (!outcome.ok) {
          setError(outcome.reason)
          return
        }

        close()
        openSheet('application', {
          mode: 'create',
          initial: {
            ...outcome.draft,
            // Spread, not assigned: `keywordsOf` returns `initial.keywords`
            // whenever it is truthy and `[]` is truthy — absence is the
            // question, an empty array is an answer. Web's half says the same.
            ...(outcome.keywords.length === 0 ? {} : { keywords: [...outcome.keywords] }),
            postingFileId: outcome.file.id,
          },
        })

        const gaps = outcome.missing.length
        const tags = outcome.keywords.length
        toast({
          title: 'Posting saved and read',
          // Said in the same words web says them, and for the same reason: the
          // sheet changes fields the person did not fill in, so it has to
          // report which. The keyword line is omitted at zero — "0 keywords
          // matched" is a sentence about the feature, not about this posting —
          // and its noun stays plural because "N of your …" governs one.
          description: [
            `${outcome.file.name} is in the Vault, and is filed under the application when you save it.`,
            gaps === 0
              ? ''
              : `${String(gaps)} field${gaps === 1 ? ' was' : 's were'} not on the page.`,
            tags === 0
              ? ''
              : `${String(tags)} of your keywords ${tags === 1 ? 'is' : 'are'} ticked.`,
          ]
            .filter(Boolean)
            .join(' '),
        })
      })()
        /*
         * Every layer under this reports failure as a value, so reaching here
         * means something threw that none of them expected. `writeCapture` is the
         * live one: its three `fs` calls are bare, and a full disk rejects the
         * write AFTER the Vault record has been added. Without the catch that is
         * an unhandled rejection and a sheet left on "Reading…" with the button
         * disabled and nothing said — while the Vault holds a row with no bytes
         * behind it.
         */
        .catch((thrown: unknown) => {
          abort.current = null
          setStep(null)
          setError(thrown instanceof Error ? thrown.message : 'Reading the posting failed.')
        })
    },
    [url, busy, settings, reader, readPosting, close, openSheet, toast],
  )

  /*
   * "From link" has already been pressed, so the read starts on its own. The
   * ref makes it exactly once, StrictMode's double mount included; see web's
   * `AddFromLinkDialog` for why there is no cleanup that aborts.
   */
  const started = useRef(false)
  useEffect(() => {
    if (!start || started.current || opening.trim() === '') return
    started.current = true
    submit(opening)
  }, [start, opening, submit])

  /** The form, filled from the address alone — what "From link" does without a model. */
  const fromAddress = () => {
    const text = url.trim()
    if (!text) return
    close()
    openSheet('application', { initial: draftFromUrl(text) })
  }

  return (
    <Sheet
      open={open}
      onClose={dismiss}
      title="Application from a link"
      description="The model reads the posting and fills the form in, and ticks any of your own keywords the job is plainly about. The page is kept in the Vault under Job postings, and nothing is saved as an application until you say so."
      footer={
        <>
          {error && !busy ? (
            <Button label="Use the address only" variant="ghost" size="md" onPress={fromAddress} />
          ) : null}
          <Button label="Cancel" variant="ghost" size="md" onPress={dismiss} />
          <Button
            label={busy ? 'Reading…' : error ? 'Try again' : 'Read and prefill'}
            size="md"
            disabled={!url.trim() || busy}
            onPress={() => submit()}
          />
        </>
      }
    >
      <View style={{ gap: space[3], paddingBottom: space[2] }}>
        <TextField
          label="Job posting URL"
          required
          mono
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          editable={!busy}
          value={url}
          placeholder="https://boards.greenhouse.io/acme/jobs/4"
          onChangeText={setUrl}
        />

        {/* Only while it is working. A step list sitting greyed out before
            anything starts is three promises the sheet has not made yet. */}
        {busy ? (
          <View style={{ gap: space[1.5] }} accessibilityLiveRegion="polite">
            {STEPS.map((entry) => {
              const at = STEPS.findIndex((x) => x.id === step)
              const mine = STEPS.findIndex((x) => x.id === entry.id)
              const done = mine < at
              const active = mine === at
              return (
                <View key={entry.id} style={s.row}>
                  <Feather
                    name={done ? 'check' : active ? 'loader' : 'circle'}
                    size={13}
                    color={done ? c.accent : active ? c.text1 : c.text3}
                  />
                  <Txt size="xs" tone={active ? 'primary' : done ? 'secondary' : 'muted'}>
                    {entry.label}
                  </Txt>
                </View>
              )
            })}
          </View>
        ) : null}

        {error ? (
          <Txt size="xs" tone="danger">
            {error}
          </Txt>
        ) : null}
      </View>
    </Sheet>
  )
}
