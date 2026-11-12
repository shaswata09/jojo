import { useId, useState } from 'react'
import { Link2 } from 'lucide-react'
import {
  DEFAULT_THINKING,
  normaliseEndpoint,
  sendsThinking,
  serverAt,
  serversFor,
} from '@jojo/service/core/model-server'
import type { ModelFailure, ModelServer, Thinking } from '@jojo/service/core/model-server'
import { Chip } from '@/components/common/Chip'
import { Field, SettingRow } from '@/components/common/Field'
import { Segment } from '@/components/common/Segment'
import { PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { listModels } from '@/lib/llm'
import { report } from '@/lib/analytics'
import { reportableProvider } from '@jojo/service/core/analytics'
import { useModelSettings } from '@/lib/model-settings-context'
import { PROVIDERS, cleanKey, parseContextWindow, providerMeta } from '@jojo/service/core/provider'
import type { ProviderId } from '@jojo/service/core/provider'
import { Shell } from '@/components/settings/PanelShell'
import { SavedServers } from '@/components/settings/SavedServers'
import { CloudTerms } from '@/components/settings/CloudTerms'

/**
 * The reasoning choices a person is offered. `server-default` is left out on
 * purpose: it is the benchmark's escape hatch, and "whatever the server was
 * started with" is not a choice anyone can make from this form.
 */
const REASONING = [
  { value: 'on', label: 'On' },
  { value: 'low', label: 'Light' },
  { value: 'off', label: 'Off' },
] as const satisfies readonly { value: Thinking; label: string }[]

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

  /*
   * The saved rows for THIS provider only.
   *
   * The stored list spans every provider this browser has reached, and offering
   * all of it here would put a vLLM box on someone's desk in the NVIDIA panel —
   * where picking it swaps the endpoint, the dialect and the key underneath a
   * form that still says NVIDIA. `serversFor` also folds in rows saved before
   * this record carried a provider; see its note.
   */
  const shown = serversFor(servers, provider.id)
  // The first-run dialog can mount this panel over the Settings page that also
  // shows it, and two `id="provider"`s would point both labels at one select.
  const providerId = useId()
  const [endpoint, setEndpoint] = useState(settings.endpoint)
  const [model, setModel] = useState(settings.model)
  /*
   * An edit buffer, because the stored value is a number and the field is text
   * — a half-typed "3" is not 3 tokens, and writing it through on every
   * keystroke would have the app plan against a window the user is midway
   * through changing. Committed on blur.
   */
  const [windowEdit, setWindowEdit] = useState(
    settings.contextWindow === undefined ? '' : String(settings.contextWindow),
  )
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

  /*
   * A SUCCESSFUL TEST, not a non-empty box.
   *
   * This was `model.trim().length > 0`, which was true enough while the model
   * could only be filled in BY a successful test — the field was disabled until
   * then. It stopped being true the moment the field became typeable for hosted
   * catalogues: typing a model id, or pasting a key and typing the id NVIDIA's
   * own site gave you, flipped the chip to "Connected" without a single request
   * having been made. A green light that means "you have typed something" is
   * worse than no light.
   *
   * `null` is the third state and it matters: nothing has been tried yet, which
   * is neither connected nor failed. Cleared back to null whenever an input
   * changes, because an answer about the old address says nothing about the new
   * one.
   */
  const [tested, setTested] = useState<boolean | null>(null)
  const connected = tested === true
  // The model too: a saved row is one MODEL at one address now, so a hosted
  // provider has several rows sharing an endpoint and the name belongs to the
  // one being edited rather than to whichever of them was stored first.
  const saved = serverAt(servers, endpoint, model)
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
      // A different address has not been reached, whatever the last one did.
      setTested(null)
    }
  }

  /** Puts a saved server back in the fields. Already verified, so connected. */
  /*
   * Restores the WHOLE connection, not just its address.
   *
   * It used to put back the endpoint and the model, which is everything a local
   * server is. A cloud one is also a provider and a key, and without those a
   * saved NVIDIA row loaded as an `openai-compatible` server with no
   * credentials — the list's whole purpose is "do not set this up again", and it
   * was useless for exactly the providers that take the most setting up.
   */
  const onLoad = (server: ModelServer) => {
    setEndpoint(server.endpoint)
    setModel(server.model)
    setNameEdit(null)
    setFailure(null)
    setListOpen(false)
    /*
     * Unknown, not connected. The row was verified when it was SAVED, which was
     * possibly months and one laptop reboot ago — the header on this component
     * makes exactly this argument about the sidebar tile, and it applies here.
     * The fields are filled in and one press of Test says whether it still
     * answers.
     */
    setTested(null)
    save({
      ...settings,
      // Through `providerMeta`, which never returns undefined: a row written by
      // a newer build naming a provider this one has not heard of reads as the
      // open-ended OpenAI-compatible entry, which is what it most likely is.
      provider: providerMeta(server.provider ?? settings.provider).id,
      endpoint: server.endpoint,
      model: server.model,
      // An entry saved before keys were kept has none; leaving what is already
      // typed is better than clearing a key the user just pasted.
      apiKey: server.apiKey ?? settings.apiKey,
    })
  }

  const onTest = async () => {
    setTesting(true)
    setFailure(null)
    const result = await listModels({ ...settings, endpoint: endpoint.trim() })
    setTesting(false)
    if (!result.ok) {
      setFailure(result)
      setTested(false)
      /*
       * The model is NOT cleared any more.
       *
       * It used to be, on the reasoning that a model id belongs to a server that
       * answered. That reads as "reset the form" the moment the id is something
       * the user typed rather than something the server reported — press Test
       * against NVIDIA, get a transport error, and the id you pasted from their
       * site is gone and has to be found again. A local server never showed this
       * because its test rarely fails and its id was never hand-typed.
       *
       * The failure is already reported in words underneath. Deleting the user's
       * input as well is punishing them for a request that did not arrive.
       */
      return
    }
    setTested(true)
    /*
     * Which KIND of provider people actually get working — not the address,
     * which is frequently a hostname on the user's own network and therefore a
     * fact about them rather than about jojo. Reported on success only: a list
     * of failed attempts would say more about someone's network than about
     * whether this feature works.
     */
    report('model_connected', { provider: reportableProvider(settings.provider) })
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
    const found = current && result.models.includes(current) ? current : (result.models[0] ?? '')
    const label = saved?.name ?? found
    setModel(found)
    setNameEdit(null)
    save({ ...settings, endpoint: endpoint.trim(), model: found })
    // Saved under the model's own name unless this address already had one the
    // user chose. That is the "auto-saved" half: connecting is the act, and
    // keeping the address is a consequence of it rather than a second button.
    remember({
      name: label,
      endpoint,
      model: found,
      // Kept so the row can be loaded back whole. Never reaches the graph, so a
      // backup file cannot carry it — see `ModelServer.apiKey`.
      provider: settings.provider,
      ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
    })
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
            disabled={shown.length === 0}
            aria-expanded={listOpen}
            title={
              shown.length === 0
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
        <label className="mb-1.5 block text-sm font-medium" htmlFor={providerId}>
          Provider
        </label>
        <select
          id={providerId}
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
            // Switching provider switches everything the test was about.
            setTested(null)
            setFailure(null)
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
        {provider.cloud ? <CloudTerms provider={provider} /> : null}
      </div>

      {listOpen ? (
        <SavedServers
          servers={shown}
          current={{ endpoint: normaliseEndpoint(endpoint), model }}
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
              // A new key is a new question. Leaving the previous verdict up
              // would show "Connected" for credentials nothing has tried.
              setTested(null)
              setFailure(null)
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
          placeholder={
            connected ? '' : provider.modelLooksLike || 'The model id, from your provider'
          }
          hint={
            connected
              ? 'What the server reported. Change it if you serve more than one.'
              : 'Test the connection to fill this from the server, or type the id yourself.'
          }
          onChange={(e) => {
            // Typing a model id is not evidence that anything answered — which
            // is exactly the bug this replaced.
            setTested(null)
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
         * The window, which had no control at all until now.
         *
         * `contextOf` has always read `settings.contextWindow` and fallen back
         * to the provider's default, and nothing in either app could write it —
         * so every Ollama user planned against 4,096 tokens whatever their
         * `num_ctx` actually was, and the agent compacted history it had room
         * for. The default is a floor Ollama itself ships, not a measurement of
         * anybody's deployment.
         *
         * Empty means "use the default", and that is a real choice rather than
         * a missing one: for Ollama it also stops jojo sending `num_ctx` at
         * all, which is what lets the server fall back to its own VRAM
         * headroom instead of failing to load a model at a size the user
         * guessed. Typing a number opts into both halves at once.
         */}
        <Field
          label="Context window"
          mono
          inputMode="numeric"
          spellCheck={false}
          value={windowEdit}
          placeholder={String(provider.defaultContext)}
          hint={
            provider.dialect === 'ollama'
              ? `Tokens. Leave empty to use ${provider.defaultContext.toLocaleString()} and let Ollama size itself; a number here is also sent as num_ctx.`
              : `Tokens your deployment can hold. Leave empty for ${provider.defaultContext.toLocaleString()}.`
          }
          onChange={(e) => {
            setWindowEdit(e.target.value.replace(/[^0-9]/g, ''))
          }}
          onBlur={() => {
            const keep = parseContextWindow(windowEdit)
            setWindowEdit(keep === undefined ? '' : String(keep))
            const { contextWindow: _dropped, ...rest } = settings
            save({ ...rest, ...(keep === undefined ? {} : { contextWindow: keep }) })
          }}
        />
        {/*
         * Reasoning, which had no control at all: `thinkingFields` has always
         * taken a mode and nothing in either app passed one, so every request
         * went out with the default. Only shown where a mode puts something on
         * the wire — a hosted provider gets no thinking field whatever is
         * chosen (see `thinkingFields`), and a switch that does nothing there
         * would be a lie.
         */}
        {sendsThinking(provider.id, 'on') ? (
          <SettingRow
            label="Reasoning"
            description="Lets models that can think — gpt-oss, Gemma 4, Qwen3 — reason before answering. Turn it off if replies come back empty on a small model."
            control={
              <Segment
                label="Reasoning"
                options={REASONING}
                value={
                  settings.thinking === undefined || settings.thinking === 'server-default'
                    ? DEFAULT_THINKING
                    : settings.thinking
                }
                onChange={(next) => {
                  save({ ...settings, thinking: next })
                }}
              />
            }
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
