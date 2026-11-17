import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { publicUrl } from '@/lib/public-url'
import { Check, Copy, Download, Loader2 } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { useCaptureInbox } from '@/lib/capture-bridge'
import { cn } from '@/lib/utils'

/**
 * Getting the capture extension onto this browser.
 *
 * ## Why there is no install button
 *
 * There cannot be one, on any Chromium browser. `chrome.webstore.install()` —
 * the API that let a page install an extension — was disabled in September 2018
 * and removed in Chrome 71, and nothing replaced it; Google's own migration
 * guidance is "navigate to your Web Store listing" and that is still the whole
 * answer. A self-signed `.crx` is not a way around it either: Chromium's
 * `VerifyCrx3` looks for a publisher proof signed with Google's key regardless
 * of how the file arrived, so a downloaded `.crx` fails with
 * `CRX_REQUIRED_PROOF_MISSING` on Windows, macOS and Linux alike, dragged onto
 * `chrome://extensions` included.
 *
 * So Developer mode → Load unpacked is the floor, and the honest thing is to
 * make those steps short, correct for the browser in front of the user, and
 * self-verifying — rather than to dress six steps up as one click, which costs
 * more trust than the six steps cost patience.
 *
 * Firefox is the real exception and is called out as such: a Mozilla-signed
 * add-on can be self-hosted and installed from a link in two clicks, with no
 * store listing. That needs a signing step jojo does not have yet, so the panel
 * says so rather than implying the zip will work there.
 *
 * ## The one piece of real magic
 *
 * The last step verifies itself. `bridge.js` announces on every jojo page it is
 * injected into, so the moment the extension is loaded this panel flips to
 * "Installed" without the user telling it anything. That is what
 * `useCaptureInbox().installed` is for, and it re-probes on a timer and on tab
 * focus — because during an install this tab is in the background and a single
 * probe at mount would have decided "no" before the extension existed.
 */

type Family = 'chromium' | 'firefox' | 'safari'

/**
 * Which browser, and what its extensions page is called. `name` is null where
 * the browser is not named, and the panel says "your browser" in the reader's
 * language instead.
 */
function detect(): { family: Family; name: string | null; scheme: string } {
  const ua = navigator.userAgent
  if (ua.includes('Firefox/')) return { family: 'firefox', name: 'Firefox', scheme: 'about:addons' }
  // Order matters: Edge, Brave and Opera all carry 'Chrome' in the UA.
  if (ua.includes('Edg/')) return { family: 'chromium', name: 'Edge', scheme: 'edge://extensions' }
  if (ua.includes('OPR/'))
    return { family: 'chromium', name: 'Opera', scheme: 'opera://extensions' }
  if (ua.includes('Chrome/'))
    return { family: 'chromium', name: null, scheme: 'chrome://extensions' }
  if (ua.includes('Safari/')) return { family: 'safari', name: 'Safari', scheme: '' }
  return { family: 'chromium', name: null, scheme: 'chrome://extensions' }
}

export function CaptureExtensionPanel() {
  const { t } = useTranslation('settings')
  const { installed, version } = useCaptureInbox()
  const [copied, setCopied] = useState(false)
  const browser = detect()

  const copyScheme = () => {
    void navigator.clipboard.writeText(browser.scheme).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      },
      () => setCopied(false),
    )
  }

  return (
    <Panel focusId="capture">
      <PanelTitle>{t('capture.title')}</PanelTitle>

      {/* Full width, matching the numbered steps below it. `max-w-prose` capped
          this at about sixty characters inside a card twice that wide, so the
          right half of the card was empty above a list that already spanned it —
          the paragraph read as a mistake rather than as a measure. */}
      <p className="mb-4 text-sm text-text-2">{t('capture.intro')}</p>

      {/* Three states, and they are genuinely different: still asking, present,
          absent. A panel that renders "not installed" while it is still asking
          tells half its readers something false for a second and a half. */}
      {installed === null ? (
        <div className="flex items-center gap-2 rounded-md border border-hairline bg-well px-3 py-2.5 text-sm text-text-3">
          <Loader2 className="size-4 animate-spin" strokeWidth={1.9} aria-hidden />
          {t('capture.checking')}
        </div>
      ) : installed ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-success-border bg-success-soft px-3 py-2.5 text-sm"
          role="status"
        >
          <Check className="size-4 shrink-0 text-success" strokeWidth={2.2} aria-hidden />
          <span className="text-text-1">{t('capture.installed')}</span>
          <span className="text-text-3">
            {t('capture.installedHint')}
            {version !== null ? ` ${t('capture.version', { version })}` : ''}
          </span>
        </div>
      ) : browser.family === 'safari' ? (
        <div className="rounded-md border border-hairline bg-well px-3 py-2.5 text-sm text-text-2">
          <p className="mb-1 font-medium text-text-1">{t('capture.safari.title')}</p>
          {/* Said plainly rather than left as a broken download. Safari
              extensions have to ship inside a signed Mac app — there is no
              standalone package format — so this is not a step jojo can shorten. */}
          <p>{t('capture.safari.body')}</p>
        </div>
      ) : (
        <Install browser={browser} copied={copied} onCopy={copyScheme} />
      )}
    </Panel>
  )
}

