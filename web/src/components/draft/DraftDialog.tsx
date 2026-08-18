import { useEffect, useMemo, useRef, useState } from 'react'
import { Mail, PenLine, Send, Sparkles } from 'lucide-react'
import { CopyFeedback } from '@/components/common/CopyFeedback'
import { EmptyState } from '@/components/common/EmptyState'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { applyFills, blanksIn, fillsFor } from '@/components/draft/template'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { displayName } from '@/data/seed'
import type { Snippet } from '@/data/vault'
import { useApplications } from '@jojo/service/react/use-applications'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useVault } from '@jojo/service/react/use-vault'
import { useToast } from '@/lib/toast-context'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'

/** How long the copied confirmation stays up — the same beat as SnippetsTool. */
const COPIED_MS = 1600

/** The quiet line under a control — the same weight the form hints use. */
const HINT = 'text-xs text-text-3'

/* -------------------------------- text ----------------------------------- */

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Plain-text body to something the editor can hold.
 *
 * Escaped on the way in, unlike the snippets tool's version: a body containing
 * "R&D" or "<200ms" is text, and handed to `innerHTML` raw the first would
 * decode to something else and the second would disappear into a phantom tag.
 */
const textToHtml = (text: string) =>
  text
    .split('\n')
    .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
    .join('')

const BLOCK_END = /<\/(p|div|li|h[1-6]|tr)>/gi

/**
 * Back to plain text, which is what a mail client wants pasted into it.
 *
 * `innerText` would do this in one line and is the usual advice, but it is
 * defined in terms of rendered layout and returns the un-broken `textContent`
 * for an element that was never attached to the document. The block tags are
 * therefore turned into newlines by hand before the browser decodes entities.
 */
