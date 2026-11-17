/**
 * L1 — conversations with the assistant: how much each may do unasked, and
 * how a turn is kept. Re-exported by `core/model.ts`.
 */

/**
 * What a conversation asks about before it acts.
 *
 * Ordered from most cautious to least, which is the order they are offered in.
 */
export const APPROVAL_MODES = ['manual', 'semi', 'auto'] as const

export type ApprovalMode = (typeof APPROVAL_MODES)[number]

/**
 * What each mode is called, and what it actually does — written once.
 *
 * Three surfaces show this: the control on the web, the control on the phone,
 * and the announcement when the agent itself changes the setting. Copy about
 * what will happen WITHOUT being asked is exactly the copy that must not drift
 * between them.
 *
 * `SAID` names deletion explicitly rather than saying "dangerous", because the
 * line the app actually draws is `delete` and `admin`, plus the handful of
 * tools that ask to be confirmed themselves — nineteen of the ninety-five a
 * model is offered, counted 2026-11-11 and pinned in `catalog.test.ts`. Closing an application is a
 * `move` and passes without a prompt under `semi`, which is worth a person
 * knowing before they choose it.
 */
export const APPROVAL_LABEL: { readonly [M in ApprovalMode]: string } = {
  manual: 'Manual',
  semi: 'Semi-auto',
  auto: 'Auto',
}

/** The announcement, when the change itself is a step the agent took. */
export const APPROVAL_TITLE: { readonly [M in ApprovalMode]: string } = {
  manual: 'Asking before each change',
  semi: 'Asking only before deletions',
  auto: 'Acting without asking',
}

export const APPROVAL_SAID: { readonly [M in ApprovalMode]: string } = {
  manual: 'You are asked before anything in this conversation is written.',
  semi: 'Edits happen straight away. You are asked before anything is deleted or cleared.',
  auto: 'Everything happens straight away, deletions included. Only emptying or replacing the whole store is confirmed.',
}

/**
 * The mode a stored conversation is in, including ones written before modes.
 *
 * A thread saved by an older build has `autoApprove` and no `approval`, and the
 * two settings it could hold map exactly onto the first two modes: asking about
 * every write, or asking only about the destructive ones. Nobody is silently
 * upgraded to `auto` — that is a mode a person has to choose.
 */
export const approvalOf = (props: {
  approval?: ApprovalMode
  autoApprove?: boolean
}): ApprovalMode => props.approval ?? (props.autoApprove === true ? 'semi' : 'manual')

/** The most of one thought a saved conversation keeps. The rest is a long monologue. */
export const MAX_THOUGHT_STORED = 8000

/**
 * What the head of a capped conversation says about what the cap took.
 *
 * `assistant.thread.set` bounds a thread's stored turns, and on a summarised
 * thread it takes the covered prefix's replies, steps and notes before it ever
 * takes a turn the person wrote — those are replayed to the model verbatim
 * (`historyFor`), so the replies can go without the model's view changing at
 * all. Only when nothing but the person's own turns is left to take do the
 * oldest of those go too. Either way the cap leaves ONE app note at the head
 * of the transcript saying which of the two happened, so the person reading
 * the conversation is told rather than finding answers missing — and, for the
 * second, the model is told as well (`TRIM_SAID_TO_MODEL`), because a turn it
 * was being sent verbatim stopped arriving.
 *
 * Recognised by its exact text, which is this app's own and never a model's:
 * an app note is never replayed as speech, and the texts are constants here.
 * The marker only ever moves from `replies` to `messages`, never back.
 */
export const TRIM_MARKER = {
  replies:
    'Earlier replies in this conversation were removed to keep it within its size limit. Your own messages are all kept, and the assistant has a summary of the rest.',
  messages:
    'This conversation outgrew its size limit, so its earliest messages were removed — yours as well as the replies. The assistant has a summary of the replies, and is told that some of your earliest messages are gone.',
} as const

export type TrimLevel = keyof typeof TRIM_MARKER

/**
 * What the model is sent in place of the person's turns the cap removed.
 *
 * A bracketed observation in the person's role, the way a failed attempt is
 * told back (`toTranscript`'s `error`), so it is never mistaken for the
 * person's words or for the model's own.
 */
export const TRIM_SAID_TO_MODEL =
  '[Some of the person’s earliest messages in this conversation are no longer kept — removed to bound its size, and not summarised. If something they said earlier matters and is not here, ask them.]'

/** Which trim the entry marks, or `null` when it is not the cap's marker. */
export const trimLevelOf = (entry: ThreadEntry | undefined): TrimLevel | null => {
  if (entry?.kind !== 'note' || entry.app !== true) return null
  if (entry.text === TRIM_MARKER.messages) return 'messages'
  if (entry.text === TRIM_MARKER.replies) return 'replies'
  return null
}