function Install({
  browser,
  copied,
  onCopy,
}: {
  browser: { family: Family; name: string | null; scheme: string }
  copied: boolean
  onCopy: () => void
}) {
  const { t } = useTranslation('settings')
  const firefox = browser.family === 'firefox'
  /** The inline marks the steps use, named in the catalog strings. */
  const marks: Record<string, ReactElement> = {
    strong: <strong className="font-medium text-text-1" />,
    muted: <span className="text-text-3" />,
    code: <code className="rounded-sm bg-panel px-1 py-0.5 font-mono text-xs" />,
  }

  return (
    <div className="space-y-4" data-focus-id="capture-install">
      <Button asChild>
        {/* A plain download. There is no API that could make this an install —
            see the header — so the button says what it does.

            The file is built by `web/scripts/pack-extension.mjs`, which both
            `npm run dev` and `npm run build` run first. That matters: Vite's SPA
            fallback answers a missing path with `index.html`, so without the
            pack step this button would hand the user an HTML page named
            `.zip` — a download that fails at the unzip, three steps after the
            mistake. */}
        <a href={publicUrl('jojo-extension.zip')} download="jojo-extension.zip">
          <Download className="size-3.5" strokeWidth={2} aria-hidden />
          {t('capture.download')}
        </a>
      </Button>

      {firefox ? (
        <div className="rounded-md border border-info-border bg-info-soft px-3 py-2.5 text-sm text-text-2">
          <p className="mb-1 font-medium text-text-1">{t('capture.firefox.title')}</p>
          <p>
            <Trans t={t} i18nKey="capture.firefox.body" components={marks} />
          </p>
        </div>
      ) : (
        <ol className="space-y-3 text-sm text-text-2">
          <Step n={1}>
            <Trans t={t} i18nKey="capture.steps.unzip" components={marks} />
          </Step>

          <Step n={2}>
            {t('capture.steps.open')}{' '}
            {/* Deliberately NOT a link: a web page is
                not allowed to navigate to a chrome:// URL, so an anchor here
                would do nothing and read as jojo's bug. */}
            <span className="mt-1.5 flex flex-wrap items-center gap-2">
              <code className="rounded-md border border-hairline bg-well px-2 py-1 font-mono text-xs text-text-1">
                {browser.scheme}
              </code>
              <Button variant="outline" size="sm" onClick={onCopy}>
                {copied ? (
                  <Check className="size-3.5" strokeWidth={2.2} aria-hidden />
                ) : (
                  <Copy className="size-3.5" strokeWidth={2} aria-hidden />
                )}
                {copied ? t('capture.steps.copied') : t('capture.steps.copy')}
              </Button>
              <span className="text-xs text-text-3">{t('capture.steps.paste')}</span>
            </span>
          </Step>

          <Step n={3}>
            <Trans t={t} i18nKey="capture.steps.developer" components={marks} />
          </Step>

          <Step n={4}>
            <Trans t={t} i18nKey="capture.steps.load" components={marks} />
          </Step>

          <Step n={5}>
            <Trans t={t} i18nKey="capture.steps.pin" components={marks} />
          </Step>

          <Step n={6}>
            <Trans t={t} i18nKey="capture.steps.back" components={marks} />
          </Step>
        </ol>
      )}

      {/* Spans too, for the same reason the paragraph above it does: one card
          with two different measures reads as two cards that failed to align. */}
      <p className="text-xs text-text-3">
        {t('capture.noOneClick', { browser: browser.name ?? t('capture.yourBrowser') })}
      </p>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-full',
          'bg-accent-soft font-mono text-xs text-text-1',
        )}
      >
        {n}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  )
}
