import { useRef, useState } from 'react'
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
 * The Applications screen already has a "From link" field beside its search
 * box, and that one stays: it reads the URL and nothing else — employer from
 * the hostname, role from the last path segment — which is instant, needs
 * nothing running, and cannot see a deadline. This is the other trade.
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

export function AddFromLinkSheet({ open }: { open: boolean }) {
  const c = useColors()
  const { open: openSheet, close } = useSheets()
  const { settings, reader } = useModelSettings()
  const readPosting = useReadPosting()
  const { toast } = useToast()

  const [url, setUrl] = useState('')
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

  const submit = () => {
    const text = url.trim()
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
      openSheet('application', { mode: 'create', initial: outcome.draft })

      const gaps = outcome.missing.length
      toast({
        title: 'Posting saved and read',
        description:
          gaps === 0
            ? `${outcome.file.name} is in the Vault. Check the form before saving it.`
            : `${outcome.file.name} is in the Vault. ${String(gaps)} field${gaps === 1 ? '' : 's'} were not on the page.`,
      })
    })()
  }

  return (
    <Sheet
      open={open}
      onClose={dismiss}
      title="Application from a link"
      description="The model reads the posting and fills the form in. The page is kept in the Vault under Job postings, and nothing is saved as an application until you say so."
      footer={
        <>
          <Button label="Cancel" variant="ghost" size="md" onPress={dismiss} />
          <Button
            label={busy ? 'Reading…' : 'Read and prefill'}
            size="md"
            disabled={!url.trim() || busy}
            onPress={submit}
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
