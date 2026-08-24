import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link2, Trash2 } from 'lucide-react'
import { normaliseEndpoint, serverAt } from '@jojo/service/core/model-server'
import type { ModelFailure, ModelServer } from '@jojo/service/core/model-server'
import { Chip } from '@/components/common/Chip'
import { Field } from '@/components/common/Field'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { listModels } from '@/lib/llm'
import { testReader } from '@/lib/markitdown'
import { MARKITDOWN } from '@jojo/service/agent/markitdown'
import { useModelSettings } from '@/lib/model-settings-context'
import { publicUrl } from '@/lib/public-url'
import {
  PROVIDERS,
  cleanKey,
  providerMeta,
  type ProviderId,
} from '@jojo/service/core/provider'

/**
 * Where the user's documents are, and the one thing jojo can talk to outside
 * itself: a local model.
 *
 * Both halves are real now. This comment used to except "the folder switches
 * below", which were three `useState` values with no reader, sitting under a
 * picker that bound a directory nothing ever wrote a document to. All of it is
 * gone — see `DocumentsPanel`, which says where documents actually live and
 * offers the way to get them out.
 */
/**
 * A card on the Settings page, a plain block inside a dialog.
 *
 * The first run already has chrome around it, and a card inside a card is the
 * tell that a settings panel has been reused somewhere it was not drawn for.
 */
function Shell({ bare, children }: { bare: boolean; children: ReactNode }) {
  return bare ? <div className="space-y-3">{children}</div> : <Panel>{children}</Panel>
}

export function ConnectionsSection() {
  /*
   * Two cards, and the pairing is the organisation.
   *
   * There were three, and the third was `DocumentsPanel` — which is not a
   * connection at all: it reports how many documents are in this browser and
   * offers to download them, which is a fact about storage. In a two-column grid
   * that made an odd number, so "Read my documents" was orphaned on the left
   * with an empty half-row beside it and a tall gap under the short card. It has
   * moved next to `DataPanel`, where the rest of "where your records live" is.
   *
   * What is left belongs together by shape as well as by subject: both are a
   * local service you point at, both take an address, and both have a Test
   * connection that says the same three things. Side by side they read as one
   * question asked twice.
   */
  return (
    <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-2">
      <LocalModelPanel />
      <DocumentReaderPanel />
    </div>
  )
}

/**
 * Point the app at a model that is already running on this machine.
 *
 * THE SHAPE OF THE CARD IS THE ARGUMENT. Endpoint is something a person can
 * type; a model id is not — for vLLM it is the full HuggingFace path, and
 * getting it wrong fails at the first real request with a 404 rather than here.
 * So Model is empty and disabled until the server has named itself, and "Test
 * connection" is the act that fills it in. A filled Model field is this app's
 * record that the address answered; nothing else can write one.
 *
 * Connecting also keeps the address, which is why there is no Save button. The
 * thing worth saving is a URL with a port in it, and the port is the part nobody
 * remembers — 8000, 11434, 1234, or whatever was passed to `--port` that day.
 * Retyping it is the friction that stops people connecting a model they already
 * have running, and a list of addresses that have worked before removes it.
 */
/**
 * Exported because the first run asks the same question the Settings page does.
 *
 * `bare` is the whole of the difference: inside a dialog the surrounding chrome
 * is already a card, and nesting one inside another is the giveaway that a
 * settings panel has been dropped somewhere it was not designed for. The
 * FIELDS are identical either way — a first run that asked for the endpoint
 * differently from Settings would be two things to keep in step.
 */
