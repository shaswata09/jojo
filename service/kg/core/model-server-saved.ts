/**
 * The saved list of model servers, and the rules for keeping it.
 *
 * WHY A SAVED LIST AT ALL — see the header of `model-server.ts`, which
 * re-exports every name here.
 */

import { normaliseEndpoint } from './model-server-protocol'

/** A server the user has connected to and kept. */
export type ModelServer = {
  /**
   * Stable across renames, which is the whole reason it is not the URL.
   *
   * The list is keyed by endpoint for *uniqueness* — pointing at the same
   * server twice is one entry, not two — but a row that lost its identity when
   * renamed would be a new row to React, and the one being edited would remount
   * under the cursor.
   */
  id: string
  /** What the user calls it. Defaults to the model the server reported. */
  name: string
  /** Base URL, OpenAI-style: '…/v1'. Normalised — no trailing slash. */
  endpoint: string
  /**
   * Which provider this is, so loading a row restores the dialect too.
   *
   * Absent on rows written before cloud providers could be saved, and read as
   * `openai-compatible` — which is what every one of those rows actually was.
   */
  provider?: string
  /**
   * The key this connection needs, when it needs one.
   *
   * HERE RATHER THAN NOWHERE, and the alternative was worse. A key lived only in
   * the current settings document, so switching from Claude to NVIDIA and back
   * meant pasting a key each time — and the saved list, whose entire purpose is
   * "do not set this up again", was useless for exactly the providers that need
   * the most setting up.
   *
   * WHAT "STORED SECURELY" CAN HONESTLY MEAN HERE. Not encrypted at rest: there
   * is no passphrase, and a cipher whose key sits in the same store as the
   * ciphertext is theatre that reads as protection. What is true, and is the
   * property that matters, is that this never leaves the device by any path the
   * app controls — `core/backup.ts` serialises nodes, edges and documents, and
   * this is none of those, so a backup file cannot carry it and neither can a
   * Transfer. It is browser storage on the user's own machine, alongside the
   * settings document that already held it.
   */
  apiKey?: string
  /** The model id requests are sent with, as the server reported it. */
  model: string
}

/**
 * Adds a model at an address, or updates the one already saved there.
 *
 * KEYED ON ENDPOINT **AND** MODEL, and the second half is what makes a hosted
 * provider usable. This was keyed on the endpoint alone, on the reasoning that
 * the model "is a fact about the server rather than a preference" — which is
 * true of a self-hosted vLLM, where one process serves one model and the URL is
 * the identity of both. It is false of every hosted provider: NVIDIA, OpenAI,
 * Anthropic, Groq and OpenRouter each answer for a whole catalogue at ONE fixed
 * address. Under the old key, connecting to a second NVIDIA model overwrote the
 * first, so the saved list could never hold more than one of them and there was
 * nothing to switch between.
 *
 * A row is therefore "a model I have reached, and how to reach it" — which is
 * what the list is for on both kinds of provider. Two models at one endpoint are
 * two rows; the same model reached twice is still one, so testing a connection
 * three times while getting the port right does not leave three rows.
 *
 * An existing entry keeps its `id` and its `name` — the name is the user's, and
 * a reconnect that renamed their "Workstation" back to `meta-llama/Llama-3.1-8B`
 * would undo an edit they made on purpose.
 *
 * THE KEY IS WRITTEN TO EVERY ROW AT THAT ENDPOINT, not only the one being
 * saved. A credential belongs to the provider, not to the model — so rotating
 * it while connecting to one NVIDIA model has to fix the other four rows too,
 * or they keep failing with a key the user already replaced and no way to see
 * why.
 */
