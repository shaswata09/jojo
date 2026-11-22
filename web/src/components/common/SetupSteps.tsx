import { BookOpenText, Bug, Puzzle, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
import { DocumentReaderPanel } from '@/components/settings/DocumentReaderPanel'
import { LocalModelPanel } from '@/components/settings/LocalModelPanel'
import { isConfigured } from '@/lib/llm'
import { syncExtensionCrashReporting, useCaptureInbox } from '@/lib/capture-bridge'
import { CRASH_CAPABILITY, crashEnabled, setCrashEnabled } from '@/lib/crash-log'
import { ANALYTICS_CAPABILITY, analyticsEnabled, setAnalyticsEnabled } from '@/lib/analytics'
import { SettingRow } from '@/components/common/Field'
import { usageSwitchStart } from '@/components/common/consent-start'
import { wasOffered } from '@/lib/onboarding'
import { CRASH_DEFAULTS } from '@jojo/service/core/crash-config'
import { PRIVACY_PAGE } from '@jojo/service/core/privacy'
import { publicUrl } from '@/lib/public-url'
import { Switch } from '@/components/ui/switch'
import { useModelSettings } from '@/lib/model-settings-context'
import { contentModal } from '@/components/ui/dialog-width'

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
  const { t } = useTranslation()
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Escape and the backdrop mean "not now", the same as Skip. Recorded
        // either way, because what is remembered is that we asked.
        if (!next) onSkip()
      }}
    >
      <DialogContent className={contentModal}>
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
            {t('setup.skip')}
          </Button>
          {/* One button that changes its word rather than two that appear and
              disappear: the panel below reports its own success with a chip, and
              a second success signal in the footer would be saying it twice. */}
          <Button type="button" onClick={onDone}>
            {done ? doneLabel : t('setup.continue')}
          </Button>
        </DialogFooter>

        <p className="text-xs text-text-3">{t('setup.optional')}</p>
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
  const { t } = useTranslation()
  const { settings } = useModelSettings()
  return (
    <Step
      icon={<Sparkles className="size-4 text-accent" strokeWidth={1.8} aria-hidden />}
      title={t('setup.model.title')}
      done={isConfigured(settings)}
      doneLabel={t('setup.done')}
      onSkip={onSkip}
      onDone={onDone}
      body={<LocalModelPanel bare />}
    >
      {t('setup.model.body')}
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
  const { t } = useTranslation()
  const { reader } = useModelSettings()
  return (
    <Step
      icon={<BookOpenText className="size-4 text-accent" strokeWidth={1.8} aria-hidden />}
      title={t('setup.reader.title')}
      done={reader.length > 0}
      doneLabel={t('setup.done')}
      onSkip={onSkip}
      onDone={onDone}
      body={<DocumentReaderPanel bare />}
    >
      {t('setup.reader.body')}
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
 * A REAL QUESTION, WITH A REAL NO. Both buttons say what they do — "Turn both
 * off" and "Save choices" — and carry the same weight, because a dialog whose
 * dismissal is the answer to a yes/no question is a dialog that collected a
 * shrug and recorded consent. Skipping and declining are the same thing here,
 * and both mean no; the switches start off, so doing nothing is also no.
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
  /*
   * BOTH START OFF, because the shipped default is off — and the switches still
   * match the default rather than being hardcoded, for the reason they always
   * did: a dialog whose controls disagree with what the app is doing tells
   * somebody they have opted out when they have not, or in.
   *
   * This said "both start on" until the owner reversed the default on
   * 2026-11-21. A switch that is already on when somebody first sees it is a
   * pre-ticked box, and a pre-ticked box is not consent (CJEU, Planet49) — the
   * person has to DO something to say yes. `core/crash-config.ts` holds the
   * reasoning; this is where it shows.
   *
   * Read from the live setting rather than hardcoded `false`, so somebody who
   * reaches this step a second time — a reset, a second browser — sees what
   * they actually answered. A stored yes still draws the switch on.
   */
  const { t } = useTranslation()
  const [crashes, setCrashes] = useState(crashEnabled)
  // Not `analyticsEnabled` alone: it reads false until this very question has
  // been answered, whatever the default. With the default off the two agree,
  // and the helper keeps them agreeing if the default ever moves again.
  const [usage, setUsage] = useState(() =>
    usageSwitchStart(analyticsEnabled(), wasOffered('crash'), CRASH_DEFAULTS.enabled),
  )

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
      <DialogContent className={contentModal}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="size-4 text-accent" strokeWidth={1.8} aria-hidden />
            {t('setup.crash.title')}
          </DialogTitle>
          <DialogDescription>{t('setup.crash.description')}</DialogDescription>
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
          <p className="text-xs font-medium text-text-1">{t('setup.crash.inReport')}</p>
          <ul className="mt-1.5 space-y-1 text-xs text-text-2">
            <li>· {t('setup.crash.inError')}</li>
            <li>· {t('setup.crash.inStack')}</li>
          </ul>
          <p className="mt-2.5 text-xs font-medium text-text-1">{t('setup.crash.never')}</p>
          <ul className="mt-1.5 space-y-1 text-xs text-text-2">
            <li>· {t('setup.crash.neverRecords')}</li>
            <li>· {t('setup.crash.neverSecrets')}</li>
          </ul>
        </div>

        <p className="text-sm text-text-2">
          <Trans
            t={t}
            i18nKey="setup.crash.where"
            components={{ em: <span className="text-text-1" /> }}
          />
        </p>

        <div className="space-y-1">
          {CRASH_CAPABILITY === 'off' ? null : (
            <SettingRow
              label={t('setup.crash.keep')}
              description={t('setup.crash.keepHint')}
              control={
                <Switch
                  checked={crashes}
                  onCheckedChange={setCrashes}
                  aria-label={t('setup.crash.keep')}
                />
              }
            />
          )}
          {ANALYTICS_CAPABILITY === 'off' ? null : (
            <SettingRow
              label={t('setup.crash.share')}
              description={t('setup.crash.shareHint')}
              control={
                <Switch
                  checked={usage}
                  onCheckedChange={setUsage}
                  aria-label={t('setup.crash.share')}
                />
              }
            />
          )}
        </div>

        {ANALYTICS_CAPABILITY === 'off' ? null : (
          <p className="text-sm text-text-2">{t('setup.crash.usageNote')}</p>
        )}

        {/*
         * EQUAL WEIGHT, on purpose. The refusal used to be a ghost button and
         * the save a filled one — the shape consent guidance warns against as
         * nudging (the EDPB's on deceptive design, for one): saying no must be
         * as easy and as visible as saying yes. Both are outline buttons now, and the save
         * keeps one label whatever the switches say — a label that changed to
         * "Continue with both off" made the primary button read as the way past
         * the dialog rather than as one of two answers.
         */}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              choose(false, false)
            }}
          >
            {t('setup.crash.bothOff')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              choose(crashes, usage)
            }}
          >
            {t('setup.crash.save')}
          </Button>
        </DialogFooter>

        <p className="text-xs text-text-3">
          {t('setup.crash.later')}{' '}
          <a
            href={publicUrl(PRIVACY_PAGE)}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline decoration-1 underline-offset-4"
          >
            {t('setup.crash.privacy')}
          </a>
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
  const { t } = useTranslation()
  const { installed } = useCaptureInbox()
  return (
    <Step
      icon={<Puzzle className="size-4 text-accent" strokeWidth={1.8} aria-hidden />}
      title={t('setup.extension.title')}
      done={installed === true}
      doneLabel={t('setup.done')}
      onSkip={onSkip}
      onDone={onDone}
      body={<CaptureExtensionPanel />}
    >
      {t('setup.extension.body')}
    </Step>
  )
}