/**
 * One turn of a conversation, as it is kept.
 *
 * The DISPLAY shape, not the model-facing one. `kg/agent/transcript.ts` derives
 * the OpenAI messages from these, so a thread is stored once and read two ways
 * rather than stored twice and kept in step by hand — which is the failure mode
 * a chat log invites, because the two drift only in old threads nobody reopens.
 *
 * `step` keeps what a person needs to read back: which tool ran, what it was
 * asked, and what it said. It does NOT keep the undo closure, which cannot
 * survive a reload — the journal is what takes an agent's writes back after the
 * conversation has been closed, and it already does.
 */

export type ThreadEntry =
  | { kind: 'you'; text: string }
  /**
   * Something said mid-run, and `app` says by whom.
   *
   * Absent (the default) means the MODEL said it — narration while it works,
   * "let me look that up" — and `toTranscript` replays it as assistant speech,
   * which is what it was.
   *
   * `app: true` means this app said it: the conversation was trimmed, the reply
   * hit the server's output limit. The person should see those in the
   * transcript and the model must NOT read them back as its own words. It never
   * said them, and a model that finds "I trimmed this conversation" in its own
   * prior speech will reason from it.
   */
  | { kind: 'note'; text: string; app?: true }
  | { kind: 'answer'; text: string }
  | { kind: 'error'; text: string }
  /**
   * What the model thought before answering, kept so a reopened conversation
   * still shows it. Never replayed to the model (`toTranscript` skips it): a
   * model reading its own old reasoning as context reasons from it, and pays
   * for the tokens. Capped at `MAX_THOUGHT_STORED` characters when saved.
   */
  | { kind: 'thought'; text: string }
  | {
      kind: 'step'
      /** The registry name, `graph.query`. */
      tool: string
      title: string
      effect: string
      args: unknown
      status: 'done' | 'failed' | 'declined'
      detail?: string
    }

export type ThreadProps = {
  slug: string
  /** The user's name for it, or the first thing they said, trimmed. */
  title: string
  entries: ThreadEntry[]
  /**
   * Let the agent write without stopping to ask. Absent means ask.
   *
   * Optional, so every conversation written before this existed keeps the safe
   * meaning — the same reason `PipelineProps.auto` is optional, and this is
   * that field's shape transplanted: a boolean on the record, validated as
   * optional, set by a one-field tool, and enforced at the point of USE rather
   * than in the tool. A tool that refused to set it could still be one commit
   * away from a graph where it disagreed with something else.
   *
   * Per conversation rather than per device, and that is a real choice with a
   * real cost. It is a statement about how much this person trusts the agent
   * for THIS piece of work — "this one is a cleanup session, stop asking me" —
   * which travels with them, so it is a record and Transfer carries it to the
   * phone. An endpoint would not be; see `model-settings-context.ts` for the
   * line that separates the two.
   */
  autoApprove?: boolean
  /**
   * How much this conversation is allowed to do without being asked.
   *
   * Three modes rather than a switch, because the switch had two settings and
   * three meanings. `autoApprove: true` mapped to the `destructive` gate — stop
   * for the fifteen tools that delete — which is neither "ask me about
   * everything" nor "act freely", and its label said only "act without asking".
   * Measured, that gap matters: both reasoning models in the benchmark close a
   * LIVE application when asked to close an ambiguous one, and a stage change
   * is a `move`, not a delete, so the old auto setting waved it through.
   *
   * `autoApprove` above is kept for conversations written before this existed
   * and is read only as a fallback — see `approvalOf`. Nothing writes it now.
   */
  approval?: ApprovalMode
  /**
   * What this conversation established, for the part of it no longer sent.
   *
   * A long chat outgrows the model's window, and the alternative to dropping
   * the beginning is remembering it in one line instead of forty. This is that
   * line: written when a compaction happens, carried on the THREAD so it
   * survives a reload and is not recomputed on every turn, and put in front of
   * the messages the model sees.
   *
   * Absent on every conversation that has never needed one, which is almost all
   * of them — one that fits is left exactly as it is, byte-identical, which is
   * also what keeps the provider's prefix cache warm.
   *
   * NOT shown in the transcript. A person can scroll up and read what actually
   * happened; this exists for the model, which cannot.
   */
  context?: string
  /**
   * How many entries `context` already accounts for.
   *
   * Without it a second compaction would summarise the same early exchanges
   * again — a summary of a summary — and each pass would blur what the last had
   * already blurred. This says where the summarised part ends, so the next
   * compaction starts at the first entry the summary does not cover.
   */
  contextThrough?: number
}
