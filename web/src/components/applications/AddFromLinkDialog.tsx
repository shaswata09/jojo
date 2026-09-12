import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, Link as LinkIcon, Loader2, Sparkles } from 'lucide-react'
import { draftFromUrl } from '@/components/applications/draft-from'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDialogs } from '@/lib/dialogs-context'
import { useModelSettings } from '@/lib/model-settings-context'
import { useReadPosting } from '@/lib/posting-agent'
import type { PostingStep } from '@/lib/posting-agent'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'
import { contentModal } from '@/components/ui/dialog-width'

/**
 * Paste a posting URL and let the model fill the form in.
 *
 * Reached two ways: the create menu's "Application from a link", which opens it
 * empty, and the "From link" field on the Applications page and the dashboard,
 * which opens it on the pasted URL and starts at once — when a model is
 * connected. Without one, that field fills the form from the address alone;
 * see `AddByUrl`.
 *
 * The page is opened through the jojo extension when it is installed — as the
 * person would see it, signed in, rendered — and through the document reader
 * when it is not. See `lib/posting-agent.ts` for why in that order.
 *
 * Both end in the same place: the ordinary create form, prefilled, waiting to
 * be checked. Nothing here writes an application. What it DOES write is the
 * page — a posting is worth keeping whether or not it becomes an application,
 * and the Vault has a drawer for exactly that. The page's id rides into the
 * form, which files it under the application when one is saved.
 *
 * THE STEPS ARE ON SCREEN because they take real seconds and fail differently.
 * A spinner that sat for fifteen seconds and then said "could not add" would
 * leave the user with no idea which of three things to go and look at. And a
 * failure offers the address-only form, because the person came here to add an
 * application and a page that would not open is no reason to stop them.
 */

const STEPS: { id: PostingStep; label: string }[] = [
  { id: 'reading', label: 'Fetching the page' },
  { id: 'asking', label: 'Reading it' },
  { id: 'saving', label: 'Saving the posting' },
]