function htmlToText(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n').replace(BLOCK_END, '\n')
  const holder = document.createElement('div')
  holder.innerHTML = withBreaks
  return (
    (holder.textContent ?? '')
      // `contenteditable` pads empty runs with non-breaking spaces. They look
      // identical to a space here and paste into a mail client as a character
      // that is not one, so they are flattened on the way out.
      .replace(/\u00a0/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/* -------------------------------- dialog --------------------------------- */

export type DraftDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The reminder this message answers — its date and application seed the draft. */
  itemId?: string
  /** Stands in when there is no reminder, or overrides the one the item carries. */
  applicationId?: string
}

/**
 * Write the email, with no model connected.
 *
 * Every "Draft…" button in the app pointed at an assistant that needs a local
 * server nobody has started, so all of them shipped disabled. This is the
 * honest version of the same journey: the user's own saved snippets are the
 * templates, the application and the reminder fill in what they genuinely know,
 * and everything they do not know stays on the page as a blank to be typed
 * over. Nothing is generated and nothing is sent — the draft leaves through the
 * clipboard, and "Mark sent" only ticks the reminder off.
 */
export function DraftDialog({ open, onOpenChange, itemId, applicationId }: DraftDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl">
        {/* The body is a child so it mounts with the dialog: the chosen snippet
            and the substituted text are seeded once, and a fresh open starts
            from the props rather than from a half-edited draft. */}
        <DraftBody itemId={itemId} applicationId={applicationId} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  )
}

function DraftBody({
  itemId,
  applicationId,
  onOpenChange,
}: Pick<DraftDialogProps, 'itemId' | 'applicationId' | 'onOpenChange'>) {
  const { get, update } = useTimeline()
  const { byId } = useApplications()
  const { snippets, addSnippet } = useVault()
  const { toast } = useToast()

  const item = itemId ? get(itemId) : undefined
  // The caller's application wins over the item's, so a Draft button that knows
  // which record it sits on is not overruled by a reminder filed elsewhere.
  const appId = applicationId ?? item?.applicationId
  const app = appId ? byId.get(appId) : undefined

  const emailSnippets = useMemo(() => snippets.filter((s) => s.tag === 'Email'), [snippets])
  const fills = useMemo(() => fillsFor(app, item), [app, item])

  const [chosenId, setChosenId] = useState<string | null>(null)
  const [html, setHtml] = useState('')
  /** Edited since the last template load — see `load` for what it protects. */
  const [dirty, setDirty] = useState(false)
  /** Pressed "start from a blank draft" with no snippets to start from. */
  const [started, setStarted] = useState(false)

  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  // Memoised because it runs a round trip through a detached DOM node, and it
  // would otherwise do that on every keystroke the editor reports.
  const text = useMemo(() => htmlToText(html), [html])
  const blanks = useMemo(() => blanksIn(text), [text])
  const empty = text.length === 0

  /**
   * Loads a template, substituting what the records know.
   *
   * Swapping templates over work in progress is the one destructive thing here,
   * and the draft is not stored anywhere it could be recovered from — so it
   * goes on an undo toast rather than a confirmation. A second dialog is not an
   * option: the host mounts exactly one at a time, by design.
   */
  const load = (snippet?: Snippet) => {
    const previous = { html, chosenId }
    setChosenId(snippet?.id ?? null)
    setHtml(snippet ? textToHtml(applyFills(snippet.body, fills)) : '')
    setDirty(false)
    setStarted(true)

    if (!dirty || empty) return
    toast({
      title: 'Draft replaced',
      description: snippet ? `Loaded ${snippet.title}.` : 'Started again from blank.',
      action: {
        label: 'Undo',
        onClick: () => {
          setHtml(previous.html)
          setChosenId(previous.chosenId)
          setDirty(true)
        },
      },
    })
  }

  const copy = async () => {
    clearTimeout(timer.current)
    try {
      // Unavailable outside a secure context, and some browsers refuse without
      // a permission — hence the catch and the visible failure state, rather
      // than a confirmation for something that did not happen.
      await navigator.clipboard.writeText(text)
      setFailed(false)
    } catch {
      setFailed(true)
    }
    setCopied(true)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
  }

  const saveAsSnippet = () => {
    // Named after the template it came from and the employer it was aimed at,
    // because a vault full of "Draft" is a vault you cannot search.
    const base = emailSnippets.find((s) => s.id === chosenId)?.title ?? 'Draft email'
    const title = app ? `${base} — ${app.org}` : base
    const saved = addSnippet({ title, tag: 'Email', body: text, applicationId: app?.id })
    toast({
      title: 'Saved to snippets',
      description: `${saved.title} · tagged Email, in the Vault`,
    })
  }

  const markSent = () => {
    if (!item) return
    const before = item.completedOn ?? null
    update(item.id, { completedOn: TODAY })
    onOpenChange(false)
    toast({
      // Nothing was sent from here, and the copy says only what happened: the
      // reminder is ticked off, the same as ticking its box in the list.
      title: 'Marked as sent',
      description: `${item.title} — ticked off in reminders`,
      action: { label: 'Undo', onClick: () => update(item.id, { completedOn: before }) },
    })
  }

  const picker = (
    <div className="flex min-h-0 flex-col gap-2">
      <p className={cn(HINT, 'px-0.5')}>Start from one of your email snippets.</p>
      <Command className="min-h-0 rounded-lg border border-hairline bg-well">
        <CommandInput placeholder="Search snippets…" />
        <CommandList>
          <CommandEmpty>No snippet matches that.</CommandEmpty>
          <CommandGroup heading="Email snippets">
            {emailSnippets.map((s) => (
              <CommandItem
                key={s.id}
                value={s.title}
                data-checked={s.id === chosenId}
                onSelect={() => load(s)}
              >
                <Mail className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
                <span className="truncate">{s.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Start fresh">
            <CommandItem
              value="Blank draft"
              data-checked={chosenId === null && started}
              onSelect={() => load(undefined)}
            >
              <PenLine className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
              <span className="truncate">Blank draft</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  )

  const editor = (
    <div className="flex min-h-0 flex-col">
      <RichTextEditor
        value={html}
        onChange={(next) => {
          setHtml(next)
          setDirty(true)
        }}
        placeholder="Write the message, or pick a snippet to start from…"
        ariaLabel="Message draft"
        className="min-h-0 flex-1"
      />

      {/* Announced as it changes: the count is the only thing standing between a
          half-filled template and a sent email addressed to [NAME]. */}
      <p aria-live="polite" className={cn(HINT, 'mt-2')}>
        {empty
          ? 'Nothing drafted yet.'
          : blanks.count === 0
            ? 'No blanks left.'
            : `${blanks.count} ${blanks.count === 1 ? 'blank' : 'blanks'} left — ${blanks.names.join(', ')}`}
        {blanks.names.some((n) => n.includes('NAME') || n.includes('PERSON'))
          ? " · a person's name is never filled in for you"
          : ''}
      </p>

      {/* Announced rather than only shown: the confirmation lands on a button
          the user has just left, and a colour change alone is easy to miss. */}
      <p aria-live="polite" className="sr-only">
        {copied ? (failed ? 'Copy was blocked by the browser' : 'Draft copied to clipboard') : ''}
      </p>
    </div>
  )

  const nothingToStartFrom = emailSnippets.length === 0 && !started

  return (
    <>
      <DialogHeader>
        <DialogTitle>Draft a message</DialogTitle>
        <DialogDescription>
          {app ? (
            <>
              For {displayName(app)}
              {item ? ` · ${item.title}` : ''}.{' '}
            </>
          ) : (
            'Not linked to an application, so [ROLE] and [DATE] stay blank. '
          )}
          Nothing is generated and nothing is sent — fill the blanks, copy it into your mail client,
          then mark it sent.
        </DialogDescription>
      </DialogHeader>

      {nothingToStartFrom ? (
        <div className="min-h-0 overflow-y-auto">
          <EmptyState
            icon={Mail}
            title="No email snippets yet"
            description="Snippets tagged Email show up here as starting points. There is nothing to load, but the draft does not have to start from one."
            action={
              <Button size="sm" variant="outline" onClick={() => load(undefined)}>
                <PenLine className="size-3.5" strokeWidth={1.8} aria-hidden />
                Start from a blank draft
              </Button>
            }
          />
        </div>
      ) : (
        <div
          className={cn(
            'grid min-h-0 gap-4 overflow-y-auto px-0.5 py-0.5',
            emailSnippets.length > 0 && 'sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]',
          )}
        >
          {emailSnippets.length > 0 ? picker : null}
          {editor}
        </div>
      )}

      <DialogFooter className="sm:justify-between">
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            disabled={empty}
            title={empty ? 'Write something first' : 'Keep this draft in the Vault, tagged Email'}
            onClick={saveAsSnippet}
          >
            Save as snippet
          </Button>
          {/* The one thing here that a local model would actually change, and it
              is not connected. Named for the real blocker rather than swallowing
              the click — and it cannot navigate either: DialogHost is mounted
              outside the router, so no route link may be reached from here. */}
          <Button
            type="button"
            variant="ghost"
            disabled
            title="The assistant needs a connected model — see Settings"
          >
            <Sparkles className="size-3.5" strokeWidth={1.8} aria-hidden />
            Open in assistant
          </Button>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {/* Every other disabled control in this app names its blocker; this
              one was greying out silently beside two that do. */}
          <Button
            type="button"
            variant="outline"
            disabled={empty}
            title={empty ? 'Write something first' : 'Copy the message to the clipboard'}
            onClick={copy}
          >
            <CopyFeedback copied={copied} failed={failed} />
          </Button>
          <Button
            type="button"
            disabled={!item || Boolean(item.completedOn)}
            title={
              !item
                ? 'Open this from a reminder to tick it off here'
                : item.completedOn
                  ? 'That reminder is already ticked off'
                  : undefined
            }
            onClick={markSent}
          >
            <Send className="size-3.5" strokeWidth={1.8} aria-hidden />
            Mark sent
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
