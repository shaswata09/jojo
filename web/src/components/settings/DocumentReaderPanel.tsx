import { useState } from 'react'
import { Chip } from '@/components/common/Chip'
import { Field } from '@/components/common/Field'
import { PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { needsExtension, testReader } from '@/lib/markitdown'
import { report } from '@/lib/analytics'
import { MARKITDOWN } from '@jojo/service/agent/markitdown'
import { CopyButton } from '@/components/common/CopyButton'
import { useModelSettings } from '@/lib/model-settings-context'
import { publicUrl } from '@/lib/public-url'
import { Shell } from '@/components/settings/PanelShell'

/**
 * Where MarkItDown is, if the user runs it.
 *
 * ATTRIBUTION IS PART OF THE CARD, not a footnote elsewhere. The MIT licence
 * asks that the notice travel with the software; the software here is not
 * shipped, it is something the person is being asked to install — so the credit,
 * the licence and the exact command belong at the moment they decide. The full
 * notice is in `THIRD-PARTY-NOTICES.md`.
 *
 * A second card rather than a field on the first, because they are different
 * programs: one answers questions and one opens documents, and a person may
 * well run one without the other.
 */
/**
 * The address a BROWSER can reach it at, which is not the one it listens on.
 *
 * Measured against markitdown-mcp 0.0.1a4: it sends no CORS headers and answers
 * the preflight with 405, so a page on one port cannot POST to it on another
 * however local both are. The dev server proxies `/reader` to `127.0.0.1:3001`
 * so this path is same-origin and works; a built copy of jojo needs whatever is
 * serving it to do the same. The phone app has no such rule and talks to
 * `MARKITDOWN.defaultEndpoint` directly.
 */
/*
 * Through `publicUrl`, and the bug it fixes is the one "Start the tour" had.
 *
 * This was the literal '/reader/mcp', which is a path from the DOMAIN root. A
 * copy served from a subpath — `example.com/jojo/`, which is what GitHub Pages
 * gives you — then POSTed to `example.com/reader/mcp`: not the app's own path,
 * not anything the app controls, a different site's root. Measured against a
 * built copy served at /jojo/: the request went to `/reader/mcp/` with the base
 * missing entirely.
 *
 * `import.meta.env.BASE_URL` is the runtime base, so this is right at `/` and
 * right under a subpath. It does not by itself make a hosted copy work — a
 * static host has nothing to forward the path WITH, which is what the failure
 * message now says — but it is the difference between "the forwarding is not
 * set up" and "the request never had a chance of arriving".
 */
const PROXY_PATH = publicUrl('reader/mcp')

/**
 * What to put in the box before anyone types, which is not one answer.
 *
 * On localhost the dev server proxies `/reader/mcp`, so the path is the simplest
 * thing that works and needs no extension. Anywhere else that path leads to a
 * file server that will answer 405, and the address that DOES work is the
 * reader's own — reached by the extension, which fetches under its own
 * permissions rather than this page's origin.
 *
 * Decided from where the page is served rather than from whether the extension
 * is installed: the default has to be stable while someone is reading the panel,
 * and the extension's presence is discovered asynchronously. Both are editable
 * either way, and the copy below says which is which.
 */
const localHost = () => {
  const host = globalThis.location?.hostname ?? ''
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === ''
}

const defaultReaderAddress = () => (localHost() ? PROXY_PATH : MARKITDOWN.defaultEndpoint)

/**
 * The setup, as one block — shown and copied from the same constant.
 *
 * Built here rather than written out, so the text on screen and the text on the
 * clipboard cannot drift: a copy button that pastes a port the panel does not
 * show is worse than no button, because the person trusts the paste and then
 * debugs the wrong address.
 */
const SETUP_COMMANDS = `${MARKITDOWN.install}\n${MARKITDOWN.serve}`

/** Exported for the first run, on the same terms as `LocalModelPanel`. */
export function DocumentReaderPanel({ bare = false }: { bare?: boolean } = {}) {
  const { reader, setReader } = useModelSettings()
  const [endpoint, setEndpoint] = useState(reader || defaultReaderAddress())
  const [testing, setTesting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [connected, setConnected] = useState(reader.length > 0)

  const onTest = async () => {
    setTesting(true)
    setFailure(null)
    const result = await testReader(endpoint)
    setTesting(false)
    setConnected(result.ok)
    if (result.ok) {
      setReader(endpoint.trim())
      // How the reader was reached, not where. `via` distinguishes the three
      // routes that exist — the extension relay is the one whose usage is
      // genuinely unknown, and it is the reason this event is worth having.
      report('reader_connected', { via: needsExtension(endpoint) ? 'extension' : 'direct' })
    } else setFailure(result.reason)
  }

  return (
    <Shell bare={bare}>
      <PanelTitle hint="optional">Read my documents</PanelTitle>
      <p className="mb-3 text-sm text-text-2">
        The assistant can only see a document&apos;s name until something turns it into text. Run{' '}
        <a
          href={MARKITDOWN.url}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {MARKITDOWN.name}
        </a>{' '}
        on this machine and it can read what is inside your PDFs, Word files, decks and
        spreadsheets.
      </p>

      <div className="space-y-3">
        <Field
          label="Address"
          mono
          type="url"
          spellCheck={false}
          value={endpoint}
          placeholder={defaultReaderAddress()}
          hint="A path on this site in development, or the reader’s own address with the extension installed. See below."
          onChange={(e) => {
            setEndpoint(e.target.value)
            setConnected(false)
            setFailure(null)
          }}
        />

        {/* A setting that needs a program the user has not installed is a
            setting that has to say how.

            ONE BOX, ONE BUTTON, copying both lines. They are two commands but a
            single act — install it, then start it — and someone who has just
            been told they need a program they do not have wants the whole
            recipe in their terminal, not two trips back to this panel. Pasting
            both into bash, zsh or PowerShell runs them in order, which is the
            order they are wanted in.

            The commands are also the two lines most likely to be mistyped: a
            lost hyphen in `--http` or a transposed port produces a reader that
            starts, prints a cheerful address, and cannot be reached. */}
        <div className="rounded-md border border-hairline bg-well p-2.5">
          <p className="text-xs text-text-3">Not running it yet?</p>
          <div className="mt-1.5 flex items-start gap-2 rounded-md border border-hairline bg-raised py-1.5 pr-1 pl-2.5">
            {/* `min-w-0` on the flex child, or a long command refuses to shrink
                and pushes the button off the edge of the card. */}
            <pre className="min-w-0 flex-1 overflow-x-auto py-0.5 font-mono text-xs whitespace-pre text-text-1">
              {SETUP_COMMANDS}
            </pre>
            <CopyButton text={SETUP_COMMANDS} label="Copy the setup commands" />
          </div>
          {/* Not a footnote. Someone who types the address it prints on startup
              gets an unexplainable failure, so the explanation goes where they
              would type it. */}
          <p className="mt-2 text-xs text-text-3">
            It listens on <span className="font-mono">{MARKITDOWN.defaultEndpoint}</span>, but it
            sends no CORS headers — so a browser will not let this page call it across ports.
            jojo&apos;s dev server forwards <span className="font-mono">{PROXY_PATH}</span> to it,
            which is why the address above is a path rather than a URL. The phone app talks to it
            directly and needs none of this.
          </p>
          {/*
           * Said plainly, because "a hosted copy needs the same forwarding" was
           * what this used to say and it reads as a configuration step. On a
           * static host it is not a step, it is impossible: there is no server
           * process to forward with. Someone reading the old sentence went
           * looking for the setting, found a 405, and reported a bug.
           */}
          {/*
           * This used to say a hosted copy could not work at all, which was
           * true of the PAGE and is no longer true of jojo. The extension
           * fetches under its own permissions, so it can reach a reader on this
           * machine when the page cannot — the same reason board scanning lives
           * there.
           */}
          <p className="mt-2 text-xs text-text-3">
            <span className="text-text-2">On a hosted copy, install the extension.</span> A page
            served from the web cannot call <span className="font-mono">127.0.0.1</span> — there is
            no proxy to forward a path, and https:// pages are barred from the local network. The
            extension is not a page: it reaches the reader directly, and jojo asks it to. Put the
            reader&apos;s own address above and it relays each request; it will only ever relay to
            this machine.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={testing || endpoint.trim().length === 0}
          title={endpoint.trim().length === 0 ? 'Fill in an address first' : undefined}
          onClick={() => {
            void onTest()
          }}
        >
          {testing ? 'Testing…' : connected ? 'Test again' : 'Test connection'}
        </Button>
        {connected ? (
          <Chip tone="green">Connected</Chip>
        ) : failure ? (
          <Chip tone="red">No answer</Chip>
        ) : (
          <Chip tone="gray">Not connected</Chip>
        )}
      </div>

      {failure ? (
        <p className="mt-2 text-xs text-danger">{failure}</p>
      ) : connected ? (
        <p className="mt-2 text-xs text-text-3">
          Documents are sent to that address and nowhere else. Nothing is uploaded.
        </p>
      ) : null}

      {/* The notice the licence asks for, where the choice is made. */}
      <p className="mt-3 border-t border-hairline pt-3 text-xs text-text-3">
        {MARKITDOWN.name} is a separate program, not part of jojo. {MARKITDOWN.copyright}{' '}
        {MARKITDOWN.licence}. jojo is not affiliated with Microsoft.
      </p>
    </Shell>
  )
}
