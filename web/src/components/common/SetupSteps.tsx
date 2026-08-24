import { BookOpenText, Bug, Puzzle, Sparkles } from 'lucide-react'
import { useState } from 'react'
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
import { syncExtensionCrashReporting, useCaptureInbox } from '@/lib/capture-bridge'
import { CRASH_CAPABILITY, setCrashEnabled } from '@/lib/crash-log'
import { ANALYTICS_CAPABILITY, setAnalyticsEnabled } from '@/lib/analytics'
import { SettingRow } from '@/components/common/Field'
import { Switch } from '@/components/ui/switch'
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
 * Crash reports, asked last.
 *
 * LAST BECAUSE IT IS THE ONLY ONE THAT IS NOT ABOUT CAPABILITY. Every other step
 * offers to make jojo do something more; this one asks permission to keep
 * something, and asking that first would have set the tone of the whole setup as
 * a consent flow. It is also the only step whose answer means anything on its
 * own — a model, a reader and the extension are each useless without the thing
 * behind them, and this is a switch.
 *
 * A REAL QUESTION, WITH A REAL NO. Both buttons say what they do — "Keep them"
 * and "No thanks" — because a dialog whose dismissal is the answer to a
 * yes/no question is a dialog that collected a shrug and recorded consent.
 * Skipping and declining are the same thing here, and both mean no.
 *
 * ONE ANSWER, BOTH HALVES. It sets the browser's setting and pushes it to the
 * extension, which cannot read it — see `syncExtensionCrashReporting`. Asking
 * twice for one preference is how a person ends up with two switches that
 * disagree and no idea which is in force.
 */
export function CrashStep({ onSkip, onDone }: { onSkip: () => void; onDone: () => void }) {
  /*
   * TWO SWITCHES, NOT ONE, and they start off.
   *
   * Agreeing to "keep the error when it breaks" is not agreeing to "record what
   * I do", and a single control covering both would collect the second by
   * bundling it with the first. They are different in kind: a crash is rare and
   * exceptional, and usage is a continuous account of what somebody does in an
   * app about their job search.
   *
   * One dialog, because two consecutive consent dialogs is a wall somebody
   * clicks through, and clicking through is not consent either.
   */
  const [crashes, setCrashes] = useState(false)
  const [usage, setUsage] = useState(false)

  const choose = (crashesOn: boolean, usageOn: boolean) => {
    setCrashEnabled(crashesOn)
    setAnalyticsEnabled(usageOn)
    // The extension keeps its own reports and cannot see this setting, so it is
    // told. On a browser with no extension this is a no-op.
    void syncExtensionCrashReporting(crashesOn, !crashesOn)
    onDone()
  }

  /*
   * Nothing to ask about when the build allows neither, and asking anyway would
   * collect an answer that could never take effect.
   */
  if (CRASH_CAPABILITY === 'off' && ANALYTICS_CAPABILITY === 'off') return null

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Escape and the backdrop mean no, not "ask me later". Recording a yes
        // from a dismissal is the one thing a consent question must never do.
        if (!next) {
          setCrashEnabled(false)
          setAnalyticsEnabled(false)
          void syncExtensionCrashReporting(false, true)
          onSkip()
        }
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="size-4 text-accent" strokeWidth={1.8} aria-hidden />
            Crash reports and usage
          </DialogTitle>
          <DialogDescription>
            Two separate things, both off unless you turn them on. Neither can carry your records:
            not an application, a document, a note, a profile or a conversation.
          </DialogDescription>
        </DialogHeader>

        {/*
         * SPECIFIC RATHER THAN REASSURING, and the two are not the same thing.
         *
         * The easy copy here is "no personal data is collected", and it is the
         * one sentence this feature is not allowed to say. On the web it would
         * be true and unfalsifiable — nothing is sent, so there is nothing to
         * check — and on the phone it would be false: Firebase Crashlytics
         * sends a per-install identifier and a device profile, by design and by
         * Google's own documentation. A promise a reader cannot check is worth
         * less than a list they can, and this list is checkable: the reports are
         * shown to them on the next screen.
         */}
        <div className="rounded-md border border-hairline bg-well p-3">
          <p className="text-xs font-medium text-text-1">What is in a report</p>
          <ul className="mt-1.5 space-y-1 text-xs text-text-2">
            <li>· The error message and where in jojo it happened.</li>
            <li>· The stack trace, which names the code that failed.</li>
          </ul>
          <p className="mt-2.5 text-xs font-medium text-text-1">What is never in one</p>
          <ul className="mt-1.5 space-y-1 text-xs text-text-2">
            <li>· Your applications, documents, notes, profile or conversations.</li>
            <li>
              · Your API keys, the addresses you use, your home directory, or any email address —
              these are stripped out before a report is written, not before it is sent.
            </li>
          </ul>
        </div>

        <p className="text-sm text-text-2">
          In this browser and in the jojo extension, reports <span className="text-text-1">stay on
          this device</span>: nothing is uploaded, and a backup file does not carry them. You read
          them yourself under Settings. On the jojo phone app the same report is also sent to
          Google&apos;s Firebase Crashlytics, which adds your device model, its operating system
          version, and a random id it uses to count how many people hit the same crash — no name, no
          account, nothing tied to you.
        </p>

        <div className="space-y-1">
          {CRASH_CAPABILITY === 'off' ? null : (
            <SettingRow
              label="Keep crash reports"
              description="The error and where it happened. Stays on this device in the browser."
              control={
                <Switch
                  checked={crashes}
                  onCheckedChange={setCrashes}
                  aria-label="Keep crash reports"
                />
              }
            />
          )}
          {ANALYTICS_CAPABILITY === 'off' ? null : (
            <SettingRow
              label="Share which features I use"
              description="Counts only — which screens are opened, how often. Never what is in them."
              control={
                <Switch
                  checked={usage}
                  onCheckedChange={setUsage}
                  aria-label="Share which features I use"
                />
              }
            />
          )}
        </div>

        {ANALYTICS_CAPABILITY === 'off' ? null : (
          <p className="text-sm text-text-2">
            The second one is the only thing jojo sends about what you DO, and it can only ever say
            things from a fixed list — &ldquo;the vault was opened&rdquo;, &ldquo;an application was
            added&rdquo;, &ldquo;there are 6&ndash;20 of them&rdquo;. It cannot name an employer, a
            role, a file or anything you typed, because those words are not in the list. It goes to
            Google Analytics so we can see which parts of jojo are worth more work.
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              choose(false, false)
            }}
          >
            No to both
          </Button>
          <Button
            type="button"
            onClick={() => {
              choose(crashes, usage)
            }}
          >
            {crashes || usage ? 'Save choices' : 'Continue with both off'}
          </Button>
        </DialogFooter>

        <p className="text-xs text-text-3">
          Off unless you say otherwise. Nothing has been recorded up to this point.
        </p>
      </DialogContent>
    </Dialog>
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
