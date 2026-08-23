import { useState } from 'react'
import { Link2, Trash2 } from 'lucide-react'
import { normaliseEndpoint, serverAt } from '@jojo/service/core/model-server'
import type { ModelFailure, ModelServer } from '@jojo/service/core/model-server'
import { Chip } from '@/components/common/Chip'
import { Field } from '@/components/common/Field'
import { DocumentsPanel } from '@/components/settings/DocumentsPanel'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { listModels } from '@/lib/llm'
import { SUGGESTIONS, useModelSettings } from '@/lib/model-settings-context'

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
export function ConnectionsSection() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
      <DocumentsPanel />

      <LocalModelPanel />
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
function LocalModelPanel() {
  const { settings, servers, save, remember, rename, forget } = useModelSettings()
  /*
   * Started from what was stored, which is why a returning user is connected
   * without pressing anything: the stored model got there by a successful test
   * in an earlier session.
   */
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
    save({ endpoint: server.endpoint, model: server.model })
  }

  const onTest = async () => {
    setTesting(true)
    setFailure(null)
    const result = await listModels(endpoint)
    setTesting(false)
    if (!result.ok) {
      setFailure(result)
      setModel('')
      return
    }
    // The first is the one to use. vLLM serves exactly one model and lists it;
    // Ollama and LM Studio list everything they hold, most-recent first.
    const found = result.models[0] ?? ''
    const label = saved?.name ?? found
    setModel(found)
    setNameEdit(null)
    save({ endpoint: endpoint.trim(), model: found })
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
    <Panel>
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
        Local model
      </PanelTitle>
      <p className="mb-3 text-sm text-text-2">
        Point at any local server: vLLM, Ollama or LM Studio. Test the connection and it will name
        its own model.
      </p>

      {listOpen ? (
        <SavedServers
          servers={servers}
          current={normaliseEndpoint(endpoint)}
          onLoad={onLoad}
          onForget={forget}
        />
      ) : null}

      <div className="space-y-3">
        <Field
          label="Endpoint"
          mono
          type="url"
          spellCheck={false}
          value={endpoint}
          placeholder="http://localhost:8000/v1"
          hint="The base URL, ending in /v1."
          onChange={(e) => {
            onEndpointChange(e.target.value)
          }}
        />
        {/* Empty and unusable until a server has answered. The model id is the
            server's to state, not the user's to guess, and a field offering to
            take a guess is a field inviting a 404 later. */}
        <Field
          label="Model"
          mono
          spellCheck={false}
          value={model}
          disabled={!connected}
          placeholder={connected ? '' : 'Found when you test the connection'}
          hint={
            connected
              ? 'What the server reported. Change it if you serve more than one.'
              : undefined
          }
          onChange={(e) => {
            setModel(e.target.value)
          }}
          onBlur={() => {
            save({ endpoint: endpoint.trim(), model: model.trim() })
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
        {/* Three servers, one click each. The port is the step people get
            wrong, and every one of these is a default. */}
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((sug) => (
            <button
              key={sug.label}
              type="button"
              className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={() => {
                onEndpointChange(sug.endpoint)
              }}
            >
              <Chip tone="gray">{sug.label}</Chip>
              <span className="sr-only">Use the {sug.label} address</span>
            </button>
          ))}
        </div>
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
    </Panel>
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