export function LocalModelPanel({ bare = false }: { bare?: boolean } = {}) {
  const { settings, servers, save, remember, rename, forget } = useModelSettings()
  /*
   * Started from what was stored, which is why a returning user is connected
   * without pressing anything: the stored model got there by a successful test
   * in an earlier session.
   */
  /** Everything that differs between providers, looked up once per render. */
  const provider = providerMeta(settings.provider)
  const [endpoint, setEndpoint] = useState(settings.endpoint)
  const [model, setModel] = useState(settings.model)
  /*
   * `null` means "not edited in this session", which is different from "" —
   * a distinction a live reload forced. Holding the name as a plain string
   * seeded from '' meant that reopening Settings showed an empty Saved-as field
   * for a server the user had named, and blurring that empty field renamed it
   * back to the model id. The stored name is the truth; this is an edit buffer
   * over it, and dropping back to `null` after a write is what re-reads it.
   */
  const [nameEdit, setNameEdit] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [failure, setFailure] = useState<ModelFailure | null>(null)
  const [listOpen, setListOpen] = useState(false)

  const connected = model.trim().length > 0
  const saved = serverAt(servers, endpoint)
  const name = nameEdit ?? saved?.name ?? model

  /**
   * A new address invalidates the model, so typing one clears it.
   *
   * Without this, editing the endpoint after a successful test leaves the old
   * server's model id sitting in an enabled field — and the next request goes to
   * the new address asking for a model it has never heard of, which fails with a
   * message about the model rather than about the change just made.
   */
  const onEndpointChange = (next: string) => {
    setEndpoint(next)
    if (normaliseEndpoint(next) !== normaliseEndpoint(endpoint)) {
      setModel('')
      setNameEdit(null)
      setFailure(null)
    }
  }

  /** Puts a saved server back in the fields. Already verified, so connected. */
  const onLoad = (server: ModelServer) => {
    setEndpoint(server.endpoint)
    setModel(server.model)
    setNameEdit(null)
    setFailure(null)
    setListOpen(false)
    save({ ...settings, endpoint: server.endpoint, model: server.model })
  }

  const onTest = async () => {
    setTesting(true)
    setFailure(null)
    const result = await listModels({ ...settings, endpoint: endpoint.trim() })
    setTesting(false)
    if (!result.ok) {
      setFailure(result)
      setModel('')
      return
    }
    /*
     * The user's choice wins when the server confirms it exists.
     *
     * This took `result.models[0]` unconditionally, on the reasoning that vLLM
     * serves exactly one model and lists it, and Ollama lists most-recent first.
     * Both true, and both about servers with a handful of models.
     *
     * A hosted catalogue breaks it. NVIDIA lists over a hundred, alphabetically,
     * so the first is `01-ai/yi-large` — and pressing Test connection silently
     * replaced a deliberately typed `nvidia/nemotron-3.5-lightning-30b-a3b` with
     * a model the account cannot call. Measured against the live API: three
     * `200`s with the typed model, then `404 Function not found for account`
     * after the test overwrote it.
     *
     * So: keep what is there when the server lists it, and only fall back to the
     * first when the box is empty or names something the server does not have.
     */
    const current = model.trim()
    const found =
      current && result.models.includes(current) ? current : (result.models[0] ?? '')
    const label = saved?.name ?? found
    setModel(found)
    setNameEdit(null)
    save({ ...settings, endpoint: endpoint.trim(), model: found })
    // Saved under the model's own name unless this address already had one the
    // user chose. That is the "auto-saved" half: connecting is the act, and
    // keeping the address is a consequence of it rather than a second button.
    remember({ name: label, endpoint, model: found })
  }

  /** Renaming the entry on this card renames the row in the list. */
  const onRename = () => {
    if (!saved) return
    rename(saved.id, name)
    // Back to reading the stored value, which `renameServer` may have replaced
    // with the model id if the user blanked the field.
    setNameEdit(null)
  }

  return (
    <Shell bare={bare}>
      <PanelTitle
        hint="OpenAI-compatible"
        right={
          <button
            type="button"
            className="rounded-md p-1.5 text-text-3 transition-colors hover:bg-well hover:text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
            onClick={() => {
              setListOpen((v) => !v)
            }}
            disabled={servers.length === 0}
            aria-expanded={listOpen}
            title={
              servers.length === 0
                ? 'Nothing saved yet — test a connection and the address is kept'
                : 'Saved servers'
            }
          >
            <Link2 className="size-4" aria-hidden />
            <span className="sr-only">Saved servers</span>
          </button>
        }
      >
        Model
      </PanelTitle>
      <p className="mb-3 text-sm text-text-2">
        A model on this machine, or one you pay for. Local is the default because it is the only
        option where your records never leave the device.
      </p>

      {/* The provider first, because every field under it depends on the answer:
          a local server needs an address, a cloud one needs a key and has its
          address already. */}
      <div className="mb-3">
        <label className="mb-1.5 block text-sm font-medium" htmlFor="provider">
          Provider
        </label>
        <select
          id="provider"
          className="h-9 w-full rounded-md border border-hairline bg-panel px-2.5 text-sm"
          value={settings.provider}
          onChange={(e) => {
            const next = e.target.value as ProviderId
            const meta = providerMeta(next)
            /*
             * The endpoint is replaced rather than kept. A fixed-endpoint
             * provider ignores what is stored anyway, and carrying
             * `http://localhost:11434` across into a Claude request would fail
             * for a reason nobody could guess from the screen.
             */
            setEndpoint(meta.endpoint)
            /*
             * The key is DROPPED, not carried.
             *
             * Keeping it looked harmless and was not: switching Anthropic to
             * OpenAI without pasting a new one would have sent the Anthropic
             * key to OpenAI in an `Authorization` header. A credential going to
             * the wrong company is not a style question, and the cost of
             * clearing it is one paste.
             */
            save({
              ...settings,
              provider: next,
              endpoint: meta.endpoint,
              model: '',
              apiKey: '',
            })
            setModel('')
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {/*
         * Two facts, said separately, because a provider can be one and not the
         * other. This used to be one sentence ending "and is billed to your
         * account", which is false on a free tier — and telling somebody they
         * are being charged for something free, on the screen where they decide
         * whether to use it, is not a small inaccuracy.
         */}
        {provider.cloud ? (
          <p className="mt-1.5 text-xs text-warn">
            {/* The label's own qualifier is trimmed here. The dropdown entry
                reads "NVIDIA (build.nvidia.com) — free, rate limited", which is
                right in a list of choices and reads as a stammer inside a
                sentence that is about to say the same thing: "goes to NVIDIA —
                free, rate limited — free, within its rate limits". */}
            Everything you ask goes to {provider.label.split(' —')[0]}
            {provider.billed
              ? ' and is billed to your account.'
              : ' — free, within its rate limits, and it will refuse rather than charge you when you reach them.'}{' '}
            jojo is local-first; this is the one part that is not.
          </p>
        ) : null}
      </div>

      {listOpen ? (
        <SavedServers
          servers={servers}
          current={normaliseEndpoint(endpoint)}
          onLoad={onLoad}
          onForget={forget}
        />
      ) : null}

      <div className="space-y-3">
        {provider.fixedEndpoint ? null : (
          <Field
            label="Endpoint"
            mono
            type="url"
            spellCheck={false}
            value={endpoint}
            placeholder={provider.endpoint || 'http://localhost:8000/v1'}
            hint={
              provider.dialect === 'ollama'
                ? 'The host and port. No /v1 — jojo uses Ollama’s own endpoint so it can ask it not to truncate.'
                : 'The base URL, ending in /v1.'
            }
            onChange={(e) => {
              onEndpointChange(e.target.value)
            }}
          />
        )}

        {provider.needsKey ? (
          <Field
            label="API key"
            mono
            type="password"
            spellCheck={false}
            autoComplete="off"
            value={settings.apiKey ?? ''}
            // Per provider. It read `sk-…` for everybody, which is OpenAI's
            // shape and nobody else's — a wrong prefix in the one field where a
            // person is checking whether they pasted the right thing.
            placeholder={provider.keyLooksLike}
            /*
             * Said plainly, because a person pasting a key deserves to know
             * where it goes. It is stored beside the app's other settings, not
             * inside the records — which is why a backup export cannot contain
             * it even by accident.
             */
            hint="Kept in this browser only. It is never put in a backup and never sent anywhere but the provider."
            onChange={(e) => {
              save({ ...settings, apiKey: cleanKey(e.target.value) })
            }}
          />
        ) : null}
        {/* Where to get one. It matters most for the free provider, where "sign
            in and it hands you a key" is the entire setup and somebody who
            cannot find the page does not get an agent at all. */}
        {provider.needsKey && provider.keyUrl ? (
          <p className="-mt-1 text-xs text-text-3">
            <a
              href={provider.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-text-1"
            >
              Get a key from {provider.label.split(' —')[0].split(' (')[0]}
            </a>
            {provider.billed ? null : ' — free, no card.'}
          </p>
        ) : null}
        {/*
         * TYPEABLE, always. It used to be disabled until a connection had been
         * tested, on the argument that "the model id is the server's to state,
         * not the user's to guess". That argument holds for a local server,
         * which lists what it is serving and will 404 a guess — and it fails
         * completely for a hosted catalogue.
         *
         * NVIDIA is the case that broke it. Its `/v1/models` cannot be read from
         * a page at all, so `connected` never becomes true, so the field never
         * unlocks, so there is no way to enter `nvidia/nemotron-3-ultra-550b-a55b`
         * — a name the user got from the provider's own website and is not
         * guessing at. A control that cannot be filled in is worse than one that
         * accepts a wrong answer: the wrong answer produces a 404 that names
         * itself.
         */}
        <Field
          label="Model"
          mono
          spellCheck={false}
          value={model}
          placeholder={connected ? '' : provider.modelLooksLike || 'The model id, from your provider'}
          hint={
            connected
              ? 'What the server reported. Change it if you serve more than one.'
              : 'Test the connection to fill this from the server, or type the id yourself.'
          }
          onChange={(e) => {
            setModel(e.target.value)
          }}
          onBlur={() => {
            save({ ...settings, endpoint: endpoint.trim(), model: model.trim() })
          }}
        />
        {/* Only once there is something to name. Before that it would be a
            label for a connection that does not exist. */}
        {connected ? (
          <Field
            label="Saved as"
            spellCheck={false}
            value={name}
            placeholder={model}
            hint="What this server is called in the list. Defaults to the model."
            onChange={(e) => {
              setNameEdit(e.target.value)
            }}
            onBlur={onRename}
          />
        ) : null}
        {/*
          The three address chips that used to sit here are gone. They existed
          to save somebody remembering whether Ollama is 11434 or 11343 — and
          the provider picker above now sets the address as a consequence of
          choosing the provider, which is the same help arriving earlier. Two
          controls writing one field is how they end up disagreeing.
        */}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={testing || endpoint.trim().length === 0}
          title={endpoint.trim().length === 0 ? 'Fill in an endpoint first' : undefined}
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

      {/* The server's own words, not a paraphrase. A wrong port and a path
          missing its /v1 fail differently, and only the endpoint knows which
          happened.

          The browser-specific half of this used to live here and now lives in
          `lib/llm`, which is where it belongs: the ambiguity it explains is a
          property of `fetch` in a browser, not of this card, and the Assistant
          page hits exactly the same wall. Printing `reason` verbatim is all
          that is left to do. */}
      {failure ? (
        <p className="mt-2 text-xs text-danger">{failure.reason}</p>
      ) : connected ? (
        <p className="mt-2 text-xs text-text-3">
          Kept in this browser. The assistant will use this model.
        </p>
      ) : null}
    </Shell>
  )
}

/**
 * The addresses this browser has connected to before.
 *
 * Only servers that answered get in here. Nothing is written on typing, so a row
 * is a claim that the address worked at least once, and Load is safe to treat as
 * connected without a fresh round trip.
 *
 * Delete is immediate and unconfirmed, which is deliberate: it forgets an
 * address, and the recovery is typing it again. A confirmation dialog would cost
 * more than the mistake does.
 */
function SavedServers({
  servers,
  current,
  onLoad,
  onForget,
}: {
  servers: readonly ModelServer[]
  current: string
  onLoad: (server: ModelServer) => void
  onForget: (id: string) => void
}) {
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-hairline">
      <p className="border-b border-hairline bg-well px-3 py-2 text-xs text-text-3">
        Saved servers — addresses that have answered here.
      </p>
      <ul className="divide-y divide-hairline">
        {servers.map((server) => (
          <li key={server.id} className="flex items-center gap-2 px-3 py-2">
            <button
              type="button"
              className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={() => {
                onLoad(server)
              }}
            >
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-text-1">{server.name}</span>
                {/* Which one is in the fields right now. Two saved servers on
                    one machine differ by a port, and a list of near-identical
                    URLs with nothing marked is a list you read character by
                    character. */}
                {server.endpoint === current ? <Chip tone="green">In use</Chip> : null}
              </span>
              <span className="block truncate font-mono text-xs text-text-3">
                {server.endpoint}
              </span>
              <span className="block truncate text-xs text-text-3">{server.model}</span>
              <span className="sr-only">Load {server.name}</span>
            </button>
            <button
              type="button"
              className="rounded-md p-1.5 text-text-3 transition-colors hover:bg-well hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={() => {
                onForget(server.id)
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              <span className="sr-only">Forget {server.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

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
    if (result.ok) setReader(endpoint.trim())
    else setFailure(result.reason)
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

        {/* The two commands, copyable. A setting that needs a program the user
            has not installed is a setting that has to say how. */}
        <div className="rounded-md border border-hairline bg-well p-2.5">
          <p className="text-xs text-text-3">Not running it yet?</p>
          <pre className="mt-1 font-mono text-xs break-words whitespace-pre-wrap text-text-2">
            {MARKITDOWN.install}
            {'\n'}
            {MARKITDOWN.serve}
          </pre>
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
