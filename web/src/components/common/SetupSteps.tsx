import { BookOpenText, Puzzle, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CaptureExtensionPanel } from '@/components/settings/CaptureExtensionPanel'
import { DocumentReaderPanel, LocalModelPanel } from '@/components/settings/ConnectionsSection'
import { isConfigured } from '@/lib/llm'
import { useCaptureInbox } from '@/lib/capture-bridge'
import { useModelSettings } from '@/lib/model-settings-context'

/**
 * The three setup offers on a first run: a model, a document reader, an extension.
 *
 * These are what turn jojo from a tracker into something that can work on the
 * search — and every one of them is genuinely optional, which is the constraint
 * that shapes all of it. The app is honest with none of them configured, so
 * none of these may trap anybody: each is its own dismissable dialog with its
 * own Skip, and skipping one says nothing about the next.
 *
 * NOT A WIZARD, deliberately, and `Onboarding`'s header argues the general case:
 * a wizard has one dismissal policy for all its steps, so putting these in one
 * would mean either trapping someone on a setup they are allowed to skip, or
 * letting a single Escape silently decline all three. There is no progress bar
 * and no back button for the same reason — a step you can leave is not a step
 * in a sequence, it is an offer.
 *
 * THE PANELS ARE THE SETTINGS PANELS. Each step hosts the same component the
 * Settings page does, in `bare` mode so it is not a card inside a card. A first
 * run that asked for the endpoint in its own words would be a second copy of
 * every field, every validation and every failure sentence to keep in step —
 * and the one that drifts is always the one people see once.
 */

/** One offer: an icon, a reason, the real panel, and a way past it. */
function Step({
  icon,
  title,
  children,
  body,
  done,
  doneLabel,
  onSkip,
  onDone,
}: {
  icon: ReactNode
  title: string
  /** Why this is worth doing, in the user's terms rather than the system's. */
  children: ReactNode
  body: ReactNode
  /** True once the thing is actually set up — the button changes, not the step. */
  done: boolean
  doneLabel: string
  onSkip: () => void
  onDone: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Escape and the backdrop mean "not now", the same as Skip. Recorded
        // either way, because what is remembered is that we asked.
        if (!next) onSkip()
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {icon}
            {title}
          </DialogTitle>
          <DialogDescription>{children}</DialogDescription>
        </DialogHeader>

        {body}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
          {/* One button that changes its word rather than two that appear and
              disappear: the panel below reports its own success with a chip, and
              a second success signal in the footer would be saying it twice. */}
          <Button type="button" onClick={onDone}>
            {done ? doneLabel : 'Continue'}
          </Button>
        </DialogFooter>

        <p className="text-xs text-text-3">
          Every one of these is optional and you can set it up later under Settings.
        </p>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Connect a model.
 *
 * First of the three because the one after it depends on it, and because it is
 * the one that changes what the app IS: without it the assistant is a scripted
 * demo and both pipelines sit paused.
 */
export function ConnectModelStep({ onSkip, onDone }: { onSkip: () => void; onDone: () => void }) {
  const { settings } = useModelSettings()
  return (
    <Step
      icon={<Sparkles className="size-4 text-accent" strokeWidth={1.8} aria-hidden />}
      title="Connect a model"
      done={isConfigured(settings)}
      doneLabel="Done"
      onSkip={onSkip}
      onDone={onDone}
      body={<LocalModelPanel bare />}
    >
      This is what makes jojo agentic rather than a filing cabinet: it can then answer questions about
      your search, write follow-ups and drafts, and run the Job Scout pipelines that keep your records
      complete and watch for postings. Point it at a model on your own machine and nothing leaves the
      device.
    </Step>
  )
}

/**
 * Point at MarkItDown.
 *
 * Only ever offered when a model is connected, because on its own it does
 * nothing a person can see — it is what the AGENT reads documents through. Its
 * own copy says the same in one line, and `Onboarding` enforces the ordering.
 */
export function DocumentReaderStep({ onSkip, onDone }: { onSkip: () => void; onDone: () => void }) {
  const { reader } = useModelSettings()
  return (
    <Step
      icon={<BookOpenText className="size-4 text-accent" strokeWidth={1.8} aria-hidden />}
      title="Let it read your documents"
      done={reader.length > 0}
      doneLabel="Done"
      onSkip={onSkip}
      onDone={onDone}
      body={<DocumentReaderPanel bare />}
    >
      Without this the assistant can see a document’s name and nothing else. Run MarkItDown on this
      machine — two commands, below — and it can read what is inside your CVs, cover letters and saved
      postings when it drafts and answers.
    </Step>
  )
}

/**
 * Install the capture extension.
 *
 * Offered whether or not a model is connected, because it is not an agent
 * feature: it keeps a posting exactly as it read on the day, which is worth
 * having on its own when the advert is taken down. It also happens to be what
 * lets the scout read a job board, which is why it is offered last rather than
 * left out.
 */
export function ExtensionStep({ onSkip, onDone }: { onSkip: () => void; onDone: () => void }) {
  const { installed } = useCaptureInbox()
  return (
    <Step
      icon={<Puzzle className="size-4 text-accent" strokeWidth={1.8} aria-hidden />}
      title="Keep the postings you apply to"
      done={installed === true}
      doneLabel="Done"
      onSkip={onSkip}
      onDone={onDone}
      body={<CaptureExtensionPanel />}
    >
      Job adverts come down, often before you hear back. The browser extension saves a posting as it
      reads today, into your own vault — and it is also how the Job Scout reads the boards you follow.
    </Step>
  )
}