export function AddFromLinkDialog({
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
  const id = useId()
  const { open: openDialog, close } = useDialogs()
  const { settings, reader } = useModelSettings()
  const readPosting = useReadPosting()
  const { toast } = useToast()

  const [url, setUrl] = useState(opening)
  const [step, setStep] = useState<PostingStep | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  const busy = step !== null

  /*
   * Memoised, because the effect below starts it and the lint rule is right
   * that a function made fresh on every render would re-run that effect on
   * every render. The `started` ref is still what makes it once.
   */
  const submit = useCallback(
    async (value: string = url) => {
      const text = value.trim()
      if (!text || busy) return
      setError(null)
      const stop = new AbortController()
      abort.current = stop

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

      // Straight into the ordinary create form. `close` first so only one dialog
      // is ever mounted — `open` would replace this one anyway, but the host
      // keys its mounts off the name and the explicit close reads as intended.
      close()
      openDialog('application', {
        mode: 'create',
        initial: {
          ...outcome.draft,
          // Spread rather than assigned: `keywordsOf` returns `initial.keywords`
          // whenever it is truthy, and `[]` is truthy — so an empty array would
          // be a decision ("this record has no keywords") where absence is the
          // question ("read them off the record"). It reads the same on a create
          // form, and would be wrong the day this initial is reused on an edit.
          ...(outcome.keywords.length === 0 ? {} : { keywords: [...outcome.keywords] }),
          postingFileId: outcome.file.id,
        },
      })

      const tags = outcome.keywords.length
      const gaps = outcome.missing.length
      toast({
        title: 'Posting read and saved',
        description: [
          outcome.via === 'extension'
            ? 'The extension saved the page to the Vault'
            : `${outcome.file.name} is in the Vault`,
          'and it is filed under the application when you save it.',
          gaps === 0
            ? ''
            : `${String(gaps)} field${gaps === 1 ? ' was' : 's were'} not on the page.`,
          // Said only when there are some. "0 keywords matched" is a sentence
          // about the feature rather than about this posting, and the picker
          // below already shows the answer.
          // The noun stays plural and only the verb agrees: "N of your …" is a
          // partitive, so "1 of your keyword is ticked" is not English. The
          // `gaps` line above gets away with switching the noun because nothing
          // precedes it.
          tags === 0 ? '' : `${String(tags)} of your keywords ${tags === 1 ? 'is' : 'are'} ticked.`,
          'Check the form before saving it.',
        ]
          .filter(Boolean)
          .join(' '),
        // No "See it in the Vault" action. This toast is raised as the create form
        // opens over it, so a navigation would change the page out of sight, under a
        // modal the person is still filling in — measured, 2026-09-11. The page is
        // filed under the application when they save, which is where they will look.
      })
    },
    [url, busy, settings, reader, readPosting, close, openDialog, toast],
  )

  /*
   * "From link" has already been pressed, so the read starts on its own.
   *
   * A ref rather than an empty dependency list: the lint rule is right that
   * this effect reads `submit`, which is new on every render, and the ref is
   * what makes "exactly once" true under StrictMode's double mount as well —
   * the second pass finds it started. There is deliberately no cleanup that
   * aborts: closing the dialog is what stops a read (see `onOpenChange`), and
   * StrictMode's simulated unmount is not somebody closing it.
   */
  const started = useRef(false)
  useEffect(() => {
    if (!start || started.current || opening.trim() === '') return
    started.current = true
    void submit(opening)
  }, [start, opening, submit])

  /** The form, filled from the address alone — what "From link" does without a model. */
  const fromAddress = () => {
    const text = url.trim()
    if (!text) return
    close()
    openDialog('application', { mode: 'create', initial: draftFromUrl(text) })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return
        // A close mid-read has to stop the read, or the form opens on top of
        // nothing a few seconds after the user decided against it.
        abort.current?.abort()
        close()
      }}
    >
      <DialogContent className={contentModal}>
        <DialogHeader>
          <DialogTitle>New application from a link</DialogTitle>
          <DialogDescription>
            The model reads the posting and fills the form in, and ticks any of your own keywords
            the job is plainly about. The page is kept in the Vault under Job postings — saved by
            the jojo extension when it is installed — and filed under the application once you save
            it. Nothing is saved as an application until you say so.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label htmlFor={id} className="sr-only">
            Job posting URL
          </label>
          <div className="relative min-w-0">
            <LinkIcon
              aria-hidden
              strokeWidth={1.8}
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-3"
            />
            <Input
              id={id}
              type="url"
              inputMode="url"
              autoComplete="off"
              autoFocus
              disabled={busy}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://boards.greenhouse.io/acme/jobs/4"
              className="pl-8"
            />
          </div>

          {/* Only while it is working. A step list sitting greyed-out before
              anything starts is three promises the dialog has not made yet. */}
          {busy ? (
            <ol className="mt-3 grid gap-1.5" aria-live="polite">
              {STEPS.map((s) => {
                const at = STEPS.findIndex((x) => x.id === step)
                const mine = STEPS.findIndex((x) => x.id === s.id)
                const done = mine < at
                const now = mine === at
                return (
                  <li
                    key={s.id}
                    className={cn(
                      'flex items-center gap-2 text-xs',
                      now ? 'text-text-1' : done ? 'text-text-2' : 'text-text-3',
                    )}
                  >
                    {done ? (
                      <Check aria-hidden className="size-3.5 text-accent" strokeWidth={2} />
                    ) : now ? (
                      <Loader2 aria-hidden className="size-3.5 animate-spin" strokeWidth={2} />
                    ) : (
                      <span aria-hidden className="size-3.5" />
                    )}
                    {s.label}
                  </li>
                )
              })}
            </ol>
          ) : null}

          {error ? (
            <p className="mt-3 text-xs text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <DialogFooter className="mt-4">
            {/* Only after a failure: before one, it is a way to skip the
                model the person chose to use. */}
            {error && !busy ? (
              <Button type="button" variant="ghost" className="sm:mr-auto" onClick={fromAddress}>
                Use the address only
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                abort.current?.abort()
                close()
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!url.trim() || busy}>
              <Sparkles className="size-3.5" strokeWidth={2} aria-hidden />
              {busy ? 'Reading…' : error ? 'Try again' : 'Read and prefill'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