export function saveServer(
  list: readonly ModelServer[],
  entry: { name: string; endpoint: string; model: string; provider?: string; apiKey?: string },
): ModelServer[] {
  const endpoint = normaliseEndpoint(entry.endpoint)
  const existing = list.find((s) => s.endpoint === endpoint && s.model === entry.model)
  /*
   * `provider` and `apiKey` are omitted rather than written as undefined, so a
   * row keeps its stored key when a caller that does not know about keys saves
   * it. `exactOptionalPropertyTypes` is on, which makes that the only spelling
   * that compiles — and it is also the correct behaviour.
   */
  const extras = {
    ...(entry.provider === undefined ? {} : { provider: entry.provider }),
    ...(entry.apiKey === undefined || entry.apiKey === '' ? {} : { apiKey: entry.apiKey }),
  }
  /** The credential half of `extras`, which travels to every row at this address. */
  const keyExtra = entry.apiKey === undefined || entry.apiKey === '' ? {} : { apiKey: entry.apiKey }
  const withKey = (rows: readonly ModelServer[]): ModelServer[] =>
    rows.map((s) => (s.endpoint === endpoint ? { ...s, ...keyExtra } : s))

  if (!existing) {
    return [
      ...withKey(list),
      {
        id: serverId(endpoint, entry.model),
        name: entry.name || entry.model,
        endpoint,
        model: entry.model,
        ...extras,
      },
    ]
  }
  return withKey(list).map((s) =>
    s.endpoint === endpoint && s.model === entry.model ? { ...s, ...extras } : s,
  )
}

/**
 * The id for a saved row: its address and its model, prefixed.
 *
 * Derived rather than minted because there is no random source in this layer
 * and no need for one — the list is unique by (endpoint, model), so that pair
 * already *is* the key. Deriving it also means two devices that saved the same
 * model agree on the id without ever having spoken, and that a test can assert
 * one.
 *
 * THE MODEL IS IN IT because the id is a React key and a delete target. When
 * this was the endpoint alone, five NVIDIA models shared one id — React would
 * have drawn them as one row and Delete would have taken all five.
 *
 * It still is not the raw endpoint, and the prefix is why: giving an id the same
 * spelling as a user-editable URL invites code that compares one to the other
 * and gets it right until somebody types a trailing slash.
 */
export const serverId = (endpoint: string, model: string) =>
  `server:${normaliseEndpoint(endpoint)}#${model}`

/** Renames one. A blank name falls back to the model id rather than vanishing. */
export function renameServer(
  list: readonly ModelServer[],
  id: string,
  name: string,
): ModelServer[] {
  return list.map((s) => (s.id === id ? { ...s, name: name.trim() || s.model } : s))
}

export function removeServer(list: readonly ModelServer[], id: string): ModelServer[] {
  return list.filter((s) => s.id !== id)
}

/**
 * The saved rows belonging to one provider.
 *
 * The list is per-browser and holds every model this device has reached, across
 * every provider — so on the NVIDIA panel it would otherwise offer a vLLM box on
 * someone's desk, and picking it would swap the endpoint, the dialect and the
 * key underneath a form that still said NVIDIA. A saved row is only useful where
 * it can actually be selected, which is the panel for its own provider.
 *
 * A ROW WITH NO `provider` IS TREATED AS `openai-compatible`, and that is a
 * migration rather than a guess: `provider` was added to this record after the
 * feature shipped, so every row saved before it is a local server the user
 * configured by hand — which is exactly what `openai-compatible` is, and what
 * `DEFAULTS.provider` was set to at the time they saved it. Dropping those rows
 * from every panel would look like the list had lost them.
 */
export function serversFor(list: readonly ModelServer[], provider: string): ModelServer[] {
  return list.filter((s) => (s.provider ?? 'openai-compatible') === provider)
}

/**
 * The saved row for an address, and — when one is given — a model.
 *
 * `model` is optional because two callers want different things. Naming one
 * asks "is THIS model at THIS address saved", which is what a settings form
 * needs to show the user's own name for the row it is editing. Omitting it asks
 * "has this address ever been reached", which is what a caller looking for a
 * stored credential wants: the key is the provider's, so any row at that
 * endpoint carries it.
 */
export const serverAt = (
  list: readonly ModelServer[],
  endpoint: string,
  model?: string,
): ModelServer | undefined => {
  const at = normaliseEndpoint(endpoint)
  return model === undefined
    ? list.find((s) => s.endpoint === at)
    : list.find((s) => s.endpoint === at && s.model === model)
}
