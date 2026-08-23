import { useState } from 'react'
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

/** Which browser, and what its extensions page is called. */
function detect(): { family: Family; name: string; scheme: string } {
  const ua = navigator.userAgent
  if (ua.includes('Firefox/')) return { family: 'firefox', name: 'Firefox', scheme: 'about:addons' }
  // Order matters: Edge, Brave and Opera all carry 'Chrome' in the UA.
  if (ua.includes('Edg/')) return { family: 'chromium', name: 'Edge', scheme: 'edge://extensions' }
  if (ua.includes('OPR/'))
    return { family: 'chromium', name: 'Opera', scheme: 'opera://extensions' }
  if (ua.includes('Chrome/'))
    return { family: 'chromium', name: 'your browser', scheme: 'chrome://extensions' }
  if (ua.includes('Safari/')) return { family: 'safari', name: 'Safari', scheme: '' }
  return { family: 'chromium', name: 'your browser', scheme: 'chrome://extensions' }
}

export function CaptureExtensionPanel() {
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
    <Panel>
      <PanelTitle>Keeping postings</PanelTitle>

      <p className="mb-4 max-w-prose text-sm text-text-2">
        A job posting is the one document in your search that belongs to somebody else. The listing
        comes down the week after the interview and takes the requirements with it. The jojo
        extension saves a copy — the page as it read the day you filed it, with every image and
        stylesheet folded in, so opening it a year later reaches nothing and needs no connection.
      </p>

      {/* Three states, and they are genuinely different: still asking, present,
          absent. A panel that renders "not installed" while it is still asking
          tells half its readers something false for a second and a half. */}
      {installed === null ? (
        <div className="flex items-center gap-2 rounded-md border border-hairline bg-well px-3 py-2.5 text-sm text-text-3">
          <Loader2 className="size-4 animate-spin" strokeWidth={1.9} aria-hidden />
          Checking this browser…
        </div>
      ) : installed ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-success-border bg-success-soft px-3 py-2.5 text-sm"
          role="status"
        >
          <Check className="size-4 shrink-0 text-success" strokeWidth={2.2} aria-hidden />
          <span className="text-text-1">Installed and connected.</span>
          <span className="text-text-3">
            Open a posting, click the jojo button, then come back to the Vault.
            {version !== null ? ` Version ${version}.` : ''}
          </span>
        </div>
      ) : browser.family === 'safari' ? (
        <div className="rounded-md border border-hairline bg-well px-3 py-2.5 text-sm text-text-2">
          <p className="mb-1 font-medium text-text-1">Safari cannot run this extension.</p>
          {/* Said plainly rather than left as a broken download. Safari
              extensions have to ship inside a signed Mac app — there is no
              standalone package format — so this is not a step jojo can shorten. */}
          <p>
            Safari only loads extensions that ship inside a signed Mac app, so there is nothing to
            install here. Use Chrome, Edge, Brave or Firefox for capturing; everything else in jojo
            works the same in Safari.
          </p>
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
  browser: { family: Family; name: string; scheme: string }
  copied: boolean
  onCopy: () => void
}) {
  const firefox = browser.family === 'firefox'

  return (
    <div className="space-y-4">
      <Button asChild>
        {/* A plain download. There is no API that could make this an install —
            see the header — so the button says what it does. */}
        <a href="/jojo-extension.zip" download>
          <Download className="size-3.5" strokeWidth={2} aria-hidden />
          Download the extension
        </a>
      </Button>

      {firefox ? (
        <div className="rounded-md border border-info-border bg-info-soft px-3 py-2.5 text-sm text-text-2">
          <p className="mb-1 font-medium text-text-1">Firefox needs a signed copy.</p>
          <p>
            Firefox is the one browser where this could be a single click — a Mozilla-signed add-on
            can be installed straight from a link here, with no store listing. jojo does not produce
            a signed build yet, so for now load it temporarily from{' '}
            <code className="rounded-sm bg-panel px-1 py-0.5 font-mono text-xs">
              about:debugging
            </code>{' '}
            → This Firefox → Load Temporary Add-on, and pick{' '}
            <code className="rounded-sm bg-panel px-1 py-0.5 font-mono text-xs">manifest.json</code>
            . Firefox forgets it when it restarts.
          </p>
        </div>
      ) : (
        <ol className="space-y-3 text-sm text-text-2">
          <Step n={1}>
            Unzip it somewhere permanent — not Downloads.{' '}
            <span className="text-text-3">
              The browser reads the extension from that folder every time it starts, so deleting or
              moving it uninstalls the extension.
            </span>
          </Step>

          <Step n={2}>
            Open the extensions page.{' '}
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
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <span className="text-xs text-text-3">Paste it into the address bar.</span>
            </span>
          </Step>

          <Step n={3}>
            Turn on <strong className="font-medium text-text-1">Developer mode</strong>, top right.{' '}
            <span className="text-text-3">
              Leave it on — turning it off disables extensions loaded this way, without saying so.
            </span>
          </Step>

          <Step n={4}>
            Click <strong className="font-medium text-text-1">Load unpacked</strong> and choose the
            folder you unzipped.
          </Step>

          <Step n={5}>
            Come back here.{' '}
            <span className="text-text-3">This panel notices on its own and turns green.</span>
          </Step>
        </ol>
      )}

      <p className="max-w-prose text-xs text-text-3">
        There is no one-click install for {browser.name}, and that is a browser decision rather than
        a missing feature here: the API that allowed it was removed in 2018, and a signed package
        would still have to come from the Chrome Web Store. Nothing about this extension talks to a
        server — it reads the page you are looking at and hands the result to this tab.
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
