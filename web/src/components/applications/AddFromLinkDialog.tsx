import { useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Check, Link as LinkIcon, Loader2, Sparkles } from 'lucide-react'
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
import { vaultPath } from '@/lib/links'
import { cn } from '@/lib/utils'

/**
 * Paste a posting URL and let the model fill the form in.
 *
 * The plain `AddByUrl` beside it reads the URL and nothing else — employer from
 * the hostname, role from the last path segment — which is free, instant and
 * cannot see a deadline. This one fetches the page through the document reader
 * and asks the model what is in it, which is slower, needs two services running
 * and can see everything the URL cannot.
 *
 * Both end in the same place: the ordinary create form, prefilled, waiting to
 * be checked. Nothing here writes an application. What it DOES write is the
 * page — a posting is worth keeping whether or not it becomes an application,
 * and the Vault has a drawer for exactly that.
 *
 * THE STEPS ARE ON SCREEN because they take real seconds and fail differently.
 * A spinner that sat for fifteen seconds and then said "could not add" would
 * leave the user with no idea which of three services to go and look at.
 */

const STEPS: { id: PostingStep; label: string }[] = [
  { id: 'reading', label: 'Fetching the page' },
  { id: 'asking', label: 'Reading it' },
  { id: 'saving', label: 'Saving the posting' },
]

export function AddFromLinkDialog({ open }: { open: boolean }) {
  const id = useId()
  const { open: openDialog, close } = useDialogs()
  const { settings, reader } = useModelSettings()
  const readPosting = useReadPosting()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [url, setUrl] = useState('')
  const [step, setStep] = useState<PostingStep | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  const busy = step !== null

  const submit = async () => {
    const text = url.trim()
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
    openDialog('application', { mode: 'create', initial: outcome.draft })

    const gaps = outcome.missing.length
    toast({
      title: 'Posting saved and read',
      description:
        gaps === 0
          ? `${outcome.file.name} is in the Vault. Check the form before saving it.`
          : `${outcome.file.name} is in the Vault. ${String(gaps)} field${gaps === 1 ? '' : 's'} were not on the page — check the form before saving it.`,
      action: {
        label: 'See it in the Vault',
        onClick: () => navigate(vaultPath({ tool: 'files' })),
      },
    })
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New application from a link</DialogTitle>
          <DialogDescription>
            The model reads the posting and fills the form in. The page is kept in the Vault under
            Job postings, and nothing is saved as an application until you say so.
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
              {busy ? 'Reading…' : 'Read and prefill'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
